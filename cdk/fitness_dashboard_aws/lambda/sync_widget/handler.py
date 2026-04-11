"""
CloudWatch Custom Widget — Manual Sync Trigger
"""
import boto3
from datetime import datetime, timezone

lambda_client = boto3.client("lambda", region_name="eu-west-2")
logs_client = boto3.client("logs", region_name="eu-west-2")

COLLECTOR_NAME = "fitness-dashboard-data-collector"
LOG_GROUP = f"/aws/lambda/{COLLECTOR_NAME}"
WIDGET_ARN = "arn:aws:lambda:eu-west-2:656370357696:function:FitnessDashboardSyncWidget"


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


def render_widget(message=None, error=None):
    last_sync = get_last_sync_time()

    status_html = ""
    if message:
        status_html = f'<p style="margin:10px 0 0;padding:8px 12px;background:#d4edda;color:#155724;border-radius:4px;font-size:13px;">{message}</p>'
    elif error:
        status_html = f'<p style="margin:10px 0 0;padding:8px 12px;background:#f8d7da;color:#721c24;border-radius:4px;font-size:13px;">{error}</p>'

    # cwdb-action must immediately follow the element it applies to.
    # JSON payload goes as direct text content inside the tag.
    # endpoint must be the full Lambda ARN.
    return f"""<div style="font-family:Arial,sans-serif;padding:16px 20px;">
<p style="margin:0 0 4px;font-size:13px;color:#5f6b7a;">Last sync</p>
<p style="margin:0 0 16px;font-size:18px;font-weight:600;color:#16191f;">{last_sync}</p>
<a class="btn btn-primary">Trigger sync now</a>
<cwdb-action action="call" endpoint="{WIDGET_ARN}">
{{ "action": "sync" }}
</cwdb-action>
{status_html}
</div>"""


def handler(event, context):
    action = (event.get("callbackParameters") or {}).get("action")

    if action == "sync":
        try:
            lambda_client.invoke(
                FunctionName=COLLECTOR_NAME,
                InvocationType="Event",
                Payload=b"{}",
            )
            now = datetime.now(timezone.utc).strftime("%d %b %Y  %H:%M UTC")
            return render_widget(message=f"Sync triggered at {now} — allow ~60s to complete.")
        except Exception as e:
            return render_widget(error=f"Failed to trigger: {e}")

    return render_widget()
