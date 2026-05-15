# Training OS V2 — API Cost Issue Analysis & Fix Plan

**Date:** May 2026  
**Status:** PRE-IMPLEMENTATION PLANNING  
**Priority:** CRITICAL — Bot traffic driving excessive costs  

---

## Executive Summary

### Primary Cost Drivers (Ranked by Impact)

1. **🔴 BOT/CRAWLER TRAFFIC** — Unrestricted API Gateway access (HIGHEST IMPACT)
   - No API key requirement
   - No rate limiting per IP/user-agent
   - Bots hitting `/activities`, `/wellness`, `/athlete` repeatedly
   - **Estimated 70-80% of excess cost**

2. **🟡 UNNECESSARY 400-DAY SYNC** — Daily full history pull (MEDIUM IMPACT)
   - `sync_activities(days=400)` runs every 06:00 UTC
   - After initial backfill, only need new activities (last 1-2 days)
   - **Estimated 15-20% of excess cost**

3. **🟡 NO API GATEWAY CACHING** — Every request hits Lambda (MEDIUM IMPACT)
   - Line 167 in api_stack.py: `caching_enabled=False`
   - Data changes once daily but cache disabled
   - **Estimated 10-15% of excess cost**

4. **🟢 REDUNDANT STREAM API CALLS** — 2 calls per activity (LOW IMPACT)
   - Only affects 14-day window (~20 activities)
   - 40 calls vs 20 calls per sync
   - **Estimated 5% of excess cost**

### Recommended Fix Priority

**Phase 1 (IMMEDIATE):** Bot protection + API key enforcement  
**Phase 2 (SAME DAY):** Reduce daily sync to incremental (1-2 days)  
**Phase 3 (NEXT DAY):** Enable API Gateway caching  
**Phase 4 (FUTURE):** Consolidate stream API calls (low priority)

---

## PHASE 1: Bot Protection (CRITICAL — Deploy First)

### Problem Statement

API Gateway is **completely open** to the internet. No authentication, no rate limiting. Bots and crawlers can make unlimited requests, triggering Lambda → DynamoDB reads on every hit.

**Evidence from logs needed:**
- Check CloudWatch API Gateway access logs for repeated IPs
- Check for user-agents: bots, scrapers, SEO crawlers
- Identify top requesters by IP/user-agent

### Current Architecture (VULNERABLE)

```
Internet (Anyone) 
  ↓ 
API Gateway (NO AUTH, NO RATE LIMIT)
  ↓
Lambda (Cold starts + execution time)
  ↓
DynamoDB (Read capacity units)
```

### Solution: CloudFront → API Key + WAF

**New Architecture:**

```
Internet
  ↓
CloudFront (Only serves dashboard to legitimate users)
  ↓ (Dashboard makes API calls with embedded key)
API Gateway (REQUIRES API KEY + Rate Limit)
  ↓ (WAF blocks malicious IPs)
Lambda (Only legitimate traffic)
  ↓
DynamoDB
```

### Implementation Steps

#### Step 1A: Add API Key to API Gateway (CDK Changes)

**File:** `cdk/fitness_dashboard_aws/api_stack.py`

**Add after line 169 (after api creation):**

```python
# Create API key for legitimate dashboard traffic
api_key = apigw.ApiKey(
    self,
    "DashboardApiKey",
    api_key_name="fitness-dashboard-frontend-key",
    description="API key for CloudFront dashboard to access backend",
    enabled=True,
)

# Create usage plan with rate limits
usage_plan = apigw.UsagePlan(
    self,
    "DashboardUsagePlan",
    name="fitness-dashboard-usage-plan",
    description="Rate-limited usage plan for dashboard",
    throttle=apigw.ThrottleSettings(
        rate_limit=10,      # 10 requests per second (reasonable for single user)
        burst_limit=20,     # Burst up to 20
    ),
    quota=apigw.QuotaSettings(
        limit=10000,        # 10,000 requests per month (way more than needed)
        period=apigw.Period.MONTH,
    ),
)

# Associate API key with usage plan
usage_plan.add_api_key(api_key)
usage_plan.add_api_stage(
    stage=self.api.deployment_stage,
)

# CRITICAL: Make all GET endpoints require API key
# Modify each endpoint creation to include api_key_required=True
```

**Modify existing endpoint definitions (lines 186-209):**

```python
# BEFORE:
activities.add_method("GET", query_integration)

# AFTER:
activities.add_method(
    "GET", 
    query_integration,
    api_key_required=True  # ← ADD THIS
)
```

**Apply to ALL read endpoints:**
- `/activities` (line 186)
- `/activities/{id}` (line 188)
- `/wellness` (line 191)
- `/athlete` (line 194)
- `/power-curve` (line 197)
- `/pace-curve` (line 200)
- `/hr-curve` (line 203)
- `/weekly-tss` (line 206)
- `/ytd` (line 209)

