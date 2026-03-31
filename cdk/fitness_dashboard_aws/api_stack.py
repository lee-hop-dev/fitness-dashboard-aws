"""
API Stack - Phase 3
Creates the REST API Gateway and Lambda query functions.

Endpoints:
  GET /activities          - Recent activities (query params: days, limit, sport)
  GET /activities/{id}     - Single activity by ID
  GET /wellness            - CTL/ATL/TSB/HRV/Sleep/Weight (days, from, to)
  GET /athlete             - Current athlete profile + recent wellness
  GET /power-curve         - Latest critical power curve (optional: date)
  GET /pace-curve          - Latest running pace curve   (optional: date)
  GET /hr-curve            - Latest heart rate curve     (optional: date)
  GET /weekly-tss          - Weekly TSS totals by sport  (weeks)
  GET /ytd                 - Year-to-date totals by sport (year)

All endpoints return CORS headers suitable for direct browser consumption
from GitHub Pages or any other frontend origin.
"""

from aws_cdk import (
    Stack,
    Duration,
    CfnOutput,
    aws_lambda as lambda_,
    aws_iam as iam,
    aws_apigateway as apigw,
    aws_logs as logs,
)
from constructs import Construct

from .dynamodb_stack import DynamoDBStack


class ApiStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        dynamo_stack: DynamoDBStack,
        athlete_id: str = "i5718022",
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── IAM Role for query Lambda ─────────────────────────────────────────
        query_role = iam.Role(
            self,
            "QueryRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        # Read-only access to all three tables
        dynamo_stack.activities_table.grant_read_data(query_role)
        dynamo_stack.wellness_table.grant_read_data(query_role)
        dynamo_stack.curves_table.grant_read_data(query_role)

        # ── Query Lambda ──────────────────────────────────────────────────────
        self.query_fn = lambda_.Function(
            self,
            "QueryFunction",
            function_name="fitness-dashboard-query",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset(
                "fitness_dashboard_aws/lambda/query_functions"
            ),
            timeout=Duration.seconds(29),   # API GW hard limit is 29 s
            memory_size=256,                 # Query workload; lighter than collector
            role=query_role,
            environment={
                "ACTIVITIES_TABLE": dynamo_stack.activities_table.table_name,
                "WELLNESS_TABLE":   dynamo_stack.wellness_table.table_name,
                "CURVES_TABLE":     dynamo_stack.curves_table.table_name,
                "ATHLETE_ID":       athlete_id,
            },
            log_retention=logs.RetentionDays.THREE_MONTHS,
        )

        # ── API Gateway REST API ──────────────────────────────────────────────
        log_group = logs.LogGroup(
            self,
            "ApiAccessLogs",
            log_group_name="/aws/apigateway/fitness-dashboard",
            retention=logs.RetentionDays.THREE_MONTHS,
        )

        self.api = apigw.RestApi(
            self,
            "FitnessDashboardApi",
            rest_api_name="fitness-dashboard-api",
            description="Fitness Dashboard REST API — Phase 3",
            # Enable API-level CORS (handled by Lambda too, belt-and-braces)
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=["GET", "OPTIONS"],
                allow_headers=[
                    "Content-Type",
                    "X-Amz-Date",
                    "Authorization",
                    "X-Api-Key",
                ],
                max_age=Duration.hours(1),
            ),
            deploy_options=apigw.StageOptions(
                stage_name="prod",
                access_log_destination=apigw.LogGroupLogDestination(log_group),
                access_log_format=apigw.AccessLogFormat.json_with_standard_fields(
                    caller=False,
                    http_method=True,
                    ip=True,
                    protocol=True,
                    request_time=True,
                    resource_path=True,
                    response_length=True,
                    status=True,
                    user=False,
                ),
                throttling_burst_limit=50,
                throttling_rate_limit=20,
                # Cache disabled — data refreshes only once per day
                caching_enabled=False,
            ),
        )

        # Convenience alias — single Lambda integration for all routes
        lambda_integration = apigw.LambdaIntegration(
            self.query_fn,
            request_templates={"application/json": '{"statusCode": "200"}'},
            proxy=True,   # pass full event; handler dispatches on resource path
        )

        # ── /activities ───────────────────────────────────────────────────────
        activities = self.api.root.add_resource("activities")
        activities.add_method("GET", lambda_integration)

        activity_id = activities.add_resource("{id}")
        activity_id.add_method("GET", lambda_integration)

        # ── /wellness ─────────────────────────────────────────────────────────
        wellness = self.api.root.add_resource("wellness")
        wellness.add_method("GET", lambda_integration)

        # ── /athlete ──────────────────────────────────────────────────────────
        athlete = self.api.root.add_resource("athlete")
        athlete.add_method("GET", lambda_integration)

        # ── /power-curve ──────────────────────────────────────────────────────
        power_curve = self.api.root.add_resource("power-curve")
        power_curve.add_method("GET", lambda_integration)

        # ── /pace-curve ───────────────────────────────────────────────────────
        pace_curve = self.api.root.add_resource("pace-curve")
        pace_curve.add_method("GET", lambda_integration)

        # ── /hr-curve ─────────────────────────────────────────────────────────
        hr_curve = self.api.root.add_resource("hr-curve")
        hr_curve.add_method("GET", lambda_integration)

        # ── /weekly-tss ───────────────────────────────────────────────────────
        weekly_tss = self.api.root.add_resource("weekly-tss")
        weekly_tss.add_method("GET", lambda_integration)

        # ── /ytd ──────────────────────────────────────────────────────────────
        ytd = self.api.root.add_resource("ytd")
        ytd.add_method("GET", lambda_integration)

        # ── CloudFormation Outputs ────────────────────────────────────────────
        CfnOutput(
            self,
            "ApiUrl",
            value=self.api.url,
            description="Base URL for the Fitness Dashboard REST API",
            export_name="FitnessDashboardApiUrl",
        )

        CfnOutput(
            self,
            "QueryFunctionArn",
            value=self.query_fn.function_arn,
            description="ARN of the query Lambda function",
            export_name="FitnessDashboardQueryFunctionArn",
        )
