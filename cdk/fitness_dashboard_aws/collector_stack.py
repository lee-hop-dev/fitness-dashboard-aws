"""
Collector Stack - Phase 2.2 + 2.4
Creates:
  - Lambda data collector function (Python 3.11, 512MB, 5min timeout)
  - IAM role with least-privilege permissions to DynamoDB + Secrets Manager
  - EventBridge scheduled rule (06:00 UTC daily) → Lambda
"""

from aws_cdk import (
    Stack,
    Duration,
    aws_lambda as lambda_,
    aws_iam as iam,
    aws_events as events,
    aws_events_targets as targets,
    aws_logs as logs,
)
from constructs import Construct

from .dynamodb_stack import DynamoDBStack
from .secrets_stack import SecretsStack
from .frontend_stack import FrontendStack


class CollectorStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        dynamo_stack: DynamoDBStack,
        secrets_stack: SecretsStack,
        frontend_stack: FrontendStack,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── IAM Role ─────────────────────────────────────────────────────────
        collector_role = iam.Role(
            self,
            "CollectorRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        # Grant write access to all three DynamoDB tables
        dynamo_stack.activities_table.grant_write_data(collector_role)
        dynamo_stack.wellness_table.grant_write_data(collector_role)
        dynamo_stack.curves_table.grant_write_data(collector_role)

        # Grant read access to secrets
        secrets_stack.intervals_secret.grant_read(collector_role)
        secrets_stack.strava_secret.grant_read(collector_role)

        # Grant write access to S3 frontend bucket (for segments.json)
        frontend_stack.bucket.grant_write(collector_role)

        # ── Lambda Function ───────────────────────────────────────────────────
        self.collector_fn = lambda_.Function(
            self,
            "DataCollector",
            function_name="fitness-dashboard-data-collector",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset(
                "fitness_dashboard_aws/lambda/data_collector"
            ),
            timeout=Duration.minutes(5),
            memory_size=512,
            role=collector_role,
            environment={
                "ACTIVITIES_TABLE": dynamo_stack.activities_table.table_name,
                "WELLNESS_TABLE": dynamo_stack.wellness_table.table_name,
                "CURVES_TABLE": dynamo_stack.curves_table.table_name,
                "INTERVALS_SECRET_NAME": secrets_stack.intervals_secret.secret_name,
                "STRAVA_SECRET_NAME": secrets_stack.strava_secret.secret_name,
                "FRONTEND_BUCKET": frontend_stack.bucket.bucket_name,
            },
            log_retention=logs.RetentionDays.THREE_MONTHS,
        )

        # ── EventBridge Schedule - Phase 2.4 ─────────────────────────────────
        # Mirrors existing GitHub Actions schedule: 6 AM UTC daily
        daily_rule = events.Rule(
            self,
            "DailyCollectorRule",
            rule_name="fitness-dashboard-daily-sync",
            description="Triggers data collector Lambda at 06:00 UTC daily",
            schedule=events.Schedule.cron(
                minute="0",
                hour="6",
                month="*",
                week_day="*",
                year="*",
            ),
        )

        daily_rule.add_target(
            targets.LambdaFunction(
                self.collector_fn,
                # Pass a source identifier so the handler knows it's a scheduled run
                event=events.RuleTargetInput.from_object({"source": "eventbridge-schedule"}),
                retry_attempts=2,
            )
        )