**Output API key to CloudFormation:**

```python
CfnOutput(
    self,
    "DashboardApiKeyId",
    value=api_key.key_id,
    description="API Key ID for dashboard (retrieve value from console)",
)
```

#### Step 1B: Update Frontend to Use API Key

**File:** Check which JS file makes API calls

```bash
cd /tmp/fda
grep -r "fetch.*j2zxz92vd4" frontend/ docs/
```

Find the data loader and add API key header:

```javascript
// Before
const response = await fetch(url);

// After
const response = await fetch(url, {
    headers: {
        'x-api-key': 'YOUR-API-KEY-HERE'  // Retrieved from AWS Console
    }
});
```

#### Step 1C: Deployment & Testing

**Deploy CDK changes:**
```bash
cd ~/fitness-dashboard-aws/cdk
export PATH=~/cdk-local/node_modules/.bin:$PATH
cdk deploy FitnessDashboardApi --require-approval never --exclusively
```

**Retrieve API key value:**
```bash
aws apigateway get-api-keys --include-values \
  --query "items[?name=='fitness-dashboard-frontend-key'].value" \
  --output text
```

**Update frontend JS with key, deploy frontend:**
```bash
cd ~/fitness-dashboard-aws
# Edit frontend JS file with API key
bash scripts/deploy_frontend.sh
```

**Test:**
1. Open dashboard — should work normally
2. Try hitting API directly without key — should get 403 Forbidden
3. Monitor CloudWatch logs for reduced invocations

#### Step 1D: Rollback Plan

**IF frontend breaks (API calls fail):**

```bash
# Immediate rollback — remove api_key_required from CDK
cd ~/fitness-dashboard-aws/cdk
# Comment out api_key_required=True on all endpoints
cdk deploy FitnessDashboardApi --require-approval never --exclusively
```

**Rollback window:** Keep old code in separate commit for 24 hours before confirming success.

---

## PHASE 2: Incremental Daily Sync (HIGH IMPACT)

### Problem Statement

**Current:** `sync_activities(api_key, days=400)` runs EVERY day at 06:00 UTC

This pulls **400 days of history** (potentially 500+ activities) when only 1-2 new activities exist since yesterday.

### Analysis

**Initial backfill (first run):** 400 days needed ✓  
**Daily sync (every subsequent run):** Only need NEW activities since last sync ✓

**Current waste:**
- 400-day query to Intervals.icu API daily
- 500+ activity writes to DynamoDB (with conditional write = read + write capacity)
- Most activities unchanged (wasted writes)

### Solution: Incremental Sync with Manual Backfill

**New sync strategy:**

```python
def sync_activities(api_key: str, days: int = 2) -> dict:
    """
    Sync recent activities only (default: last 2 days).
    
    Why 2 days not 1:
    - Timezone edge cases (UTC vs local)    - Late activity uploads to Intervals.icu
    - Retroactive edits/corrections
    
    For full backfill, invoke with: {"backfill_days": 400}
    """
```

### Implementation

#### Step 2A: Modify Lambda Handler

**File:** `cdk/fitness_dashboard_aws/lambda/data_collector/handler.py`

**Change default from 400 to 2 days:**

```python
def handler(event, context):
    """
    Main handler for data collection.
    
    Event payloads:
      {} or {"source": "eventbridge-schedule"}  → Daily sync (2 days)
      {"backfill_days": 400}                   → Full backfill (manual)
      {"refresh_streams": true}                → Re-sync all 14d streams
    """
    logger.info(f"Handler invoked with event: {json.dumps(event)}")
    
    # Retrieve secrets
    api_key = get_intervals_api_key()
    access_token = get_strava_access_token()
    
    # Check for manual backfill request
    backfill_days = event.get("backfill_days")
    if backfill_days:
        logger.info(f"Manual backfill requested: {backfill_days} days")
        sync_activities(api_key, days=int(backfill_days))
    else:
        # Normal daily sync — only last 2 days
        logger.info("Daily sync: pulling last 2 days of activities")
        sync_activities(api_key, days=2)  # ← CHANGED FROM 400
    
    # Rest of sync functions unchanged
    sync_wellness(api_key)
    sync_all_curves(api_key)
    sync_athlete(api_key)
    sync_segments(activities, access_token)
    
    # Stream sync
    if event.get("refresh_streams"):
        logger.info("Stream refresh requested")
    sync_streams_14d(api_key, access_token)
    
    return {"statusCode": 200, "body": "Sync complete"}
```

#### Step 2B: Document Manual Backfill

Create runbook entry for when full sync needed.

#### Step 2C: Expected Impact

**Before:** 400 days × ~500 activities  
**After:** 2 days × ~2-5 activities  
**Cost reduction:** ~95% reduction in daily sync

