"""
Strava OAuth Lambda - Phase 7
Server-side token exchange so the client_secret never reaches the browser.

Routes handled:
  POST /strava/token    - Exchange authorisation code for access+refresh tokens
  POST /strava/refresh  - Exchange refresh token for a new access token

Both endpoints load Strava credentials from Secrets Manager, call the
Strava token endpoint, and return only what the frontend needs.

The client_secret is NEVER returned to the caller.
"""

import json
import logging
import os
import urllib.request
import urllib.parse
import urllib.error

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

STRAVA_TOKEN_URL  = "https://www.strava.com/oauth/token"
SECRET_NAME       = os.environ.get("STRAVA_SECRET_NAME", "fitness-dashboard/strava-credentials")
REGION            = os.environ.get("AWS_REGION", "eu-west-2")

# Lazy-loaded Secrets Manager client
_secrets_client = None

CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
}


def ok(body, status=200):
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def err(message, status=400):
    logger.error("Error %s: %s", status, message)
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps({"error": message}),
    }


def get_strava_creds() -> dict:
    """Load Strava credentials from Secrets Manager (cached per Lambda container)."""
    global _secrets_client
    if _secrets_client is None:
        _secrets_client = boto3.client("secretsmanager", region_name=REGION)

    resp = _secrets_client.get_secret_value(SecretId=SECRET_NAME)
    secret = json.loads(resp["SecretString"])
    return {
        "client_id":     str(secret["client_id"]),
        "client_secret": secret["client_secret"],
    }


def call_strava_token(payload: dict) -> dict:
    """POST to Strava token endpoint, return parsed JSON response."""
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req  = urllib.request.Request(
        STRAVA_TOKEN_URL,
        data=data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        logger.error("Strava HTTP error %s: %s", exc.code, body)
        # Re-raise with status so caller can forward Strava's actual code
        exc._strava_body = body
        raise exc


def handle_token_exchange(body: dict) -> dict:
    """
    POST /strava/token
    Exchange an authorisation code for access + refresh tokens.

    Request body: { "code": "<auth_code>" }
    Response:     { "access_token", "refresh_token", "expires_at", "athlete" }
    """
    code = body.get("code")
    if not code:
        return err("Missing required field: code", 400)

    logger.info("Exchanging authorisation code for tokens")
    creds = get_strava_creds()

    strava_resp = call_strava_token({
        "client_id":     creds["client_id"],
        "client_secret": creds["client_secret"],
        "code":          code,
        "grant_type":    "authorization_code",
    })

    if "errors" in strava_resp or "message" in strava_resp:
        return err(strava_resp.get("message", "Token exchange failed"), 400)

    # Return only what the frontend needs — never return client_secret
    return ok({
        "access_token":  strava_resp["access_token"],
        "refresh_token": strava_resp["refresh_token"],
        "expires_at":    strava_resp["expires_at"],
        "athlete":       strava_resp.get("athlete", {}),
    })


def handle_token_refresh(body: dict) -> dict:
    """
    POST /strava/refresh
    Exchange a refresh token for a new access token.

    Request body: { "refresh_token": "<token>" }
    Response:     { "access_token", "refresh_token", "expires_at" }
    """
    refresh_token = body.get("refresh_token")
    if not refresh_token:
        return err("Missing required field: refresh_token", 400)

    logger.info("Refreshing access token")
    creds = get_strava_creds()

    strava_resp = call_strava_token({
        "client_id":     creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": refresh_token,
        "grant_type":    "refresh_token",
    })

    if "errors" in strava_resp or "message" in strava_resp:
        return err(strava_resp.get("message", "Token refresh failed"), 400)

    return ok({
        "access_token":  strava_resp["access_token"],
        "refresh_token": strava_resp["refresh_token"],
        "expires_at":    strava_resp["expires_at"],
    })


def handler(event, context):
    """Main Lambda entry point."""
    logger.info("Event: %s", json.dumps(event))

    method   = event.get("httpMethod", "POST")
    resource = event.get("resource", "/")

    if method == "OPTIONS":
        return {"statusCode": 200, "headers": CORS_HEADERS, "body": ""}

    # Parse request body
    body = {}
    raw_body = event.get("body") or "{}"
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return err("Invalid JSON body", 400)

    try:
        if resource == "/strava/token" and method == "POST":
            return handle_token_exchange(body)

        if resource == "/strava/refresh" and method == "POST":
            return handle_token_refresh(body)

        return err(f"Unknown route: {method} {resource}", 404)

    except Exception as exc:
        logger.exception("Unhandled error")
        return err(str(exc), 500)
