# Phase 1 Implementation Guide: API Key Authentication

**Objective:** Add API key requirement to all GET endpoints to block bot traffic

**Estimated time:** 2-3 hours (deployment + testing + observation)

---

## Step 1: Modify CDK API Stack

### File: `cdk/fitness_dashboard_aws/api_stack.py`

#### Change 1A: Add API Key and Usage Plan (after line 169)

**Insert after the `self.api = apigw.RestApi(...)` block:**

```python
        # ── API Key for Bot Protection (Phase 1 Cost Fix) ────────────────────
        # All GET endpoints require this key. Frontend will embed it.
        # Bots without the key get 403 Forbidden.
        
        api_key = apigw.ApiKey(
            self,
            "DashboardApiKey",
            api_key_name="fitness-dashboard-frontend-key",
            description="API key for CloudFront dashboard (bot protection)",
            enabled=True,
        )

        # Usage plan with strict rate limits
        usage_plan = apigw.UsagePlan(
            self,
            "DashboardUsagePlan",
            name="fitness-dashboard-usage-plan",
            description="Rate-limited plan for legitimate dashboard traffic only",
            throttle=apigw.ThrottleSettings(
                rate_limit=10,      # 10 requests/second (generous for single-user)
                burst_limit=20,     # Allow burst up to 20
            ),
            quota=apigw.QuotaSettings(
                limit=10000,        # 10,000 requests/month (far more than needed)
                period=apigw.Period.MONTH,
            ),
        )

        # Link API key to usage plan
        usage_plan.add_api_key(api_key)
        usage_plan.add_api_stage(
            stage=self.api.deployment_stage,
        )
```

#### Change 1B: Require API Key on All GET Endpoints

**Find each `.add_method("GET", ...)` call and add `api_key_required=True`:**

**Line 186 - /activities:**
```python
# BEFORE:
activities.add_method("GET", query_integration)

# AFTER:
activities.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 188 - /activities/{id}:**
```python
# BEFORE:
activity_id.add_method("GET", query_integration)

# AFTER:
activity_id.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 191 - /wellness:**
```python
# BEFORE:
wellness.add_method("GET", query_integration)

# AFTER:
wellness.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 194 - /athlete:**
```python
# BEFORE:
athlete.add_method("GET", query_integration)

# AFTER:
athlete.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 197 - /power-curve:**
```python
# BEFORE:
power_curve.add_method("GET", query_integration)

# AFTER:
power_curve.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 200 - /pace-curve:**
```python
# BEFORE:
pace_curve.add_method("GET", query_integration)

# AFTER:
pace_curve.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 203 - /hr-curve:**
```python
# BEFORE:
hr_curve.add_method("GET", query_integration)

# AFTER:
hr_curve.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 206 - /weekly-tss:**
```python
# BEFORE:
weekly_tss.add_method("GET", query_integration)

# AFTER:
weekly_tss.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

**Line 209 - /ytd:**
```python
# BEFORE:
ytd.add_method("GET", query_integration)

# AFTER:
ytd.add_method(
    "GET",
    query_integration,
    api_key_required=True,
)
```

#### Change 1C: Add CloudFormation Output for API Key

**Add at the end of api_stack.py (after other CfnOutput blocks):**

```python
        CfnOutput(
            self,
            "DashboardApiKeyId",
            value=api_key.key_id,
            description="API Key ID (retrieve full key from AWS Console Secrets Manager)",
            export_name="FitnessDashboardApiKeyId",
        )
```

---

## Step 2: Deploy API Stack Changes

```bash
cd ~/fitness-dashboard-aws

# Verify on feature branch
git branch
# Should show: * fix/api-cost-optimization

# Commit the CDK change
git add cdk/fitness_dashboard_aws/api_stack.py
git commit -m "feat(api): add API key requirement for bot protection

- Add API key 'fitness-dashboard-frontend-key'
- Require key on all GET endpoints (/activities, /wellness, /athlete, curves, /ytd)
- Rate limit: 10 req/sec, burst 20, quota 10k/month
- Part of cost optimization Phase 1"

# Deploy
cd cdk
export PATH=~/cdk-local/node_modules/.bin:$PATH
cdk deploy FitnessDashboardApi --require-approval never --exclusively

# Should see output including:
# ✅  FitnessDashboardApi
# Outputs:
# FitnessDashboardApi.DashboardApiKeyId = xxxxxxxxx
```

---

## Step 3: Retrieve API Key Value

```bash
# Get the key ID from CloudFormation output
KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name FitnessDashboardApi \
  --query 'Stacks[0].Outputs[?OutputKey==`DashboardApiKeyId`].OutputValue' \
  --output text)

echo "API Key ID: $KEY_ID"

# Retrieve the actual API key value
API_KEY=$(aws apigateway get-api-key --api-key $KEY_ID --include-value \
  --query 'value' --output text)

echo "API Key Value: $API_KEY"

# SAVE THIS VALUE SECURELY — you'll need it for frontend
echo "$API_KEY" > /tmp/dashboard_api_key.txt
chmod 600 /tmp/dashboard_api_key.txt
```

---

## Step 4: Find and Update Frontend Data Loader

```bash
cd ~/fitness-dashboard-aws

# Find which file makes API calls
grep -r "j2zxz92vd4.execute-api" frontend/ docs/ 2>/dev/null | head -5
# or
grep -r "fetch.*prod" frontend/ docs/ 2>/dev/null | head -5
```

