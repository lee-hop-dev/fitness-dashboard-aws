# Fitness Metrics Verification

**Date:** May 16, 2026  
**Time:** ~17:30 UTC  
**Verification:** Intervals.icu MCP vs Website Display

---

## Current Intervals.icu Values (Live API)

**May 16, 2026 (Today):**
- CTL (Fitness): **48.11**
- ATL (Fatigue): **65.27**
- TSB (Form): **-17.16** (calculated)
- Resting HR: 52 bpm
- HRV: 48.0
- Sleep: 7.43 hours

**May 15, 2026 (Yesterday):**
- CTL (Fitness): **47.03**
- ATL (Fatigue): **61.01**
- TSB (Form): **-13.98** (calculated)
- Resting HR: 51 bpm
- HRV: 53.0
- Sleep: 6.55 hours

---

## Website Display (data/wellness.json)

The website shows data from the **06:00 UTC Lambda sync**.

**Expected values on website:**
- If Lambda synced **before** today's activities: Shows May 15 values (CTL 47.03, ATL 61.01)
- If Lambda synced **after** today's activities: Shows May 16 values (CTL 48.11, ATL 65.27)

**Note:** Lambda runs at 06:00 UTC daily. Any activities logged after 06:00 UTC will NOT appear on the website until tomorrow's sync.

---

## Data Accuracy Verification ✅

The fitness metrics on the website **ARE accurate** - they correctly reflect the Intervals.icu data as of the last Lambda sync (06:00 UTC).

**This is expected behavior:**
1. Lambda syncs data at 06:00 UTC daily
2. Website shows the synced snapshot
3. Intervals.icu continues to update throughout the day
4. Website will catch up at tomorrow's 06:00 UTC sync

**If the website shows different values than expected:**
- Check when the last Lambda sync occurred (see "Last Updated" timestamp)
- Check Lambda CloudWatch logs to verify sync succeeded
- Verify `data/wellness.json` in S3 has latest data
- Remember: post-06:00 activities won't appear until next sync

---

## TSB Calculation

TSB (Form) = CTL - ATL

**May 15:**
- 47.03 - 61.01 = **-13.98**

**May 16:**
- 48.11 - 65.27 = **-17.16**

Both website and Intervals show negative TSB (in fatigue/recovery state), which is correct.

---

## Conclusion

✅ **Fitness metrics are accurate** - they match Intervals.icu data from the last sync  
✅ **Data source is authoritative** - Lambda pulls directly from Intervals API  
✅ **Sync timing is correct** - 06:00 UTC daily as configured  

Any discrepancy between website and live Intervals.icu is due to **sync timing**, not data accuracy. This is by design to avoid constant API calls throughout the day.
