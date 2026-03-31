"""
Query Functions Lambda - Phase 3
Single handler dispatches all API Gateway routes to the correct DynamoDB query.

Routes handled:
  GET /activities          - Recent activities list (last 90 days by default)
  GET /activities/{id}     - Single activity by activity_id
  GET /wellness            - CTL/ATL/TSB/HRV/Sleep/Weight (last 90 days by default)
  GET /athlete             - Current athlete profile (FTP, W'bal, weight, etc.)
  GET /power-curve         - Latest critical power curve
  GET /pace-curve          - Latest running pace curve
  GET /hr-curve            - Latest heart rate curve
  GET /weekly-tss          - Weekly TSS totals by sport
  GET /ytd                 - Year-to-date totals by sport

All responses include CORS headers.  Error responses follow the same envelope:
  {"error": "<message>", "statusCode": <int>}
"""

import json
import logging
import os
from datetime import datetime, timezone, timedelta
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key, Attr

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── AWS resources ─────────────────────────────────────────────────────────────
dynamodb = boto3.resource("dynamodb", region_name="eu-west-2")

ACTIVITIES_TABLE = os.environ["ACTIVITIES_TABLE"]
WELLNESS_TABLE   = os.environ["WELLNESS_TABLE"]
CURVES_TABLE     = os.environ["CURVES_TABLE"]
ATHLETE_ID       = os.environ.get("ATHLETE_ID", "5718022")

activities_table = dynamodb.Table(ACTIVITIES_TABLE)
wellness_table   = dynamodb.Table(WELLNESS_TABLE)
curves_table     = dynamodb.Table(CURVES_TABLE)

# ── CORS headers returned on every response ───────────────────────────────────
CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Content-Type": "application/json",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

