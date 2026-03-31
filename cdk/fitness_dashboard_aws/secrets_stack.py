"""
Secrets Manager Stack - Phase 2.3
Creates secrets for all API credentials:
  - Intervals.icu API key
  - Strava client ID, client secret, refresh token
"""

from aws_cdk import (
    Stack,
    aws_secretsmanager as sm,
)
from constructs import Construct


class SecretsStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── Intervals.icu ────────────────────────────────────────────────────
        # Auth uses literal "API_KEY" as username + actual key as password
        self.intervals_secret = sm.Secret(
            self,
            "IntervalsApiKey",
            secret_name="fitness-dashboard/intervals-api-key",
            description="Intervals.icu API key for athlete 5718022",
            # Placeholder - populate manually in console after deploy
            secret_string_value=None,  # Will be set manually
        )

        # ── Strava ───────────────────────────────────────────────────────────
        # Bundle all Strava credentials as a single JSON secret for efficiency
        self.strava_secret = sm.Secret(
            self,
            "StravaCreds",
            secret_name="fitness-dashboard/strava-credentials",
            description="Strava OAuth credentials (client_id, client_secret, refresh_token)",
            # Placeholder structure - populate manually in console after deploy
            secret_string_value=None,  # Will be set manually
        )

    @property
    def intervals_secret_arn(self) -> str:
        return self.intervals_secret.secret_arn

    @property
    def strava_secret_arn(self) -> str:
        return self.strava_secret.secret_arn
