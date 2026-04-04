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
