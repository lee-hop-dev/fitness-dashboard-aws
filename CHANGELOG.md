# V2 Dashboard Changelog

## Session: 2026-07-16 — Performance Improvement Programme (branch: perf-improvements)

**Rollback tag:** `pre-perf-work-20260716` (commit `5015ccb`)
**Plan of record:** PERFORMANCE_IMPROVEMENT_HANDOVER.md (14 July 2026)

### Baseline measurements (before any change) — 16 July 2026, curl via CloudFront/API Gateway, Accept-Encoding: gzip

**Frontend (CloudFront, compressed transfer size):**
| Page | Status | Time | Transfer |
|---|---|---|---|
| index.html | 200 | 1.24s | 25.2KB |
| activity.html | 200 | 0.88s | 37.7KB |
| cycling.html | 200 | 2.31s (cold) | 8.0KB |
| running.html | 200 | 0.66s | 8.1KB |
| cardio.html | 200 | 0.59s | 2.8KB |

**API Gateway (gzip requested — responses returned UNCOMPRESSED, confirming WP3):**
| Endpoint | Status | Time | Transfer |
|---|---|---|---|
| /activities?days=90&limit=1000 | 200 | 3.14s | 312.9KB |
| /wellness?days=180 | 200 | 1.74s | 209.0KB |
| /weekly-tss?weeks=52 | 200 | 0.63s | 4.9KB |
| /ytd | 200 | 0.55s | 0.9KB |
| /athlete | 200 | 1.46s | 114.0KB |
| /power-curve | 200 | 0.95s | 45.9KB |
| /pace-curve | 200 | 0.79s | 21.7KB |
| /hr-curve | 200 | 0.73s | 17.5KB |

Total page-load API payload (index): ~726KB uncompressed across 8 calls; slowest call 3.14s.

### Cycling / running / cardio page audit — 25 July 2026 — awaiting `deploy_frontend.sh`

**Rollback tag:** `pre-page-audit-20260725`

Same method as the activity-page audit: `eslint no-undef` over every inline script (extracted
and linted in its correct `sourceType`) plus `assets/js/*`, then a headless Chromium pass
checking SVG/canvas content, unfilled placeholders and console output.

**Two real bugs fixed:**

- **`fix(index)`: pace-curve filter could never match.** The filter tested `curve.type`
  against `'Run'`/`'VirtualRun'`/`'TrailRun'`, but on the pace-curve endpoint `type` is the
  **curve** type (`'PACE'`), not the sport — `sport` is `null` on every entry. It logged
  `Filtered running curves: 0` every load and always fell through to `list[0]`. That fallback
  was correct *by luck* (Intervals returns `'90 days'` at index 0, `'All time'` at index 1);
  an upstream reorder would have silently rendered all-time bests labelled as 90-day. Now
  selected by label, `list[0]` retained as fallback. **Closes the item deferred at WP2 close.**
- **`fix(cardio)`: YTD computed over a 90-day window.** `cardio.html` derives YTD
  sessions/hours/TSS from the activities array itself (unlike `cycling.html`, which reads the
  pre-aggregated `ytd` object) but called `DATA.loadAll()` with no arguments — and `loadAll`
  defaults to `activityDays: 90`. **YTD cardio was under-reported by 5 of 20 sessions (25%),
  3.7 hours and 162 TSS**; everything before 26 April was invisible. Now passes 400, matching
  `running.html` and `rowing.html`. No extra network cost — `dashboard.json` already carries
  400 days. Post-fix the page reads 20 / 15.6h / 847, matching an independent calculation over
  the full dataset.

**Curve payload ordering (all three, verified 25 July):** `power_curve`, `pace_curve` and
`hr_curve` each return `[0] '90 days'`, `[1] 'All time'`. Every other call site
(`index-page.js` power curve, `cycling.html` ×2) still indexes `list[0]` directly. Correct
today, order-dependent in principle — logged, not changed, to keep this task minimal.

**Investigated and confirmed NOT bugs** (recorded so they are not re-raised):
- `cy-dist-bar` / `cy-hrs-bar` / `cy-tss-bar` and the running equivalents render as childless
  divs — they are progress bars whose width is set in JS. Measured live at 58.5% / 36% / 42.4%
  on cycling. Working correctly.
