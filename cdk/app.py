#!/usr/bin/env python3
"""
Fitness Dashboard AWS - CDK App Entry Point

Phase 2: Core Infrastructure
  - DynamoDBStack  (2.1) - three tables: activities, wellness, curves
  - SecretsStack   (2.3) - API credentials in Secrets Manager
  - CollectorStack (2.2 + 2.4) - Lambda data collector + EventBridge schedule

Phase 3: API Layer
  - ApiStack       (3.1 + 3.2) - API Gateway REST API + Lambda query functions

Phase 4: Frontend Migration
  - FrontendStack  (4.1 + 4.2) - S3 static bucket + CloudFront distribution

Phase 5: Monitoring & Cost Control
  - MonitoringStack         (5.1 + 5.2) - CloudWatch alarms, dashboard, SNS alerts
  - BudgetStack             (5.2) - AWS Budgets with 4-tier alerting
  - EmergencyShutdownStack  (5.2) - Kill switch Lambda + API endpoint

Region: eu-west-2 (London)
Account: Lee.Hopkins.Dev
"""

import aws_cdk as cdk

from fitness_dashboard_aws.dynamodb_stack import DynamoDBStack
from fitness_dashboard_aws.secrets_stack import SecretsStack
from fitness_dashboard_aws.collector_stack import CollectorStack
from fitness_dashboard_aws.api_stack import ApiStack
from fitness_dashboard_aws.frontend_stack import FrontendStack
from fitness_dashboard_aws.monitoring_stack import MonitoringStack
from fitness_dashboard_aws.budget_stack import BudgetStack
from fitness_dashboard_aws.emergency_shutdown_stack import EmergencyShutdownStack

app = cdk.App()

env = cdk.Environment(region="eu-west-2")

dynamo_stack = DynamoDBStack(
    app,
    "FitnessDashboardDynamo",
    env=env,
    description="Fitness Dashboard - DynamoDB tables (activities, wellness, curves)",
)

secrets_stack = SecretsStack(
    app,
    "FitnessDashboardSecrets",
    env=env,
    description="Fitness Dashboard - API credentials in Secrets Manager",
)

frontend_stack = FrontendStack(
    app,
    "FitnessDashboardFrontend",
    env=env,
    description="Fitness Dashboard - S3 static hosting + CloudFront CDN (Phase 4)",
)

collector_stack = CollectorStack(
    app,
    "FitnessDashboardCollector",
    dynamo_stack=dynamo_stack,
    secrets_stack=secrets_stack,
    frontend_stack=frontend_stack,
    env=env,
    description="Fitness Dashboard - Lambda data collector + EventBridge schedule",
)

api_stack = ApiStack(
    app,
    "FitnessDashboardApi",
    dynamo_stack=dynamo_stack,
    athlete_id="5718022",
    env=env,
    description="Fitness Dashboard - API Gateway REST API + Lambda query functions",
)


# ── Phase 5: Monitoring & Cost Control ────────────────────────────────────
emergency_shutdown_stack = EmergencyShutdownStack(
    app,
    "FitnessDashboardEmergencyShutdown",
    collector_stack=collector_stack,
    env=env,
    description="Fitness Dashboard - Emergency shutdown Lambda (SNS-triggered)",
)

monitoring_stack = MonitoringStack(
    app,
    "FitnessDashboardMonitoring",
    dynamo_stack=dynamo_stack,
    collector_stack=collector_stack,
    api_stack=api_stack,
    alert_email="lee.hopkins+aws-alerts@gmail.com",
    env=env,
    description="Fitness Dashboard - CloudWatch alarms, dashboard, SNS alerts",
)

# Wire alert topic to emergency shutdown (resolves circular dependency)
emergency_shutdown_stack.set_alert_topic(monitoring_stack.alert_topic)

budget_stack = BudgetStack(
    app,
    "FitnessDashboardBudget",
    alert_topic=monitoring_stack.alert_topic,
    shutdown_topic=emergency_shutdown_stack.shutdown_topic,
    env=env,
    description="Fitness Dashboard - AWS Budgets with 4-tier cost alerts",
)

# Explicit dependency ordering
collector_stack.add_dependency(dynamo_stack)
collector_stack.add_dependency(secrets_stack)
collector_stack.add_dependency(frontend_stack)
api_stack.add_dependency(dynamo_stack)
# FrontendStack is independent of backend stacks — no dependency needed


# Phase 5 dependencies
emergency_shutdown_stack.add_dependency(collector_stack)
monitoring_stack.add_dependency(dynamo_stack)
monitoring_stack.add_dependency(collector_stack)
monitoring_stack.add_dependency(api_stack)
budget_stack.add_dependency(monitoring_stack)
budget_stack.add_dependency(emergency_shutdown_stack)

app.synth()
