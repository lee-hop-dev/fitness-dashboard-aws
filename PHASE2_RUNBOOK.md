# Phase 2 Deployment Runbook
## Fitness Dashboard AWS - Core Infrastructure

---

## Before You Start — Verify Phase 1

Run these two commands first. If either fails, fix before proceeding.

```bash
aws sts get-caller-identity
# Expected: JSON with your Account ID + lee-admin ARN

cdk --version
# Expected: 2.x.x (build ...)
```

---

## Step 1 — Configure AWS CLI (if not done)

```bash
aws configure
# AWS Access Key ID:     <from IAM console, lee-admin user>
# AWS Secret Access Key: <from downloaded CSV>
# Default region name:   eu-west-2
# Default output format: json
```

Then verify:
```bash
aws sts get-caller-identity
```

---

## Step 2 — Get the CDK code into your repo

The CDK code lives in the `cdk/` directory of `fitness-dashboard-aws`.

If starting fresh:
```bash
git clone https://github.com/lee-hop-dev/fitness-dashboard-aws.git
cd fitness-dashboard-aws
```

Copy the generated files into your repo's `cdk/` directory:
```
cdk/
├── app.py
├── cdk.json
├── requirements.txt
└── fitness_dashboard_aws/
    ├── __init__.py
    ├── dynamodb_stack.py
    ├── secrets_stack.py
    ├── collector_stack.py
    └── lambda/
        └── data_collector/
            └── handler.py
```

---

## Step 3 — Set up CDK Python environment

```bash
cd cdk

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Mac/Linux
# .venv\Scripts\activate    # Windows

# Install CDK dependencies
pip install -r requirements.txt

# Verify CDK can synthesise the stacks
cdk synth
# Expected: CloudFormation YAML printed for all 3 stacks, no errors
```

---

## Step 4 — Deploy DynamoDB tables

Deploy the database layer first.

```bash
cdk deploy FitnessDashboardDynamo
```

Expected output:
```
✅  FitnessDashboardDynamo
Outputs:
  (none - tables created with RETAIN policy)
```

Verify in AWS Console:
- Go to DynamoDB → Tables
- Confirm: `fitness-activities`, `fitness-wellness`, `fitness-curves` exist
- Check `fitness-activities` has GSI `athlete_id-start_date-index`

---

## Step 5 — Deploy Secrets Manager

```bash
cdk deploy FitnessDashboardSecrets
```

**After deploy, populate the secrets manually:**

### Intervals.icu API Key
1. Go to AWS Console → Secrets Manager
2. Click `fitness-dashboard/intervals-api-key`
3. Click "Retrieve secret value" → "Edit"
4. Replace placeholder with your actual Intervals.icu API key
5. Save

### Strava Credentials
1. Click `fitness-dashboard/strava-credentials`
2. Edit → paste this JSON (replace values):
```json
{
  "client_id": "201642",
  "client_secret": "<your_strava_client_secret>",
  "refresh_token": "<your_strava_refresh_token>"
}
```
3. Save

---

## Step 6 — Deploy Lambda + EventBridge

```bash
cdk deploy FitnessDashboardCollector
```

Expected output:
```
✅  FitnessDashboardCollector
```

---

## Step 7 — Test the Lambda manually

```bash
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"source": "manual-test"}' \
  --cli-binary-format raw-in-base64-out \
  response.json

cat response.json
```

Expected response:
```json
{
  "statusCode": 200,
  "body": "{\"activities\": 47, \"wellness\": 90, \"power_curves\": 1, \"athlete\": \"ok\"}"
}
```

Check CloudWatch logs:
```bash
aws logs tail /aws/lambda/fitness-dashboard-data-collector --follow
```

---

## Step 8 — Verify data in DynamoDB

```bash
# Check activities table has data
aws dynamodb scan \
  --table-name fitness-activities \
  --select COUNT \
  --region eu-west-2

# Check wellness table
aws dynamodb scan \
  --table-name fitness-wellness \
  --select COUNT \
  --region eu-west-2
```

---

## Step 9 — Verify EventBridge schedule

1. AWS Console → EventBridge → Rules
2. Find `fitness-dashboard-daily-sync`
3. Confirm schedule: `cron(0 6 * * ? *)`
4. Confirm target: `fitness-dashboard-data-collector`

---

## Phase 2 Complete ✅

When all steps above pass, Phase 2 is done. Next: **Phase 3 — API Layer**
(API Gateway + Lambda query functions)

---

## Rollback

If anything goes wrong:
- Original GitHub Pages dashboard is **untouched** and still running
- To tear down Phase 2 AWS resources:

```bash
cdk destroy FitnessDashboardCollector
cdk destroy FitnessDashboardSecrets
cdk destroy FitnessDashboardDynamo
# Note: DynamoDB tables have RETAIN policy - delete manually if needed
```