- `pb-mar` / `pb-mar-pace` show `—` because `athlete.profile.pb_marathon` genuinely does not
  exist in the Intervals payload. `pb_5k` (1196s), `pb_10k` (2505s) and `pb_half_marathon`
  (6552s) are present and render 19:56 / 41:45 / 1:49:12. Note the PB fields live at
  `athlete.profile.*`, **not** at the top level of the athlete payload.
- Two `effort-time` tiles show `—` because `PACE_TARGETS` includes Half (21,097m) and Marathon
  (42,195m) while the 90-day pace curve only extends to 12,000m. No 90-day best exists for
  those distances. Whether to hide empty tiles is a design call, not a defect — flagged for Lee.
- `renderSegments` flags under `no-undef` in both page modules; it is a deliberate global from
  `segments.js` (classic script), same pattern as `formatDuration`. False positive.

**Verification:** zero page errors and zero console errors on `index.html`, `cycling.html`,
`running.html` and `cardio.html`. index 6/6 visible canvases painted; cycling and running
6/6 SVG with content; cardio 40/40 stat values populated across 10 cards.

**Deploy:** `bash scripts/deploy_frontend.sh` (frontend only). Cache-bust
`index-page.js?v=20260725-1`. `cardio.html` is HTML — served `no-cache`, no bump needed.

**Noted, not changed:** `cycling.html` and `running.html` still carry ~11KB inline module
scripts each — WP1-style extraction never covered them. Same cacheability argument as WP1;
worth a follow-up.

### Activity page — data/render fixes — DEPLOYED and verified 25 July 2026

Deployed via `deploy_frontend.sh`; browser-verified by Lee. HR zone percentage labels now
render (first time ever — see fix 1 below), and the duration curve card is correctly absent
on HR-only Workout activities.

The `i is not defined` error carried in the backlog since WP6a is now closed.

**Rollback tag:** `pre-activity-fixes-20260725`

Audit method: `eslint no-undef` across every file in `docs/assets/js/` (each linted in its
correct `sourceType`), then a headless Chromium sweep over six activities spanning Run,
VirtualRide and Workout, checking every `<canvas>` for *visible-but-unpainted* rather than
merely unpainted — a hidden card reads as zero ink and must not be counted as a defect.

- **`fix(activity)`: stray `ctx.font` referencing out-of-scope loop variable.** The
  `pctLabels` plugin's `afterDatasetDraw` set `ctx.font` using `i` *before* the `forEach`
  that declares it. This is the long-standing `i is not defined` page error logged during
  WP6a as pre-existing. It was not cosmetic: the throw occurred at the top of the hook, so
  the `forEach` below never ran and **the percentage labels above the HR zone bars have
  never rendered**. The line duplicated the correct per-bar assignment inside the loop;
  deleting it restores the labels and changes nothing else.
  - This was the **only** genuine undeclared identifier in the frontend. `segments.js`
    `formatDuration` flags under `no-undef` but is a deliberate global supplied by
    `cycling.html` / `running.html` before the script loads — false positive, left alone.
- **`fix(activity)`: duration curve card left visible on HR-only activities.**
  `buildPrimaryTrace` early-outs when an activity has neither `watts` nor `velocity_smooth`
  and hides `power-row` — but `curve-row` is a **sibling** of `power-row` in `activity.html`,
  not a child, so it stayed visible: an empty canvas under placeholder text
  ("Power Curve / — W / peak effort vs 90-day"). Hits every `Workout`-type activity
  (Hyrox, Cardio), which carry only `time` + `heartrate` (+`respiration`) streams.

**Verification (headless Chromium, local serve with `data/*` proxied to CloudFront):**
| Activity | Type | Before | After |
|---|---|---|---|
| i168751357 | Run | `i is not defined` | 0 errors, 7/7 visible painted |
| i167532276 | VirtualRide | `i is not defined` | 0 errors, 8/8 visible painted |
| i168097527 | Workout (Hyrox) | curve card blank | 0 errors, 2/2 visible painted |
| i167688816 | Workout (Cardio) | curve card blank | 0 errors, 2/2 visible painted |
| i166802710 | Run | — | 0 errors, all painted |
| i166670542 | — | — | 0 errors, 8/8 visible painted |

