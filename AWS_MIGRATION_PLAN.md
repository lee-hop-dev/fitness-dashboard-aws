# AWS Migration Plan - Fitness Dashboard

**Project:** `fitness-dashboard-aws`  
**Account:** Lee.Hopkins.Dev (`Lee.hopkins+aws@gmail.com`)  
**Plan:** Free tier (6 months, $200 credits)  
**Expires:** ~1 October 2026 ⚠️ Set calendar reminder to upgrade  

---

## Migration Strategy

**Approach:** Keep existing `fitness-dashboard` repo running on GitHub Pages unchanged. Build AWS backend in new `fitness-dashboard-aws` repo. This allows:
- ✅ Production system stays live and working
- ✅ No risk to current functionality
- ✅ Time to build/test AWS version properly
- ✅ Clean comparison between architectures

---

## Current Architecture (GitHub Pages)

```
GitHub Actions (daily 6am UTC)
    ↓
Python collector (collect_data.py)
    ↓
Intervals.icu + Strava APIs
    ↓
JSON files (docs/data/*.json)
    ↓
GitHub Pages (static HTML/CSS/JS)
```

**Data Flow:**
1. Workflow runs Python script
2. Script fetches from Intervals.icu API (athlete ID: 5718022)
3. Script fetches from Strava API
4. Processes and saves to JSON files
5. Commits JSON to repo
6. GitHub Pages serves static site
7. Frontend loads JSON client-side

---

## Target Architecture (AWS Serverless)

```
EventBridge (daily 6am UTC)
    ↓
Lambda (Python)
    ↓
Intervals.icu + Strava APIs
    ↓
DynamoDB (activities, wellness, curves)
    ↓
API Gateway (REST endpoints)
    ↓
S3 + CloudFront (static frontend)
```

**Data Flow:**
1. EventBridge triggers Lambda on schedule
2. Lambda fetches from APIs (credentials in Secrets Manager)
3. Lambda processes and writes to DynamoDB
4. Frontend hosted on S3/CloudFront
5. Frontend calls API Gateway endpoints
6. API Gateway → Lambda → DynamoDB queries
7. Response returned to frontend

---

## Prerequisites Checklist

### Account Setup ✅
- [x] AWS account created (`Lee.Hopkins.Dev`)
- [x] Root account MFA enabled
- [x] IAM admin user created (`lee-admin`)
- [x] IAM user MFA enabled
- [x] IAM user access keys created and downloaded
- [ ] AWS CLI configured with IAM user credentials
- [ ] AWS CLI test successful (`aws sts get-caller-identity`)

### Local Environment
- [x] AWS CLI installed
- [ ] AWS CLI configured
- [ ] Node.js installed (for CDK)
- [ ] AWS CDK installed (`npm install -g aws-cdk`)
- [ ] Python 3.11+ available
- [ ] Git configured

### GitHub Repository
- [ ] `fitness-dashboard-aws` repo created on GitHub
- [ ] Local clone pushed to new repo
- [ ] Branch protection rules configured (optional)

---

## Phase 1: Foundation (Week 1)

### 1.1 Complete AWS CLI Setup
**Goal:** Verify AWS access from local machine

**Steps:**
1. Run `aws configure`
2. Enter IAM user Access Key ID
3. Enter IAM user Secret Access Key
4. Set region: `eu-west-2` (London)
5. Set output format: `json`
6. Test: `aws sts get-caller-identity`

**Success criteria:** Command returns your account ID and user ARN

---

### 1.2 Install AWS CDK
**Goal:** Set up Infrastructure as Code tooling

**Steps:**
```bash
# Install CDK globally
npm install -g aws-cdk

# Verify installation
cdk --version

# Bootstrap AWS account for CDK (one-time setup)
cdk bootstrap aws://ACCOUNT-ID/eu-west-2
```

**Success criteria:** `cdk --version` shows version number, bootstrap completes successfully

**Note:** Replace `ACCOUNT-ID` with your actual AWS account ID from step 1.1

---

### 1.3 Create CDK Project Structure
**Goal:** Set up the infrastructure code repository

**Steps:**
```bash
cd /path/to/fitness-dashboard-aws

# Create CDK directory
mkdir cdk
cd cdk

# Initialize CDK app (Python)
cdk init app --language python

# Activate virtual environment
source .venv/bin/activate  # Mac/Linux
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt
```

**Success criteria:** CDK project created, virtual environment activated

---

### 1.4 Push to GitHub
**Goal:** Get the new repo live on GitHub

