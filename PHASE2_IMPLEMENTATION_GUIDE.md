# Phase 2 Implementation Guide: Incremental Daily Sync

**Prerequisite:** Phase 1 deployed and verified (API key working for 2+ hours)

**Objective:** Change daily sync from 400 days to 2 days, reducing API load by ~95%

**Estimated time:** 1 hour (deployment + testing) + 24-hour observation

---

## Understanding the Change

### Current Behavior (WASTEFUL)
```python
def handler(event, context):
    # ...
    sync_activities(api_key, days=400)  # ← Pulls 400 days EVERY day
```

**Daily impact:**
- Queries ~500 activities from Intervals.icu
- Writes ~500 rows to DynamoDB (even if unchanged)
- Takes 3-4 minutes to complete
- Wastes API quota on unchanged data

### New Behavior (EFFICIENT)
```python
def handler(event, context):
    # ...
    backfill_days = event.get("backfill_days")
    if backfill_days:
        # Manual full sync when explicitly requested
        sync_activities(api_key, days=int(backfill_days))
    else:
        # Normal daily sync — only recent activities
        sync_activities(api_key, days=2)
```

**Daily impact:**
- Queries ~2-5 activities from Intervals.icu
- Writes ~2-5 rows to DynamoDB
- Takes 10-30 seconds to complete
- Efficient use of API quota

---

## Step 1: Locate Handler Function

```bash
cd ~/fitness-dashboard-aws

# Find the handler function
grep -n "def handler" cdk/fitness_dashboard_aws/lambda/data_collector/handler.py
```

**Expected output:**
```
1111:def handler(event, context):
```

**The handler function is typically near the end of the file (line ~1100-1150)**

---

## Step 2: Modify Handler Function

### File: `cdk/fitness_dashboard_aws/lambda/data_collector/handler.py`

**Find the handler function (around line 1111):**

```python
def handler(event, context):
    """
    Lambda handler for fitness data collection.
    Triggered daily at 06:00 UTC by EventBridge.
    """
    logger.info("Fitness Dashboard Data Collector - Starting")
    
    # Get API credentials from Secrets Manager
    api_key = get_intervals_api_key()
    access_token = get_strava_access_token()
    
    # Sync all data sources
    sync_activities(api_key, days=400)  # ← FIND THIS LINE
    sync_wellness(api_key)
    sync_all_curves(api_key)
    sync_athlete(api_key)
    
    # ... rest of function
```

**Replace with:**

```python
def handler(event, context):
    """
    Lambda handler for fitness data collection.
    Triggered daily at 06:00 UTC by EventBridge.
    
    Event payloads:
      {} or {"source": "eventbridge-schedule"}  → Daily sync (2 days)
      {"backfill_days": 400}                   → Full backfill (manual)
      {"backfill_days": 7}                     → Week backfill
      {"refresh_streams": true}                → Re-sync 14d streams only
    """
    logger.info("Fitness Dashboard Data Collector - Starting")
    logger.info(f"Event payload: {json.dumps(event)}")
    
    # Get API credentials from Secrets Manager
    api_key = get_intervals_api_key()
    access_token = get_strava_access_token()
    
    # Check for manual backfill request
    backfill_days = event.get("backfill_days")
    if backfill_days:
        logger.info(f"Manual backfill requested: {backfill_days} days")
        sync_activities(api_key, days=int(backfill_days))
    else:
        # Normal daily sync — only last 2 days
        # Why 2 not 1:
        #   - Timezone edge cases (activity logged yesterday in local time, today in UTC)
        #   - Late uploads (activity completed yesterday, uploaded today)
        #   - Retroactive edits (someone edits yesterday's activity today)
        logger.info("Daily incremental sync: pulling last 2 days of activities")
        sync_activities(api_key, days=2)
    
    # Wellness, curves, athlete — unchanged (these are already efficient)
    sync_wellness(api_key)
    sync_all_curves(api_key)
    sync_athlete(api_key)
    
    # Segments and streams
    # (rest of handler unchanged)
    
    # ... rest of function
```

---

## Step 3: Commit and Deploy