Cards with no underlying data (`chart-elevation`, `chart-primary`, `chart-curve`,
`chart-cadence`, `chart-speed`) are now correctly suppressed on Workout activities.
`chart-speed` remains hidden on runs by design — the speed chart is cycling-only.

**Deploy:** `bash scripts/deploy_frontend.sh` (frontend only). Cache-bust
`activity-page.js?v=20260725-1` covers both fixes.

**Noted, not changed:** an anonymous `leaflet-zoom-animated` canvas reads as unpainted in the
sweep on GPS activities — a thin polyline slips through pixel sampling, not a defect.

### WP7 — DEPLOYED and verified 25 July 2026

- `deploy_frontend.sh` run; all 8 stale files purged from S3 by Step 3's `--delete`.
- `list-objects-v2 --prefix data/ --delimiter /` returns exactly the 6 expected keys:
  `dashboard.json`, `hr_curves_90d.json`, `pace_curves_90d.json`, `power_curves_90d.json`,
  `segments.json`, `upcoming_events.json`. Every Lambda-managed file intact — the exclusion
  list correctly protected them from `--delete` as well as from upload.
- New HEAD-based last-sync code confirmed live at the edge in `race-stream.html`.
- Deleted paths now return the index.html fallback (`200 text/html`), not a true 404 —
  expected WP6b behaviour, deliberately unchanged.

**Performance programme status:** WP1–WP7 and WP9 complete and live. Remaining: WP6b
(infrastructure 404 handling — deferred, needs explicit approval), WP10 (custom domain —
independent, any time), WP8 (CloudFront price class — September 2026).

### WP7 prepared — 25 July 2026

**Rollback tag:** `pre-wp7-20260725`

- **WP7** `chore(data)`: removed 7 V1-era static snapshots from `docs/data/`, all confirmed to
  have **zero** references across `docs/`, `scripts/` and `cdk/` (`--include="*.html" --include="*.js"`
  plus a full-tree sweep): `activities.json` (231KB), `wellness.json`, `weekly_tss.json`,
  `ytd.json`, `athlete.json`, `heatmap_1y.json`, `heatmap_3y.json`.
  - `heatmap_1y.json` / `heatmap_3y.json` were **not** in the handover's WP7 list — found during
    the reference sweep, same provenance (frozen content, deployed 9 June, unreferenced since the
    heatmap moved to `dashboard.json` in WP2).
  - Live S3 state before the change: all 8 files (incl. `meta.json`) dated `2026-06-09T10:05:29Z`,
    ~363KB total, content frozen at `2026-03-31` per `meta.json`.
- **WP7** `fix(race-stream)`: `meta.json` was the only stale file with a live consumer —
  `race-stream.html`'s "last sync" widget, which is linked from the nav on **every** page.
  That widget was already broken two ways: it read `d.last_update` while the file's key is
  `last_updated`, and the file had not moved since March. It rendered `NaNh NaNm ago` in
  production. Now sourced from the `Last-Modified` header of the collector-written
  `data/dashboard.json` via a **HEAD** request — no body transferred, no new Lambda work,
  no S3 PUT, no cost. Guards added for non-200, missing header, and unparseable date;
  the existing `.catch` → `'Unknown'` behaviour is preserved. `meta.json` then removed.
  - Verified against live CloudFront before commit: `HEAD` → 200,
    `last-modified: Sat, 25 Jul 2026 06:01:07 GMT`, renders `9h 6m ago`, **0 bytes** of body.
  - No cache-bust bump needed: the block is inline in `race-stream.html`, and HTML is served
    `no-cache, no-store, must-revalidate` by Step 1 of the deploy script.

**Deploy:** `bash scripts/deploy_frontend.sh`. Step 3's `--delete` purges all 8 files from S3 —
none of them appear in the exclusion list, and the 6 Lambda-managed files that *are* excluded are
skipped for deletion as well as for upload, so they are untouched.

**Verification after deploy:**
- `aws s3api list-objects-v2 --bucket fitness-dashboard-frontend-656370357696 --prefix data/`
  should list only `dashboard.json`, `segments.json`, `power_curves_90d.json`,
  `pace_curves_90d.json`, `hr_curves_90d.json`, `upcoming_events.json` and `streams/*`.
