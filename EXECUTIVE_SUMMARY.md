# Training OS V2: API Cost Optimization — Executive Summary

**Date:** May 2026  
**Status:** Ready for Implementation  
**Priority:** CRITICAL — Cost mitigation required  

---

## Problem Statement

AWS costs for Training OS V2 are exceeding expectations. Analysis identifies three primary cost drivers:

1. **Bot/crawler traffic** (70-80% of excess cost) — API Gateway has no authentication
2. **Inefficient daily sync** (15-20% of excess cost) — Pulls 400 days of data every day
3. **No response caching** (10-15% of excess cost) — Every request hits Lambda

**Combined impact:** 2-3x higher costs than necessary

---

## Solution Overview

**Three-phase incremental fix with rollback points:**

### Phase 1: Bot Protection (2-3 hours)
- Add API key requirement to all GET endpoints
- Rate limit: 10 req/sec, burst 20, quota 10k/month
- **Expected reduction:** 70-80% of excess cost
- **Risk:** Low (frontend change only if API key works)

### Phase 2: Incremental Sync (1 hour + 24h observation)
- Change daily sync from 400 days to 2 days
- Manual backfill available on-demand
- **Expected reduction:** 90-95% of daily sync overhead
- **Risk:** Low (manual backfill available)

### Phase 3: API Caching (30 minutes + 24h observation)
- Enable 1-hour cache on API Gateway
- **Expected reduction:** ~90% reduction in Lambda invocations
- **Risk:** Very low (just enable cache)

**Total estimated cost reduction: 70-90%**

---

## Timeline

| Phase | Duration | Observation | Total Elapsed |
|-------|----------|-------------|---------------|
| **Phase 1** | 2-3 hours | 2 hours | ~5 hours |
| **Phase 2** | 1 hour | 24 hours | ~25 hours |
| **Phase 3** | 30 minutes | 24 hours | ~25 hours |
| **TOTAL** | | | **~55 hours (3 days)** |

---

## Risk Assessment

### Overall Risk Level: LOW

**Mitigation factors:**
- Incremental deployment (one phase at a time)
- Rollback script ready at each phase
- No data loss possible (only affects API access patterns)
- Extensive testing between phases
- Can revert any phase within 5 minutes

### What Could Go Wrong?

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Frontend fails to load | Low | High | Rollback frontend deploy |
| Missing activities in sync | Low | Medium | Manual backfill available |
| Cache serves stale data | Very Low | Low | 1-hour TTL acceptable for fitness data |
| Legitimate user gets rate-limited | Very Low | Low | Can increase limit in CDK |

---

## Key Decisions

### Why API Key Instead of Cognito/OAuth?

**Reasoning:**
- Single-user dashboard (not multi-tenant)
- No user accounts needed
- Fastest implementation (2-3 hours vs days for Cognito)
- Effective bot protection with minimal complexity
- Can upgrade to Cognito later if needed

**Trade-off accepted:** Key is embedded in frontend JS (visible in source). This is acceptable because:
- Rate limiting prevents abuse even if key is extracted
- No sensitive data exposed (public fitness data)
- Bots are blocked (key required)
- Low risk for single-user system

### Why 2 Days Instead of 1 Day?

