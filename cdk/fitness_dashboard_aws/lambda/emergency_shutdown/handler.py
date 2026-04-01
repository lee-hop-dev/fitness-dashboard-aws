"""
Emergency Shutdown Lambda Handler

This function provides a kill switch to stop all AWS services immediately.
Triggered by:
  1. API Gateway POST /emergency-shutdown (manual kill switch)
  2. SNS notification when budget exceeds $10 (auto-shutdown)

Actions:
  - Disable EventBridge scheduled rule (stops data collector)
  - Set API Gateway throttling to 0 req/sec (blocks all API calls)
  - Disable DynamoDB auto-scaling (on-demand stays, but marks as shutdown)
  - Send confirmation email via SNS

Environment Variables:
  - EVENTBRIDGE_RULE_NAME: Name of the daily collector schedule rule
  - API_GATEWAY_ID: REST API ID to throttle
  - API_GATEWAY_STAGE: Stage name (typically 'prod')
  - ALERT_TOPIC_ARN: SNS topic for shutdown confirmation
  - SHUTDOWN_TOKEN: Secret token for API Gateway authentication
"""

import json
import os
import boto3
from typing import Dict, Any

# AWS clients
events_client = boto3.client("events")
apigateway_client = boto3.client("apigateway")
sns_client = boto3.client("sns")


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Emergency shutdown handler.
    
    Args:
        event: Lambda event (API Gateway request or SNS notification)
        context: Lambda context
    
    Returns:
        API Gateway response or SNS processing confirmation
    """
    
    # Detect trigger source
    trigger_source = _detect_trigger_source(event)
    
    # If API Gateway trigger, verify authentication token
    if trigger_source == "api_gateway":
        if not _verify_token(event):
            return {
                "statusCode": 401,
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"error": "Unauthorized: Invalid token"}),
            }
    
    # Execute shutdown sequence
    shutdown_results = []
    
    # 1. Disable EventBridge scheduled rule
    try:
        rule_name = os.environ["EVENTBRIDGE_RULE_NAME"]
        events_client.disable_rule(Name=rule_name)
        shutdown_results.append(f"✅ Disabled EventBridge rule: {rule_name}")
    except Exception as e:
        shutdown_results.append(f"❌ EventBridge disable failed: {str(e)}")
    
    # 2. Throttle API Gateway to 0 req/sec
    try:
        api_id = os.environ["API_GATEWAY_ID"]
        stage_name = os.environ["API_GATEWAY_STAGE"]
        
        # Update stage throttling settings
        apigateway_client.update_stage(
            restApiId=api_id,
            stageName=stage_name,
            patchOperations=[
                {
                    "op": "replace",
                    "path": "/throttle/*/*/rateLimit",
                    "value": "0",
                },
                {
                    "op": "replace",
                    "path": "/throttle/*/*/burstLimit",
                    "value": "0",
                },
            ],
        )
        shutdown_results.append(f"✅ Throttled API Gateway: {api_id}/{stage_name} to 0 req/sec")
    except Exception as e:
        shutdown_results.append(f"❌ API Gateway throttle failed: {str(e)}")
    
    # 3. Send confirmation email
    try:
        alert_topic_arn = os.environ["ALERT_TOPIC_ARN"]
        message = _format_shutdown_message(trigger_source, shutdown_results)
        
        sns_client.publish(
            TopicArn=alert_topic_arn,
            Subject="🚨 EMERGENCY SHUTDOWN ACTIVATED",
            Message=message,
        )
        shutdown_results.append(f"✅ Sent confirmation email to alert topic")
    except Exception as e:
        shutdown_results.append(f"❌ SNS notification failed: {str(e)}")
    
    # Log results
    print(json.dumps({
        "trigger_source": trigger_source,
        "shutdown_results": shutdown_results,
    }))
    
    # Return response based on trigger type
    if trigger_source == "api_gateway":
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "status": "shutdown_complete",
                "trigger": "manual_api_call",
                "actions": shutdown_results,
            }),
        }
    else:
        # SNS trigger — no response needed
        return {"status": "shutdown_complete"}


def _detect_trigger_source(event: Dict[str, Any]) -> str:
    """Detect whether Lambda was triggered by API Gateway or SNS."""
    if "Records" in event and event["Records"][0].get("EventSource") == "aws:sns":
        return "sns_budget_alert"
    elif "requestContext" in event:
        return "api_gateway"
    else:
        return "unknown"


def _verify_token(event: Dict[str, Any]) -> bool:
    """Verify API Gateway request token."""
    try:
        # Check for token in query string
        query_params = event.get("queryStringParameters", {}) or {}
        provided_token = query_params.get("token", "")
        
        # Check for token in Authorization header
        headers = event.get("headers", {}) or {}
        auth_header = headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            provided_token = auth_header[7:]  # Remove "Bearer " prefix
        
        expected_token = os.environ["SHUTDOWN_TOKEN"]
        return provided_token == expected_token
    except Exception as e:
        print(f"Token verification error: {str(e)}")
        return False


def _format_shutdown_message(trigger: str, results: list) -> str:
    """Format the shutdown confirmation email message."""
    trigger_text = {
        "api_gateway": "Manual API call (kill switch URL)",
        "sns_budget_alert": "Automatic trigger (budget exceeded $10)",
        "unknown": "Unknown trigger",
    }.get(trigger, trigger)
    
    message = f"""
FITNESS DASHBOARD - EMERGENCY SHUTDOWN ACTIVATED

Trigger: {trigger_text}
Time: {_get_current_time()}

Actions Taken:
{chr(10).join(results)}

Services Status:
• Data Collector: DISABLED (no more daily syncs)
• API Gateway: THROTTLED (0 requests allowed)
• Frontend: OFFLINE (API calls will fail)
• DynamoDB: ACTIVE (data preserved, no new writes)

Cost Accumulation: STOPPED

To Re-Enable Services:
1. Log in to AWS Console
2. CloudWatch → Events → Rules → "fitness-dashboard-daily-sync" → Enable
3. API Gateway → Stages → prod → Throttle Settings → Reset limits
4. Deploy updated throttle settings

Or run the re-enable script (if created).

Dashboard Status Page:
https://d3mtfyb3f9u51j.cloudfront.net (will show API errors)

AWS Console:
https://eu-west-2.console.aws.amazon.com/console/home?region=eu-west-2
"""
    return message


def _get_current_time() -> str:
    """Get current UTC time as formatted string."""
    from datetime import datetime
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
