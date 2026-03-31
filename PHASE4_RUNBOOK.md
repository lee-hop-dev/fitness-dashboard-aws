# Phase 4 Runbook — Frontend Migration

**Goal:** Deploy the dashboard frontend to S3/CloudFront and update the data loader to call the API Gateway instead of reading static JSON files.

**API URL:** `https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod`

---

## What was changed

| File | Change |
|---|---|
| `cdk/fitness_dashboard_aws/frontend_stack.py` | **New** — S3 bucket + CloudFront CDK stack |
| `cdk/app.py` | Added `FrontendStack` import and instantiation |
| `docs/assets/js/data-loader.js` | Replaced static JSON fetches with API Gateway calls |
| `PHASE4_RUNBOOK.md` | This file |

---

## Step 1: Deploy the FrontendStack via CDK

Run from your local working directory `C:\Users\leeho\Documents\Claude.ai\Fitness-Dashboard_AWS\repo\cdk`

```powershell
# Activate CDK virtual environment (Windows)
.venv\Scripts\activate

# Install updated dependencies (if not already done)
pip install -r requirements.txt

# Confirm the new stack appears in the list
cdk list
# Expected output includes: FitnessDashboardFrontend

# Deploy ONLY the frontend stack (backend stacks already deployed)
cdk deploy FitnessDashboardFrontend
```

**CDK will ask for confirmation** — review and type `y`.

**Expected outputs after deploy:**

```
Outputs:
FitnessDashboardFrontend.BucketName          = fitness-dashboard-frontend-<account-id>
FitnessDashboardFrontend.CloudFrontDomainName = <id>.cloudfront.net
FitnessDashboardFrontend.CloudFrontDistributionId = <distribution-id>
FitnessDashboardFrontend.DashboardUrl         = https://<id>.cloudfront.net
```

**Save these values** — you'll need them in Steps 2 and 3.

---

## Step 2: Upload frontend files to S3

Replace `<bucket-name>` with the value from the CDK output above.

```powershell
# Sync docs/ folder to S3 (run from repo root)
aws s3 sync docs/ s3://<bucket-name>/ --delete --region eu-west-2

# Verify files are present
aws s3 ls s3://<bucket-name>/ --region eu-west-2
```

Expected output: `index.html`, `cycling.html`, `running.html`, `rowing.html`, `cardio.html`, `other.html`, `race-stream.html`, `assets/` folder.

---

## Step 3: Invalidate CloudFront cache

Replace `<distribution-id>` with the value from the CDK output.

```powershell
aws cloudfront create-invalidation \
  --distribution-id <distribution-id> \
  --paths "/*"
```

Wait ~60 seconds for the invalidation to complete.

---

## Step 4: Smoke test the live AWS dashboard

Open the CloudFront URL from Step 1 in a browser:
```
https://<id>.cloudfront.net
```

Check each page loads and data appears:
- [ ] `index.html` — overview, CTL/ATL/TSB, recent activities
- [ ] `cycling.html` — power curve, weekly TSS chart
- [ ] `running.html` — pace curve, recent runs
- [ ] `rowing.html` — rowing activities
- [ ] `cardio.html` — cardio activities
- [ ] `other.html` — other activities

Check browser DevTools → Network tab:
- [ ] API calls to `j2zxz92vd4.execute-api.eu-west-2.amazonaws.com` are returning 200
- [ ] No CORS errors in the console
- [ ] No 404s for missing static JSON files (expected — they no longer exist at this path)

---

## Re-deploying frontend changes

Whenever you update HTML, CSS or JS:

```powershell
# 1. Sync to S3
aws s3 sync docs/ s3://<bucket-name>/ --delete --region eu-west-2

# 2. Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

Changes will be live within ~60 seconds.

---

## Rollback

The original `fitness-dashboard` repo on GitHub Pages is untouched and continues to run. If anything is wrong with the AWS version, simply stop using the CloudFront URL — nothing has been broken.

---

## Next: Phase 5 — Optimisation & Monitoring

- CloudWatch dashboard for Lambda, API GW, DynamoDB metrics
- Cost alarms (alert if > £5/month)
- Lambda memory tuning
- Architecture diagram for portfolio