```bash
cd ~/fitness-dashboard-aws

# Verify on feature branch
git branch
# Should show: * fix/api-cost-optimization

# Commit the change
git add cdk/fitness_dashboard_aws/lambda/data_collector/handler.py
git commit -m "feat(collector): change daily sync from 400 days to 2 days

- Normal daily sync now pulls only last 2 days (was 400)
- Manual backfill available via event payload: {\"backfill_days\": N}
- Reduces daily sync time from 3-4 minutes to 10-30 seconds
- Part of cost optimization Phase 2

Why 2 days:
- Timezone edge cases between UTC and local time
- Late activity uploads to Intervals.icu
- Retroactive edits/corrections

To manually backfill:
aws lambda invoke --function-name fitness-dashboard-data-collector \\
  --payload '{\"backfill_days\": 400}' response.json"

# Deploy
cd cdk
export PATH=~/cdk-local/node_modules/.bin:$PATH
cdk deploy FitnessDashboardCollector --require-approval never --exclusively --force

# The --force flag ensures Lambda code actually updates
# (CDK sometimes skips Lambda updates without this)
```

---

## Step 4: Verify Lambda Code Updated

```bash
# Get current Lambda code hash
aws lambda get-function --function-name fitness-dashboard-data-collector \
  --query 'Configuration.CodeSha256' --output text

# Compare with previous hash (saved in pre-implementation checklist)
# Should be DIFFERENT
```

**If hash is the SAME:**
```bash
# CDK didn't update the Lambda code
# Force update:
cd ~/fitness-dashboard-aws/cdk
rm -rf cdk.out
cdk deploy FitnessDashboardCollector --require-approval never --exclusively --force
```

---

## Step 5: Test Incremental Sync (Manual Invoke)

### Test 5A: Test Normal Daily Sync (2 days)

```bash
# Invoke Lambda with empty payload (simulates EventBridge trigger)
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"source": "manual-test"}' \
  --cli-binary-format raw-in-base64-out \
  response.json

# Check response
cat response.json
# Should see: {"statusCode": 200, ...}

# Check logs for confirmation
aws logs tail /aws/lambda/fitness-dashboard-data-collector --since 5m
```

**Look for in logs:**
```
Daily incremental sync: pulling last 2 days of activities
```

**Check duration:**
```bash
# Should complete in 10-30 seconds (much faster than 3-4 minutes)
aws logs filter-log-events \
  --log-group-name /aws/lambda/fitness-dashboard-data-collector \
  --start-time $(date -u -d '10 minutes ago' +%s)000 \
  --filter-pattern "Duration" \
  | grep Duration | tail -1
```

### Test 5B: Test Manual Backfill (400 days)

```bash
# Invoke with backfill payload
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"backfill_days": 400}' \
  --cli-binary-format raw-in-base64-out \
  response.json

# Check logs
aws logs tail /aws/lambda/fitness-dashboard-data-collector --since 5m --follow
```

**Look for in logs:**
```
Manual backfill requested: 400 days
```

**This should take 3-4 minutes (same as before) — that's expected for full backfill**

---

## Step 6: Verify Dashboard Data

### Check Recent Activities Appear

**Open dashboard:**
```
https://d3mtfyb3f9u51j.cloudfront.net/
```

**Verify:**
- [ ] Recent activities (last 2 days) are visible
- [ ] Activity counts look correct
- [ ] No missing data on overview page
- [ ] Activity detail pages work for recent activities

### Check DynamoDB for New Activity

```bash
# Get most recent activity from DynamoDB
aws dynamodb query \
  --table-name fitness-activities \
  --index-name athlete_id-start_date-index \
  --key-condition-expression "athlete_id = :aid" \
  --expression-attribute-values '{":aid": {"S": "5718022"}}' \
  --scan-index-forward false \
  --limit 5 \
  --output table
```

**Should show your most recent activities**

---

## Step 7: Wait for Next Automatic Sync

**The next EventBridge trigger is at 06:00 UTC daily**

**To verify automatic sync works with new 2-day logic:**

```bash
# Next morning after 06:00 UTC, check logs
aws logs filter-log-events \
  --log-group-name /aws/lambda/fitness-dashboard-data-collector \
  --start-time $(date -u -d 'today 06:00' +%s)000 \
  --filter-pattern "Daily incremental sync" \
  | grep "Daily incremental sync"
```

**Expected output:**
```
Daily incremental sync: pulling last 2 days of activities
```

---

## Step 8: Monitor for 24 Hours

### Check Lambda Duration Trend

```bash
# Get average duration over last 24 hours
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=fitness-dashboard-data-collector \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 86400 \
  --statistics Average,Maximum \
  --output table
```

**Expected:**
- Average duration: 10,000-30,000 ms (10-30 seconds)
- Was previously: 180,000-240,000 ms (3-4 minutes)
- **Reduction: ~85-90%**

### Check Dashboard Daily

