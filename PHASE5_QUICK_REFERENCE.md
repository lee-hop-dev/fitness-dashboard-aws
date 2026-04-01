# Phase 5 Quick Reference Card

**Status:** Deployed | **Region:** eu-west-2 (London) | **Cost Target:** <$3/month

---

## 📊 CloudWatch Dashboard
**URL:** https://eu-west-2.console.aws.amazon.com/cloudwatch/home?region=eu-west-2#dashboards:name=fitness-dashboard-ops

**What to check:**
- Top row: Any errors? (should all be 0)
- Lambda invocations: ~30-40/day expected
- API requests: ~100-500/day expected (increases as you use dashboard)
- Performance: Lambda duration <5s, API latency <500ms

---

## 🚨 Kill Switch
**Bookmark URL:** (see CloudFormation outputs after deploy)
```
https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/emergency-shutdown?token=XXXXX
```

**When to use:**
- Budget alert at $5+ received
- Unexpected AWS charges
- Something broken and racking up costs
- Need to stop all services immediately

**What it does:**
1. Disables daily data sync (EventBridge rule)
2. Blocks all API calls (throttle to 0)
3. Sends confirmation email
4. Dashboard goes offline (expected)

**Recovery:**
- Re-enable EventBridge rule in console
- Reset API Gateway throttle to 20/50
- Or re-deploy: `cdk deploy FitnessDashboardCollector FitnessDashboardApi`

---

## 💰 Budget Thresholds

| Tier | Threshold | Action |
|------|-----------|--------|
| 1    | $2.40     | ℹ️ FYI: Usage trending up |
| 2    | $3.00     | ⚠️ Review usage patterns |
| 3    | $5.00     | 🔴 Critical: Investigate immediately |
| 4    | $10.00    | 🚨 **AUTO-SHUTDOWN TRIGGERED** |

**Normal operation:** $0-0.50 during free tier, ~$2-3 post-free-tier

---

## 📧 Email Alerts

**From:** `AWS Notifications <no-reply@sns.amazonaws.com>`  
**To:** `lee.hopkins+aws-alerts@gmail.com`

**Alert types:**
- Budget exceeded threshold
- Lambda errors (3+ in 5 min)
- API Gateway 5xx errors (5+ in 5 min)
- Performance degradation (slow responses)
- Emergency shutdown activated

---

## 🔧 Common Commands

**Deploy monitoring updates:**
```bash
cd ~/fitness-dashboard-aws/cdk
source .venv/bin/activate
cdk deploy FitnessDashboardMonitoring
```

**Check current AWS costs:**
```bash
aws ce get-cost-and-usage \
  --time-period Start=2026-04-01,End=2026-04-02 \
  --granularity DAILY \
  --metrics "UnblendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE
```

**View CloudWatch alarms:**
```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix "fitness-dashboard" \
  --region eu-west-2
```

**Test kill switch:**
```bash
curl -X POST "https://[API-ID].execute-api.eu-west-2.amazonaws.com/prod/emergency-shutdown?token=YOUR_TOKEN"
```

---

## 📱 Mobile Access

**Dashboard:** Works in mobile browser (sign in to AWS Console)  
**Kill switch:** Works from any browser (no login needed)  
**Alerts:** Check email on phone

---

## 🎯 Success Metrics

**Healthy system:**
- ✅ All CloudWatch alarm widgets show "0 errors"
- ✅ Lambda duration <5 seconds
- ✅ API latency p99 <1 second
- ✅ Monthly cost <$3
- ✅ Dashboard loads in <2 seconds

**Investigate if:**
- ❌ Any error count >0
- ❌ Lambda duration >10 seconds
- ❌ API latency >2 seconds
- ❌ Cost >$3 before Tier 2 alert
- ❌ Dashboard widgets show "No data"

---

## 📚 Key Files

- `cdk/fitness_dashboard_aws/monitoring_stack.py` - Alarms + dashboard
- `cdk/fitness_dashboard_aws/budget_stack.py` - Cost alerts
- `cdk/fitness_dashboard_aws/emergency_shutdown_stack.py` - Kill switch
- `cdk/fitness_dashboard_aws/lambda/emergency_shutdown/handler.py` - Shutdown logic
- `PHASE5_DEPLOYMENT_GUIDE.md` - Full deployment instructions

---

**Last updated:** 1 April 2026  
**Phase 5 commit:** `b00248c`