**Expected output will show the data loader file (likely `docs/assets/js/data-loader.js` or similar)**

### Update the fetch calls

**Find the pattern:**
```javascript
fetch(url)
// or
fetch(url, {})
```

**Replace with:**
```javascript
fetch(url, {
    headers: {
        'x-api-key': 'YOUR-API-KEY-HERE'  // Paste actual key from Step 3
    }
})
```

**Example before:**
```javascript
async function fetchActivities(days = 14) {
    const response = await fetch(`${API_BASE}/activities?days=${days}`);
    return response.json();
}
```

**Example after:**
```javascript
async function fetchActivities(days = 14) {
    const response = await fetch(`${API_BASE}/activities?days=${days}`, {
        headers: {
            'x-api-key': 'abcd1234your-actual-key-here'
        }
    });
    return response.json();
}
```

**CRITICAL:** Update EVERY fetch() call that hits the API Gateway. Search for all instances.

---

## Step 5: Deploy Frontend with API Key

```bash
cd ~/fitness-dashboard-aws

# Commit frontend change
git add docs/   # or frontend/ depending on structure
git commit -m "feat(frontend): add API key header to all API requests

- Required for bot protection (Phase 1)
- Key embedded in data-loader.js
- All fetch() calls now include x-api-key header"

# Deploy frontend
bash scripts/deploy_frontend.sh

# Script automatically:
# - Syncs to S3 (excluding Lambda-managed files)
# - Invalidates CloudFront cache
# - Waits for invalidation to complete
```

---

## Step 6: Test Dashboard Functionality

### Test 6A: Dashboard Loads Correctly

**Open in browser:**
```
https://d3mtfyb3f9u51j.cloudfront.net/
```

**Check each page:**
- [ ] Overview page loads with data
- [ ] Cycling page shows power curves
- [ ] Running page shows pace data
- [ ] Rowing page loads
- [ ] Activity detail page works

**If any page fails:**
- Open browser DevTools (F12)
- Check Console for errors
- Look for 403 Forbidden responses
- Verify API key is being sent in headers

### Test 6B: Bot Protection Active

**Test API without key (should fail):**
```bash
# This should return 403 Forbidden
curl https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/athlete
# Expected: {"message":"Forbidden"}
```

**Test API with key (should succeed):**
```bash
# This should return JSON data
curl -H "x-api-key: YOUR-KEY-HERE" \
  https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/athlete
# Expected: {"athlete_id":"5718022", ...}
```

---

## Step 7: Monitor for 2 Hours

### Check Lambda Invocations

```bash
# Watch invocations in real-time
watch -n 60 'aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=fitness-dashboard-query \
  --start-time $(date -u -d "1 hour ago" +%Y-%m-%dT%H:00:00Z) \
  --end-time $(date -u +%Y-%m-%dT%H:59:59Z) \
  --period 3600 \
  --statistics Sum \
  --output table'
```

### Check API Gateway Logs

```bash
# Check last 100 requests
aws logs tail /aws/apigateway/fitness-dashboard --since 1h | head -100

# Count 403 (blocked) vs 200 (legitimate)
aws logs filter-log-events \
  --log-group-name /aws/apigateway/fitness-dashboard \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern '"status": 403' \
  | grep -c "403"

aws logs filter-log-events \
  --log-group-name /aws/apigateway/fitness-dashboard \
  --start-time $(date -u -d '1 hour ago' +%s)000 \
  --filter-pattern '"status": 200' \
  | grep -c "200"
```

**Expected:**
- 403 count should be HIGH (bots blocked)
- 200 count should be LOW (only legitimate dashboard use)

---

## Step 8: Rollback if Needed

**IF dashboard is broken:**

```bash
cd ~/fitness-dashboard-aws

# Option A: Revert frontend only (if API changes work but frontend broken)
git revert HEAD  # Reverts the frontend commit
bash scripts/deploy_frontend.sh

# Option B: Full rollback (if API changes are the problem)
/tmp/rollback.sh
```

---

## Step 9: Phase 1 Success Confirmation

**Confirm all criteria met:**

- [ ] Dashboard fully functional
- [ ] All pages load with data
- [ ] No console errors in browser
- [ ] Bot requests return 403 Forbidden
- [ ] Legitimate requests return 200 OK
- [ ] Lambda invocations significantly reduced
- [ ] Monitored for 2+ hours without issues

**If ALL confirmed:** Proceed to Phase 2 (Incremental Sync)

**If ANY failures:** Investigate and fix before proceeding

---

## Troubleshooting

### Issue: Dashboard shows "Forbidden" errors

**Cause:** API key not set correctly in frontend

**Fix:**
1. Verify API key value is correct
2. Check that EVERY fetch() call includes the header
3. Clear browser cache and reload
4. Check CloudFront invalidation completed

### Issue: Some pages work, others don't

**Cause:** Missed one or more fetch() calls when adding headers

**Fix:**
```bash
# Find all fetch calls
grep -n "fetch(" docs/assets/js/*.js

# Verify each one has headers with x-api-key
```

### Issue: API Gateway returns 429 (Too Many Requests)

**Cause:** Rate limit too strict

**Fix:** Increase rate_limit in CDK:
```python
rate_limit=20,  # Increase from 10 to 20
```
Then redeploy API stack.

---

## Next Steps

**After 2-hour observation period with no issues:**

→ Proceed to **Phase 2: Incremental Daily Sync** (separate guide)
