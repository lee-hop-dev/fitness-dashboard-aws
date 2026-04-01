"""
Monitoring Stack - Phase 5.1 + 5.2
Creates:
  - SNS topic for email alerts
  - CloudWatch alarms (Lambda errors, API errors, performance)
  - CloudWatch dashboard (operational metrics)
  - Log metric filters for specific error patterns
"""

from aws_cdk import (
    Stack,
    Duration,
    aws_sns as sns,
    aws_sns_subscriptions as subscriptions,
    aws_cloudwatch as cloudwatch,
    aws_cloudwatch_actions as cw_actions,
    aws_logs as logs,
)
from constructs import Construct

from .dynamodb_stack import DynamoDBStack
from .collector_stack import CollectorStack
from .api_stack import ApiStack


class MonitoringStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        dynamo_stack: DynamoDBStack,
        collector_stack: CollectorStack,
        api_stack: ApiStack,
        alert_email: str = "lee.hopkins+aws-alerts@gmail.com",
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── SNS Topic for Alerts ──────────────────────────────────────────────
        self.alert_topic = sns.Topic(
            self,
            "AlertTopic",
            topic_name="fitness-dashboard-alerts",
            display_name="Fitness Dashboard Alerts",
        )

        self.alert_topic.add_subscription(
            subscriptions.EmailSubscription(alert_email)
        )

        # ── CloudWatch Alarms: Lambda Errors ──────────────────────────────────
        # Collector Lambda errors (after built-in retries exhausted)
        collector_error_alarm = cloudwatch.Alarm(
            self,
            "CollectorErrorAlarm",
            alarm_name="fitness-dashboard-collector-errors",
            alarm_description="Data collector Lambda has failed 3+ times in 5 minutes",
            metric=collector_stack.collector_fn.metric_errors(
                statistic=cloudwatch.Stats.SUM,
                period=Duration.minutes(5),
            ),
            threshold=3,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        collector_error_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))

        # API Lambda errors (query functions)
        api_error_alarm = cloudwatch.Alarm(
            self,
            "ApiErrorAlarm",
            alarm_name="fitness-dashboard-api-errors",
            alarm_description="API query functions have failed 5+ times in 5 minutes",
            metric=api_stack.query_fn.metric_errors(
                statistic=cloudwatch.Stats.SUM,
                period=Duration.minutes(5),
            ),
            threshold=5,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        api_error_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))

        # ── CloudWatch Alarms: API Gateway ────────────────────────────────────
        # API Gateway 5xx errors
        api_5xx_alarm = cloudwatch.Alarm(
            self,
            "Api5xxAlarm",
            alarm_name="fitness-dashboard-api-5xx-errors",
            alarm_description="API Gateway has 5+ server errors in 5 minutes",
            metric=cloudwatch.Metric(
                namespace="AWS/ApiGateway",
                metric_name="5XXError",
                dimensions_map={
                    "ApiName": api_stack.api.rest_api_name,
                },
                statistic=cloudwatch.Stats.SUM,
                period=Duration.minutes(5),
            ),
            threshold=5,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        api_5xx_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))

        # ── CloudWatch Alarms: Performance ────────────────────────────────────
        # Collector Lambda duration > 10 seconds (indicates API timeout issues)
        collector_duration_alarm = cloudwatch.Alarm(
            self,
            "CollectorDurationAlarm",
            alarm_name="fitness-dashboard-collector-slow",
            alarm_description="Data collector taking >10 seconds (API timeout likely)",
            metric=collector_stack.collector_fn.metric_duration(
                statistic=cloudwatch.Stats.AVERAGE,
                period=Duration.minutes(5),
            ),
            threshold=10000,  # milliseconds
            evaluation_periods=2,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        collector_duration_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))

        # API Gateway latency p99 > 2 seconds
        api_latency_alarm = cloudwatch.Alarm(
            self,
            "ApiLatencyAlarm",
            alarm_name="fitness-dashboard-api-slow",
            alarm_description="API Gateway p99 latency >2 seconds",
            metric=cloudwatch.Metric(
                namespace="AWS/ApiGateway",
                metric_name="Latency",
                dimensions_map={
                    "ApiName": api_stack.api.rest_api_name,
                },
                statistic="p99",
                period=Duration.minutes(5),
            ),
            threshold=2000,  # milliseconds
            evaluation_periods=2,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        api_latency_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))

        # ── CloudWatch Alarms: DynamoDB ───────────────────────────────────────
        # DynamoDB throttled requests (should never happen with on-demand)
        dynamo_throttle_alarm = cloudwatch.Alarm(
            self,
            "DynamoThrottleAlarm",
            alarm_name="fitness-dashboard-dynamodb-throttled",
            alarm_description="DynamoDB requests are being throttled",
            metric=cloudwatch.Metric(
                namespace="AWS/DynamoDB",
                metric_name="UserErrors",
                dimensions_map={
                    "TableName": dynamo_stack.activities_table.table_name,
                },
                statistic=cloudwatch.Stats.SUM,
                period=Duration.minutes(5),
            ),
            threshold=0,
            evaluation_periods=1,
            comparison_operator=cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treat_missing_data=cloudwatch.TreatMissingData.NOT_BREACHING,
        )
        dynamo_throttle_alarm.add_alarm_action(cw_actions.SnsAction(self.alert_topic))

        # ── CloudWatch Dashboard ──────────────────────────────────────────────
        dashboard = cloudwatch.Dashboard(
            self,
            "OperationalDashboard",
            dashboard_name="fitness-dashboard-ops",
        )

        # Row 1: Error Status Indicators
        dashboard.add_widgets(
            cloudwatch.SingleValueWidget(
                title="Collector Errors (5m)",
                metrics=[
                    collector_stack.collector_fn.metric_errors(
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.minutes(5),
                    )
                ],
                width=6,
                height=4,
            ),
            cloudwatch.SingleValueWidget(
                title="API Errors (5m)",
                metrics=[
                    api_stack.query_fn.metric_errors(
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.minutes(5),
                    )
                ],
                width=6,
                height=4,
            ),
            cloudwatch.SingleValueWidget(
                title="API 5xx Errors (5m)",
                metrics=[
                    cloudwatch.Metric(
                        namespace="AWS/ApiGateway",
                        metric_name="5XXError",
                        dimensions_map={
                            "ApiName": api_stack.api.rest_api_name,
                        },
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.minutes(5),
                    )
                ],
                width=6,
                height=4,
            ),
            cloudwatch.SingleValueWidget(
                title="DynamoDB Throttles (5m)",
                metrics=[
                    cloudwatch.Metric(
                        namespace="AWS/DynamoDB",
                        metric_name="UserErrors",
                        dimensions_map={
                            "TableName": dynamo_stack.activities_table.table_name,
                        },
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.minutes(5),
                    )
                ],
                width=6,
                height=4,
            ),
        )

        # Row 2: Request Volumes
        dashboard.add_widgets(
            cloudwatch.GraphWidget(
                title="Lambda Invocations (24h)",
                left=[
                    collector_stack.collector_fn.metric_invocations(
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.hours(1),
                        label="Data Collector",
                    ),
                    api_stack.query_fn.metric_invocations(
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.hours(1),
                        label="API Queries",
                    ),
                ],
                width=12,
                height=6,
            ),
            cloudwatch.GraphWidget(
                title="API Gateway Requests (24h)",
                left=[
                    cloudwatch.Metric(
                        namespace="AWS/ApiGateway",
                        metric_name="Count",
                        dimensions_map={
                            "ApiName": api_stack.api.rest_api_name,
                        },
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.hours(1),
                    )
                ],
                width=12,
                height=6,
            ),
        )

        # Row 3: Performance Metrics
        dashboard.add_widgets(
            cloudwatch.GraphWidget(
                title="Lambda Duration (avg)",
                left=[
                    collector_stack.collector_fn.metric_duration(
                        statistic=cloudwatch.Stats.AVERAGE,
                        period=Duration.minutes(5),
                        label="Collector",
                    ),
                    api_stack.query_fn.metric_duration(
                        statistic=cloudwatch.Stats.AVERAGE,
                        period=Duration.minutes(5),
                        label="API Queries",
                    ),
                ],
                left_y_axis=cloudwatch.YAxisProps(label="Milliseconds"),
                width=12,
                height=6,
            ),
            cloudwatch.GraphWidget(
                title="API Gateway Latency (p50, p99)",
                left=[
                    cloudwatch.Metric(
                        namespace="AWS/ApiGateway",
                        metric_name="Latency",
                        dimensions_map={
                            "ApiName": api_stack.api.rest_api_name,
                        },
                        statistic="p50",
                        period=Duration.minutes(5),
                        label="p50",
                    ),
                    cloudwatch.Metric(
                        namespace="AWS/ApiGateway",
                        metric_name="Latency",
                        dimensions_map={
                            "ApiName": api_stack.api.rest_api_name,
                        },
                        statistic="p99",
                        period=Duration.minutes(5),
                        label="p99",
                    ),
                ],
                left_y_axis=cloudwatch.YAxisProps(label="Milliseconds"),
                width=12,
                height=6,
            ),
        )

        # Row 4: DynamoDB Activity
        dashboard.add_widgets(
            cloudwatch.GraphWidget(
                title="DynamoDB Read/Write Units",
                left=[
                    cloudwatch.Metric(
                        namespace="AWS/DynamoDB",
                        metric_name="ConsumedReadCapacityUnits",
                        dimensions_map={
                            "TableName": dynamo_stack.activities_table.table_name,
                        },
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.hours(1),
                        label="Activities Read",
                    ),
                    cloudwatch.Metric(
                        namespace="AWS/DynamoDB",
                        metric_name="ConsumedWriteCapacityUnits",
                        dimensions_map={
                            "TableName": dynamo_stack.activities_table.table_name,
                        },
                        statistic=cloudwatch.Stats.SUM,
                        period=Duration.hours(1),
                        label="Activities Write",
                    ),
                ],
                width=24,
                height=6,
            ),
        )
