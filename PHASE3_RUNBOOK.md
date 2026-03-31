# Phase 3 Deployment Runbook
## Fitness Dashboard AWS — API Layer

---

## Before You Start — Verify Phase 2

Confirm the three Phase 2 stacks are deployed and healthy:

```bash
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query "StackSummaries[?contains(StackName,'FitnessDashboard')].{Name:StackName,Status:StackStatus}" \
  --output table
```

Expected output — three stacks, all `CREATE_COMPLETE` or `UPDATE_COMPLETE`:
```
FitnessDashboardDynamo
FitnessDashboardSecrets
FitnessDashboardCollector
```

Also confirm data is actually in DynamoDB (Phase 2 must have synced):
```bash
aws dynamodb scan \
  --table-name fitness-activities \
  --select COUNT \
  --region eu-west-2
# Expected: "Count" > 0
```

---

## What Phase 3 Creates

| Resource | Name | Purpose |
|----------|------|---------|
| Lambda | `fitness-dashboard-query` | Query handler for all API routes |
| API Gateway | `fitness-dashboard-api` | REST API, stage `prod` |
| CloudWatch Logs | `/aws/apigateway/fitness-dashboard` | API access logs |
| IAM Role | `FitnessDashboardApi-QueryRole*` | Read-only DynamoDB access |

---

## Step 1 — Pull the Phase 3 code

```bash
cd C:\Users\leeho\Documents\Claude.ai\Fitness-Dashboard_AWS\repo\cdk
git pull origin main
```

Verify the new files are present:
```
fitness_dashboard_aws/api_stack.py
fitness_dashboard_aws/lambda/query_functions/handler.py
```

---

## Step 2 — Activate virtual environment and install deps

```bash
# Windows
.venv\Scripts\activate

pip install -r requirements.txt
```

---

## Step 3 — Synthesise (dry run — no AWS changes)

```bash
cdk synth FitnessDashboardApi
```

This should print a CloudFormation template to stdout. Look for:
- `AWS::ApiGateway::RestApi`
- `AWS::Lambda::Function` (QueryFunction)
- `AWS::IAM::Role` (QueryRole)

No errors = safe to deploy.

---

## Step 4 — Deploy the API stack

```bash
cdk deploy FitnessDashboardApi
```

CDK will show a changeset summary and ask for confirmation.  
Review it, then type **y** to proceed.

Expected output at the end:
```
✅  FitnessDashboardApi

Outputs:
FitnessDashboardApi.ApiUrl = https://XXXXXXXXXX.execute-api.eu-west-2.amazonaws.com/prod/
FitnessDashboardApi.QueryFunctionArn = arn:aws:lambda:eu-west-2:...
```

**Save the `ApiUrl` value — you'll need it for Phase 4.**

---

## Step 5 — Smoke test all endpoints

Replace `BASE_URL` with your actual API URL from Step 4.

```bash
set BASE_URL=https://XXXXXXXXXX.execute-api.eu-west-2.amazonaws.com/prod

# Activities — recent 90 days
curl "%BASE_URL%/activities" | python -m json.tool

# Single activity — grab an ID from the activities list first
curl "%BASE_URL%/activities/12345678" | python -m json.tool

# Wellness
curl "%BASE_URL%/wellness" | python -m json.tool

# Athlete profile
curl "%BASE_URL%/athlete" | python -m json.tool

# Power curve
curl "%BASE_URL%/power-curve" | python -m json.tool

# Pace curve
curl "%BASE_URL%/pace-curve" | python -m json.tool

# HR curve
curl "%BASE_URL%/hr-curve" | python -m json.tool

# Weekly TSS (last 12 weeks)
curl "%BASE_URL%/weekly-tss" | python -m json.tool

# Year-to-date
curl "%BASE_URL%/ytd" | python -m json.tool
```

**Expected for every endpoint:** HTTP 200, valid JSON, no `"error"` key.

### Query parameter examples

```bash
# Activities filtered by sport
curl "%BASE_URL%/activities?sport=Ride&days=30"

# Wellness for a specific date range
curl "%BASE_URL%/wellness?from=2025-01-01&to=2025-03-31"

# YTD for previous year
curl "%BASE_URL%/ytd?year=2024"

# Power curve for a specific date
curl "%BASE_URL%/power-curve?date=2025-03-01"
```

---

## Step 6 — Test CORS headers

Confirm the frontend will be able to call the API from a browser:

```bash
curl -I -X OPTIONS "%BASE_URL%/activities" \
  -H "Origin: https://lee-hop-dev.github.io" \
  -H "Access-Control-Request-Method: GET"
```

Expected response headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET,OPTIONS
Access-Control-Allow-Headers: Content-Type,...
```

---

## Troubleshooting

### "Internal Server Error" / 502 from API Gateway
Check Lambda logs:
```bash
aws logs tail /aws/lambda/fitness-dashboard-query --follow
```

### 403 Forbidden
Lambda doesn't have permission to read DynamoDB. Verify the IAM role grants were applied:
```bash
aws iam get-role-policy \
  --role-name FitnessDashboardApi-QueryRole... \
  --policy-name ...
```

### Empty arrays `[]` in responses
Data is missing from DynamoDB. Run the collector Lambda manually:
```bash
aws lambda invoke \
  --function-name fitness-dashboard-data-collector \
  --payload '{"source":"manual"}' \
  --region eu-west-2 \
  response.json && cat response.json
```

### Timeout errors
Lambda timeout is 29 seconds (API Gateway hard limit). If queries are slow,
check DynamoDB consumed capacity and consider adding a GSI or reducing page size.

---

## Rollback

If Phase 3 needs to be torn down:
```bash
cdk destroy FitnessDashboardApi
```

This removes the API Gateway, Lambda, and IAM role.  
**DynamoDB data is unaffected** (lives in the separate `FitnessDashboardDynamo` stack).

---

## Next: Phase 4 — Frontend Migration

Once all endpoints pass smoke tests, record the `ApiUrl` output and proceed to
Phase 4: update the frontend to load data from the API instead of static JSON files.