**Steps:**
```bash
cd /path/to/fitness-dashboard-aws

# Update remote to point to new repo
git remote set-url origin https://github.com/lee-hop-dev/fitness-dashboard-aws.git

# Create initial commit for AWS work
git add cdk/
git commit -m "chore: initialize AWS CDK project structure"
git push -u origin main
```

**Success criteria:** New repo visible at `https://github.com/lee-hop-dev/fitness-dashboard-aws`

---

## Phase 2: Core Infrastructure (Week 2)

### 2.1 Create DynamoDB Tables
**Goal:** Set up data storage

**Tables to create:**
- `fitness-activities` - Partition key: `athlete_id` (String), Sort key: `activity_id` (String)
- `fitness-wellness` - Partition key: `athlete_id` (String), Sort key: `date` (String)
- `fitness-curves` - Partition key: `athlete_id` (String), Sort key: `curve_type#date` (String)

**CDK Stack:** `DynamoDBStack`

**Success criteria:** Tables visible in AWS Console, zero cost under free tier

---

### 2.2 Create Lambda Data Collector
**Goal:** Replace GitHub Actions Python script with Lambda function

**Function specs:**
- Runtime: Python 3.11
- Memory: 512 MB (tune later)
- Timeout: 5 minutes
- Environment variables: None (use Secrets Manager)

**Code location:** `cdk/lambda/data_collector/`

**Success criteria:** Lambda can be invoked manually and completes without error

---

### 2.3 Set Up Secrets Manager
**Goal:** Securely store API credentials

**Secrets to create:**
- `fitness-dashboard/intervals-api-key`
- `fitness-dashboard/strava-client-id`
- `fitness-dashboard/strava-client-secret`
- `fitness-dashboard/strava-refresh-token`

**Success criteria:** Lambda can retrieve secrets, API calls succeed

---

### 2.4 Create EventBridge Schedule
**Goal:** Automate daily data sync

**Schedule:** `cron(0 6 * * ? *)` - 6:00 AM UTC daily  
**Target:** Lambda data collector function

**Success criteria:** Function runs automatically at 6 AM, CloudWatch logs confirm execution

---

## Phase 3: API Layer (Week 3)

### 3.1 Create API Gateway
**Goal:** Expose data via REST endpoints

**Endpoints to create:**
- `GET /activities` - Recent activities list
- `GET /activities/{id}` - Single activity detail
- `GET /wellness` - CTL/ATL/TSB/HRV/Sleep/Weight
- `GET /athlete` - FTP, W'bal, weight
- `GET /power-curve` - Critical power curve
- `GET /pace-curve` - Running pace curve
- `GET /hr-curve` - Heart rate curve
- `GET /weekly-tss` - Weekly TSS by sport
- `GET /ytd` - Year-to-date totals

**Success criteria:** All endpoints return valid JSON, CORS enabled

---

### 3.2 Create Lambda Query Functions
**Goal:** Serve data from DynamoDB via API Gateway

**Functions needed:**
- `get_activities` - Query recent activities
- `get_activity` - Get single activity by ID
- `get_wellness` - Query wellness data by date range
- `get_athlete` - Get current athlete stats
- `get_curves` - Query power/pace/HR curves

**Success criteria:** API calls return correct data, response times < 500ms

---

### 3.3 API Testing
**Goal:** Verify all endpoints work correctly

**Test approach:**
- Use Postman or curl to test each endpoint
- Verify response format matches current JSON structure
- Check error handling (404s, 500s)
- Test with various query parameters

**Success criteria:** All endpoints tested and documented

---

## Phase 4: Frontend Migration (Week 4)

### 4.1 Create S3 Bucket for Static Hosting
**Goal:** Replace GitHub Pages with S3/CloudFront

**Bucket configuration:**
- Static website hosting enabled
- Public read access via bucket policy
- Index document: `index.html`
- Error document: `404.html`

**Success criteria:** Can upload HTML and access via S3 URL

---

### 4.2 Create CloudFront Distribution
**Goal:** Add CDN for global performance

**Distribution settings:**
- Origin: S3 bucket
- Default root object: `index.html`
- SSL certificate: Use CloudFront default
- Price class: Use all edge locations

**Success criteria:** CloudFront URL serves site content

---

### 4.3 Update Frontend Data Loading
**Goal:** Replace JSON file reads with API calls

**Changes needed:**
- Update `docs/assets/js/data-loader.js`
- Replace `fetch('data/activities.json')` with `fetch('https://api.example.com/activities')`
- Handle API errors gracefully
- Add loading states

**Success criteria:** Dashboard loads data from API Gateway, all charts render correctly

---

