"""
Budget Stack - Phase 5.2
Creates:
  - AWS Budget with 4-tier alerting ($2.40, $3, $5, $10)
  - SNS integration for email alerts
  - Auto-shutdown trigger at $10 threshold
"""

from aws_cdk import (
    Stack,
    aws_budgets as budgets,
    aws_sns as sns,
)
from constructs import Construct


class BudgetStack(Stack):

    def __init__(
        self,
        scope: Construct,
        construct_id: str,
        alert_topic: sns.Topic,
        shutdown_topic: sns.Topic,
        **kwargs,
    ) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── AWS Budget with 4-tier alerting ───────────────────────────────────
        budget = budgets.CfnBudget(
            self,
            "MonthlyBudget",
            budget=budgets.CfnBudget.BudgetDataProperty(
                budget_name="fitness-dashboard-monthly-cost",
                budget_type="COST",
                time_unit="MONTHLY",
                budget_limit=budgets.CfnBudget.SpendProperty(
                    amount=10.0,  # Emergency shutdown threshold
                    unit="USD",
                ),
            ),
            notifications_with_subscribers=[
                # Tier 1: $2.40 (80% of $3 — early warning)
                budgets.CfnBudget.NotificationWithSubscribersProperty(
                    notification=budgets.CfnBudget.NotificationProperty(
                        notification_type="ACTUAL",
                        comparison_operator="GREATER_THAN",
                        threshold=24.0,  # 24% of $10 limit = $2.40
                        threshold_type="PERCENTAGE",
                    ),
                    subscribers=[
                        budgets.CfnBudget.SubscriberProperty(
                            subscription_type="SNS",
                            address=alert_topic.topic_arn,
                        ),
                    ],
                ),
                # Tier 2: $3.00 (first threshold)
                budgets.CfnBudget.NotificationWithSubscribersProperty(
                    notification=budgets.CfnBudget.NotificationProperty(
                        notification_type="ACTUAL",
                        comparison_operator="GREATER_THAN",
                        threshold=30.0,  # 30% of $10 limit = $3.00
                        threshold_type="PERCENTAGE",
                    ),
                    subscribers=[
                        budgets.CfnBudget.SubscriberProperty(
                            subscription_type="SNS",
                            address=alert_topic.topic_arn,
                        ),
                    ],
                ),
                # Tier 3: $5.00 (critical alert)
                budgets.CfnBudget.NotificationWithSubscribersProperty(
                    notification=budgets.CfnBudget.NotificationProperty(
                        notification_type="ACTUAL",
                        comparison_operator="GREATER_THAN",
                        threshold=50.0,  # 50% of $10 limit = $5.00
                        threshold_type="PERCENTAGE",
                    ),
                    subscribers=[
                        budgets.CfnBudget.SubscriberProperty(
                            subscription_type="SNS",
                            address=alert_topic.topic_arn,
                        ),
                    ],
                ),
                # Tier 4: $10.00 (emergency shutdown trigger)
                budgets.CfnBudget.NotificationWithSubscribersProperty(
                    notification=budgets.CfnBudget.NotificationProperty(
                        notification_type="ACTUAL",
                        comparison_operator="GREATER_THAN",
                        threshold=100.0,  # 100% of $10 limit = $10.00
                        threshold_type="PERCENTAGE",
                    ),
                    subscribers=[
                        # Only shutdown topic here - it will notify alert_topic via Lambda
                        budgets.CfnBudget.SubscriberProperty(
                            subscription_type="SNS",
                            address=shutdown_topic.topic_arn,
                        ),
                    ],
                ),
            ],
        )