- `race-stream.html` "last sync" shows a real elapsed time, not `NaN`.
- Every other page unchanged (nothing else referenced the deleted files).

**Noted, out of scope:**
- `data/segments.json` is **30 bytes** (`{"cycling":[],"running":[]}`). **This is correct
  behaviour, NOT a bug — do not "fix" it.** `sync_segments()` only keeps efforts with
  `pr_rank <= 3` on Strava-sourced cycling/running activities. Lee's riding is predominantly
  Zwift/ZRL, so top-3 PR efforts on Strava segments are genuinely rare and an empty file is
  the expected output. The collector writes it successfully every morning. Confirmed by Lee,
  25 July 2026. (Flagged in error during WP7 — logged here to prevent it being re-raised.)
- `race-stream.html` loads `assets/css/main.css` and `assets/js/theme-toggle.js` **unversioned**
  under the 1-year cache rule — the same latent stale-cache risk WP6a fixed for `data-loader.js`.
  Not touched here (neither file changed); log for a future pass.

### WP2 prepared (commits 494d05b, fb1dfe4, f3f2018) — awaiting deploy sequence

**Rollback tag:** `pre-wp2-20260716`

- **WP2** `feat(collector)`: `write_dashboard_json()` runs LAST in the daily handler and writes `data/dashboard.json` to S3 (ContentType application/json, CacheControl max-age=300). Payloads are sourced by replicating the query Lambda's DynamoDB queries verbatim (paginated `table.query` on the GSI, never scan, never the public API, never re-derived from Intervals), wrapped under the exact API response shapes: `activities`, `wellness` (180d), `weekly_tss` (52w), `ytd`, `athlete`, `power_curve`, `pace_curve`, `hr_curve`, plus `generated_at`.
  - **Design deviation from handover (justified):** handover specified 90-day activities, but `running.html`/`rowing.html` call `loadAll({activityDays: 400})` — a 90-day file cannot serve them. The file holds **400 days** (already in DynamoDB); the frontend filters to each page's window client-side, replicating the API's `start_date >= since` behaviour. CloudFront `compress=True` keeps the transfer manageable.
  - **Second deviation:** handover said index uses `DATA.loadAll()`; in reality post-WP1 `index-page.js` has its own fetch block (4 calls + a deferred 365-day heatmap call). Both `data-loader.js` (4 sport pages) and `index-page.js` (index main block + heatmap) were converted — heatmap now also serves from the static file, so a normal index load makes zero API Gateway calls.
- **WP2** `chore(deploy)`: `data/dashboard.json` added to the Lambda-managed exclusion list in `deploy_frontend.sh` and `deploy_frontend.ps1`. Also fixed: the `.ps1` was missing the `data/upcoming_events.json` exclusion entirely (latent wipe risk on any PowerShell deploy).
- **WP2** `perf(frontend)`: static-first load in `data-loader.js` and `index-page.js` with hard API fallback on ANY failure (non-200, non-JSON content type, missing top-level key, or `generated_at` older than 48h). Path used is logged to console. API code paths fully preserved. Cache-bust bumps: `data-loader.js?v=20260716-2` (4 sport pages), `index-page.js?v=20260716-2` (index).

**Deploy order (per handover):** (1) `deploy_frontend.sh` — exclusion + frontend land together; frontend safely uses API fallback until the file exists; (2) CloudShell `git pull` + full CDK deploy of FitnessDashboardCollector; (3) trigger sync, verify `curl -s .../data/dashboard.json | python3 -m json.tool | head` shows current `generated_at`; (4) reload index in incognito — console should report the static path, Network tab zero `j2zxz92vd4` calls.

### WP2 deployed and verified — 16 July 2026, ~16:45 UTC