---

## PHASE 3: API Gateway Caching

### Change

**File:** `cdk/fitness_dashboard_aws/api_stack.py` (line 167)

```python
caching_enabled=True,  # ← CHANGE FROM False
cache_ttl=Duration.hours(1),
cache_data_encrypted=False,
```

### Why 1 Hour?

- Data changes once daily (06:00 UTC)
- 1-hour cache = max 24 invocations/day per endpoint
- User sees max 1-hour stale data (acceptable)

---

## PHASE 4: Consolidate Stream API Calls (LOW PRIORITY)

Only implement AFTER Phases 1-3 confirmed working.

### Investigation Required

Test if `/activity/{id}?intervals=true` includes stream data.

**IF YES:** Modify `_fetch_laps()` to return `(laps, meta, streams)` tuple and remove `_fetch_stream_data()`.

**IF NO:** Leave as-is (minimal impact).

---

## Implementation Timeline

### Day 1 Morning
- **Phase 1:** API key + rate limiting (2 hours)
- Test dashboard, monitor logs
- **DECISION POINT:** If working, proceed to Phase 2

### Day 1 Afternoon
- **Phase 2:** Change days=400 to days=2 (30 minutes)
- Test incremental sync
- Monitor for 24 hours

### Day 2
- **Phase 3:** Enable caching (15 minutes)
- Monitor cost reduction

### Future (Optional)
- **Phase 4:** Stream API consolidation

---

## Risk Mitigation

### Rollback Points

**After each phase:** 24-hour observation before next phase

**Rollback triggers:**
- Dashboard fails to load
- Data missing/stale
- Lambda errors spike
- Cost increases

### Testing Checklist

After each deployment:
- [ ] Dashboard loads normally
- [ ] All pages show data
- [ ] Activity detail pages work
- [ ] No console errors
- [ ] CloudWatch shows reduced invocations
- [ ] Cost trends downward in billing dashboard

---

## Monitoring Plan

### Metrics to Track

**Before fix (baseline):**
- Lambda invocations per day
- API Gateway requests per day
- DynamoDB read/write units per day
- Daily cost

**After Phase 1:**
- Should see 70-80% reduction in API Gateway requests
- Legitimate traffic only

**After Phase 2:**
- Should see Lambda runtime drop significantly (2-day vs 400-day query)

**After Phase 3:**
- Should see repeated requests served from cache (check cache hit ratio)

### CloudWatch Queries

```bash
# API Gateway requests per day
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=fitness-dashboard-api \
  --start-time 2026-05-14T00:00:00Z \
  --end-time 2026-05-15T00:00:00Z \
  --period 86400 \
  --statistics Sum

# Lambda invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=fitness-dashboard-query \
  --start-time 2026-05-14T00:00:00Z \
  --end-time 2026-05-15T00:00:00Z \
  --period 86400 \
  --statistics Sum
```

---

## Code Review Checklist

### Before Any Changes

- [ ] Current repo clean (no uncommitted changes)
- [ ] Latest commit pulled from remote
- [ ] Create feature branch: `git checkout -b fix/api-cost-optimization`

### Code Quality Standards

- [ ] One logical change per commit
- [ ] Conventional commit messages
- [ ] No hardcoded values (use environment variables)
- [ ] Error handling on all API calls
- [ ] Logging at appropriate levels
- [ ] Comments explain "why" not "what"

### Testing Standards

- [ ] Test happy path
- [ ] Test error conditions
- [ ] Test rollback procedure
- [ ] Verify no regressions on existing features

---

## Success Criteria

### Phase 1 Success
- [ ] API requires key
- [ ] Rate limiting enforced
- [ ] Bot traffic blocked (check logs)
- [ ] Dashboard still works for legitimate users

### Phase 2 Success
- [ ] Daily sync completes in <1 minute (vs 3-4 minutes)
- [ ] New activities appear within 24 hours
- [ ] No missing data on dashboard

### Phase 3 Success
- [ ] Cache hit ratio >80% for frequently accessed endpoints
- [ ] Response times <100ms for cached requests
- [ ] Fresh data appears within 1 hour of sync

### Overall Success
- [ ] Cost reduced by 70-90%
- [ ] All dashboard functionality intact
- [ ] No user-visible changes (except faster load times)

---

## Next Steps

1. **Review this plan** with stakeholder
2. **Check API Gateway logs** to confirm bot traffic (evidence needed)
3. **Get approval** to proceed
4. **Schedule implementation window** (low-traffic time)
5. **Execute Phase 1** with rollback plan ready

**Estimated total implementation time:** 3-4 hours across 2 days  
**Risk level:** Low (incremental with rollback at each stage)  
**Expected cost reduction:** 70-90%

