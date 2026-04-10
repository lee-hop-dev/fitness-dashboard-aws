"""
CloudWatch Custom Widget — Manual Sync Trigger
Button to invoke fitness-dashboard-data-collector on demand.
"""

import boto3
from datetime import datetime, timezone

lambda_client = boto3.client("lambda", region_name="eu-west-2")

COLLECTOR_NAME = "fitness-dashboard-data-collector"


def render_widget(message=None, error=None):
    status_html = ""
    if message:
        status_html = f"""
        <p style="margin:10px 0 0;padding:8px 12px;background:#d4edda;
                  color:#155724;border-radius:4px;font-size:13px;">
            {message}
        </p>"""
    elif error:
        status_html = f"""
        <p style="margin:10px 0 0;padding:8px 12px;background:#f8d7da;
                  color:#721c24;border-radius:4px;font-size:13px;">
            {error}
        </p>"""

    return f"""
    <div style="font-family:Arial,sans-serif;padding:16px 20px;">
        <p style="margin:0 0 16px;font-size:13px;color:#5f6b7a;">
            Triggers a full Intervals.icu data sync immediately,
            bypassing the 06:00 UTC schedule.
        </p>
        <a class="btn btn-primary"
           href="cwdb-action:call?endpoint=FitnessDashboardSyncWidget&action=sync">
            Trigger sync now
        </a>
        {status_html}
    </div>
    """


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
            return render_widget(
                message=f"Sync triggered at {now} — allow ~60s to complete."
            )
        except Exception as e:
            return render_widget(error=f"Failed to trigger: {e}")

    return render_widget()
