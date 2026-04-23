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
from boto3.dynamodb.conditions import Key

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


def _decode_polyline(encoded: str) -> list:
    """
    Decode a Google-encoded polyline string into [[lat, lng], ...] pairs.
    Strava map.polyline uses this format. No external library required.
    Returns list of [lat, lng] float pairs.
    """
    coords = []
    index = 0
    lat = 0
    lng = 0
    while index < len(encoded):
        # Decode latitude delta
        result, shift, b = 0, 0, 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if result & 1 else result >> 1
        lat += dlat

        # Decode longitude delta
        result, shift, b = 0, 0, 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if result & 1 else result >> 1
        lng += dlng

        coords.append([lat / 1e5, lng / 1e5])
    return coords


def paginate_query(table, **kwargs) -> list:
    """Exhaust DynamoDB Query pagination and return all matching items."""
    items = []
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    return items


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

def sync_activities(api_key: str, days: int = 400) -> int:
    """
    Fetch recent activities from Intervals.icu and upsert into DynamoDB.
    Uses the /athlete/{id}/activities endpoint.
    Fetches last 400 days by default to populate the 1-year heatmap and
    rowing/running all-time PBs. Pass days=1095 for a 3-year backfill.

    Field names follow the Intervals.icu OpenAPI spec exactly.
    Key fields stored as-is from the API:
      type                  — sport type (Ride, Run, VirtualRide, etc.)
      icu_training_load     — TSS equivalent
      icu_average_watts     — average power
      icu_weighted_avg_watts— normalised power
      icu_intensity         — intensity factor on 0-100+ scale (NOT 0.0-1.0)
                              — frontend divides by 100 to show 0.90 etc.
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
    Generic curve sync: fetches from Intervals.icu, writes to DynamoDB curves table,
    and writes the raw response to S3 as a static JSON file for the frontend.

    S3 filenames match what the pages fetch directly:
      power → data/power_curves_90d.json
      pace  → data/pace_curves_90d.json
      hr    → data/hr_curves_90d.json

    Intervals computes all curves — never recalculate client-side.
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

    # Write to DynamoDB (for API Gateway endpoint)
    item = float_to_decimal(data) if isinstance(data, dict) else {"raw": float_to_decimal(data)}
    item["athlete_id"] = ATHLETE_ID
    item["curve_type_date"] = f"{curve_key}#{today}"
    item["fetched_date"] = today
    table.put_item(Item=item)
    logger.info(f"Synced {curve_key} curves to DynamoDB")

    # Write to S3 (for direct static file fetch by cycling/running pages)
    if FRONTEND_BUCKET:
        s3_key = f"data/{curve_key}_curves_90d.json"
        s3_client.put_object(
            Bucket=FRONTEND_BUCKET,
            Key=s3_key,
            Body=json.dumps(data),
            ContentType="application/json",
        )
        logger.info(f"Wrote {s3_key} to s3://{FRONTEND_BUCKET}/{s3_key}")

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


def get_running_pbs(api_key: str) -> dict:
    """
    Read all-time running PBs directly from Intervals.icu pace-curves endpoint
    using curves=all. This is the same authoritative source as the Intervals UI.
    Reads distance[] and values[] arrays to find exact 5k and 10k times.
    """
    data = intervals_get(
        f"athlete/{ATHLETE_ID}/pace-curves",
        api_key,
        params={"type": "Run", "curves": ["all"]},
    )
    if not data:
        logger.warning("No all-time pace curve returned")
        return {}

    curve = None
    if isinstance(data, dict) and data.get("list"):
        curve = data["list"][0]
    elif isinstance(data, list) and data:
        curve = data[0]

    if not curve:
        return {}

    distances = curve.get("distance", [])
    times     = curve.get("values", [])

    if not isinstance(distances, list):
        logger.warning("Pace curve distance field is not an array")
        return {}

    pbs = {}
    for target, key in [(5000, "pb_5k"), (10000, "pb_10k"), (21097, "pb_half_marathon")]:
        idx = next(
            (i for i, d in enumerate(distances) if abs(float(d) - target) < 50),
            None,
        )
        if idx is not None and times[idx]:
            pbs[key] = round(float(times[idx]), 1)
            mins, secs = divmod(int(pbs[key]), 60)
            logger.info(f"{key}: {pbs[key]}s ({mins}:{secs:02d})")
        else:
            logger.info(f"{key}: not found in all-time pace curve")

    return pbs


def sync_athlete(api_key: str) -> dict:
    """
    Fetch athlete profile from Intervals.icu and persist to wellness table.
    Running PBs are read from the Intervals all-time pace curve — the same
    authoritative source Intervals.icu UI uses. No activity scanning.
    """
    table = dynamodb.Table(WELLNESS_TABLE)

    athlete = intervals_get(f"athlete/{ATHLETE_ID}", api_key)

    pbs = get_running_pbs(api_key)
    logger.info(f"Running PBs from Intervals all-time pace curve: {pbs}")

    item = float_to_decimal(athlete)
    item["athlete_id"] = ATHLETE_ID
    item["date"]       = "athlete_profile"
    item["updated_at"] = datetime.now(timezone.utc).isoformat()
    for k, v in pbs.items():
        item[k] = float_to_decimal(v)

    table.put_item(Item=item)
    logger.info("Synced athlete profile with running PBs")
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


# ── Phase 8: Activity stream sync ─────────────────────────────────────────────

def _should_include_segment(effort: dict) -> bool:
    """
    Segment filter for Phase 8 stream JSON.
    Include if: personal top-3 PR, overall Strava top-10, or age-group top-10.
    Everything else is discarded at collection time — not stored, not sent to browser.
    """
    pr_rank  = effort.get("pr_rank")
    kom_rank = effort.get("kom_rank")
    qom_rank = effort.get("qom_rank")

    personal_top3   = pr_rank  is not None and pr_rank  <= 3
    overall_top10   = kom_rank is not None and kom_rank <= 10
    age_group_top10 = qom_rank is not None and qom_rank <= 10

    return personal_top3 or overall_top10 or age_group_top10


def _fetch_stream_data(activity_id: str, api_key: str) -> dict:
    """
    Fetch raw activity streams from Intervals.icu.
    Returns a dict keyed by stream type, each value being the data array.
    activity_id must include the 'i' prefix (e.g. 'i135229442').

    Correct endpoint: /api/v1/activity/{id}/streams.json
    Note: 'activity' singular (not athlete/.../activities), .json suffix required.
    Ref: https://forum.intervals.icu/t/access-activities-streams-via-api/101065
    """
    raw = intervals_get(
        f"activity/{activity_id}/streams.json",
        api_key,
    )
    # Intervals returns a list of {type, data[]} objects — normalise to dict
    if isinstance(raw, list):
        return {item["type"]: item.get("data", []) for item in raw if "type" in item}
    if isinstance(raw, dict):
        return raw
    return {}


def _fetch_kudos_count(strava_id: str, access_token: str) -> int:
    """
    Fetch kudos count from Strava for a single activity.
    Stores count only — not the athlete list (PII consideration).
    Returns 0 on any error so a failed kudos fetch never blocks stream writing.
    """
    try:
        result = strava_get(f"activities/{strava_id}/kudos", access_token)
        if isinstance(result, list):
            return len(result)
    except Exception as e:
        logger.warning(f"Kudos fetch failed for strava_id={strava_id}: {e}")
    return 0


def _fetch_strava_activity_data(strava_id: str, access_token: str) -> tuple:
    """
    Fetch Strava activity — extracts both qualifying segment efforts and GPS polyline
    from a single API call. Returns (segments, latlng_pairs).

    segments: list of qualifying segment dicts (PR top-3 / overall top-10 / AG top-10)
    latlng_pairs: list of [lat, lng] pairs decoded from map.polyline, or [] if unavailable

    Replaces _fetch_qualifying_segments — combines into one Strava call for efficiency.
    """
    data = strava_get(
        f"activities/{strava_id}",
        access_token,
        params={"include_all_efforts": "true"},
    )
    if not data:
        return [], []

    # Decode GPS polyline — Strava map.polyline is the full-resolution track
    latlng_pairs = []
    polyline = data.get("map", {}).get("polyline") or ""
    if polyline:
        try:
            latlng_pairs = _decode_polyline(polyline)
            logger.info(f"Strava {strava_id}: decoded {len(latlng_pairs)} GPS points from polyline")
        except Exception as e:
            logger.warning(f"Polyline decode failed for strava_id={strava_id}: {e}")

    # Filter segment efforts
    efforts = data.get("segment_efforts", [])
    segments = []
    for effort in efforts:
        if not _should_include_segment(effort):
            continue
        seg = effort.get("segment", {})
        segments.append({
            "name":           seg.get("name", ""),
            "distance_m":     seg.get("distance", 0),
            "elapsed_time_s": effort.get("elapsed_time", 0),
            "pr_rank":        effort.get("pr_rank"),
            "kom_rank":       effort.get("kom_rank"),
            "qom_rank":       effort.get("qom_rank"),
            "segment_id":     str(seg.get("id", "")),
        })
    logger.info(
        f"Strava {strava_id}: {len(efforts)} total segment efforts, "
        f"{len(segments)} qualifying (PR top-3 / overall top-10 / AG top-10)"
    )
    return segments, latlng_pairs


def _fetch_laps(activity_id: str, api_key: str) -> tuple:
    """
    Fetch lap/interval data and full activity metrics from Intervals.icu.
    Returns (laps, meta). Meta contains all fields required by the frontend
    summary + hero panels — everything pre-calculated by Intervals, no
    browser-side recalculation needed.
    Single API call — reuses the activity detail endpoint for laps.
    activity_id must include the 'i' prefix (e.g. 'i135229442').

    Correct endpoint: /api/v1/activity/{id}?intervals=true
    Ref: https://forum.intervals.icu/t/solved-how-to-fetch-lap-interval-data-via-api/126341

    Field audit (2026-04 — verified against live DynamoDB rows):
      Universal (present on Ride/Run/Row, though some null on very short sessions):
        moving_time, distance, average_speed, pace, max_speed,
        average_heartrate, max_heartrate, athlete_max_hr,
        average_cadence (unit differs per sport: rpm/spm/strokes-per-min),
        average_stride, icu_training_load, icu_weight,
        polarization_index, trimp, icu_hr_zones, icu_hr_zone_times,
        hr_load, hr_load_type
      Ride-only (null for Run/Row):
        icu_average_watts, icu_weighted_avg_watts, icu_w_prime,
        icu_variability_index, icu_efficiency_factor, icu_joules,
        icu_intensity (0-100 scale, divide by 100 for display),
        decoupling (already a %), icu_zone_times (power),
        strain_score, power_load
      Run-only (null for Ride/Row):
        pace_zone_times, pace_load, gap
      Sport-specific FTP:
        icu_ftp — sport-specific FTP at activity time (Ride or Run)
      Elevation (null for indoor):
        total_elevation_gain, total_elevation_loss
    """
    try:
        raw = intervals_get(
            f"activity/{activity_id}",
            api_key,
            params={"intervals": "true"},
        )
        if not isinstance(raw, dict):
            return [], {}

        # Build meta dict — pass Intervals values through verbatim.
        # Use .get() so missing fields become None (handled by frontend as "hide tile").
        meta = {
            # ── Identity & display ────────────────────────────────────────────
            "name":                   raw.get("name", ""),
            "start_date_local":       raw.get("start_date_local", ""),
            # ── Duration & distance ───────────────────────────────────────────
            "moving_time":            raw.get("moving_time"),
            "elapsed_time":           raw.get("elapsed_time"),
            "distance":               raw.get("distance"),
            "average_speed":          raw.get("average_speed"),
            "max_speed":              raw.get("max_speed"),
            "pace":                   raw.get("pace"),
            # ── Heart rate ────────────────────────────────────────────────────
            "average_heartrate":      raw.get("average_heartrate"),
            "max_heartrate":          raw.get("max_heartrate"),
            "athlete_max_hr":         raw.get("athlete_max_hr"),
            "lthr":                   raw.get("lthr"),
            "icu_resting_hr":         raw.get("icu_resting_hr"),
            "icu_hr_zones":           raw.get("icu_hr_zones"),
            "icu_hr_zone_times":      raw.get("icu_hr_zone_times"),
            # ── Cadence & stride ──────────────────────────────────────────────
            "average_cadence":        raw.get("average_cadence"),
            "average_stride":         raw.get("average_stride"),
            # ── Power (Ride-only; null elsewhere) ─────────────────────────────
            "icu_ftp":                raw.get("icu_ftp"),
            "icu_average_watts":      raw.get("icu_average_watts"),
            "icu_weighted_avg_watts": raw.get("icu_weighted_avg_watts"),
            "icu_w_prime":            raw.get("icu_w_prime"),
            "icu_variability_index":  raw.get("icu_variability_index"),
            "icu_efficiency_factor":  raw.get("icu_efficiency_factor"),
            "icu_joules":             raw.get("icu_joules"),
            "icu_joules_above_ftp":   raw.get("icu_joules_above_ftp"),
            "icu_power_zones":        raw.get("icu_power_zones"),
            "icu_zone_times":         raw.get("icu_zone_times"),
            "decoupling":             raw.get("decoupling"),
            "strain_score":           raw.get("strain_score"),
            # ── Run-only ──────────────────────────────────────────────────────
            "pace_zones":             raw.get("pace_zones"),
            "pace_zone_times":        raw.get("pace_zone_times"),
            "gap_zone_times":         raw.get("gap_zone_times"),
            "gap":                    raw.get("gap"),
            # ── Training load ─────────────────────────────────────────────────
            "icu_training_load":      raw.get("icu_training_load"),
            "icu_intensity":          raw.get("icu_intensity"),   # 0-100 scale
            "hr_load":                raw.get("hr_load"),
            "pace_load":              raw.get("pace_load"),
            "power_load":             raw.get("power_load"),
            "hr_load_type":           raw.get("hr_load_type"),
            "trimp":                  raw.get("trimp"),
            "polarization_index":     raw.get("polarization_index"),
            # ── Weight & context ──────────────────────────────────────────────
            "icu_weight":             raw.get("icu_weight"),
            # ── Elevation (null for indoor) ───────────────────────────────────
            "total_elevation_gain":   raw.get("total_elevation_gain"),
            "total_elevation_loss":   raw.get("total_elevation_loss"),
            "min_altitude":           raw.get("min_altitude"),
            "max_altitude":           raw.get("max_altitude"),
            # ── Source / context ──────────────────────────────────────────────
            "source":                 raw.get("source"),
            "device_name":            raw.get("device_name"),
            "trainer":                raw.get("trainer"),
            "has_segments":           raw.get("has_segments"),
        }
        intervals = raw.get("icu_intervals", [])
        if not isinstance(intervals, list):
            return [], meta
        laps = []
        lap_num = 0
        for interval in intervals:
            # icu_intervals includes all interval types (RECOVERY, LAP, ACTIVE etc)
            # Include all — frontend can filter/display as needed
            lap_num += 1
            laps.append({
                "lap":         lap_num,
                "type":        interval.get("type"),
                "elapsed_s":   interval.get("elapsed_time", 0),
                "distance_m":  interval.get("distance"),
                "avg_watts":   interval.get("average_watts"),
                "np_watts":    interval.get("weighted_average_watts"),
                "avg_hr":      interval.get("average_heartrate"),
                "max_hr":      interval.get("max_heartrate"),
                "avg_cadence": interval.get("average_cadence"),
                "avg_speed":   interval.get("average_speed"),
                "zone":        interval.get("zone"),
                "label":       interval.get("label"),
                "start_time":  interval.get("start_time"),
                "end_time":    interval.get("end_time"),
            })
        return laps, meta
    except Exception as e:
        logger.warning(f"Laps fetch failed for {activity_id}: {e}")
        return [], {}


def sync_streams_14d(api_key: str, access_token: str) -> dict:
    """
    Phase 8 — Proactive 14-day stream sync.

    For each activity in the last 14 days:
      1. Fetch streams (power, HR, cadence, GPS etc) from Intervals.icu
      2. Fetch kudos count from Strava (count only, one-time snapshot)
      3. Fetch and filter segment efforts (PR top-3, overall top-10, AG top-10)
      4. Fetch lap splits + full activity metrics from Intervals.icu
      5. Write combined payload to S3: data/streams/{activity_id}.json

    The payload includes all Intervals pre-calculated values (TSS/NP/IF/VI/
    decoupling/work etc) in the top level — frontend reads directly, no
    client-side recalculation. See _fetch_laps() meta block for full field list.

    Files are Lambda-managed — never overwritten by frontend deploys.
    CloudFront serves them as static assets — no Lambda in the page load path.

    Idempotent: safe to re-run; overwrites existing stream files.
    Can be triggered on-demand via {"refresh_streams": true} event payload.
    """
    if not FRONTEND_BUCKET:
        logger.warning("FRONTEND_BUCKET not set — stream files not written to S3")
        return {"error": "FRONTEND_BUCKET not set"}

    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    cutoff_str = cutoff.strftime("%Y-%m-%d")

    # Pull 14-day activities from DynamoDB
    table = dynamodb.Table(ACTIVITIES_TABLE)
    scan_result = table.scan(
        FilterExpression="athlete_id = :aid AND start_date >= :cutoff",
        ExpressionAttributeValues={
            ":aid":    ATHLETE_ID,
            ":cutoff": cutoff_str,
        },
        ProjectionExpression="activity_id, #t, strava_id, start_date",
        ExpressionAttributeNames={"#t": "type"},
    )
    activities = scan_result.get("Items", [])
    # Handle DynamoDB pagination in case of large result sets
    while "LastEvaluatedKey" in scan_result:
        scan_result = table.scan(
            ExclusiveStartKey=scan_result["LastEvaluatedKey"],
            FilterExpression="athlete_id = :aid AND start_date >= :cutoff",
            ExpressionAttributeValues={
                ":aid":    ATHLETE_ID,
                ":cutoff": cutoff_str,
            },
            ProjectionExpression="activity_id, #t, strava_id, start_date",
            ExpressionAttributeNames={"#t": "type"},
        )
        activities.extend(scan_result.get("Items", []))

    logger.info(f"sync_streams_14d: found {len(activities)} activities since {cutoff_str}")

    results = {"written": 0, "errors": 0, "skipped": 0}

    for act in activities:
        raw_id    = str(act.get("activity_id", ""))
        strava_id = act.get("strava_id")
        sport     = act.get("type", "")

        # Intervals activity IDs are stored as numeric strings in DynamoDB
        # — prefix with 'i' for all API calls and S3 key
        activity_id = raw_id if raw_id.startswith("i") else f"i{raw_id}"

        logger.info(f"Processing {activity_id} ({sport})")

        try:
            # 1. Streams from Intervals.icu
            streams = _fetch_stream_data(activity_id, api_key)
            if not streams:
                logger.warning(f"No stream data returned for {activity_id} — skipping")
                results["skipped"] += 1
                continue

            # 2. Kudos from Strava (count only, graceful on missing strava_id)
            kudos_count = 0
            if strava_id:
                kudos_count = _fetch_kudos_count(str(strava_id), access_token)

            # 3. Qualifying segments + GPS polyline from Strava (single API call)
            segments = []
            strava_latlng = []
            if strava_id:
                segments, strava_latlng = _fetch_strava_activity_data(
                    str(strava_id), access_token
                )

            # Replace Intervals latlng stream (latitude-only) with Strava polyline
            # Strava map.polyline provides proper [lat, lng] pairs.
            # Intervals.icu latlng stream only contains latitudes — confirmed via API.
            if strava_latlng:
                streams["latlng"] = strava_latlng
                logger.info(
                    f"{activity_id}: replaced Intervals latlng with "
                    f"{len(strava_latlng)} Strava GPS pairs"
                )
            elif "latlng" in streams:
                # No Strava polyline — remove broken Intervals latlng
                # (latitudes-only data would render as straight lines)
                del streams["latlng"]
                logger.info(f"{activity_id}: removed Intervals latlng (no Strava polyline available)")

            # 4. Lap splits + full activity metrics from Intervals.icu (single call)
            #    activity_meta contains every pre-calculated field the frontend needs.
            laps, activity_meta = _fetch_laps(activity_id, api_key)

            # 5. Assemble payload and write to S3
            #    Top-level shape preserved (activity_id, sport_type, kudos_count,
            #    icu_ftp, athlete_max_hr, streams, laps, segments) for backwards
            #    compatibility; all additional Intervals fields are flattened in
            #    from activity_meta.
            payload = {
                # ── Identity ──────────────────────────────────────────────────
                "activity_id":      activity_id,
                "synced_at":        datetime.now(timezone.utc).isoformat() + "Z",
                "sport_type":       sport,
                "strava_id":        str(strava_id) if strava_id else None,
                # ── All Intervals pre-calculated fields (see _fetch_laps) ─────
                **activity_meta,
                # ── Strava kudos + streams + laps + segments ──────────────────
                "kudos_count":      kudos_count,
                "streams":          streams,
                "laps":             laps,
                "segments":         segments,
            }

            s3_client.put_object(
                Bucket=FRONTEND_BUCKET,
                Key=f"data/streams/{activity_id}.json",
                Body=json.dumps(payload),
                ContentType="application/json",
            )
            logger.info(
                f"Wrote data/streams/{activity_id}.json — "
                f"kudos={kudos_count}, laps={len(laps)}, segments={len(segments)}"
            )
            results["written"] += 1

        except Exception as e:
            logger.error(f"Stream sync failed for {activity_id}: {e}")
            results["errors"] += 1

    logger.info(f"sync_streams_14d complete: {json.dumps(results)}")
    return results


def sync_youtube_videos() -> dict:
    """
    Fetch latest videos from @lh_cymru YouTube channel using YouTube Data API v3.
    Writes to S3: data/youtube_videos.json
    
    Returns dict with synced video count and channel info.
    """
    if not FRONTEND_BUCKET:
        logger.warning("FRONTEND_BUCKET not set — YouTube videos not written to S3")
        return {"error": "FRONTEND_BUCKET not set"}
    
    try:
        # Get YouTube API key from Secrets Manager
        response = secrets_client.get_secret_value(
            SecretId="fitness-dashboard/youtube-api-key"
        )
        youtube_key = response["SecretString"]
        
        # Channel handle (without @)
        handle = "lh_cymru"
        
        # Step 1: Resolve channel ID from handle using forHandle parameter
        # YouTube Data API v3 channels endpoint supports forHandle lookup
        channel_url = (
            f"https://www.googleapis.com/youtube/v3/channels"
            f"?part=snippet,contentDetails"
            f"&forHandle={handle}"
            f"&key={youtube_key}"
        )
        
        req = urllib.request.Request(channel_url)
        with urllib.request.urlopen(req) as resp:
            channel_data = json.loads(resp.read().decode())
        
        if not channel_data.get("items"):
            logger.error(f"Channel @{handle} not found")
            return {"error": f"Channel @{handle} not found"}
        
        channel_item = channel_data["items"][0]
        channel_id = channel_item["id"]
        channel_title = channel_item["snippet"]["title"]
        uploads_playlist_id = channel_item["contentDetails"]["relatedPlaylists"]["uploads"]
        
        logger.info(f"Found channel: {channel_title} (ID: {channel_id})")
        
        # Step 2: Fetch recent videos from the uploads playlist
        # This is more reliable than search for getting all uploads in order
        playlist_url = (
            f"https://www.googleapis.com/youtube/v3/playlistItems"
            f"?part=snippet,contentDetails"
            f"&playlistId={uploads_playlist_id}"
            f"&maxResults=10"
            f"&key={youtube_key}"
        )
        
        req = urllib.request.Request(playlist_url)
        with urllib.request.urlopen(req) as resp:
            playlist_data = json.loads(resp.read().decode())
        
        # Transform to simplified structure
        videos = []
        for item in playlist_data.get("items", []):
            snippet = item["snippet"]
            video_id = snippet["resourceId"]["videoId"]
            
            # Get the best available thumbnail (high > medium > default)
            thumbnails = snippet.get("thumbnails", {})
            thumbnail_url = (
                thumbnails.get("high", {}).get("url") or
                thumbnails.get("medium", {}).get("url") or
                thumbnails.get("default", {}).get("url") or
                ""
            )
            
            videos.append({
                "video_id": video_id,
                "title": snippet["title"],
                "description": snippet.get("description", ""),
                "thumbnail": thumbnail_url,
                "published_at": snippet["publishedAt"],
                "url": f"https://www.youtube.com/watch?v={video_id}",
            })
        
        # Write to S3
        payload = {
            "channel_handle": f"@{handle}",
            "channel_id": channel_id,
            "channel_title": channel_title,
            "synced_at": datetime.now(timezone.utc).isoformat(),
            "video_count": len(videos),
            "videos": videos,
        }
        
        s3_client.put_object(
            Bucket=FRONTEND_BUCKET,
            Key="data/youtube_videos.json",
            Body=json.dumps(payload, indent=2),
            ContentType="application/json",
        )
        
        logger.info(f"Synced {len(videos)} YouTube videos from @{handle}")
        return {
            "synced": len(videos),
            "channel": channel_title,
        }
        
    except Exception as e:
        logger.error(f"YouTube sync failed: {e}")
        return {"error": str(e)}


# ── Handler ───────────────────────────────────────────────────────────────────

def handler(event, context):
    """
    Main Lambda handler.
    Triggered by EventBridge schedule (06:00 UTC daily).

    Supported event payloads:
      {}                          — normal daily sync (all functions)
      {"backfill_days": 1095}     — backfill activities (3-year)
      {"refresh_streams": true}   — re-fetch all 14d streams + kudos only
                                    (used by ops dashboard Refresh button)
    """
    logger.info(f"Data collector triggered. Event: {json.dumps(event)}")

    # ── refresh_streams: standalone stream re-fetch, skip routine sync ─────────
    if event.get("refresh_streams"):
        logger.info("refresh_streams mode: re-fetching all 14d activity streams")
        try:
            api_key = get_intervals_api_key()
            strava_creds = get_strava_creds()
            access_token = strava_get_access_token(strava_creds)
            result = sync_streams_14d(api_key, access_token)
            logger.info(f"refresh_streams complete: {json.dumps(result)}")
            return {"statusCode": 200, "body": json.dumps({"refresh_streams": result})}
        except Exception as e:
            logger.error(f"refresh_streams failed: {e}")
            return {"statusCode": 500, "body": json.dumps({"error": str(e)})}

    # ── Normal daily sync ─────────────────────────────────────────────────────
    try:
        api_key = get_intervals_api_key()
        logger.info("Successfully retrieved API key from Secrets Manager")
    except Exception as e:
        logger.error(f"Failed to retrieve API key: {e}")
        raise

    results = {}

    # Default 400 days keeps the 1-year heatmap and all-time rowing/running PBs populated.
    # Pass {"backfill_days": 1095} for a 3-year backfill.
    backfill_days = int(event.get("backfill_days", 400))
    if backfill_days != 400:
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

    # ── Phase 8: Activity streams (14-day proactive sync) ─────────────────────
    try:
        # Strava access token already obtained above for segments — reuse it.
        # If segments block failed, get a fresh token here.
        if "segments_error" in results:
            strava_creds = get_strava_creds()
            access_token = strava_get_access_token(strava_creds)
        stream_result = sync_streams_14d(api_key, access_token)
        results["streams"] = stream_result
    except Exception as e:
        logger.error(f"Streams sync failed: {e}")
        results["streams_error"] = str(e)

    # ── YouTube videos (latest from @lh_cymru) ────────────────────────────────
    try:
        youtube_result = sync_youtube_videos()
        results["youtube"] = youtube_result
    except Exception as e:
        logger.error(f"YouTube sync failed: {e}")
        results["youtube_error"] = str(e)

    logger.info(f"Sync complete: {json.dumps(results)}")
    return {"statusCode": 200, "body": json.dumps(results)}
