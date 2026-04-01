# Phase 5 Deployment Guide

**Date:** 1 April 2026  
**Status:** Ready to deploy  
**Commit:** `6a7e884` - feat(phase5): add monitoring, budget alerts, and emergency kill switch

---

## What This Deploys

### New AWS Resources:
1. **SNS Topics** (2):
   - `fitness-dashboard-alerts` - Email alerts for all monitoring
   - `fitness-dashboard-shutdown-trigger` - Auto-shutdown at $10 budget

2. **CloudWatch Alarms** (7):
   - Collector Lambda errors (3+ in 5min)
   - API Lambda errors (5+ in 5min)
   - API Gateway 5xx errors (5+ in 5min)
   - Collector duration > 10s
   - API Gateway latency p99 > 2s
   - DynamoDB throttled requests
   - Budget thresholds (4 tiers)

3. **CloudWatch Dashboard**:
   - Name: `fitness-dashboard-ops`
   - 4 rows × metrics (errors, volumes, performance, DynamoDB)

4. **AWS Budget**:
   - $10/month limit with 4-tier alerts ($2.40, $3, $5, $10)

5. **Emergency Shutdown Lambda**:
   - Function: `fitness-dashboard-emergency-shutdown`
   - API endpoint: `POST /emergency-shutdown`
   - Kill switch URL (see outputs after deploy)

---

## Deployment Steps

### 1. Navigate to CDK Directory
```bash
cd /path/to/fitness-dashboard-aws/cdk
```

### 2. Activate CDK Virtual Environment
```bash
# Mac/Linux:
source .venv/bin/activate

# Windows:
.venv\Scripts\activate
```

### 3. Synthesize CDK Stacks (Check for Errors)
```bash
cdk synth
```

**Expected output:** CloudFormation templates for all 8 stacks  
**If errors:** Check Python syntax or missing dependencies

### 4. Deploy All Phase 5 Stacks
```bash
cdk deploy --all
```

**What happens:**
- CDK will show a preview of all resources to create
- You'll be asked to confirm IAM role changes (type `y`)
- Deployment takes ~5-10 minutes

**Stacks deployed:**
- `FitnessDashboardMonitoring`
- `FitnessDashboardBudget`
- `FitnessDashboardEmergencyShutdown`

### 5. Confirm SNS Email Subscription

**After deployment, you'll receive 2 emails:**
1. From: `AWS Notifications <no-reply@sns.amazonaws.com>`
2. Subject: `AWS Notification - Subscription Confirmation`

**Action required:**
- Click "Confirm subscription" link in BOTH emails
- One for `fitness-dashboard-alerts` (monitoring)
- One for `fitness-dashboard-shutdown-trigger` (budget auto-shutdown)

**Until confirmed:** You won't receive alerts!

### 6. Save Kill Switch URL

**After deployment completes, CDK outputs:**
```
FitnessDashboardEmergencyShutdown.KillSwitchURL = 
https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/emergency-shutdown?token=XXXXX
```

**Action required:**
1. Copy the full URL (including token)
2. Save as browser bookmark: `🚨 AWS KILL SWITCH`
3. Test it (see Testing section below)

---

## Testing the Kill Switch

### Test Emergency Shutdown (Safe)

**Method 1: Browser**
1. Open the kill switch URL in your browser
2. Should see JSON response:
   ```json
   {
     "status": "shutdown_complete",
     "trigger": "manual_api_call",
     "actions": [
       "✅ Disabled EventBridge rule: fitness-dashboard-daily-sync",
       "✅ Throttled API Gateway: xxx/prod to 0 req/sec",
       "✅ Sent confirmation email to alert topic"
     ]
   }
   ```
3. Check email for shutdown confirmation

**Method 2: curl (from terminal)**
```bash
curl -X POST "https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/emergency-shutdown?token=YOUR_TOKEN"
```

### Verify Shutdown Worked

1. **Check EventBridge:**
   - AWS Console → EventBridge → Rules
   - Rule `fitness-dashboard-daily-sync` should show "Disabled"

2. **Check API Gateway:**
   - Try loading dashboard: https://d3mtfyb3f9u51j.cloudfront.net
   - Should see "Failed to fetch" or API errors

3. **Check Email:**
   - Should receive email titled: `🚨 EMERGENCY SHUTDOWN ACTIVATED`

### Re-Enable Services After Test

**Option A: AWS Console**
1. **EventBridge:**
   - Go to EventBridge → Rules → `fitness-dashboard-daily-sync`
   - Click "Enable"

