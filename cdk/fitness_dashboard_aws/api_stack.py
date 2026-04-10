"""
API Stack - Phase 3 + Phase 7
Creates the REST API Gateway and Lambda query functions.

Phase 3 endpoints:
  GET /activities          - Recent activities (query params: days, limit, sport)
  GET /activities/{id}     - Single activity by ID
  GET /wellness            - CTL/ATL/TSB/HRV/Sleep/Weight (days, from, to)
  GET /athlete             - Current athlete profile + recent wellness
  GET /power-curve         - Latest critical power curve (optional: date)
  GET /pace-curve          - Latest running pace curve   (optional: date)
  GET /hr-curve            - Latest heart rate curve     (optional: date)
  GET /weekly-tss          - Weekly TSS totals by sport  (weeks)
  GET /ytd                 - Year-to-date totals by sport (year)

Phase 7 endpoints (Strava OAuth — server-side token exchange):
  POST /strava/token       - Exchange auth code for access+refresh tokens
  POST /strava/refresh     - Exchange refresh token for new access token

The Strava OAuth Lambda is defined here (not a separate stack) to avoid
circular CDK dependencies.
"""

from aws_cdk import (
    Stack,
    Duration,
    CfnOutput,
    aws_lambda as lambda_,
    aws_iam as iam,
    aws_apigateway as apigw,
    aws_logs as logs,
    aws_secretsmanager as sm,
    aws_cloudwatch as cloudwatch,
)
from constructs import Construct

from .dynamodb_stack import DynamoDBStack


class ApiStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        dynamo_stack: DynamoDBStack,
        athlete_id: str = "5718022",
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
            timeout=Duration.seconds(29),
            memory_size=256,
            role=query_role,
            environment={
                "ACTIVITIES_TABLE": dynamo_stack.activities_table.table_name,
                "WELLNESS_TABLE":   dynamo_stack.wellness_table.table_name,
                "CURVES_TABLE":     dynamo_stack.curves_table.table_name,
                "ATHLETE_ID":       athlete_id,
            },
            log_retention=logs.RetentionDays.THREE_MONTHS,
        )

        # ── Phase 7: Strava OAuth Lambda ──────────────────────────────────────
        # Defined here (not a separate stack) to avoid circular CDK dependency.
        # The Lambda reads client_secret from Secrets Manager — never the browser.
        strava_oauth_role = iam.Role(
            self,
            "StravaOAuthRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        strava_secret = sm.Secret.from_secret_name_v2(
            self, "StravaSecret", "fitness-dashboard/strava-credentials"
        )
        strava_secret.grant_read(strava_oauth_role)

        self.strava_oauth_fn = lambda_.Function(
            self,
            "StravaOAuthFunction",
            function_name="fitness-dashboard-strava-oauth",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset(
                "fitness_dashboard_aws/lambda/strava_oauth"
            ),
            timeout=Duration.seconds(15),
            memory_size=128,
            role=strava_oauth_role,
            environment={
                "STRAVA_SECRET_NAME": "fitness-dashboard/strava-credentials",
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
            description="Fitness Dashboard REST API — Phase 3 + Phase 7",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=["GET", "POST", "OPTIONS"],
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
                caching_enabled=False,
            ),
        )

        # Lambda integrations
        query_integration = apigw.LambdaIntegration(
            self.query_fn,
            request_templates={"application/json": '{"statusCode": "200"}'},
            proxy=True,
        )

        strava_integration = apigw.LambdaIntegration(
            self.strava_oauth_fn,
            request_templates={"application/json": '{"statusCode": "200"}'},
            proxy=True,
        )

        # ── Phase 3 routes ────────────────────────────────────────────────────
        activities = self.api.root.add_resource("activities")
        activities.add_method("GET", query_integration)
        activity_id = activities.add_resource("{id}")
        activity_id.add_method("GET", query_integration)

        wellness = self.api.root.add_resource("wellness")
        wellness.add_method("GET", query_integration)

        athlete = self.api.root.add_resource("athlete")
        athlete.add_method("GET", query_integration)

        power_curve = self.api.root.add_resource("power-curve")
        power_curve.add_method("GET", query_integration)

        pace_curve = self.api.root.add_resource("pace-curve")
        pace_curve.add_method("GET", query_integration)

        hr_curve = self.api.root.add_resource("hr-curve")
        hr_curve.add_method("GET", query_integration)

        weekly_tss = self.api.root.add_resource("weekly-tss")
        weekly_tss.add_method("GET", query_integration)

        ytd = self.api.root.add_resource("ytd")
        ytd.add_method("GET", query_integration)

        # ── Phase 7 routes ────────────────────────────────────────────────────
        strava = self.api.root.add_resource("strava")
        strava_token = strava.add_resource("token")
        strava_token.add_method("POST", strava_integration)
        strava_refresh = strava.add_resource("refresh")
        strava_refresh.add_method("POST", strava_integration)

        # ── Ops: Sync Widget Lambda + CloudWatch Dashboard ────────────────────
        # CloudWatch custom widget that lets you trigger FitnessDashboardCollector
        # on demand from the AWS Console, without opening the Lambda test tab.
        COLLECTOR_NAME = "FitnessDashboardCollector"

        sync_widget_role = iam.Role(
            self,
            "SyncWidgetRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        # Allow widget to invoke the collector
        sync_widget_role.add_to_policy(
            iam.PolicyStatement(
                actions=["lambda:InvokeFunction"],
                resources=[
                    f"arn:aws:lambda:eu-west-2:656370357696:function:{COLLECTOR_NAME}"
                ],
            )
        )

        # Allow widget to read collector log streams for last-sync timestamp
        sync_widget_role.add_to_policy(
            iam.PolicyStatement(
                actions=["logs:DescribeLogStreams", "logs:GetLogEvents"],
                resources=[
                    f"arn:aws:logs:eu-west-2:656370357696:log-group:/aws/lambda/{COLLECTOR_NAME}:*"
                ],
            )
        )

        self.sync_widget_fn = lambda_.Function(
            self,
            "SyncWidgetFunction",
            function_name="FitnessDashboardSyncWidget",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset(
                "fitness_dashboard_aws/lambda/sync_widget"
            ),
            timeout=Duration.seconds(30),
            memory_size=128,
            role=sync_widget_role,
            description="CloudWatch custom widget — triggers Intervals.icu sync on demand",
            log_retention=logs.RetentionDays.ONE_MONTH,
        )

        # Grant CloudWatch permission to invoke the widget Lambda
        self.sync_widget_fn.add_permission(
            "AllowCloudWatchInvoke",
            principal=iam.ServicePrincipal("cloudwatch.amazonaws.com"),
        )

        # CloudWatch dashboard with the custom widget
        import json as _json
        cloudwatch.CfnDashboard(
            self,
            "TrainingOsOpsDashboard",
            dashboard_name="TrainingOS-Ops",
            dashboard_body=_json.dumps({
                "widgets": [
                    {
                        "type": "custom",
                        "x": 0,
                        "y": 0,
                        "width": 8,
                        "height": 4,
                        "properties": {
                            "endpoint": self.sync_widget_fn.function_arn,
                            "title": "Manual sync — Intervals.icu",
                            "updateOn": {
                                "refresh": True,
                                "resize": False,
                                "timeRange": False,
                            },
                        },
                    }
                ]
            }),
        )

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

        CfnOutput(
            self,
            "StravaOAuthFunctionArn",
            value=self.strava_oauth_fn.function_arn,
            description="ARN of the Strava OAuth Lambda function",
        )
