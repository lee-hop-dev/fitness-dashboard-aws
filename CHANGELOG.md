# V2 Dashboard Changelog

## Session: 2026-04-04 — Bug Fix Sprint

### Issues Identified & Resolved

---

#### 1. Strava Segments Not Displaying
**Issue:** Strava segment PRs and top-3 performances showed "No PR or top-3 performances" on cycling and running pages.

**Root Cause (Architecture):** V2 data collector Lambda (`data_collector/handler.py`) only synced from Intervals.icu. The `build_segments()` logic from V1 `collect_data.py` was never ported. `segments.json` in S3 was a static empty file `{"cycling":[],"running":[]}`.

**Root Cause (Deployment):** `aws s3 sync docs/` on every frontend deploy uploaded the repo's empty `docs/data/segments.json` on top of any Lambda-written version, resetting it to empty.

**Fix:**
- Added Strava client helpers (`get_strava_creds`, `strava_get_access_token`, `strava_get`) to `data_collector/handler.py`
- Added `sync_segments()` mirroring V1 `build_segments()` — calls Strava `GET /activities/{id}?include_all_efforts=true`, filters `pr_rank <= 3`, writes `data/segments.json` to S3
- Added IAM `s3:PutObject` permission on `data/*` for the collector Lambda role (`collector_stack.py`)
- Added `FRONTEND_BUCKET` env var to Lambda
- Added `scripts/deploy_frontend.ps1` and `scripts/deploy_frontend.sh` with `--exclude` flags to permanently prevent S3 sync from overwriting Lambda-managed files

**Files Changed:**
- `cdk/fitness_dashboard_aws/lambda/data_collector/handler.py`
- `cdk/fitness_dashboard_aws/collector_stack.py`
- `scripts/deploy_frontend.ps1` ← **use this for all future deployments**
- `scripts/deploy_frontend.sh`

**Deployment Rule Going Forward:** Never run bare `aws s3 sync docs/ s3://...`. Always use `scripts/deploy_frontend.ps1` which excludes the four Lambda-managed files.

---

#### 2. Activity Heatmap Missing Activities (Overview Page)
**Issue:** Heatmap showing sparse data — only ~90 days of activities visible on the 1-year view.

**Root Cause:** `sync_activities()` default window was 90 days. The frontend requests 365 days for the heatmap, but DynamoDB only had 90 days of data.

**Fix:** Changed `sync_activities()` default from 90 → 400 days in `data_collector/handler.py`. Triggered one-time Lambda run with `{"backfill_days": 400}` to backfill historical data (278 activities synced).

---

#### 3. Cycling Power Curve Chart vs Card Mismatch
**Issue:** Power curve chart annotation showed ~358W for 5min, card showed 346W.

**Root Cause:** `formatDurationLabel(270s)` and `formatDurationLabel(300s)` both return `"5min"`. The chart used `labels.indexOf('5min')` which found index 86 (270s = 358W) instead of index 89 (300s = 346W).

**Fix:** Added `secs` field to `powerBests` array in `cycling.html`. Changed `buildPowerCurveChartLine()` to use `data.findIndex(d => d.secs === N)` for exact second-based index lookup instead of label string matching.

**File Changed:** `docs/cycling.html` (two small changes, no other logic affected)

---

#### 4. Running 5k/10k Best Times Not Displaying
**Issue:** Running page showed `—` for 90-day 5k and 10k best times.

**Root Cause:** V2 `sync_athlete()` stored only the raw Intervals.icu athlete profile. Unlike V1 which stored `pb_5k`/`pb_10k` in `athlete.json`, V2 never calculated or stored these values. The running page reads `athlete.pb_5k` and `athlete.pb_10k` — both always null.

**Initial (Wrong) Fix Attempted:** Calculated PBs by scanning DynamoDB activities and estimating time from `average_speed`. This gave inaccurate results (25:34 instead of 19:56) because activity speed data is not precise enough and the 15% distance tolerance included non-PB runs.

**Correct Fix:** Added `get_running_pbs()` to `data_collector/handler.py` which calls Intervals.icu `GET /pace-curves?type=Run&curves=all` (all-time best pace curve). Reads `distance[]` and `values[]` arrays directly to find exact 5k (19:56) and 10k (41:45) times. This is the same authoritative source as the Intervals.icu UI.

**File Changed:** `cdk/fitness_dashboard_aws/lambda/data_collector/handler.py` only

---

#### 5. Running Activity Cards Missing Pace
**Issue:** Last 14 days activity cards on running page showed `—` for pace.

**Root Cause:** `_normaliseActivity()` in `data-loader.js` did not map `average_speed` → `avg_speed`. The running card template used `a.avg_speed` which was always undefined.

**Fix:** Added `avg_speed: a.average_speed != null ? a.average_speed : (a.avg_speed ?? null)` to `_normaliseActivity()` in `docs/assets/js/data-loader.js`.