2. **API Gateway:**
   - Go to API Gateway → `fitness-dashboard-api` → Stages → `prod`
   - Throttle Settings → Rate: `20`, Burst: `50`
   - Click "Save Changes"
   - Actions → Deploy API → Stage: `prod`

**Option B: Re-deploy Stack**
```bash
cdk deploy FitnessDashboardCollector FitnessDashboardApi
```

---

## Accessing the CloudWatch Dashboard

**Method 1: Direct URL**
```
https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2#dashboards:name=fitness-dashboard-ops
```

**Method 2: AWS Console Navigation**
1. Sign in: https://console.aws.amazon.com
2. Region selector → `Europe (London) eu-west-2`
3. Services → CloudWatch
4. Left sidebar → Dashboards
5. Click `fitness-dashboard-ops`

**Mobile Access:**
- Works on phone/tablet browsers
- Layout adapts to screen size
- Can check during alerts

---

## Expected Alert Scenarios

### Budget Alert: $2.40/month (Tier 1)
**Email subject:** `AWS Budgets: fitness-dashboard-monthly-cost has exceeded your alert threshold`  
**Action:** Review CloudWatch dashboard, check if usage is expected

### Budget Alert: $3.00/month (Tier 2)
**Email subject:** Similar to Tier 1  
**Action:** Investigate usage patterns, consider optimizing

### Budget Alert: $5.00/month (Tier 3 - Critical)
**Email subject:** Similar but more urgent  
**Action:** Immediate investigation required

### Budget Alert: $10.00/month (Tier 4 - Auto-Shutdown)
**Email 1:** Budget alert  
**Email 2:** `🚨 EMERGENCY SHUTDOWN ACTIVATED`  
**Action:** Services stopped automatically, follow re-enable steps

### Lambda Error Alert
**Email subject:** `ALARM: "fitness-dashboard-collector-errors" in EU (London)`  
**Action:** Check CloudWatch logs, verify Intervals.icu API is accessible

---

## Cost Tracking

**During Free Tier (First 12 Months):**
- Expected cost: $0.00 - $0.50/month
- Budget alerts should NOT trigger unless something unusual happens

**Post-Free-Tier (Month 13+):**
- Expected cost: ~$2-4/month
- Tier 1 alert ($2.40) = normal operation
- Tier 2 alert ($3) = slightly elevated, review logs
- Tier 3+ = investigate immediately

---

## Troubleshooting

### Deployment Fails: "Stack FitnessDashboardMonitoring already exists"
**Solution:** Stack was partially created. Run:
```bash
cdk destroy FitnessDashboardMonitoring
cdk deploy FitnessDashboardMonitoring
```

### Deployment Fails: IAM Permission Denied
**Solution:** Verify IAM user has AdministratorAccess:
```bash
aws sts get-caller-identity
aws iam list-attached-user-policies --user-name lee-admin
```

### SNS Subscription Email Not Received
**Solution:** 
1. Check spam/junk folder
2. Verify email in SNS console:
   - AWS Console → SNS → Subscriptions
   - Should see `lee.hopkins+aws-alerts@gmail.com` with status "Pending confirmation"
3. Click "Request confirmation" in console

### Kill Switch Returns 401 Unauthorized
**Solution:** Token mismatch. Get correct token:
```bash
aws cloudformation describe-stacks \
  --stack-name FitnessDashboardEmergencyShutdown \
  --query "Stacks[0].Outputs[?OutputKey=='ShutdownToken'].OutputValue" \
  --output text
```

### Dashboard Shows "No Data"
**Solution:** Widgets need time to populate. Wait 5-10 minutes after first API call.

---

## Post-Deployment Checklist

- [ ] All 3 stacks deployed successfully
- [ ] SNS email subscriptions confirmed (2 emails)
- [ ] Kill switch URL bookmarked
- [ ] Kill switch tested (shutdown + re-enable)
- [ ] CloudWatch dashboard accessible
- [ ] First budget alert received (if any usage)
- [ ] Dashboard showing live data

---

## Next Steps (Phase 6)

With monitoring in place, you can now confidently:
1. Start building AI training coach integration
2. Experiment with new features knowing costs are capped
3. Monitor performance and optimize bottlenecks
4. Use dashboard for portfolio demos

**Documentation:** Phase 6 planning (AI coach architecture)

---

*Created: 1 April 2026*  
*Status: Ready for deployment*  
*Estimated deployment time: 10 minutes*
