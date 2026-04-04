"""
Lambda Data Collector - Phase 2.2
Replaces GitHub Actions / collect_data.py workflow.

Fetches from Intervals.icu API and writes to DynamoDB.
Triggered by EventBridge on schedule (06:00 UTC daily).

Athlete ID: 5718022 (i5718022 prefix in API calls)
Auth: Basic auth with "API_KEY" as username + actual key as password
"""

import base64
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── AWS clients ───────────────────────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb")
secrets_client = boto3.client("secretsmanager")
s3_client = boto3.client("s3")

ATHLETE_ID = "5718022"
INTERVALS_BASE_URL = "https://intervals.icu/api/v1"

# Table names (set via Lambda env vars)
ACTIVITIES_TABLE = os.environ.get("ACTIVITIES_TABLE", "fitness-activities")
WELLNESS_TABLE   = os.environ.get("WELLNESS_TABLE",   "fitness-wellness")
CURVES_TABLE     = os.environ.get("CURVES_TABLE",     "fitness-curves")

INTERVALS_SECRET_NAME = os.environ.get(
    "INTERVALS_SECRET_NAME", "fitness-dashboard/intervals-api-key"
)
STRAVA_SECRET_NAME = os.environ.get(
    "STRAVA_SECRET_NAME", "fitness-dashboard/strava-credentials"
)
FRONTEND_BUCKET = os.environ.get("FRONTEND_BUCKET", "")

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
        # Handle list values correctly (e.g. curves=["90d"] -> curves=90d)
        # urllib.parse.urlencode does not handle lists like requests does
        parts = []
        for k, v in params.items():
            if isinstance(v, list):
                for item in v:
                    parts.append(f"{urllib.parse.quote(str(k))}={urllib.parse.quote(str(item))}")
            else:
                parts.append(f"{urllib.parse.quote(str(k))}={urllib.parse.quote(str(v))}")
        url += "?" + "&".join(parts)

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

def sync_activities(api_key: str, days: int = 90) -> int:
    """
    Fetch recent activities from Intervals.icu and upsert into DynamoDB.
    Uses the /athlete/{id}/activities endpoint.
    Fetches last 90 days by default; pass days=400 for a one-time backfill.

    Field names follow the Intervals.icu OpenAPI spec exactly.
    Key fields stored as-is from the API:
      type                  — sport type (Ride, Run, VirtualRide, etc.)
      icu_training_load     — TSS equivalent
      icu_average_watts     — average power
      icu_weighted_avg_watts— normalised power
      icu_intensity         — intensity factor (0.0–1.0+, NOT percent)
      icu_ftp               — FTP at time of activity
      icu_w_prime           — W\'bal
      icu_weight            — weight at time of activity
      average_heartrate     — average HR (NOT average_hr)
      max_heartrate         — max HR
      total_elevation_gain  — elevation gain (NOT elevation_gain)
      distance              — distance in metres
      moving_time           — moving time in seconds

    Strava stub activities (containing \'_note\' field) are skipped.
    """
    table = dynamodb.Table(ACTIVITIES_TABLE)

    oldest = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    newest = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # limit=500 ensures we capture all activities in the date range.
    # Intervals.icu default limit is lower and silently truncates results.
    activities = intervals_get(
        f"athlete/{ATHLETE_ID}/activities",
        api_key,
        params={"oldest": oldest, "newest": newest, "limit": 500},
    )

    count = 0
    skipped = 0
    with table.batch_writer() as batch:
        for activity in activities:
            # Filter out Strava stub activities — they contain _note and no useful data
            if "_note" in activity or not activity.get("type"):
                skipped += 1
                continue

            item = float_to_decimal(activity)
            item["athlete_id"] = ATHLETE_ID
            # activity_id from Intervals is numeric; store as string for DynamoDB sort key
            item["activity_id"] = str(activity.get("id", ""))
            # Normalise date field for GSI sort key (use start_date_local, truncate to date)
            item["start_date"] = str(activity.get("start_date_local", ""))[:10]
            batch.put_item(Item=item)
            count += 1

    logger.info(f"Synced {count} activities, skipped {skipped} Strava stubs")
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


def sync_curve(api_key: str, endpoint: str, sport_type: str, curve_key: str) -> bool:
    """
    Generic curve sync: fetches from Intervals.icu and writes to DynamoDB curves table.
    Intervals computes all curves — never recalculate client-side.
    params format matches working collect_data.py: curves as list.
    """
    table = dynamodb.Table(CURVES_TABLE)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    data = intervals_get(
        f"athlete/{ATHLETE_ID}/{endpoint}",
        api_key,
        params={"type": sport_type, "curves": ["90d"]},
    )

    if not data:
        logger.warning(f"No data returned for {curve_key}")
        return False

    item = float_to_decimal(data) if isinstance(data, dict) else {"raw": float_to_decimal(data)}
    item["athlete_id"] = ATHLETE_ID
    item["curve_type_date"] = f"{curve_key}#{today}"
    item["fetched_date"] = today
    table.put_item(Item=item)
    logger.info(f"Synced {curve_key} curves")
    return True