---

#### 6. Rowing All-Time 2k/5k Bests Not Displaying
**Issue:** Rowing page showed `—` for 2K and 5K all-time bests.

**Root Cause:** `DATA.loadAll()` fetched only 90 days of activities. Rowing PB activities were older than 90 days.

**Fix:** `loadAll()` in `data-loader.js` now accepts optional `activityDays` parameter (default 90). `rowing.html` calls `DATA.loadAll({ activityDays: 400 })` to load full history.

---

### Lambda-Managed S3 Files (Never overwrite with s3 sync)
These four files are written by the Lambda collector on every run. The repo contains stale/empty placeholder versions that must never be synced to S3:

| File | Written by | Content |
|------|-----------|---------|
| `data/segments.json` | Lambda `sync_segments()` | Strava PR/top-3 segment efforts |
| `data/power_curves_90d.json` | Lambda `sync_curve()` | 90-day power curve from Intervals |
| `data/pace_curves_90d.json` | Lambda `sync_curve()` | 90-day pace curve from Intervals |
| `data/hr_curves_90d.json` | Lambda `sync_curve()` | 90-day HR curve from Intervals |

---

### Deployment Commands (V2)

**Lambda deploy (CDK):**
```powershell
cd C:\Users\leeho\Documents\Claude.ai\Fitness-Dashboard_AWS\repo\cdk
cdk deploy FitnessDashboardCollector --require-approval never --exclusively
```

**Frontend deploy (always use script, never bare s3 sync):**
```powershell
cd C:\Users\leeho\Documents\Claude.ai\Fitness-Dashboard_AWS\repo
powershell -ExecutionPolicy Bypass -File scripts\deploy_frontend.ps1
```

**Trigger Lambda manually (test tab, payload `{}`):**
Lambda function: `fitness-dashboard-data-collector`
Console: https://eu-west-2.console.aws.amazon.com/lambda/home?region=eu-west-2#/functions/fitness-dashboard-data-collector

---

### Current Branch
`fix/power-chart-label-mismatch` — contains all fixes from this session. Merge to main after verification.

---

## Session: 2026-04-11 — CloudWatch Ops Dashboard

### Changes Delivered

#### 1. TrainingOS-Ops CloudWatch Dashboard
**Objective:** Native AWS ops dashboard with manual sync trigger — no frontend changes.

**What was built:**
- New `FitnessDashboardSyncWidget` Lambda added to `FitnessDashboardApi` CDK stack
- Reads last sync timestamp from `/aws/lambda/fitness-dashboard-data-collector` CloudWatch Logs
- Invokes `fitness-dashboard-data-collector` asynchronously on button click
- CloudWatch custom dashboard `TrainingOS-Ops` with 8×4 widget
- IAM role scoped to `lambda:InvokeFunction` + `logs:DescribeLogStreams` on collector

**Files Changed:**
- `cdk/fitness_dashboard_aws/api_stack.py` — SyncWidgetRole, SyncWidgetFunction, CfnDashboard
- `cdk/fitness_dashboard_aws/lambda/sync_widget/handler.py` — new Lambda handler

**Result:** Dashboard live at CloudWatch → Dashboards → TrainingOS-Ops. Last sync timestamp and Trigger sync now button both working.

**Deploy note:** CloudShell must be on `fix/power-chart-label-mismatch` branch. `main` branch does not have this code.

---

## Session: 2026-04-11 (continued) — Sync button fix

**Issue:** Button in TrainingOS-Ops dashboard did nothing.

**Root cause:** `cwdb-action` HTML tag is not processed by the CloudWatch dashboard iframe renderer despite being documented. Multiple syntax variations tried — all failed silently.

**Fix:** Replaced `cwdb-action` with a plain `<a href>` link to a new `GET /trigger-sync` API Gateway endpoint backed by `fitness-dashboard-trigger-sync` Lambda. Opens in new tab, returns plain text confirmation, invokes `fitness-dashboard-data-collector` async.

**Verified:** CloudWatch Logs confirm multiple invocations at 11:51 UTC triggered by button clicks from the dashboard.

**Files changed:**
- `cdk/fitness_dashboard_aws/api_stack.py` — added TriggerSyncRole, TriggerSyncFunction, GET /trigger-sync route
- `cdk/fitness_dashboard_aws/lambda/trigger_sync/handler.py` — new Lambda
- `cdk/fitness_dashboard_aws/lambda/sync_widget/handler.py` — button changed to plain href link

## Session: 2026-04-23 — Phase 8 Chart Truncation Fix

### Issue: Chart Right-Side Truncation (GitHub Issue #5)

**Reported Issue:** All time-series charts on activity.html showed visible truncation on the right side with dead space. Multiple prior attempts to fix had worsened the issue.

