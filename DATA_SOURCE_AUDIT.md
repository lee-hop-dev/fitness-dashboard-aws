# Data Source Audit - Original vs New Page

**Date:** May 16, 2026
**Purpose:** Verify all data sources match between original and new page

---

## Original Page (index.html) Data Sources

### Primary Data (via API Gateway)
From `assets/js/data-loader.js` → `DATA.loadAll()`:
1. ✅ `/activities?days=90&limit=1000` → Activities array
2. ✅ `/wellness?days=180` → Wellness array  
3. ✅ `/weekly-tss?weeks=52` → Weekly TSS data
4. ✅ `/ytd` → YTD stats
5. ❌ `/athlete` → Athlete profile (NOT loaded in new page)
6. ❌ `/power-curve` → Power curves (NOT loaded in new page)
7. ❌ `/pace-curve` → Pace curves (NOT loaded in new page)
8. ❌ `/hr-curve` → HR curves (NOT loaded in new page)

### Heatmap Data (deferred load)
From `DATA.loadHeatmap1y()`:
9. ❌ `/activities?days=365&limit=1000` → Full year for heatmap (NOT loaded in new page)

### Static Files
10. ✅ `data/upcoming_events.json` → Calendar events

---

## New Page (new_index.html) Current State

### Currently Loaded ✅
1. ✅ `/activities?days=90&limit=1000` - CORRECT
2. ✅ `/wellness?days=180` - CORRECT
3. ✅ `/ytd` - CORRECT  
4. ✅ `/weekly-tss?weeks=52` - CORRECT
5. ✅ `data/upcoming_events.json` - CORRECT

### Missing Data Sources ❌

#### CRITICAL - Calendar shows empty cells
**Issue:** Calendar renders 365 days but only has 90 days of activity data
**Fix Required:** Add separate fetch for `/activities?days=365` for calendar
**Impact:** Calendar mostly blank, missing 9+ months of data

#### Missing but may not be used yet
- `/athlete` - Profile data (FTP, weight, etc.)
- `/power-curve` - 90d power bests
- `/pace-curve` - 90d pace bests  
- `/hr-curve` - 90d HR data

---

## Action Items

### 1. CRITICAL: Fix Calendar Data (365-day activities)
The new page tries to render a 365-day calendar with only 90 days of data.

**Options:**
A. Add separate fetch for 365-day activities (deferred, like original)
B. Reduce calendar to 90 days to match data
C. Fetch 365 days upfront (slower initial load)

**Recommendation:** Follow original pattern - fetch 90 days initially, defer 365-day fetch for calendar.

### 2. Verify if power/pace/HR curves needed
Check if new page design shows "90-Day Bests" section.
- If YES → Add API fetches for `/power-curve`, `/pace-curve`, `/hr-curve`
- If NO → Not needed yet

### 3. Verify if athlete profile needed
Check if new page shows FTP, weight, threshold pace anywhere.
- If YES → Add `/athlete` fetch
- If NO → Not needed yet

---

## Data Source Verification Status

| Endpoint | Original Uses | New Page Has | Match | Notes |
|----------|---------------|--------------|-------|-------|
| /activities (90d) | ✅ | ✅ | ✅ | Correct |
| /activities (365d) | ✅ | ❌ | ❌ | **MISSING - breaks calendar** |
| /wellness | ✅ | ✅ | ✅ | Fixed to use API |
| /ytd | ✅ | ✅ | ✅ | Correct |
| /weekly-tss | ✅ | ✅ | ✅ | Correct |
| /athlete | ✅ | ❌ | ❌ | May not be used yet |
| /power-curve | ✅ | ❌ | ❌ | May not be used yet |
| /pace-curve | ✅ | ❌ | ❌ | May not be used yet |
| /hr-curve | ✅ | ❌ | ❌ | May not be used yet |
| upcoming_events.json | ✅ | ✅ | ✅ | Correct |

**Summary:** 5/10 correct, 1 critical missing (365d activities), 4 may not be needed yet
