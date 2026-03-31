"""
DynamoDB Stack - Phase 2.1
Creates the three core tables for the fitness dashboard:
  - fitness-activities
  - fitness-wellness
  - fitness-curves
"""

from aws_cdk import (
    Stack,
    RemovalPolicy,
    aws_dynamodb as dynamodb,
)
from constructs import Construct


class DynamoDBStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── Activities table ─────────────────────────────────────────────────
        # Stores individual training activities fetched from Intervals.icu
        self.activities_table = dynamodb.Table(
            self,
            "ActivitiesTable",
            table_name="fitness-activities",
            partition_key=dynamodb.Attribute(
                name="athlete_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="activity_id", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,  # Never auto-delete production data
        )

        # GSI: query activities by date (for recent-N queries)
        self.activities_table.add_global_secondary_index(
            index_name="athlete_id-start_date-index",
            partition_key=dynamodb.Attribute(
                name="athlete_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="start_date", type=dynamodb.AttributeType.STRING
            ),
            projection_type=dynamodb.ProjectionType.ALL,
        )

        # ── Wellness table ───────────────────────────────────────────────────
        # Stores daily wellness: CTL, ATL, TSB, HRV, sleep, weight, resting HR
        self.wellness_table = dynamodb.Table(
            self,
            "WellnessTable",
            table_name="fitness-wellness",
            partition_key=dynamodb.Attribute(
                name="athlete_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="date", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )

        # ── Curves table ─────────────────────────────────────────────────────
        # Stores power curves, pace curves, HR curves
        # Sort key format: "power#2025-01-15", "pace#2025-01-15", "hr#2025-01-15"
        self.curves_table = dynamodb.Table(
            self,
            "CurvesTable",
            table_name="fitness-curves",
            partition_key=dynamodb.Attribute(
                name="athlete_id", type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name="curve_type_date", type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.RETAIN,
        )