### 4.4 Deploy Frontend to S3
**Goal:** Get the AWS-hosted version live

**Deployment:**
```bash
# Sync local docs/ to S3
aws s3 sync docs/ s3://fitness-dashboard-bucket/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id XXXXX --paths "/*"
```

**Success criteria:** CloudFront URL shows working dashboard with API data

---

## Phase 5: Optimization & Monitoring (Week 5)

### 5.1 Set Up CloudWatch Dashboards
**Goal:** Monitor system health

**Metrics to track:**
- Lambda invocations, errors, duration
- DynamoDB read/write capacity usage
- API Gateway requests, latency, errors
- CloudFront requests, cache hit rate

**Success criteria:** Dashboard shows all key metrics

---

### 5.2 Configure Alarms
**Goal:** Get notified of issues

**Alarms to create:**
- Lambda errors > 5 in 5 minutes
- API Gateway 5xx errors > 10 in 5 minutes
- DynamoDB throttled requests > 0
- Estimated monthly cost > $10

**Success criteria:** Test alarm triggers and notifications work

---

### 5.3 Performance Tuning
**Goal:** Optimize costs and speed

**Areas to tune:**
- Lambda memory allocation (balance speed vs cost)
- DynamoDB table modes (provisioned vs on-demand)
- API Gateway caching
- CloudFront cache TTLs

**Success criteria:** All responses < 500ms, monthly cost projection < $5

---

### 5.4 Documentation
**Goal:** Document the AWS architecture

**Documents to create:**
- Architecture diagram (draw.io or similar)
- API endpoint documentation
- Deployment runbook
- Cost breakdown and projections
- Troubleshooting guide

**Success criteria:** Someone could deploy/maintain this without your help

---

## Rollback Plan

If AWS migration has issues:

1. **Original dashboard keeps running** - No changes to `fitness-dashboard` repo
2. **Switch DNS back** - If using custom domain, point back to GitHub Pages
3. **No data loss** - Original JSON files still updating via GitHub Actions
4. **Time to fix** - AWS version can be debugged without pressure

---

## Cost Projections

### Free Tier Usage (First 12 Months)
- Lambda: 1M requests/month (400,000 GB-seconds) - **$0**
- DynamoDB: 25 GB storage, 25 WCU/RCU - **$0**
- API Gateway: 1M requests/month - **$0**
- S3: 5 GB storage - **$0**
- CloudFront: 50 GB data transfer/month - **$0**

**Estimated monthly cost during free tier:** $0.00

### Post-Free-Tier (Month 13+)
- Lambda: ~30 invocations/month - **~$0.01**
- DynamoDB: ~100 MB storage, minimal reads - **~$0.50**
- API Gateway: ~3,000 requests/month - **~$0.10**
- S3: ~50 MB storage - **~$0.01**
- CloudFront: ~1 GB data transfer/month - **~$0.10**

**Estimated monthly cost post-free-tier:** £2-3/month

---

## Success Metrics

### Technical
- ✅ All existing dashboard features work in AWS version
- ✅ API response times < 500ms
- ✅ 99.9% uptime (CloudWatch metrics)
- ✅ Zero security vulnerabilities (AWS Trusted Advisor)
- ✅ Monthly cost < $5

### Portfolio/CV Value
- ✅ Production AWS serverless architecture
- ✅ Infrastructure as Code (CDK)
- ✅ Multi-service integration (Lambda, DynamoDB, API Gateway, S3, CloudFront)
- ✅ Monitoring and observability (CloudWatch)
- ✅ Security best practices (Secrets Manager, IAM)
- ✅ Cost optimization skills

---

## Timeline Summary

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Foundation | Week 1 | ✅ Complete |
| Phase 2: Core Infrastructure | Week 2 | ✅ Complete |
| Phase 3: API Layer | Week 3 | ✅ Complete — 12/12 smoke tests passing |
| Phase 4: Frontend Migration | Week 4 | Not Started |
| Phase 5: Optimization | Week 5 | Not Started |

**Total estimated time:** 5 weeks (working part-time)  
**Current progress:** AWS account setup complete, CLI installation complete, awaiting CLI configuration

---

## Next Immediate Steps

Phase 3 complete. Ready to start **Phase 4: Frontend Migration**.

1. Update `docs/assets/js/data-loader.js` — replace static JSON fetches with API calls
2. Update all dashboard pages to use API responses
3. Handle loading states and API errors in the frontend
4. Deploy frontend to S3 (Phase 4.4)

API base URL: `https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/`

---

*Document created: 31 March 2026*  
*Last updated: 31 March 2026*  
*Status: Phase 1 in progress*
