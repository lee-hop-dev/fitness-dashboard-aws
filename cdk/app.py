#!/usr/bin/env python3
"""
Fitness Dashboard AWS - CDK App Entry Point

Phase 2: Core Infrastructure
  - DynamoDBStack  (2.1) - three tables: activities, wellness, curves
  - SecretsStack   (2.3) - API credentials in Secrets Manager
  - CollectorStack (2.2 + 2.4) - Lambda data collector + EventBridge schedule

Region: eu-west-2 (London)
Account: Lee.Hopkins.Dev
"""

import aws_cdk as cdk

from fitness_dashboard_aws.dynamodb_stack import DynamoDBStack
from fitness_dashboard_aws.secrets_stack import SecretsStack
from fitness_dashboard_aws.collector_stack import CollectorStack

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

collector_stack = CollectorStack(
    app,
    "FitnessDashboardCollector",
    dynamo_stack=dynamo_stack,
    secrets_stack=secrets_stack,
    env=env,
    description="Fitness Dashboard - Lambda data collector + EventBridge schedule",
)

# Explicit dependency ordering
collector_stack.add_dependency(dynamo_stack)
collector_stack.add_dependency(secrets_stack)

app.synth()
