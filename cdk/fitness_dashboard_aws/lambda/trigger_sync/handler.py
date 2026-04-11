"""
GET /trigger-sync — invokes fitness-dashboard-data-collector async.
Returns plain text confirmation (opens in new tab from dashboard widget link).
"""
import boto3
from datetime import datetime, timezone

lambda_client = boto3.client("lambda", region_name="eu-west-2")
COLLECTOR_NAME = "fitness-dashboard-data-collector"


def handler(event, context):
    try:
        lambda_client.invoke(
            FunctionName=COLLECTOR_NAME,
            InvocationType="Event",
            Payload=b"{}",
        )
        now = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
        body = f"Sync triggered at {now}. You can close this tab."
        status = 200
    except Exception as e:
        body = f"Error triggering sync: {e}"
        status = 500

    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "text/plain",
            "Access-Control-Allow-Origin": "*",
        },
        "body": body,
    }
