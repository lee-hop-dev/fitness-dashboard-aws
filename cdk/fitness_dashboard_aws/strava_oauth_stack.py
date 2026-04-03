"""
Strava OAuth Stack - Phase 7
Server-side token exchange Lambda + API Gateway routes.

Adds two POST endpoints to the existing REST API:
  POST /strava/token    - Exchange authorisation code → access+refresh tokens
  POST /strava/refresh  - Exchange refresh token → new access token

The Lambda reads client_secret from Secrets Manager so it never
reaches the browser. CORS is pre-configured for the CloudFront origin.
"""

from aws_cdk import (
    Stack,
    Duration,
    CfnOutput,
    aws_lambda as lambda_,
    aws_iam as iam,
    aws_logs as logs,
)
from constructs import Construct

from .secrets_stack import SecretsStack
from .api_stack import ApiStack


class StravaOAuthStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        secrets_stack: SecretsStack,
        api_stack: ApiStack,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── IAM Role ──────────────────────────────────────────────────────────
        oauth_role = iam.Role(
            self,
            "StravaOAuthRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        # Read-only access to the Strava credentials secret
        secrets_stack.strava_secret.grant_read(oauth_role)

        # ── Lambda ────────────────────────────────────────────────────────────
        self.oauth_fn = lambda_.Function(
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
            role=oauth_role,
            environment={
                "STRAVA_SECRET_NAME": "fitness-dashboard/strava-credentials",
            },
            log_retention=logs.RetentionDays.THREE_MONTHS,
        )

        # ── API Gateway routes (added to existing REST API) ───────────────────
        oauth_integration = api_stack.api.root.add_resource("strava")

        # POST /strava/token
        token_resource = oauth_integration.add_resource("token")
        token_resource.add_method(
            "POST",
            api_stack._make_lambda_integration(self.oauth_fn),
        )

        # POST /strava/refresh
        refresh_resource = oauth_integration.add_resource("refresh")
        refresh_resource.add_method(
            "POST",
            api_stack._make_lambda_integration(self.oauth_fn),
        )

        # ── Outputs ───────────────────────────────────────────────────────────
        CfnOutput(
            self,
            "StravaOAuthFunctionArn",
            value=self.oauth_fn.function_arn,
            description="ARN of the Strava OAuth Lambda function",
        )
