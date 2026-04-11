"""
CloudWatch Custom Widget — Manual Sync Trigger
Uses a direct API Gateway link rather than cwdb-action (which is unreliable).
The /trigger-sync endpoint is already exposed via API Gateway.
"""
import boto3
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger()
logger.setLevel(logging.INFO)

logs_client = boto3.client("logs", region_name="eu-west-2")
lambda_client = boto3.client("lambda", region_name="eu-west-2")

COLLECTOR_NAME = "fitness-dashboard-data-collector"
LOG_GROUP = f"/aws/lambda/{COLLECTOR_NAME}"
API_URL = "https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod/trigger-sync"


def get_last_sync_time():
    try:
        streams = logs_client.describe_log_streams(
            logGroupName=LOG_GROUP,
            orderBy="LastEventTime",
            descending=True,
            limit=1,
        )
        if not streams.get("logStreams"):
            return "No sync recorded yet"
        ts_ms = streams["logStreams"][0].get("lastEventTimestamp")
        if not ts_ms:
            return "Unknown"
        dt = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        return dt.strftime("%d %b %Y  %H:%M UTC")
    except Exception as e:
        return f"Unable to read: {e}"


def handler(event, context):
    logger.info("EVENT: %s", json.dumps(event))

    # Check if this is a direct sync trigger (called from API Gateway link)
    action = (event.get("callbackParameters") or {}).get("action")
    if action == "sync":
        try:
            lambda_client.invoke(
                FunctionName=COLLECTOR_NAME,
                InvocationType="Event",
                Payload=b"{}",
            )
            now = datetime.now(timezone.utc).strftime("%d %b %Y  %H:%M UTC")
            logger.info("Sync triggered at %s", now)
            triggered_msg = f'<p style="margin:10px 0 0;padding:8px 12px;background:#d4edda;color:#155724;border-radius:4px;font-size:13px;">Sync triggered at {now} — allow ~60s to complete.</p>'
        except Exception as e:
            triggered_msg = f'<p style="margin:10px 0 0;padding:8px 12px;background:#f8d7da;color:#721c24;border-radius:4px;font-size:13px;">Failed: {e}</p>'
    else:
        triggered_msg = ""

    last_sync = get_last_sync_time()

    # Use a plain href link to the API Gateway trigger endpoint.
    # Opens in a new tab, triggers the sync, user closes the tab.
    # This is reliable — no cwdb-action dependency.
    return (
        f'<div style="font-family:Arial,sans-serif;padding:16px 20px;">'
        f'<p style="margin:0 0 4px;font-size:13px;color:#5f6b7a;">Last sync</p>'
        f'<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#16191f;">{last_sync}</p>'
        f'<a class="btn btn-primary" href="{API_URL}" target="_blank">Trigger sync now</a>'
        f'{triggered_msg}'
        f'</div>'
    )