**Reasoning:**
- Timezone edge cases (activity logged yesterday local time, today UTC)
- Late uploads (activity completed yesterday, uploaded today)
- Retroactive edits (someone edits yesterday's activity today)
- Belt-and-braces approach: rather pull slightly more than miss something

**Trade-off accepted:** Pulls ~5 activities instead of ~2-3. Still 99% reduction vs 400 days.

### Why 1-Hour Cache Instead of 6-Hour?

**Reasoning:**
- Data changes once daily at 06:00 UTC
- 1 hour = worst case is seeing data 1 hour old
- Can increase later if needed
- Conservative approach for first implementation

**Trade-off accepted:** More Lambda invocations than with longer cache. Can tune after observing patterns.

---

## Pre-Implementation Requirements

### Evidence Collection Needed

Before starting, collect baseline metrics:

1. **API Gateway logs** — Confirm bot traffic is the primary driver
   ```bash
   aws logs filter-log-events \
     --log-group-name /aws/apigateway/fitness-dashboard \
     --start-time $(date -u -d '24 hours ago' +%s)000
   ```

2. **Lambda invocation count** — Document current rate
   ```bash
   aws cloudwatch get-metric-statistics \
     --namespace AWS/Lambda \
     --metric-name Invocations \
     --dimensions Name=FunctionName,Value=fitness-dashboard-query \
     --start-time $(date -u -d '7 days ago' +%Y-%m-%dT00:00:00Z) \
     --end-time $(date -u +%Y-%m-%dT23:59:59Z) \
     --period 604800 \
     --statistics Sum
   ```

3. **Current costs** — Baseline for comparison
   ```bash
   aws ce get-cost-and-usage \
     --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
     --granularity MONTHLY \
     --metrics BlendedCost
   ```

### Repository Preparation

1. **Clean workspace** — No uncommitted changes
2. **Latest code pulled** — Synced with remote
3. **Backup branch created** — Safety net for rollback
4. **Feature branch created** — `fix/api-cost-optimization`

### Rollback Plan

**Emergency rollback script created at `/tmp/rollback.sh`:**
- Reverts to backup branch
- Redeploys original stacks
- Takes ~5 minutes to execute
- Tested (dry-run) before implementation

---

## Documents Created

All implementation guides and checklists ready:

1. **API_COST_ISSUE_ANALYSIS_AND_FIX_PLAN.md** — Full technical analysis
2. **PRE_IMPLEMENTATION_CHECKLIST.md** — Step-by-step pre-flight checks
3. **PHASE1_IMPLEMENTATION_GUIDE.md** — Detailed Phase 1 instructions
4. **PHASE2_IMPLEMENTATION_GUIDE.md** — Detailed Phase 2 instructions
5. **PHASE3_IMPLEMENTATION_GUIDE.md** — Detailed Phase 3 instructions (to be created)
6. **This executive summary** — High-level overview

---

## Success Criteria

### Phase 1 Success
- [ ] Dashboard fully functional after deployment
- [ ] API returns 403 without key, 200 with key
- [ ] Lambda invocations reduced (bot traffic blocked)
- [ ] No user-visible issues

### Phase 2 Success
- [ ] Lambda duration: 10-30 seconds (was 3-4 minutes)
- [ ] New activities appear daily
- [ ] No missing data over 3+ days
- [ ] Manual backfill tested and works

### Phase 3 Success
- [ ] Cache hit ratio >80%
- [ ] Response times <100ms for cached requests
- [ ] Fresh data appears within 1 hour of sync

### Overall Success
- [ ] **Cost reduced by 70-90%**
- [ ] All dashboard functionality intact
- [ ] No user-visible changes (except faster page loads)
- [ ] System stable for 1 week post-implementation

---

## Approval Required

**Confirm understanding and approval to proceed:**

- [ ] Problem statement understood
- [ ] Solution approach approved
- [ ] Timeline acceptable (3 days)
- [ ] Risk level acceptable (LOW with mitigation)
- [ ] Success criteria agreed
- [ ] Ready to proceed with implementation

**Next action:** Execute **PRE_IMPLEMENTATION_CHECKLIST.md**

---

## Questions to Answer Before Proceeding

1. **Have API Gateway logs been analyzed to confirm bot traffic?**
   - Need evidence that bots are driving costs (not just assumption)

2. **What is the current monthly AWS cost?**
   - Need baseline to measure success against

3. **When is the best time window for deployment?**
   - Low-traffic period recommended (though impact is minimal with rollback ready)

4. **Who should be notified before/during/after deployment?**
   - Stakeholder communication plan

5. **Is there a backup of current working state?**
   - Git backup branch + ability to rollback

**Once these questions are answered, proceed with Phase 1 deployment.**

---

**Document prepared by:** Claude  
**Date:** May 15, 2026  
**Review status:** Ready for stakeholder approval  
**Implementation status:** PENDING — Awaiting go-ahead