class DecimalEncoder(json.JSONEncoder):
    """DynamoDB returns Decimal; JSON doesn't support it."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Preserve integer values as int, floats as float
            return int(obj) if obj % 1 == 0 else float(obj)
        return super().default(obj)


def ok(body, status=200):
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body, cls=DecimalEncoder),
    }


def err(message, status=500):
    logger.error(message)
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message, "statusCode": status}),
    }


def days_ago(n: int) -> str:
    """Return ISO date string for N days ago (UTC)."""
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")


def current_year_start() -> str:
    return f"{datetime.now(timezone.utc).year}-01-01"


def paginate_query(table, **kwargs) -> list:
    """Exhaust DynamoDB pagination and return all items."""
    items = []
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        last = resp.get("LastEvaluatedKey")
        if not last:
            break
        kwargs["ExclusiveStartKey"] = last
    return items


# ── Route handlers ────────────────────────────────────────────────────────────

def get_activities(params: dict) -> dict:
    """
    Query activities by date using the GSI athlete_id-start_date-index.
    Optional query params:
      days  - number of days to look back (default 90)
      limit - max items to return (default 200)
      sport - filter by sport type (optional)
    """
    days  = int(params.get("days", 90))
    limit = int(params.get("limit", 200))
    sport = params.get("sport")

    since = days_ago(days)
    logger.info("get_activities: athlete=%s since=%s sport=%s", ATHLETE_ID, since, sport)

    kwargs = dict(
        IndexName="athlete_id-start_date-index",
        KeyConditionExpression=(
            Key("athlete_id").eq(ATHLETE_ID) &
            Key("start_date").gte(since)
        ),
        ScanIndexForward=False,  # newest first
        Limit=limit,
    )

    if sport:
        # Intervals.icu uses 'type' for sport (Ride, Run, VirtualRide etc.)
        kwargs["FilterExpression"] = Attr("type").eq(sport)

    items = paginate_query(activities_table, **kwargs)
    return ok({"activities": items, "count": len(items), "since": since})


def get_activity(activity_id: str) -> dict:
    """Fetch a single activity by its ID."""
    logger.info("get_activity: athlete=%s id=%s", ATHLETE_ID, activity_id)

    resp = activities_table.get_item(
        Key={"athlete_id": ATHLETE_ID, "activity_id": activity_id}
    )
    item = resp.get("Item")
    if not item:
        return err(f"Activity {activity_id} not found", 404)
    return ok(item)


def get_wellness(params: dict) -> dict:
    """
    Query wellness entries (CTL/ATL/TSB/HRV/Sleep/Weight).
    Optional query params:
      days  - number of days to look back (default 90)
      from  - explicit ISO start date e.g. 2025-01-01
      to    - explicit ISO end date   e.g. 2025-12-31
    """
    days  = int(params.get("days", 90))
    from_ = params.get("from", days_ago(days))
    to_   = params.get("to", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

    logger.info("get_wellness: athlete=%s from=%s to=%s", ATHLETE_ID, from_, to_)

    items = paginate_query(
        wellness_table,
        KeyConditionExpression=(
            Key("athlete_id").eq(ATHLETE_ID) &
            Key("date").between(from_, to_)
        ),
        ScanIndexForward=True,  # chronological
    )
    return ok({"wellness": items, "count": len(items), "from": from_, "to": to_})


def get_athlete(_params: dict) -> dict:
    """
    Return the athlete profile plus recent wellness trend.

    The collector stores the Intervals.icu athlete profile as a wellness
    record with the static sort key "athlete_profile".  Fetch that directly,
    then also return the last 7 days of wellness entries for trend data.
    """
    logger.info("get_athlete: athlete=%s", ATHLETE_ID)

    # Fetch the static athlete_profile record written by the collector
    resp = wellness_table.get_item(
        Key={"athlete_id": ATHLETE_ID, "date": "athlete_profile"}
    )
    profile = resp.get("Item")
    if not profile:
        return err("Athlete profile not found — run the data collector first", 404)

    # Recent wellness entries for trend display (ISO date sort keys only)
    recent = paginate_query(
        wellness_table,
        KeyConditionExpression=(
            Key("athlete_id").eq(ATHLETE_ID) &
            Key("date").gte(days_ago(7))
        ),
        ScanIndexForward=False,
    )
    # Filter out the static athlete_profile key from the trend list
    recent = [w for w in recent if w.get("date") != "athlete_profile"]

    return ok({
        "athlete_id": ATHLETE_ID,
        "profile": profile,
        "recent_wellness": recent,
    })


def get_curve(curve_type: str, params: dict) -> dict:
    """
    Fetch the most recent curve of the given type (power / pace / hr).
    Optional query param:
      date - return curve for specific date (ISO, default = latest)
    """
    date = params.get("date")
    prefix = f"{curve_type}#"

    logger.info("get_curve: athlete=%s type=%s date=%s", ATHLETE_ID, curve_type, date)

    if date:
        sort_key = f"{curve_type}#{date}"
        resp = curves_table.get_item(
            Key={"athlete_id": ATHLETE_ID, "curve_type_date": sort_key}
        )
        item = resp.get("Item")
        if not item:
            return err(f"{curve_type} curve for {date} not found", 404)
        return ok(item)

    # No date — fetch the latest entry for this curve type
    resp = curves_table.query(
        KeyConditionExpression=(
            Key("athlete_id").eq(ATHLETE_ID) &
            Key("curve_type_date").begins_with(prefix)
        ),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    if not items:
        return err(f"No {curve_type} curve data found", 404)
    return ok(items[0])


def get_weekly_tss(params: dict) -> dict:
    """
    Aggregate TSS by sport for each calendar week.
    Optional query params:
      weeks - number of weeks to look back (default 12)
    """
    weeks = int(params.get("weeks", 12))
    since = days_ago(weeks * 7)

    logger.info("get_weekly_tss: athlete=%s since=%s", ATHLETE_ID, since)

    items = paginate_query(
        activities_table,
        IndexName="athlete_id-start_date-index",
        KeyConditionExpression=(
            Key("athlete_id").eq(ATHLETE_ID) &
            Key("start_date").gte(since)
        ),
        ScanIndexForward=True,
        # Intervals.icu fields: 'type' = sport, 'icu_training_load' = TSS
        ProjectionExpression="start_date, #sport_type, icu_training_load",
        ExpressionAttributeNames={"#sport_type": "type"},
    )

    # Build {week_start: {sport: tss}} mapping
    buckets: dict[str, dict[str, float]] = {}
    for item in items:
        date_str = item.get("start_date", "")[:10]
        if not date_str:
            continue
        try:
            d = datetime.strptime(date_str, "%Y-%m-%d")
        except ValueError:
            continue
        # ISO week Monday
        week_start = (d - timedelta(days=d.weekday())).strftime("%Y-%m-%d")
        sport = item.get("type", "Other")                      # 'type' per Intervals.icu spec
        tss   = float(item.get("icu_training_load") or 0)     # 'icu_training_load' per spec
        if week_start not in buckets:
            buckets[week_start] = {}
        buckets[week_start][sport] = buckets[week_start].get(sport, 0) + tss

    weeks_list = [
        {"week": k, "sports": v, "total": sum(v.values())}
        for k, v in sorted(buckets.items())
    ]
    return ok({"weekly_tss": weeks_list, "since": since})


def get_ytd(params: dict) -> dict:
    """
    Year-to-date totals aggregated by sport.
    Optional query params:
      year - 4-digit year (default = current year)
    """
    year      = params.get("year", str(datetime.now(timezone.utc).year))
    year_from = f"{year}-01-01"
    year_to   = f"{year}-12-31"

    logger.info("get_ytd: athlete=%s year=%s", ATHLETE_ID, year)

    items = paginate_query(
        activities_table,
        IndexName="athlete_id-start_date-index",
        KeyConditionExpression=(
            Key("athlete_id").eq(ATHLETE_ID) &
            Key("start_date").between(year_from, year_to)
        ),
        ScanIndexForward=True,
        # Intervals.icu fields: 'type' = sport, 'icu_training_load' = TSS,
        # 'total_elevation_gain' = elevation (NOT elevation_gain)
        ProjectionExpression=(
            "start_date, #sport_type, icu_training_load, moving_time, distance, total_elevation_gain"
        ),
        ExpressionAttributeNames={"#sport_type": "type"},
    )

    totals: dict[str, dict] = {}
    for item in items:
        sport = item.get("type", "Other")                          # 'type' per Intervals.icu spec
        if sport not in totals:
            totals[sport] = {
                "count": 0,
                "tss":            0.0,
                "moving_time_s":  0,
                "distance_m":     0.0,
                "elevation_m":    0.0,
            }
        totals[sport]["count"]         += 1
        totals[sport]["tss"]           += float(item.get("icu_training_load") or 0)  # per spec
        totals[sport]["moving_time_s"] += int(item.get("moving_time") or 0)
        totals[sport]["distance_m"]    += float(item.get("distance") or 0)
        totals[sport]["elevation_m"]   += float(item.get("total_elevation_gain") or 0)  # per spec

    return ok({"ytd": totals, "year": year, "activity_count": len(items)})


# ── Dispatcher ────────────────────────────────────────────────────────────────

def handler(event, context):
    """
    Main Lambda entry point.  API Gateway passes the route in
    event['routeKey'] (HTTP API) or event['resource'] + event['httpMethod']
    (REST API).  We normalise to (method, resource_path) here.
    """
    logger.info("Event: %s", json.dumps(event))

    # Handle OPTIONS pre-flight for CORS
    method   = event.get("httpMethod", "GET")
    resource = event.get("resource", "/")
    params   = event.get("queryStringParameters") or {}
    path_params = event.get("pathParameters") or {}

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    try:
        # Route dispatch
        if resource == "/activities" and method == "GET":
            return get_activities(params)

        if resource == "/activities/{id}" and method == "GET":
            activity_id = path_params.get("id", "")
            if not activity_id:
                return err("Missing activity id", 400)
            return get_activity(activity_id)

        if resource == "/wellness" and method == "GET":
            return get_wellness(params)

        if resource == "/athlete" and method == "GET":
            return get_athlete(params)

        if resource == "/power-curve" and method == "GET":
            return get_curve("power", params)

        if resource == "/pace-curve" and method == "GET":
            return get_curve("pace", params)

        if resource == "/hr-curve" and method == "GET":
            return get_curve("hr", params)

        if resource == "/weekly-tss" and method == "GET":
            return get_weekly_tss(params)

        if resource == "/ytd" and method == "GET":
            return get_ytd(params)

        return err(f"Unknown route: {method} {resource}", 404)

    except Exception as exc:
        logger.exception("Unhandled error")
        return err(str(exc), 500)
