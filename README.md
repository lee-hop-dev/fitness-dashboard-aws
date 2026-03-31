# Fitness Dashboard - AWS

AWS serverless backend for fitness analytics dashboard.

## Overview

This is the AWS migration of the [fitness-dashboard](https://github.com/lee-hop-dev/fitness-dashboard) project, converting from GitHub Pages + JSON files to a serverless AWS architecture.

**Original (GitHub Pages):** Static site with daily GitHub Actions → JSON files  
**AWS Version:** Serverless with Lambda, DynamoDB, API Gateway, S3/CloudFront

## Status

🚧 **In Development** - Phase 1 (Foundation) in progress

- ✅ AWS account setup complete
- ✅ IAM user created with MFA
- ✅ AWS CLI configured
- ⏳ CDK setup pending (requires home desktop)
- ⏳ Infrastructure deployment pending

See [AWS_MIGRATION_PLAN.md](./AWS_MIGRATION_PLAN.md) for detailed migration roadmap.

## Architecture

### Current (Original Dashboard)
```
GitHub Actions → Python Collector → JSON Files → GitHub Pages
```

### Target (AWS Serverless)
```
EventBridge → Lambda → DynamoDB
                ↓
          API Gateway
                ↓
       S3 + CloudFront
```

## Project Structure

```
fitness-dashboard-aws/
├── cdk/                      # AWS CDK infrastructure code
│   ├── stacks/              # CDK stack definitions
│   ├── lambda/              # Lambda function code
│   │   └── data_collector/  # Data sync Lambda
│   └── app.py               # CDK app entry point
├── docs/                    # Frontend (HTML/CSS/JS)
└── workflows/               # Original Python collector (for reference)
```

## AWS Resources

**Account:** Lee.Hopkins.Dev  
**Region:** eu-west-2 (London)  
**Account ID:** 656370357696  
**Plan:** Free tier (6 months)

### Services Used
- **Lambda** - Data collection and API handlers
- **DynamoDB** - Activity and wellness data storage
- **API Gateway** - REST API endpoints
- **S3 + CloudFront** - Static site hosting and CDN
- **Secrets Manager** - API credential storage
- **EventBridge** - Scheduled data sync
- **CloudWatch** - Monitoring and logging

## Development

### Prerequisites
- AWS CLI configured
- Node.js 18+ (for CDK)
- AWS CDK installed globally
- Python 3.11+

### Setup (From Home Desktop)
```bash
# Install CDK
npm install -g aws-cdk

# Bootstrap AWS account (one-time)
cdk bootstrap aws://656370357696/eu-west-2

# Install Python dependencies
cd cdk
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Deploy infrastructure
cdk deploy --all
```

## Cost Estimation

**Free Tier (Months 1-12):** $0/month  
**Post-Free-Tier (Month 13+):** ~£2-3/month

See [AWS_MIGRATION_PLAN.md](./AWS_MIGRATION_PLAN.md) for detailed cost breakdown.

## Deployment Status

| Phase | Status |
|-------|--------|
| Phase 1: Foundation | 🚧 In Progress |
| Phase 2: Core Infrastructure | ⏳ Not Started |
| Phase 3: API Layer | ⏳ Not Started |
| Phase 4: Frontend Migration | ⏳ Not Started |
| Phase 5: Optimization | ⏳ Not Started |

## Original Dashboard

The original GitHub Pages version continues to run at:  
https://lee-hop-dev.github.io/fitness-dashboard/

Repository: https://github.com/lee-hop-dev/fitness-dashboard

## Documentation

- [AWS Migration Plan](./AWS_MIGRATION_PLAN.md) - Detailed 5-week roadmap
- [Project Overview](./docs/PROJECT_OVERVIEW.md) - Original dashboard documentation

## License

Personal project - Lee Hopkins

---

*Created: 31 March 2026*  
*Last Updated: 31 March 2026*
