"""
Lambda Data Collector - Phase 2.2
Replaces GitHub Actions / collect_data.py workflow.

Fetches from Intervals.icu API and writes to DynamoDB.
Triggered by EventBridge on schedule (06:00 UTC daily).

Athlete ID: 5718022 (i5718022 prefix in API calls)
Auth: Basic auth with "API_KEY" as username + actual key as password
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
import urllib.request
import urllib.parse
import base64

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── AWS clients ───────────────────────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb")
secrets_client = boto3.client("secretsmanager")

ATHLETE_ID = "5718022"
INTERVALS_BASE_URL = "https://intervals.icu/api/v1"

# Table names (set via Lambda env vars)
ACTIVITIES_TABLE = os.environ.get("ACTIVITIES_TABLE", "fitness-activities")
WELLNESS_TABLE = os.environ.get("WELLNESS_TABLE", "fitness-wellness")
CURVES_TABLE = os.environ.get("CURVES_TABLE", "fitness-curves")

INTERVALS_SECRET_NAME = os.environ.get(
    "INTERVALS_SECRET_NAME", "fitness-dashboard/intervals-api-key"
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_intervals_api_key() -> str:
    """
    Retrieve Intervals.icu API key from Secrets Manager.
    Handles both storage formats:
      - Plain string:  "abc123"
      - JSON object:   {"api_key": "abc123"} or any single-value dict
    """
    response = secrets_client.get_secret_value(SecretId=INTERVALS_SECRET_NAME)
    secret = response["SecretString"]

    # If stored as JSON key/value pair, extract the actual key value
    try:
        parsed = json.loads(secret)
        if isinstance(parsed, dict):
            for key in ("api_key", "value", "key", "secret", "intervals_api_key"):
                if key in parsed:
                    logger.info(f"Extracted API key from JSON secret using key: '{key}'")
                    return parsed[key]
            first_val = next(iter(parsed.values()))
            logger.info("Extracted API key from JSON secret (first value)")
            return first_val
    except (json.JSONDecodeError, StopIteration):
        pass  # Not JSON, treat as plain string

    logger.info("Using API key as plain string")
    return secret



def intervals_get(path: str, api_key: str, params: dict = None) -> dict | list:
    """Make an authenticated GET request to the Intervals.icu API."""
    url = f"{INTERVALS_BASE_URL}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    # Intervals.icu uses Basic auth: username="API_KEY", password=<actual key>
    credentials = base64.b64encode(f"API_KEY:{api_key}".encode()).decode()
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Basic {credentials}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())


def float_to_decimal(obj):
    """Recursively convert floats to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: float_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [float_to_decimal(i) for i in obj]
    return obj


# ── Sync functions ────────────────────────────────────────────────────────────

def sync_activities(api_key: str) -> int:
    """
    Fetch recent activities from Intervals.icu and upsert into DynamoDB.
    Uses the /athlete/{id}/activities endpoint.
    Fetches last 90 days to catch any backfill.
    """
    table = dynamodb.Table(ACTIVITIES_TABLE)

    oldest = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    newest = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    activities = intervals_get(
        f"athlete/{ATHLETE_ID}/activities",
        api_key,
        params={"oldest": oldest, "newest": newest},
    )

    count = 0
    with table.batch_writer() as batch:
        for activity in activities:
            item = float_to_decimal(activity)
            item["athlete_id"] = ATHLETE_ID
            # activity_id from Intervals is numeric; store as string for DynamoDB sort key
            item["activity_id"] = str(activity.get("id", ""))
            # Normalise date field for GSI sort key
            item["start_date"] = str(activity.get("start_date_local", ""))[:10]
            batch.put_item(Item=item)
            count += 1

    logger.info(f"Synced {count} activities")
    return count


def sync_wellness(api_key: str) -> int:
    """
    Fetch wellness data from Intervals.icu and upsert into DynamoDB.
    Uses the /athlete/{id}/wellness endpoint.
    Wellness includes CTL, ATL, TSB, HRV, sleep, weight, resting HR.
    These values are computed by Intervals.icu — never recalculated client-side.
    """
    table = dynamodb.Table(WELLNESS_TABLE)

    oldest = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    newest = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    wellness_data = intervals_get(
        f"athlete/{ATHLETE_ID}/wellness",
        api_key,
        params={"oldest": oldest, "newest": newest},
    )

    count = 0
    with table.batch_writer() as batch:
        for entry in wellness_data:
            item = float_to_decimal(entry)
            item["athlete_id"] = ATHLETE_ID
            item["date"] = str(entry.get("id", ""))  # Intervals uses 'id' as the date
            batch.put_item(Item=item)
            count += 1

    logger.info(f"Synced {count} wellness entries")
    return count


def sync_power_curves(api_key: str) -> int:
    """
    Fetch power curves from Intervals.icu and upsert into DynamoDB.
    Uses the /athlete/{id}/power-curves endpoint.
    Intervals computes Critical Power — never recalculate client-side.
    """
    table = dynamodb.Table(CURVES_TABLE)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    curves = intervals_get(
        f"athlete/{ATHLETE_ID}/power-curves",
        api_key,
        params={"type": "Ride", "curves": "power"},
    )

    count = 0
    with table.batch_writer() as batch:
        item = float_to_decimal(curves) if isinstance(curves, dict) else {}
        item["athlete_id"] = ATHLETE_ID
        item["curve_type_date"] = f"power#{today}"
        item["fetched_date"] = today
        batch.put_item(Item=item)
        count += 1

    logger.info(f"Synced power curves ({count} records)")
    return count


def sync_athlete(api_key: str) -> dict:
    """
    Fetch current athlete profile from Intervals.icu.
    Includes FTP, W'bal, weight and other current stats.
    Stored in wellness table under a special 'athlete_profile' sort key.
    """
    table = dynamodb.Table(WELLNESS_TABLE)

    athlete = intervals_get(
        f"athlete/{ATHLETE_ID}",
        api_key,
    )

    item = float_to_decimal(athlete)
    item["athlete_id"] = ATHLETE_ID
    item["date"] = "athlete_profile"  # Static key for latest profile
    item["updated_at"] = datetime.now(timezone.utc).isoformat()

    table.put_item(Item=item)
    logger.info("Synced athlete profile")
    return item


# ── Handler ───────────────────────────────────────────────────────────────────

def handler(event, context):
    """
    Main Lambda handler.
    Triggered by EventBridge schedule (06:00 UTC daily).
    Can also be invoked manually with event = {"force": true}.
    """
    logger.info(f"Data collector triggered. Event: {json.dumps(event)}")

    try:
        api_key = get_intervals_api_key()
        logger.info("Successfully retrieved API key from Secrets Manager")
    except Exception as e:
        logger.error(f"Failed to retrieve API key: {e}")
        raise

    results = {}

    try:
        results["activities"] = sync_activities(api_key)
    except Exception as e:
        logger.error(f"Activities sync failed: {e}")
        results["activities_error"] = str(e)

    try:
        results["wellness"] = sync_wellness(api_key)
    except Exception as e:
        logger.error(f"Wellness sync failed: {e}")
        results["wellness_error"] = str(e)

    try:
        results["power_curves"] = sync_power_curves(api_key)
    except Exception as e:
        logger.error(f"Power curves sync failed: {e}")
        results["power_curves_error"] = str(e)

    try:
        sync_athlete(api_key)
        results["athlete"] = "ok"
    except Exception as e:
        logger.error(f"Athlete sync failed: {e}")
        results["athlete_error"] = str(e)

    logger.info(f"Sync complete: {json.dumps(results)}")
    return {"statusCode": 200, "body": json.dumps(results)}