- Frontend deployed (invalidation `I76PSQSFN3GJT7UG6VUQXMDNFQ`); collector deployed via full CDK deploy (two passes — first surfaced a missing IAM grant, fixed in `1f99a84`: wellness + curves tables needed `grant_read_data`; activities already had it from segment sync).
- Manual sync run: `dashboard.json {"bytes": 1878195, "activities": 325, "wellness": 181}` — no errors.
- **Shape verification vs live API (sandbox, 16 July):** `/wellness?days=180` — 181/181 entries byte-identical, envelope keys identical. `/ytd` — deep-equal. Activities: all normalisation fields present (`start_date`, `type`, `icu_training_load`, `icu_average_watts`, `moving_time`, `average_speed`, `icu_intensity`). `power_curve` raw item preserved (`list` key / "90 days" labels untouched).
- **Transfer:** 1,878,195 bytes raw → **328,657 bytes compressed** through CloudFront (`compress=True`), replacing ~726KB uncompressed across 8 API calls; slowest previous call was 3.14s.
- **Browser verification complete (16 July):** index loads via static path (console confirms), heatmap served from the file (313 activities, no API call), all charts render. `weekly_tss` deep-equal to live API (51/51 weeks). A twelve-zero Rowing series in the weekly load chart was investigated and is true data — no Rowing/VirtualRow activity in the last 12 weeks. **WP2 closed.**
- Deferred item noted (pre-existing, not WP2): index pace-curve filter `Filtered running curves: 0` never matches typed running curves and always falls through to `list[0]` — works via fallback, log for later.

### Batch B — DEPLOYED (record backfilled 25 July 2026)

The section below was left reading "awaiting CDK deploy" — the deploy did happen on
16 July and was never recorded. Verified against live infrastructure on 25 July:

- **WP3 live:** `aws apigateway get-rest-apis` → `minimumCompressionSize: 1024` on `j2zxz92vd4`.
  `/activities?days=90&limit=1000` with `Accept-Encoding: gzip` returns **43,851 bytes**
  against a 312,943-byte baseline — **−86%**. (Fallback path only post-WP2, but the ops
  dashboard and trigger-sync polling benefit on every call.)
- **WP9 live:** collector `LastModified 2026-07-16T16:38:05Z`. CloudWatch Logs
  `filter-log-events --filter-pattern "Batch activity fetch"` shows the batch path on every
  06:00 run from 17 July through 25 July: `requested 8, received 8` / `requested 9, received 9`.
  **Zero** `batch returned a stub` fallback lines in nine days — the batch endpoint returns
  full activities for every id in the window, so per-activity Intervals calls really are
  2N → N+1 in production, not just in principle.

### Batch B prepared (commits af7c2be, f859b03) — deployed 16 July, see above

- **WP3** `perf(api)`: `min_compression_size=Size.kibibytes(1)` on the RestApi. Validated by full local `cdk synth` — template renders `MinimumCompressionSize: 1024`. Requires FULL deploy of FitnessDashboardApi (not hotswap).
- **WP9** `perf(collector)`: `sync_streams_14d` now fetches meta+laps for the entire window in ONE batched call (`athlete/{id}/activities/{ids}?intervals=true`) instead of one `activity/{id}?intervals=true` call per activity. Per-activity Intervals calls: 2N → N+1 (~47% fewer; 20-activity window: 40→21).
  - **Design deviation from handover (justified):** handover proposed merging streams into `_fetch_laps` and deleting `_fetch_stream_data`. Verified against the Intervals OpenAPI spec (2026-07-16): NO endpoint returns streams together with activity/interval data, so that merge is impossible. The batch endpoint achieves the quota reduction instead. `_fetch_stream_data` retained (streams have a dedicated endpoint only).
  - Shaping extracted to pure `_build_laps_and_meta()` shared by batch and fallback paths — **proven functionally identical** to the previous `_fetch_laps` output (50 meta fields + laps, exact JSON equality on synthetic input).
  - Robust fallback: batch failure, missing id, or Strava-stub result (per spec) → per-activity `_fetch_laps` call, i.e. worst case = today's behaviour exactly. Early-exit for streamless activities preserved.
  - Hotswap deploy acceptable (Lambda code only). Before-copies of all 9 current stream files captured for post-deploy shape diff.

### Batch A — DEPLOYED 16 July 2026, verified live

**After-measurements (compressed transfer via CloudFront):**
| Page | Before | After | Change |
|---|---|---|---|
| index.html | 25.2KB | 7.9KB | −68% |
| activity.html | 37.7KB | 10.2KB | −73% |

All extracted JS (`index-page.js`, `activity-page.js`, `data-loader.js`) confirmed serving with `cache-control: public, max-age=31536000`. Live index on cdnjs Chart.js 4.4.1, zero jsdelivr references. Browser verification by Lee: index, calendar, activity pages all good.