def sync_all_curves(api_key: str) -> dict:
    """Sync power (Ride), pace (Run) and HR (Run) curves — matching collect_data.py."""
    results = {}
    curves = [
        ("power-curves",  "Ride", "power"),
        ("pace-curves",   "Run",  "pace"),
        ("hr-curves",     "Run",  "hr"),
    ]
    for endpoint, sport, key in curves:
        try:
            results[key] = sync_curve(api_key, endpoint, sport, key)
        except Exception as e:
            logger.error(f"{key} curves sync failed: {e}")
            results[f"{key}_error"] = str(e)
    return results


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


# ── Strava helpers ────────────────────────────────────────────────────────────

def get_strava_creds() -> dict:
    """Retrieve Strava credentials from Secrets Manager.
    Returns dict with client_id, client_secret, refresh_token."""
    response = secrets_client.get_secret_value(SecretId=STRAVA_SECRET_NAME)
    return json.loads(response["SecretString"])


def strava_get_access_token(creds: dict) -> str:
    """Exchange Strava refresh token for a fresh access token."""
    data = urllib.parse.urlencode({
        "client_id":     creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
        "grant_type":    "refresh_token",
    }).encode()
    req = urllib.request.Request(
        "https://www.strava.com/oauth/token",
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())["access_token"]


