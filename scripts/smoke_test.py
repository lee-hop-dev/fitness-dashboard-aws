#!/usr/bin/env python3
"""
Phase 3 Smoke Test
Run from your local machine (requires internet access to AWS API Gateway).

Usage:
    python scripts/smoke_test.py

Optional — override the base URL:
    BASE_URL=https://... python scripts/smoke_test.py
"""

import json
import os
import sys
import urllib.request
import urllib.error

BASE = os.environ.get(
    "BASE_URL",
    "https://j2zxz92vd4.execute-api.eu-west-2.amazonaws.com/prod",
).rstrip("/")

TESTS = [
    # (path, expected_top_level_keys, description)
    ("/activities",         ["activities", "count", "since"],           "Recent activities (90 days)"),
    ("/activities?days=7",  ["activities", "count", "since"],           "Activities last 7 days"),
    ("/wellness",           ["wellness", "count", "from", "to"],        "Wellness (90 days)"),
    ("/wellness?days=7",    ["wellness", "count", "from", "to"],        "Wellness last 7 days"),
    ("/athlete",            ["athlete_id", "profile", "recent_wellness"], "Athlete profile"),
    ("/power-curve",        None,                                        "Power curve (latest)"),
    ("/pace-curve",         None,                                        "Pace curve (latest)"),
    ("/hr-curve",           None,                                        "HR curve (latest)"),
    ("/weekly-tss",         ["weekly_tss", "since"],                     "Weekly TSS (12 weeks)"),
    ("/weekly-tss?weeks=4", ["weekly_tss", "since"],                     "Weekly TSS (4 weeks)"),
    ("/ytd",                ["ytd", "year", "activity_count"],           "Year-to-date totals"),
]

CORS_TEST_PATH = "/activities"

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "

passed = 0
failed = 0


def test(path, expected_keys, description):
    global passed, failed
    url = BASE + path
    try:
        req = urllib.request.Request(url, headers={"Origin": "https://lee-hop-dev.github.io"})
        with urllib.request.urlopen(req, timeout=15) as r:
            status = r.status
            cors   = r.headers.get("Access-Control-Allow-Origin", "")
            body   = json.loads(r.read())
            keys   = list(body.keys())

            if status != 200:
                print(f"  {FAIL}  {path:<35}  HTTP {status}  — {description}")
                failed += 1
                return

            if expected_keys:
                missing = [k for k in expected_keys if k not in body]
                if missing:
                    print(f"  {FAIL}  {path:<35}  Missing keys: {missing}  — {description}")
                    failed += 1
                    return

            cors_ok = "*" in cors or "github.io" in cors
            cors_flag = "" if cors_ok else f"  {WARN} no CORS header"
            print(f"  {PASS}  {path:<35}  {status}  keys={keys[:5]}{cors_flag}  — {description}")
            passed += 1

    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        print(f"  {FAIL}  {path:<35}  HTTP {e.code}  {body}  — {description}")
        failed += 1
    except Exception as e:
        print(f"  {FAIL}  {path:<35}  ERROR: {e}  — {description}")
        failed += 1


def test_cors_preflight():
    """OPTIONS request to verify preflight works for browser clients."""
    url = BASE + CORS_TEST_PATH
    try:
        req = urllib.request.Request(
            url,
            method="OPTIONS",
            headers={
                "Origin": "https://lee-hop-dev.github.io",
                "Access-Control-Request-Method": "GET",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            acao = r.headers.get("Access-Control-Allow-Origin", "")
            acam = r.headers.get("Access-Control-Allow-Methods", "")
            if acao:
                print(f"  {PASS}  OPTIONS /activities          {r.status}  ACAO={acao}  ACAM={acam}  — CORS preflight")
            else:
                print(f"  {WARN}  OPTIONS /activities          {r.status}  No ACAO header  — CORS preflight")
    except Exception as e:
        print(f"  {FAIL}  OPTIONS /activities          ERROR: {e}  — CORS preflight")


def test_404():
    """Unknown route should return 404."""
    url = BASE + "/does-not-exist"
    try:
        req = urllib.request.Request(url)
        urllib.request.urlopen(req, timeout=10)
        print(f"  {FAIL}  /does-not-exist              Expected 404, got 200")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f"  {PASS}  /does-not-exist              404 as expected  — 404 handling")
        else:
            print(f"  {WARN}  /does-not-exist              HTTP {e.code} (expected 404)  — 404 handling")
    except Exception as e:
        print(f"  {WARN}  /does-not-exist              {e}")


def test_single_activity():
    """Fetch the first activity ID from /activities and hit /activities/{id}."""
    url = BASE + "/activities?days=90&limit=1"  # collector syncs 90 days
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            body = json.loads(r.read())
            items = body.get("activities", [])
            if not items:
                print(f"  {WARN}  /activities/{{id}}             No activities found to test single-fetch")
                return
            aid = items[0].get("activity_id") or items[0].get("id")
            if not aid:
                print(f"  {WARN}  /activities/{{id}}             activity_id key not found in item: {list(items[0].keys())}")
                return
            test(f"/activities/{aid}", None, f"Single activity (id={aid})")
    except Exception as e:
        print(f"  {WARN}  /activities/{{id}}             Could not determine ID: {e}")


if __name__ == "__main__":
    print(f"\nFitness Dashboard — Phase 3 Smoke Tests")
    print(f"Base URL: {BASE}\n")

    for path, keys, desc in TESTS:
        test(path, keys, desc)

    test_single_activity()
    test_cors_preflight()
    test_404()

    print(f"\n{'─'*60}")
    print(f"  Passed: {passed}   Failed: {failed}")

    if failed > 0:
        print(f"\n  Some tests failed. Check CloudWatch logs:")
        print(f"  aws logs tail /aws/lambda/fitness-dashboard-query --follow --region eu-west-2")
        sys.exit(1)
    else:
        print(f"\n  All tests passed ✅  — ready for Phase 4")