### Batch A contents (commits 708afdf, 8e7c339, be5612e, 0059764)

- **WP1** `perf(frontend)`: inline scripts extracted — `index.html` 129KB→50KB (module → `assets/js/index-page.js`, 79KB), `activity.html` 157KB→51KB (plain script → `assets/js/activity-page.js`, 104KB). Extracted JS proven byte-identical to original inline blocks via git diff. Both files auto-covered by deploy script's `assets/js/*.js` 1-year cache rule. Versioned `?v=20260716-1`.
- **WP4** `perf(frontend)`: index.html moved from jsdelivr chart.js@4.4.0 to cdnjs Chart.js/4.4.1 (matching activity/cardio/rowing); `preconnect` to cdnjs added. cycling/running load no CDN Chart.js — no change needed.
- **WP5** `perf(frontend)`: `upcoming_events.json` fetch memoised in index-page.js — 3 fetches → 1 per load (verified in headless browser: exactly 1 request).
- **WP6a** `fix(frontend)`: content-type guards on all 6 JSON fetch sites (data-loader `_fetch`, upcoming_events helper, 2× curve fetches in index-page, stream + 2× curve fetches in activity-page). Missing stream files now show the friendly "kept for 14 days" message instead of a JSON parse error. `data-loader.js` gained `?v=20260716-1` on cardio/cycling/rowing/running (previously unversioned under a 1-year cache — latent stale-cache risk now fixed).

**Verification (headless Chromium against local serve + live API/data):**
- index.html: 0 page errors, 0 console errors, 7/7 charts painted, upcoming_events fetched once
- activity.html (i164158909): 13/13 charts painted, no visible errors
- cardio/cycling/running/rowing (modified data-loader path): 0 errors, content rendered
- Pre-existing bug found (NOT introduced, confirmed identical on pre-change page): `activity.html` throws `i is not defined` page error without visible impact — logged for the activity-page data-issues task

**Deferred from WP6:** infrastructure-level 404 handling (layer b) — per plan, not changing `error_responses` without explicit approval. `youtube_videos.json` reconciliation — nothing in repo reads/writes it; confirm with Lee before removing from Lambda-managed list.


## Session: 2026-05-29 — Activity Page Flight Deck Redesign

### Changes Delivered

---

#### Activity Page — Flight Deck Hero Redesign

**Scope:** Visual reskin of `new_activity.html` (cycling) and creation of `new_running_activity.html` (running). Pages `activity.html` and `run-activity.html` are **untouched** — they remain the rollback baseline.

**Rollback tag:** `pre-activity-redesign` (commit `8b4725c`)

**Files Changed:**
- `docs/new_activity.html` — updated
- `docs/new_running_activity.html` — new file

**What changed (new_activity.html):**
- Added `data-theme="dark" data-accent="lime"` to `<html>` tag
- Added `design-system.css` and `layout.css` to `<head>` — matching `new_cycling.html` shell
- Replaced old `rl-header` + cockpit card grid hero with **Flight Deck hero**: 3-column layout (TSS ring · identity+stat strip · readings column)
- TSS ring: arc fill driven by IF (cycling) or rIF (running) — animates on load via CSS transition; no new data field
- Stat strip: Distance / Moving / Elevation / Avg Speed / Avg Power / Norm Power / Work — all from existing stream JSON fields
- Readings column: Peak Power (max of `streams.watts`) / Variability (NP÷AP) / Avg+Max HR (cycling); Best Pace / rIF / HR (running) — all derived from existing fields, no new API fields
- Updated nav: added `new_cycling ✦` and `new_running ✦` links; `new_cycling.html` marked active
- Added `buildFlightDeck(data, ftp, hrmax)` function wired in `init()` alongside existing `buildHero()`
- All existing build functions (`buildHero`, `buildWorkoutStats`, `buildPrimaryTrace`, `buildHrSection`, `buildCadenceSpeed`, `buildSegments`, `buildLaps`, `buildDurationCurve`, `rlPatch`) completely untouched

**What changed (new_running_activity.html):**
- New file, copy of `new_activity.html`
- `data-accent="coral"`, title "Run Activity — Training OS"
- Coral accent CSS override (`oklch(0.76 0.19 30)`)
- `DS_ACCENT` constant set to coral hex `#e8714a`
- Running nav active; breadcrumb defaults to Running / ▷