**For next 3-4 days:**
- [ ] Visit dashboard each day
- [ ] Verify new activities appear within 24 hours
- [ ] Check no data gaps or missing activities
- [ ] Verify activity detail pages work

---

## Step 9: Document Monthly Backfill (Optional)

**If you want monthly full verification:**

Create file `/tmp/monthly-backfill-eventbridge-rule.json`:

```json
{
  "ScheduleExpression": "cron(0 6 1 * ? *)",
  "State": "ENABLED",
  "Description": "Monthly full 400-day backfill for belt-and-braces verification",
  "Targets": [
    {
      "Arn": "arn:aws:lambda:eu-west-2:656370357696:function:fitness-dashboard-data-collector",
      "Id": "MonthlyBackfill",
      "Input": "{\"backfill_days\": 400}"
    }
  ]
}
```

**Create the rule:**
```bash
aws events put-rule \
  --name fitness-dashboard-monthly-backfill \
  --schedule-expression "cron(0 6 1 * ? *)" \
  --description "Monthly 400-day backfill (1st of month at 06:00 UTC)" \
  --state ENABLED

# Add Lambda as target
aws events put-targets \
  --rule fitness-dashboard-monthly-backfill \
  --targets "Id=1,Arn=arn:aws:lambda:eu-west-2:656370357696:function:fitness-dashboard-data-collector,Input={\"backfill_days\":400}"

# Grant EventBridge permission to invoke Lambda
aws lambda add-permission \
  --function-name fitness-dashboard-data-collector \
  --statement-id AllowEventBridgeMonthlyBackfill \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:eu-west-2:656370357696:rule/fitness-dashboard-monthly-backfill
```

**This is OPTIONAL — 2-day incremental sync is sufficient for normal operation**

---

## Step 10: Rollback if Needed

**IF sync is missing activities:**

### Quick Fix: Run Manual Backfill

```bash
# Pull last 7 days to catch any missed activities
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"backfill_days": 7}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

### Full Rollback: Revert to 400 Days

```bash
cd ~/fitness-dashboard-aws

# Revert the commit
git revert HEAD

# Redeploy
cd cdk
cdk deploy FitnessDashboardCollector --require-approval never --exclusively --force

# Verify reverted
aws logs tail /aws/lambda/fitness-dashboard-data-collector --since 1h
# Should NOT see "Daily incremental sync" message after next run
```

---

## Step 11: Phase 2 Success Confirmation

**Confirm all criteria met:**

- [ ] Lambda runs in 10-30 seconds (was 3-4 minutes)
- [ ] New activities appear daily
- [ ] No missing activities over 3+ days observation
- [ ] Manual backfill tested and works
- [ ] Dashboard fully functional
- [ ] CloudWatch Duration metric shows 85-90% reduction

**If ALL confirmed:** Proceed to Phase 3 (API Gateway Caching)

**If ANY failures:** Run manual backfill and investigate

---

## Troubleshooting

### Issue: Activity from yesterday missing

**Likely cause:** Timezone edge case (activity logged late yesterday, after daily sync)

**Fix:** Next day's sync will catch it (2-day window covers this)

**Immediate fix:**
```bash
# Run 3-day backfill to catch it now
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"backfill_days": 3}' \
  response.json
```

### Issue: Multiple activities missing

**Cause:** Intervals.icu was down during sync, or sync failed

**Fix:**
```bash
# Run 7-day backfill
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"backfill_days": 7}' \
  response.json

# Check logs for errors
aws logs tail /aws/lambda/fitness-dashboard-data-collector --since 24h
```

### Issue: Lambda duration still 3-4 minutes

**Cause:** Code didn't update (CDK deployment skipped)

**Fix:**
```bash
cd ~/fitness-dashboard-aws/cdk
rm -rf cdk.out
cdk deploy FitnessDashboardCollector --force --require-approval never --exclusively

# Verify code hash changed
aws lambda get-function --function-name fitness-dashboard-data-collector \
  --query 'Configuration.CodeSha256' --output text
```

---

## Expected Cost Impact

**Before:**
- 400-day query: ~3-4 minutes execution time daily
- 500+ activities processed
- High DynamoDB write units

**After:**
- 2-day query: ~10-30 seconds execution time daily
- 2-5 activities processed
- Minimal DynamoDB write units

**Cost reduction: ~90-95% in daily sync overhead**

Combined with Phase 1 (bot protection), total reduction so far: **~80-85% of baseline cost**

---

## Next Steps

**After 24-hour observation period with no issues:**

→ Proceed to **Phase 3: API Gateway Caching** (separate guide)
