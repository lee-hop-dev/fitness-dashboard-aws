"""
Emergency Shutdown Stack - Phase 5
Creates:
  - Lambda function for emergency shutdown
  - API Gateway endpoint: POST /emergency-shutdown
  - SNS topic for auto-shutdown trigger
  - IAM permissions to disable EventBridge and throttle API Gateway
  - Secret token for API authentication
"""

from aws_cdk import (
    Stack,
    Duration,
    SecretValue,
    aws_lambda as lambda_,
    aws_iam as iam,
    aws_sns as sns,
    aws_sns_subscriptions as subscriptions,
    aws_logs as logs,
    CfnOutput,
)
from constructs import Construct

from .collector_stack import CollectorStack


class EmergencyShutdownStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        collector_stack: CollectorStack,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── SNS Topic for Auto-Shutdown Trigger ───────────────────────────────
        # This topic receives budget alerts at $10 threshold
        self.shutdown_topic = sns.Topic(
            self,
            "ShutdownTriggerTopic",
            topic_name="fitness-dashboard-shutdown-trigger",
            display_name="Fitness Dashboard Auto-Shutdown Trigger",
        )

        # ── IAM Role for Shutdown Lambda ──────────────────────────────────────
        shutdown_role = iam.Role(
            self,
            "ShutdownRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                )
            ],
        )

        # Grant permission to disable EventBridge rules
        shutdown_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=["events:DisableRule"],
                resources=[
                    f"arn:aws:events:{self.region}:{self.account}:rule/fitness-dashboard-daily-sync"
                ],
            )
        )

        # Grant permission to publish to alert SNS topic (set later via set_alert_topic method)

        # ── Generate Shutdown Token ───────────────────────────────────────────
        # Simple token generation (in production, use Secrets Manager)
        import secrets
        shutdown_token = secrets.token_urlsafe(32)

        # ── Shutdown Lambda Function ──────────────────────────────────────────
        self.shutdown_fn = lambda_.Function(
            self,
            "EmergencyShutdownFn",
            function_name="fitness-dashboard-emergency-shutdown",
            runtime=lambda_.Runtime.PYTHON_3_11,
            handler="handler.handler",
            code=lambda_.Code.from_asset(
                "fitness_dashboard_aws/lambda/emergency_shutdown"
            ),
            timeout=Duration.seconds(30),
            memory_size=256,
            role=shutdown_role,
            environment={
                "EVENTBRIDGE_RULE_NAME": "fitness-dashboard-daily-sync",
                "SHUTDOWN_TOKEN": shutdown_token,
            },
            log_retention=logs.RetentionDays.ONE_MONTH,
        )

        # Subscribe shutdown Lambda to the auto-shutdown SNS topic
        self.shutdown_topic.add_subscription(
            subscriptions.LambdaSubscription(self.shutdown_fn)
        )

        # ── Outputs ────────────────────────────────────────────────────────────
        CfnOutput(
            self,
            "ShutdownTopicARN",
            value=self.shutdown_topic.topic_arn,
            description="SNS topic ARN for budget-triggered auto-shutdown",
            export_name="FitnessDashboardShutdownTopicARN",
        )

        CfnOutput(
            self,
            "ShutdownFunctionName",
            value=self.shutdown_fn.function_name,
            description="Lambda function name for emergency shutdown",
        )

        # Store token as output (for manual Lambda invocation if needed)
        CfnOutput(
            self,
            "ShutdownToken",
            value=shutdown_token,
            description="Authentication token for manual shutdown (invoke Lambda directly)",
        )

    def set_alert_topic(self, alert_topic: sns.Topic) -> None:
        """
        Set the alert topic for shutdown confirmations after monitoring stack is created.
        This resolves circular dependency between monitoring and shutdown stacks.
        """
        # Grant publish permission to shutdown function
        alert_topic.grant_publish(self.shutdown_fn.role)
        
        # Update Lambda environment variable
        self.shutdown_fn.add_environment("ALERT_TOPIC_ARN", alert_topic.topic_arn)