def strava_get(endpoint: str, access_token: str, params: dict = None) -> dict | list | None:
    """Make an authenticated GET request to the Strava API with retry + rate-limit handling."""
    url = f"https://www.strava.com/api/v3/{endpoint}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            time.sleep(0.3)  # respect Strava rate limits
            req = urllib.request.Request(
                url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                logger.warning("Strava rate limited, sleeping 60s...")
                time.sleep(60)
                continue
            logger.error(f"Strava HTTP error {e.code} for {endpoint}: {e}")
            if attempt == 2:
                return None
            time.sleep(5 * (attempt + 1))
        except Exception as e:
            logger.error(f"Strava request failed for {endpoint}: {e}")
            if attempt == 2:
                return None
            time.sleep(5 * (attempt + 1))
    return None


def sync_segments(activities: list, access_token: str) -> dict:
    """
    Build segment data from the most recent Strava activity for each sport.
    Only includes segments where pr_rank is 1, 2 or 3 (PR / top-3 personal best).

    Mirrors V1 build_segments() in collect_data.py exactly.
    Writes the result to data/segments.json in the S3 frontend bucket.
    """
    CYCLING_TYPES = ("Ride", "VirtualRide")
    RUNNING_TYPES = ("Run", "VirtualRun")

    segments = {"cycling": [], "running": []}

    # Only activities that came from / have a Strava ID
    strava_acts = [a for a in activities if a.get("strava_id")]
    cycling_candidates = [a for a in strava_acts if a.get("type") in CYCLING_TYPES]
    running_candidates = [a for a in strava_acts if a.get("type") in RUNNING_TYPES]

    logger.info(
        f"Segment candidates — cycling: {len(cycling_candidates)}, "
        f"running: {len(running_candidates)}"
    )

    def fetch_efforts(candidates: list, sport: str) -> tuple[dict | None, list]:
        """Try up to 5 recent activities; return the first one that has segment efforts."""
        for act in candidates[:5]:
            data = strava_get(
                f"activities/{act['strava_id']}",
                access_token,
                params={"include_all_efforts": "true"},
            )
            efforts = data.get("segment_efforts", []) if data else []
            if efforts:
                logger.info(
                    f"Found {len(efforts)} {sport} segments in "
                    f"'{act.get('name', act['strava_id'])}' ({act.get('date', '')})"
                )
                return act, efforts
            else:
                logger.info(
                    f"No segments in '{act.get('name', act['strava_id'])}' "
                    f"({act.get('date', '')}), trying next"
                )
        logger.info(f"No segments found in last {min(5, len(candidates))} {sport} activities")
        return None, []

    def build_entries(activity: dict, efforts: list, sport: str) -> list:
        entries = []
        for e in efforts:
            pr_rank = e.get("pr_rank")
            if pr_rank is None or pr_rank > 3:
                continue

            seg   = e.get("segment", {})
            stats = e.get("athlete_segment_stats", {})

            achievement = {1: "gold", 2: "silver", 3: "bronze"}.get(pr_rank)

            entry = {
                "id":             seg.get("id"),
                "name":           seg.get("name", ""),
                "distance":       seg.get("distance", 0),
                "avg_grade":      seg.get("average_grade", 0),
                "max_grade":      seg.get("maximum_grade", 0),
                "climb_category": seg.get("climb_category", 0),
                "elevation_gain": (seg.get("elevation_high", 0) or 0)
                                  - (seg.get("elevation_low", 0) or 0),

                "time":           e.get("elapsed_time", 0),
                "moving_time":    e.get("moving_time", 0),
                "date":           activity.get("date", ""),
                "activity_name":  activity.get("name", ""),

                "pr_rank":        pr_rank,
                "kom_rank":       e.get("kom_rank"),
                "pr_time":        stats.get("pr_elapsed_time"),
                "pr_date":        stats.get("pr_date"),
                "effort_count":   stats.get("effort_count"),

                "avg_hr":         e.get("average_heartrate"),
                "max_hr":         e.get("max_heartrate"),
                "avg_cadence":    e.get("average_cadence"),

                "achievement":    achievement,
                "is_pr":          pr_rank == 1,
            }
            if sport == "cycling":
                entry["avg_power"] = e.get("average_watts")

            entries.append(entry)
        return entries

    act, efforts = fetch_efforts(cycling_candidates, "cycling")
    if act:
        segments["cycling"] = build_entries(act, efforts, "cycling")

    act, efforts = fetch_efforts(running_candidates, "running")
    if act:
        segments["running"] = build_entries(act, efforts, "running")

    cycling_prs = sum(1 for s in segments["cycling"] if s["is_pr"])
    running_prs = sum(1 for s in segments["running"] if s["is_pr"])
    logger.info(
        f"Segments built — cycling: {len(segments['cycling'])} "
        f"({cycling_prs} PRs), running: {len(segments['running'])} ({running_prs} PRs)"
    )

    # Write to S3 frontend bucket
    if FRONTEND_BUCKET:
        s3_client.put_object(
            Bucket=FRONTEND_BUCKET,
            Key="data/segments.json",
            Body=json.dumps(segments),
            ContentType="application/json",
        )
        logger.info(f"Wrote segments.json to s3://{FRONTEND_BUCKET}/data/segments.json")
    else:
        logger.warning("FRONTEND_BUCKET not set — segments.json not written to S3")

    return segments


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

    # Support one-time backfill: invoke Lambda with {"backfill_days": 400}
    backfill_days = int(event.get("backfill_days", 90))
    if backfill_days != 90:
        logger.info(f"Backfill mode: fetching {backfill_days} days of activities")

    try:
        results["activities"] = sync_activities(api_key, days=backfill_days)
    except Exception as e:
        logger.error(f"Activities sync failed: {e}")
        results["activities_error"] = str(e)

    try:
        results["wellness"] = sync_wellness(api_key)
    except Exception as e:
        logger.error(f"Wellness sync failed: {e}")
        results["wellness_error"] = str(e)

    try:
        results["curves"] = sync_all_curves(api_key)
    except Exception as e:
        logger.error(f"Curves sync failed: {e}")
        results["curves_error"] = str(e)

    try:
        sync_athlete(api_key)
        results["athlete"] = "ok"
    except Exception as e:
        logger.error(f"Athlete sync failed: {e}")
        results["athlete_error"] = str(e)

    # ── Strava segments (PR / top-3) ──────────────────────────────────────────
    try:
        strava_creds = get_strava_creds()
        access_token = strava_get_access_token(strava_creds)

        # Load activities from DynamoDB to find strava_id candidates
        table = dynamodb.Table(ACTIVITIES_TABLE)
        scan_result = table.scan(
            FilterExpression="attribute_exists(strava_id)",
            ProjectionExpression="strava_id, #t, #n, start_date",
            ExpressionAttributeNames={"#t": "type", "#n": "name"},
        )
        ddb_activities = [
            {
                "strava_id": item["strava_id"],
                "type":      item.get("type", ""),
                "name":      item.get("name", ""),
                "date":      item.get("start_date", ""),
            }
            for item in scan_result.get("Items", [])
            if item.get("strava_id")
        ]
        # Sort newest first so we check the most recent activities first
        ddb_activities.sort(key=lambda a: a["date"], reverse=True)

        seg_result = sync_segments(ddb_activities, access_token)
        results["segments"] = {
            "cycling": len(seg_result["cycling"]),
            "running": len(seg_result["running"]),
        }
    except Exception as e:
        logger.error(f"Segments sync failed: {e}")
        results["segments_error"] = str(e)

    logger.info(f"Sync complete: {json.dumps(results)}")
    return {"statusCode": 200, "body": json.dumps(results)}