**What was NOT changed (per handoff rules):**
- No new API endpoints or response fields
- No mock values rendered (location, weather, kudos count, aerobic decoupling, auto-analysis → not displayed)
- Tweaks panel not shipped
- `activity.html` and `run-activity.html` untouched
- All data stream functions identical to pre-change state

**Deployment:** Run `bash scripts/deploy_frontend.sh` from CloudShell after `git pull`.

---



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

## Session: 2026-04-24 — GitHub Issue #5 Resolution Complete

### Issue #5: Upcoming Events Not Displaying (RESOLVED)

**Final Status:** ✅ FULLY RESOLVED

**Problem Summary:**
Frontend displayed "0 events" despite having upcoming events scheduled in Intervals.icu. Root cause was three-fold:
1. V2 Lambda never had upcoming events sync (not ported from V1)
2. Wrong API endpoint URL (double 'i' prefix causing 403)
3. Browser caching preventing fresh data display

**Resolution Timeline:**

**Commit c131e4c** - Initial implementation
- Added `sync_upcoming_events()` function to Lambda handler
- Fetches events from Intervals.icu for today + 14 days
- Writes to S3 `data/upcoming_events.json`
- Added to deploy script exclusions
- **Bug:** Used `/athlete/i5718022/events` instead of `/athlete/5718022/events`

**Commit a35a67a** - Documentation
- Added comprehensive CHANGELOG entry with root cause analysis

**Commit 5b58a93** - API endpoint fix
- Fixed double 'i' prefix bug in events API URL
- Changed from `/athlete/i{ATHLETE_ID}/events` to `/athlete/{ATHLETE_ID}/events`
- ATHLETE_ID constant is already `"5718022"` (numeric only, no prefix)
- Resolved 403 Forbidden error

**Commit 217b15a** - Browser cache fix
- Added `{ cache: 'no-cache' }` to both `fetch('data/upcoming_events.json')` calls
- Frontend was caching old March/April stale data
- CloudFront served fresh data but browser wouldn't fetch it

**Verification Steps Completed:**
1. ✅ Lambda deployed with corrected endpoint
2. ✅ Manual invocation successful: `{"count": 8, "date_range": "2026-04-24 to 2026-05-08", "s3_write": true}`
3. ✅ S3 file updated with fresh events (April 25 - May 8, 2026)
4. ✅ CloudFront invalidation completed
5. ✅ Frontend displays 4 events within 7-day window:
   - April 25: Z2 Easy Ride — 45min pre-Liege
   - April 26: ECRO: Liege Monument
   - April 28: ZRL R4-4: Double Span Points
   - April 30: Group Run — steady Z2/Z3, optional quality
6. ✅ Calendar view shows upcoming events on correct dates
7. ✅ Auto-sync scheduled for daily 06:00 UTC via EventBridge

**Technical Details:**
- Intervals.icu API endpoint: `GET /athlete/5718022/events?oldest=YYYY-MM-DD&newest=YYYY-MM-DD`
- Authentication: HTTP Basic Auth with `API_KEY:{secret}` from Secrets Manager
- Data format: JSON array of event objects from Intervals.icu calendar
- Frontend filter: Shows events within next 7 days only (configurable in code)
- S3 file: `data/upcoming_events.json` (Lambda-managed, excluded from deploys)
- Cache strategy: `no-cache` on frontend, CloudFront caches with invalidation on sync

**Lessons Learned:**
1. Always verify API endpoints match V1 working implementation
2. ATHLETE_ID constant usage: numeric `"5718022"` for most endpoints, `"i5718022"` only for activity-specific calls
3. Browser caching requires explicit `cache: 'no-cache'` for frequently-updated JSON files
4. CloudFront invalidation alone insufficient if browser has cached response
5. Testing sequence: Lambda → S3 → CloudFront → Browser (each layer can cache)

**Files Modified:**
- `cdk/fitness_dashboard_aws/lambda/data_collector/handler.py` - Added sync function
- `scripts/deploy_frontend.sh` - Added exclusion for upcoming_events.json
- `docs/index.html` - Added cache-busting to fetch calls
- `CHANGELOG.md` - Documentation

**Issue Status:** CLOSED ✅

---
