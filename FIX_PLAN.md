# Training OS V2 — UI/UX Fixes
**Date:** May 13, 2026
**Scope:** Multiple frontend improvements across Overview, Cycling, Running, and Activity pages

## Issues to Fix

### 1. Overview Page — Calendar Text Visibility ✓
**Issue:** Upcoming event text not visible enough
**Location:** `index.html` lines 1209-1212, `main.css` lines 874-886
**Fix:** Increase text contrast and opacity for `.cal-mini-name.planned` and `.cal-mini-stats.planned`
- Change `.cal-mini-name.planned` color to `var(--text-primary)` (from `var(--accent)`)
- Ensure full opacity (already at 1)
- Potentially adjust background transparency

### 2. Cycling Page — Strava Segments 24-Hour Display ✓
**Issue:** Shows only last activity, not all activities in previous 24 hours
**Location:** `assets/js/segments.js` lines 9-120
**Current behavior:** Displays segments from `segments[0].activity_name` (single activity)
**Fix:** Update Lambda `sync_segments()` to collect segments from all activities in last 24 hours, not just most recent

### 3. Activity Page — Hero Box Sparklines ✓
**Issue:** User unclear what sparklines represent
**Location:** `activity.html` lines 1280-1296
**Current mappings:**
- Moving Time → `velocity_smooth` (speed over time)
- Distance → `distance` (cumulative distance)
- Elevation → `altitude` (elevation profile)
**Fix:** Add tooltip/title attribute explaining sparkline meaning

### 4. Activity Page — Elevation Max Gradient Inaccurate ✓
**Issue:** Max gradient calculation incorrect
**Location:** Need to investigate elevation profile calculation
**Fix:** Recalculate from altitude stream data properly

### 5. Activity Profile Chart — Visibility Issues ✓
**Issue:** X/Y axis text not readable, black graph with dark writing too dark
**Location:** `activity.html` elevation profile chart configuration
**Fix:**
- Change axis text color to `var(--text-secondary)` or white/silver
- Improve graph color scheme for better contrast
- Add white/silver axis markup

### 6. Ride Telemetry — Stat Reordering ✓
**Issue:** Move Average HR above Pwr:HR Decoupling, add Max HR below Average
**Location:** Workout stats panel in activity.html
**Fix:** Reorder telemetry stats as requested

### 7. Run Telemetry — Stat Reordering ✓
**Issue:** Move avg HR above elev gain, include Max HR
**Location:** Workout stats panel (running-specific)
**Fix:** Apply same HR reordering for running activities

### 8. Run Pace Chart — Green Highlighting ✓
**Issue:** Green highlighting looks off
**Location:** Primary pace trace chart for running
**Fix:** Review gradient fill or zone segment coloring

### 9. 90 Day Power Curve — Background Line Visibility ✓
**Issue:** 90 day best line not visible (too dark)
**Location:** Duration curve chart, power_curves_90d.json reference line
**Fix:** Increase opacity/brightness of 90d best line

### 10. 90 Day Pace Curve — Pace Values Inaccurate ✓
**Issue:** Displayed pace appears incorrect
**Location:** Duration curve for running
**Fix:** Verify pace calculation and display format (min/km)

### 11. Heart Rate Chart — Color Scheme & Visibility ✓
**Issue:** HR column chart needs better color scheme and visibility
**Location:** HR zone time bars chart
**Fix:** Improve colors and contrast

### 12. Cadence — Show Max Cadence ✓
**Issue:** Missing max cadence as sub-statistic
**Location:** Cadence stat display
**Fix:** Add max cadence below average (consistent with other metrics)

### 13. Lap Splits — Route Profile Behind Laps ✓
**Issue:** Route profile should be behind lap splits, lap splits take priority
**Location:** Lap splits section
**Fix:** Adjust z-index/layering so elevation profile is background, lap bars foreground

## Implementation Order

1. Quick CSS fixes (calendar, chart colors, axis text) — bundle in one commit
2. Hero sparkline tooltips — single commit
3. Activity telemetry reordering — single commit  
4. Elevation/gradient calculations — investigate then commit
5. Lambda segments 24-hour fix — separate commit with Lambda deploy
6. Pace curve accuracy — investigate then commit
7. Lap splits layering — single commit

## Files to Modify

### Frontend
- `docs/index.html` — calendar rendering
- `docs/assets/css/main.css` — calendar planned text, chart colors
- `docs/activity.html` — hero sparklines, telemetry order, chart configs
- `docs/assets/js/segments.js` — (display only, main fix in Lambda)

### Backend
- `workflows/collect_data.py` — sync_segments() 24-hour logic

## Testing Checklist

- [ ] Calendar upcoming events visible in both dark/light themes
- [ ] Segments show all activities from last 24 hours
- [ ] Hero sparklines have clear tooltips
- [ ] Elevation max gradient accurate
- [ ] Activity profile X/Y axis readable
- [ ] Ride telemetry order: ...Avg HR → Max HR → Pwr:HR...
- [ ] Run telemetry order: ...Avg HR → Max HR → Elev Gain...
- [ ] Run pace chart green highlighting fixed
- [ ] 90d power curve background line visible
- [ ] 90d pace curve values accurate
- [ ] HR chart colors improved
- [ ] Cadence shows max value
- [ ] Lap splits foreground, elevation profile background
