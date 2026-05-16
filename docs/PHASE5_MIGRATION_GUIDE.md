# Phase 5: Migration & Testing Guide

**Date:** May 16, 2026  
**Commit:** fcce490 (debug logging added)  
**Status:** Ready for testing, then migration

---

## Current Status

### Bug Fixes Applied ✅
**Commit fcce490:** "fix: Add comprehensive error handling and debug logging for blank charts"

Fixed issues:
1. **Comprehensive error handling** - All fetch calls now validate responses
2. **Debug logging** - Console logs at every major step to diagnose issues
3. **Container validation** - Checks for missing DOM elements before rendering
4. **Data validation** - Validates arrays before processing
5. **Stack traces** - Full error details for debugging

What the logging will reveal:
- Actual HTTP status codes for each fetch
- Number of records loaded from each JSON file
- YTD cardio data (hours, TSS, distance) to debug zero hours
- Latest wellness values (CTL, ATL, HRV, Sleep, RHR)
- Chart data point counts
- Activities rendered in each section
- Calendar generation details (weeks, days with activity)

---

## Testing Procedure

### Step 1: Deploy with Debug Logging

```bash
cd ~/fitness-dashboard-aws
git pull
bash scripts/deploy_frontend.sh
```

### Step 2: Check Browser Console

Navigate to: https://d3mtfyb3f9u51j.cloudfront.net/new_index.html

Open DevTools (F12) and check Console for:

**Expected successful output:**
```
🎨 New design system loading...
📡 Fetching data files...
✅ Data fetched successfully
  Activities: 150
  Wellness records: 90
  YTD stats: {cycling: {...}, running: {...}, ...}
✅ Data structured successfully
  Latest wellness: {ctl: 87.4, atl: 89.2, hrv: 45, sleep: 25200, rhr: 48}
  YTD cardio: {hours: 12.5, tss: 750, distance: 0}
📈 Rendering fitness trend chart...
  Chart data points: 90
  Series prepared: [{key: 'ctl', points: 90}, {key: 'atl', points: 90}, {key: 'tsb', points: 90}]
✅ Chart render call completed
✅ Fitness trend chart legend added
✅ Fitness trend chart rendered successfully
📋 Populating recent activities...
  Activities to render: 10
✅ Recent activities rendered successfully
📅 Rendering training calendar...
  Date range: 2025-05-16 to 2026-05-16
  Days with activity: 180
✅ Rendered 53 weeks (371 days) in calendar
✅ Design system page loaded successfully
```

**If errors appear:**
- Check which fetch failed (status code will be logged)
- Check if containers are missing (error will identify which)
- Check if chart rendering threw an error
- Note exact error message and stack trace

### Step 3: Visual Verification

After console check, verify visually:

- [ ] YTD section shows all 5 columns
- [ ] YTD cardio hours is not zero (should see actual hours if data exists)
- [ ] Hero cards row displays (CTL, ATL, TSB, HRV, Sleep, RHR)
- [ ] Readiness hero with ring and today's workout
- [ ] **Fitness Trend chart renders** (CTL/ATL/TSB lines visible)
- [ ] **Recent Activities list populates** (10 activities shown)
- [ ] **Training Calendar heatmap appears** (53 weeks of colored cells)
- [ ] No "Loading..." text remains visible
- [ ] No console errors in red

---

## Debugging Outcomes

### If Cardio Hours Still Zero

Check console output for:
```
YTD cardio: {hours: X, tss: Y, distance: Z}
```

**If hours: 0** → Data issue in `data/ytd.json`
- Cardio activities may not be aggregated correctly
- Check Lambda function `calculate_ytd_stats()`
- Verify cardio activities exist in `data/activities.json`

**If hours: null/undefined** → Field name mismatch
- YTD JSON may use different field names
- Check actual JSON structure at https://d3mtfyb3f9u51j.cloudfront.net/data/ytd.json

### If Charts Still Blank

**Fitness Chart:**
```
📈 Rendering fitness trend chart...
❌ Fitness chart container not found
```
→ DOM issue: container ID mismatch or not rendered

```
📈 Rendering fitness trend chart...
✅ Chart render call completed
(but chart is blank)
```
→ Charts-new.js issue: check if renderLineChart function is working

**Recent Activities:**
```
📋 Populating recent activities...
❌ Recent activities container not found
```
→ DOM issue: check HTML for `id="recent-activities"`

**Calendar:**
```
📅 Rendering training calendar...
❌ Calendar heatmap container not found
```
→ DOM issue: check HTML for `id="calendar-heatmap"`

---

## Phase 5: Actual Migration

**DO NOT MIGRATE UNTIL:**
1. All three charts render correctly
2. Cardio hours show correct value (not zero)
3. No console errors
4. All visual elements display properly

### Migration Steps (When Ready)

```bash
cd ~/fitness-dashboard-aws

# 1. Backup original
cp docs/index.html docs/index_old.html

# 2. Replace with new version
mv docs/new_index.html docs/index.html

# 3. Commit
git add docs/index.html docs/index_old.html
git commit -m "feat(design): migrate index.html to design system V2

Replaces original index.html with new design system version.
Original backed up as index_old.html.

Changes:
- Rail Flow Light design palette
- Enhanced YTD 5-column layout
- Hero cards with sparklines
- Improved readiness hero with today's workout
- Fitness trend chart with legend
- Activity feed cards
- Training calendar heatmap

All tests passing. Ready for production."

# 4. Deploy
bash scripts/deploy_frontend.sh

# 5. Verify live site
sleep 60
# Open https://d3mtfyb3f9u51j.cloudfront.net/
# Hard refresh: Ctrl+Shift+R
```

### Rollback (If Needed)

```bash
cd ~/fitness-dashboard-aws

# Quick rollback
mv docs/index.html docs/index_broken.html
mv docs/index_old.html docs/index.html

git add docs/index.html docs/index_broken.html
git commit -m "revert: rollback to original index.html due to production issue"
bash scripts/deploy_frontend.sh
```

---

## Next Steps After Migration

Once `index.html` is successfully migrated:

1. **Repeat for other pages** (one at a time):
   - `new_cycling.html` → `cycling.html`
   - `new_running.html` → `running.html`
   - `new_rowing.html` → `rowing.html`
   - `new_activity.html` → `activity.html`

2. **Update sidebar nav links** to point to new pages

3. **Clean up old files** after everything is verified

4. **Final cleanup** commit to remove `new_*` files

---

## Current Commit History

```
fcce490 - fix: Add comprehensive error handling and debug logging for blank charts
3fbaf17 - fix: Correct RHR field and upcoming events loading
fdcaf88 - feat: Add hero cards row with sparklines
f6f967a - feat: Enhanced readiness hero with today's planned workout
1a08c22 - feat: Add defensive null checks to YTD calculations
cc871e4 - feat: Implement YTD 5-column layout with Rail Flow Light palette
```

---

## Console Log Reference

Save this pattern for debugging other pages:

```javascript
console.log('📡 Fetching...');  // Network operations
console.log('✅ Success');      // Successful operations
console.log('⚠️ Warning');      // Non-fatal issues
console.log('❌ Error');        // Fatal errors
console.log('📊 Data');         // Data inspection
console.log('📈 Rendering');    // UI rendering steps
console.log('📋 Populating');   // List/feed population
console.log('📅 Calendar');     // Calendar operations
```
