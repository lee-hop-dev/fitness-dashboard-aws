"""
Emergency Shutdown Lambda Handler

This function provides an automated kill switch to stop AWS services.
Triggered by:
  - SNS notification when budget exceeds $10 (auto-shutdown)

Actions:
  - Disable EventBridge scheduled rule (stops data collector)
  - Send confirmation email via SNS

Environment Variables:
  - EVENTBRIDGE_RULE_NAME: Name of the daily collector schedule rule
  - ALERT_TOPIC_ARN: SNS topic for shutdown confirmation
"""

import json
import os
import boto3
from typing import Dict, Any

# AWS clients
events_client = boto3.client("events")
sns_client = boto3.client("sns")


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Emergency shutdown handler.
    
    Args:
        event: Lambda event (SNS notification)
        context: Lambda context
    
    Returns:
        Shutdown processing confirmation
    """
    
    # Execute shutdown sequence
    shutdown_results = []
    
    # 1. Disable EventBridge scheduled rule
    try:
        rule_name = os.environ["EVENTBRIDGE_RULE_NAME"]
        events_client.disable_rule(Name=rule_name)
        shutdown_results.append(f"✅ Disabled EventBridge rule: {rule_name}")
    except Exception as e:
        shutdown_results.append(f"❌ EventBridge disable failed: {str(e)}")
    
    # 2. Send confirmation email
    try:
        alert_topic_arn = os.environ["ALERT_TOPIC_ARN"]
        message = _format_shutdown_message(shutdown_results)
        
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
        "trigger_source": "budget_alert",
        "shutdown_results": shutdown_results,
    }))
    
    return {"status": "shutdown_complete"}


def _format_shutdown_message(results: list) -> str:
    """Format the shutdown confirmation email message."""
    message = f"""
FITNESS DASHBOARD - EMERGENCY SHUTDOWN ACTIVATED

Trigger: Automatic budget alert ($10 threshold exceeded)
Time: {_get_current_time()}

Actions Taken:
{chr(10).join(results)}

Services Status:
• Data Collector: DISABLED (no more daily syncs)
• API Gateway: ACTIVE (dashboard still works, but no new data)
• DynamoDB: ACTIVE (data preserved, no new writes)

Cost Accumulation: STOPPED (no Lambda invocations)

To Re-Enable Services:
1. Log in to AWS Console
2. CloudWatch → Events → Rules → "fitness-dashboard-daily-sync" → Enable

AWS Console:
https://eu-west-2.console.aws.amazon.com/console/home?region=eu-west-2
"""
    return message


def _get_current_time() -> str:
    """Get current UTC time as formatted string."""
    from datetime import datetime
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
