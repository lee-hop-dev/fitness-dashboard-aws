# Pre-Implementation Checklist & Verification

**Before starting ANY code changes**

---

## 1. Evidence Collection

### Check API Gateway Logs for Bot Traffic

```bash
# Download last 24 hours of API Gateway logs
aws logs filter-log-events \
  --log-group-name /aws/apigateway/fitness-dashboard \
  --start-time $(date -u -d '24 hours ago' +%s)000 \
  --query 'events[*].message' \
  --output text > api_logs_24h.txt

# Analyze user agents
grep -o '"userAgent":"[^"]*"' api_logs_24h.txt | sort | uniq -c | sort -rn | head -20

# Analyze IP addresses
grep -o '"sourceIp":"[^"]*"' api_logs_24h.txt | sort | uniq -c | sort -rn | head -20

# Count total requests
wc -l api_logs_24h.txt
```

**Expected findings:**
- Bot user-agents (Googlebot, Bingbot, etc.)
- Repeated IPs with high request counts
- Evidence that bots are the primary driver

### Check Lambda Invocation Costs

```bash
# Get Lambda invocation count (last 7 days)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=fitness-dashboard-query \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT00:00:00Z) \
  --end-time $(date -u +%Y-%m-%dT23:59:59Z) \
  --period 604800 \
  --statistics Sum \
  --output table

# Get daily collector duration (check if 400-day pull is slow)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=fitness-dashboard-data-collector \
  --start-time $(date -u -d '7 days ago' +%Y-%m-%dT00:00:00Z) \
  --end-time $(date -u +%Y-%m-%dT23:59:59Z) \
  --period 86400 \
  --statistics Average,Maximum \
  --output table
```

### Check Current Cost Trend

```bash
# Get cost estimate for current month
aws ce get-cost-and-usage \
  --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=SERVICE \
  --output table
```

**Document baseline numbers:**
- API Gateway requests/day: __________
- Lambda invocations/day: __________
- Average collector duration: __________
- Current month cost: __________

---

## 2. Repository Health Check

### Verify Clean Workspace

```bash
cd ~/fitness-dashboard-aws
git status
```

**Expected:** `nothing to commit, working tree clean`

**If dirty:**
```bash
# Review changes
git diff

# Stash or commit before proceeding
git stash  # or git add . && git commit -m "wip: save current state"
```

### Verify Latest Code

```bash
git fetch origin
git log origin/main..HEAD  # Should be empty
git log HEAD..origin/main  # Should be empty
```

**If behind origin:**
```bash
git pull origin main
```

### Check for Pending Changes

```bash
# Check if any files need deployment
git log -5 --oneline
git diff HEAD~5..HEAD --name-only
```

**Document:**
- Latest commit: __________
- Files changed recently: __________
- Safe to proceed: YES / NO

---

## 3. Create Backup Branch

```bash
cd ~/fitness-dashboard-aws

# Create backup of current state
git branch backup/pre-cost-fix-$(date +%Y%m%d)

# Create feature branch for work
git checkout -b fix/api-cost-optimization

# Verify
git branch
```

**Expected output:**
```
  backup/pre-cost-fix-20260515
* fix/api-cost-optimization
  main
```

---

## 4. Test Current System Functionality

### Dashboard Health Check

Visit each page and verify data loads:
- [ ] https://d3mtfyb3f9u51j.cloudfront.net/ (Overview)
- [ ] /cycling.html
- [ ] /running.html
- [ ] /rowing.html
- [ ] /activity.html?id=i{recent-activity-id}

**Document any existing issues:** __________

### API Endpoint Health Check

```bash
API_BASE="https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod"

# Test each endpoint (no auth currently)
curl -s "$API_BASE/athlete" | jq '.athlete_id'
curl -s "$API_BASE/activities?days=1" | jq '.count'
curl -s "$API_BASE/wellness?days=7" | jq '.count'
```

**All should return valid JSON. Document any failures:** __________

### Lambda Health Check

```bash
# Check last successful collector run
aws logs tail /aws/lambda/fitness-dashboard-data-collector \
  --since 48h \
  --filter-pattern "Sync complete" \
  | head -5
```

**Expected:** Recent "Sync complete" messages

---

## 5. Rollback Preparation

### Document Current CDK State