**Symptoms:**
- Power, HR, cadence, and speed charts clipped on right edge
- Last data points not visible
- Inconsistent chart widths across different chart types
- Dead space visible between chart area and container edge

**Root Causes Identified:**

1. **Insufficient y-axis width:** Charts were using `width = 50px` which was inadequate for 3-digit power values with 'W' suffix
2. **Incomplete x-axis padding removal:** `afterFit` only removed `paddingRight`, leaving `paddingLeft` intact
3. **Inconsistent axis configurations:** Different chart types had varying y-axis width settings
4. **Scale merging logic:** The spread operator `{...baseScales,...scalesOpts}` could allow individual chart configs to override critical settings
5. **Missing explicit padding:** Layout padding wasn't setting all four sides explicitly

**Fix Applied (Commit f81ae23):**

Updated `makeChart()` function in `docs/activity.html`:
- Increased y-axis width from 50px to 56px (base configuration)
- Added explicit tick padding control (`padding: 0` for x-axis, `padding: 4` for y-axis)
- Enhanced `afterFit` on x-axis to remove both `paddingLeft` and `paddingRight`
- Improved scale merging logic to preserve critical `afterFit` settings
- Set explicit layout padding for all four sides: `{top:0, right:0, bottom:0, left:0}`
- Applied consistent 56px y-axis width across ALL chart types:
  * Primary trace charts (power/pace)
  * HR trace chart
  * Cadence/Speed charts
  * Duration curve charts
  * Elevation profile overlay axes (yR1, yR2, yR3, yR4)

**Files Changed:**
- `docs/activity.html` (makeChart function + 10 individual chart configurations)

**Testing Required After Deploy:**
1. Open activity.html on live URL
2. Inspect canvas elements with DevTools
3. Verify charts extend fully to container right edge
4. Test cycling, running, and rowing activities
5. Confirm uniform chart widths across all chart types

**Outstanding Investigation:**
If truncation persists after this fix, the issue is likely:
- Container div CSS width problem (check parent element computed styles)
- Chart.js version-specific rendering behavior
- Browser-specific canvas rendering differences

**Deploy Command:**
```bash
cd ~/fitness-dashboard-aws && git pull && bash scripts/deploy_frontend.sh
```

---

## Session: 2026-04-23 — GitHub Issue #5: Upcoming Events Sync

### Issue: Upcoming Events Showing Stale Past Events

**Reported Issue:** Frontend displays March/April 2026 events in "Upcoming Events" section, all of which are in the past (current date: April 23, 2026).

**Symptoms:**
- `data/upcoming_events.json` contains events from March 31 - April 14, 2026
- All events shown as "upcoming" are actually past events
- Calendar view shows no future events despite having scheduled workouts

**Root Cause:**
V2 AWS migration never ported the upcoming events sync from V1. The `upcoming_events.json` file in the repository is static data from the old V1 system. The Lambda data collector had no function to fetch fresh upcoming events from Intervals.icu.

**Fix Applied (Commit c131e4c):**

Added `sync_upcoming_events()` function to Lambda handler:
- Fetches events from Intervals.icu `/athlete/i5718022/events` API endpoint
- Date range: today + 14 days (rolling window)
- Writes to S3 `data/upcoming_events.json` (replaces stale static file)
- Runs automatically every day at 06:00 UTC alongside other sync functions
- Returns: `{"count": N, "date_range": "YYYY-MM-DD to YYYY-MM-DD", "s3_write": True}`

Updated deploy script exclusions:
- Added `--exclude "data/upcoming_events.json"` to `scripts/deploy_frontend.sh`
- Prevents frontend deploys from overwriting Lambda-managed file
- Consistent with existing exclusions for segments, curves, and streams

**Files Changed:**
- `cdk/fitness_dashboard_aws/lambda/data_collector/handler.py` (added function + handler call)
- `scripts/deploy_frontend.sh` (added exclusion)

**Testing Required After Deploy:**
1. Deploy Lambda: `cd cdk && cdk deploy FitnessDashboardCollector --require-approval never --exclusively`
2. Trigger manually: `aws lambda invoke --function-name fitness-dashboard-data-collector --payload '{}' --cli-binary-format raw-in-base64-out response.json`
3. Check logs: `aws logs tail /aws/lambda/fitness-dashboard-data-collector --since 5m | grep "upcoming"`
4. Verify S3 file: `aws s3 cp s3://fitness-dashboard-frontend-656370357696/data/upcoming_events.json - | jq '.[0] | {name, start_date_local}'`
5. Expected: Events from April 23, 2026 → May 7, 2026 (today + 14 days)
6. Verify frontend displays future events, not past events

**Deploy Command:**
```bash
cd ~/fitness-dashboard-aws && git pull
export PATH=~/cdk-local/node_modules/.bin:$PATH
cd cdk
cdk deploy FitnessDashboardCollector --require-approval never --exclusively
```

---