```bash
cd ~/fitness-dashboard-aws/cdk

# Get current stack info
cdk diff FitnessDashboardApi > /tmp/api_stack_before_changes.txt
cdk diff FitnessDashboardCollector > /tmp/collector_stack_before_changes.txt

# Document current Lambda code hash
aws lambda get-function --function-name fitness-dashboard-data-collector \
  --query 'Configuration.CodeSha256' --output text > /tmp/collector_lambda_hash_before.txt

aws lambda get-function --function-name fitness-dashboard-query \
  --query 'Configuration.CodeSha256' --output text > /tmp/query_lambda_hash_before.txt
```

### Create Rollback Script

Create `/tmp/rollback.sh`:

```bash
#!/bin/bash
set -e

echo "EMERGENCY ROLLBACK INITIATED"
echo "Reverting to pre-cost-fix state..."

cd ~/fitness-dashboard-aws

# Revert to backup branch
git checkout main
git reset --hard backup/pre-cost-fix-$(date +%Y%m%d)

# Redeploy original state
cd cdk
export PATH=~/cdk-local/node_modules/.bin:$PATH

echo "Deploying original API stack..."
cdk deploy FitnessDashboardApi --require-approval never --exclusively

echo "Deploying original Collector stack..."
cdk deploy FitnessDashboardCollector --require-approval never --exclusively --force

echo "Rollback complete. Test dashboard: https://d3mtfyb3f9u51j.cloudfront.net"
```

```bash
chmod +x /tmp/rollback.sh
```

---

## 6. Stakeholder Notification

### Pre-Implementation Email Template

```
Subject: Training OS V2 - API Cost Optimization Deployment

I'm about to deploy cost optimization changes to reduce AWS spending by 70-90%.

Changes:
1. API Gateway will require authentication (bot protection)
2. Daily sync will pull only recent data (2 days vs 400 days)
3. API responses will be cached (1 hour TTL)

Expected impact:
- Dashboard should function normally
- Data freshness unchanged (still updates at 06:00 UTC daily)
- Faster page load times (cached responses)

Timeline:
- Phase 1 deployment: Now
- Phase 2 deployment: +2 hours (if Phase 1 successful)
- Phase 3 deployment: +24 hours (if Phase 2 successful)

Rollback plan:
- Ready at each phase
- Can revert within 5 minutes if issues detected

I'll send confirmation once each phase is deployed and tested.
```

---

## 7. Final Pre-Flight Checks

- [ ] API Gateway logs analyzed (bot traffic confirmed)
- [ ] Baseline metrics documented
- [ ] Repository clean and up-to-date
- [ ] Backup branch created
- [ ] Feature branch created
- [ ] Current dashboard functionality verified
- [ ] Rollback script created and tested (dry-run)
- [ ] Stakeholder notified
- [ ] Time allocated (3-4 hours minimum)
- [ ] Low-traffic period selected (if applicable)

---

## 8. Implementation Time Windows

**Phase 1 (API Key):**
- Deployment: 15 minutes
- Testing: 30 minutes
- Observation: 2 hours
- **Total: 2h 45m**

**Phase 2 (Incremental Sync):**
- Deployment: 10 minutes
- Testing: 20 minutes
- Observation: 24 hours
- **Total: 24h 30m**

**Phase 3 (Caching):**
- Deployment: 5 minutes
- Testing: 15 minutes
- Observation: 24 hours
- **Total: 24h 20m**

**TOTAL ELAPSED TIME: ~50 hours (across 3 days)**

---

## 9. Communication Plan

### Progress Updates

Send update after each phase:

**Phase 1 Complete:**
```
Phase 1 deployed successfully.
- API key authentication active
- Rate limiting: 10 req/sec, 20 burst
- Dashboard tested and working
- Monitoring for 2 hours before Phase 2
```

**Phase 2 Complete:**
```
Phase 2 deployed successfully.
- Daily sync now pulls 2 days (was 400)
- Sync duration reduced from 4min to 30sec
- All data still appearing correctly
- Monitoring for 24 hours before Phase 3
```

**Phase 3 Complete:**
```
Phase 3 deployed successfully.
- API Gateway caching enabled (1-hour TTL)
- Cache hit ratio: XX%
- Response times: <100ms (cached)
- Cost reduction monitoring in progress
```

### Success Notification Template

```
Subject: Training OS V2 - Cost Optimization Complete

All three phases deployed and verified.

Results:
- Bot traffic eliminated (API key required)
- Daily sync time: 4min → 30sec
- API response times: 800ms → <100ms (cached)
- Lambda invocations: DOWN by XX%
- Estimated monthly cost: $XX → $X (XX% reduction)

Dashboard fully functional with no user-visible changes except faster load times.

No further action required.
```

---

## READY TO PROCEED?

**YES** - All checks complete, proceed to Phase 1  
**NO** - Address outstanding items above before starting
