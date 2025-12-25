# Session Data Quality Audit Report

**Date:** 2025-12-25  
**Cell:** opencode-swarm-plugin--ys7z8-mjlk7jspacf  
**Agent:** WildDawn  

## Executive Summary

Investigation of why only 3 of 102 sessions (2.9%) pass the coordinator-session eval filter reveals:

1. **Filter is working as designed** - correctly isolating high-quality complete coordinator sessions
2. **Data quality is actually GOOD** - the 3 passing sessions are gold-standard examples
3. **97% filtered out is EXPECTED** - most sessions are worker completions, not coordinator sessions
4. **Filter may be too strict** for broad coordinator behavior analysis (needs tuning)

## Data Breakdown

### Total Sessions: 102

| Category | Count | % | Description |
|----------|-------|---|-------------|
| **Single-event sessions** | 70 | 68.6% | Worker completions (subtask_success), isolated reviews |
| **Multi-event incomplete** | 29 | 28.4% | Coordinator sessions that didn't complete full cycle |
| **Passing sessions** | 3 | 2.9% | Complete coordinator cycles with spawn + review |

### Single-Event Sessions (70 sessions - 68.6%)

**Event Type Breakdown:**
- `OUTCOME/subtask_success`: 56 (80.0%) - **Worker completions, not coordinator sessions**
- `DECISION/review_completed`: 12 (17.1%) - Isolated review events
- `DECISION/worker_spawned`: 2 (2.9%) - Isolated spawn events

**Analysis:** These are **NOT coordinator sessions**. They're worker agents reporting completion or isolated coordinator actions captured in separate session files.

### Multi-Event Failures (29 sessions - 28.4%)

**Failure Breakdown:**
- **No worker_spawned event**: 20 sessions
  - Review-only sessions (3-22 events, all `review_completed`)
  - Appears to be test data or session capture split across files
- **Has worker_spawned but no review_completed**: 5 sessions
  - Incomplete coordinator sessions (4-24 events)
  - Coordinator spawned workers but reviews weren't captured (yet)
- **Too few events (<3)**: 4 sessions
  - Aborted early

**Key Finding:** None of these 29 sessions have `decomposition_complete` events. This suggests:
1. Session capture may not be recording decomposition events
2. OR coordinator sessions span multiple session files
3. OR these are partial captures from long-running coordinators

### Passing Sessions (3 sessions - 2.9%)

#### ses_4b86f0867ffeXKv95ktf31igfD
- **Events:** 33
- **Worker spawns:** 20
- **Reviews completed:** 13
- **Violations:** 0
- **Duration:** 437 minutes (7.3 hours)
- **Quality:** GOLD STANDARD

#### ses_4ac0f508dffeEcwSQ6OSMWrmWF
- **Events:** 21
- **Worker spawns:** 17
- **Reviews completed:** 4
- **Duration:** 540 minutes (9.0 hours)
- **Quality:** GOLD STANDARD

#### ses_4ae8c2f66ffecyfyre7ZQ7y5LW
- **Events:** 31
- **Worker spawns:** 24
- **Reviews completed:** 7
- **Violations:** 0
- **Duration:** 368 minutes (6.1 hours)
- **Quality:** GOLD STANDARD

**Analysis:** These are FULL multi-hour coordinator sessions with extensive worker coordination. They represent the ideal coordinator behavior the eval is designed to measure.

## Current Filter Criteria

```typescript
{
  minEvents: 3,              // Default
  requireWorkerSpawn: true,  // Default
  requireReview: true,       // Default
}
```

### Filter Performance

| Check | Impact |
|-------|--------|
| `minEvents >= 3` | Filters out 74 sessions (72.5%) |
| `requireWorkerSpawn: true` | Filters out 20 additional sessions (19.6%) |
| `requireReview: true` | Filters out 5 additional sessions (4.9%) |

**Cascade effect:** Each filter compounds, resulting in 2.9% passing rate.

## Root Cause Analysis

### Is the Filter Too Strict?

**YES and NO:**

✅ **Working as designed:**
- Correctly excludes worker-only sessions (80% of single-event data)
- Correctly excludes incomplete coordinator sessions
- Isolates high-quality complete coordinator cycles

❌ **Too strict for real-world analysis:**
- 2.9% passing rate means most coordinator behavior is invisible to the eval
- Filter assumes coordinators ALWAYS complete full spawn+review cycles
- Doesn't account for:
  - Long-running multi-session coordinators
  - Coordinators that spawn workers but reviews aren't captured yet
  - Early-stage coordinator sessions (before first spawn)

### Is the Data Quality Low?

**NO.** The data quality is actually GOOD:

- The 3 passing sessions are excellent gold-standard examples
- They contain rich coordinator behavior (20-24 worker spawns, 4-13 reviews)
- Zero violations in all 3 sessions
- Multi-hour timelines showing sustained coordination

The "low passing rate" is a **filter strictness issue**, not a data quality issue.

### Why Only 3/102 Pass?

**Theory 1: Session Capture Splits Long Coordinators**
- The 3 passing sessions are 6-9 hour marathons
- Most coordinator work may be happening in shorter bursts
- Session files might be split by epic_id or time windows

**Evidence:**
- Some sessions have 20+ `review_completed` events with no `worker_spawned`
- This suggests reviews from previous spawns in a different session file

**Theory 2: Review Capture Is Incomplete**
- 5 sessions have `worker_spawned` but no `review_completed`
- Reviews may be captured in separate session files
- OR review capture isn't working consistently

**Theory 3: Most Coordinator Sessions Are Short**
- Only 32/102 sessions (31.4%) have ANY `review_completed` event
- Only 10/102 sessions (9.8%) have ANY `worker_spawned` event
- This suggests most captured activity is worker completions, not coordinator cycles

## Recommendations

### 1. Make Filter Parameters Optional (IMMEDIATE)

**Current default:**
```typescript
{
  minEvents: 3,
  requireWorkerSpawn: true,
  requireReview: true,
}
```

**Recommended default:**
```typescript
{
  minEvents: 3,              // Keep - filters out noise
  requireWorkerSpawn: false, // CHANGE - allow early-stage sessions
  requireReview: false,      // CHANGE - allow incomplete sessions
}
```

**Impact:** This would increase passing rate from 3 to ~28 sessions (from 2.9% to 27.5%).

**Rationale:**
- Captures more coordinator behavior (spawns without reviews)
- Allows evaluation of early-stage coordination patterns
- Still filters out single-event worker completions
- Users can opt-in to stricter filters if needed

### 2. Add Session Type Detection (ENHANCEMENT)

Add a filter to exclude worker-only sessions automatically:

```typescript
function isCoordinatorSession(session: CoordinatorSession): boolean {
  return session.events.some(e => 
    e.event_type === "DECISION" && 
    (e.decision_type === "decomposition_complete" || 
     e.decision_type === "worker_spawned" ||
     e.decision_type === "strategy_selected")
  );
}
```

**Impact:** Filters out 70+ worker-only sessions before applying other criteria.

### 3. Investigate Session Capture Splitting (BUG FIX?)

**Symptoms:**
- Sessions with 22 `review_completed` events but no `worker_spawned`
- Sessions with 24 `worker_spawned` events but no reviews
- No `decomposition_complete` events in ANY session (including the 3 passing)

**Hypothesis:** Long-running coordinator sessions may be split across multiple session files.

**Action:** Investigate `eval-capture.ts` to understand:
- How `session_id` is generated
- Whether sessions are split by epic_id
- Whether there's a session timeout that creates new files

### 4. Add Filter Reporting to Data Loader (OBSERVABILITY)

The data loader logs filtered-out count, but doesn't break down WHY sessions failed.

**Enhancement:**
```typescript
console.log(`Filtered out ${filteredOutCount} sessions:`);
console.log(`  - Too few events (<${minEvents}): ${stats.tooFewEvents}`);
console.log(`  - No worker_spawned: ${stats.noWorkerSpawn}`);
console.log(`  - No review_completed: ${stats.noReview}`);
console.log(`  - Worker-only sessions: ${stats.workerOnly}`);
```

This helps users understand filter impact.

### 5. Consider Separate Evals for Different Session Types

Instead of one eval with strict filters, consider:

**Eval 1: Full Coordinator Cycles** (current behavior)
- Filters: `minEvents=3, requireWorkerSpawn=true, requireReview=true`
- Focus: End-to-end coordinator discipline
- Expected passing rate: ~3% (gold standard only)

**Eval 2: Coordinator Spawning Behavior**
- Filters: `minEvents=3, requireWorkerSpawn=true, requireReview=false`
- Focus: How coordinators delegate work
- Expected passing rate: ~10%

**Eval 3: Coordinator Review Behavior**
- Filters: `minEvents=3, requireWorkerSpawn=false, requireReview=true`
- Focus: How coordinators review worker output
- Expected passing rate: ~31%

**Eval 4: All Coordinator Activity**
- Filters: `minEvents=3, requireWorkerSpawn=false, requireReview=false, isCoordinatorSession=true`
- Focus: Broad coordinator behavior patterns
- Expected passing rate: ~27%

## Conclusion

The coordinator-session eval filter is **working as designed**. It successfully isolates high-quality complete coordinator sessions for evaluation.

However, the **2.9% passing rate is too strict** for comprehensive coordinator behavior analysis. The filter should:

1. **Default to more lenient settings** (requireWorkerSpawn=false, requireReview=false)
2. **Allow users to opt-in** to stricter filters for gold-standard analysis
3. **Automatically exclude worker-only sessions** via session type detection
4. **Provide visibility** into why sessions are filtered out

The data quality itself is GOOD. The 3 passing sessions are excellent examples of sustained multi-hour coordinator behavior with extensive worker coordination and zero violations.

---

## Appendix: Raw Data

### Event Count Distribution

```
  1 event:  70 sessions (68.6%) - Mostly worker completions
  2 events:  4 sessions (3.9%)
  3 events:  6 sessions (5.9%)
  4 events:  3 sessions (2.9%)
  5 events:  3 sessions (2.9%)
  6 events:  2 sessions (2.0%)
  7 events:  1 session  (1.0%)
  9 events:  1 session  (1.0%)
 21 events:  1 session  (1.0%) ✓ PASSING
 22 events:  5 sessions (4.9%)
 24 events:  1 session  (1.0%)
 27 events:  1 session  (1.0%)
 30 events:  2 sessions (2.0%)
 31 events:  1 session  (1.0%) ✓ PASSING
 33 events:  1 session  (1.0%) ✓ PASSING
```

### Sample Worker-Only Sessions

```
ses_6EraEW6LTRswygMPQa2voC.jsonl (1 event):
  OUTCOME/subtask_success

ses_xyJ85H9SaA5FSnJvDL7ktJ.jsonl (1 event):
  OUTCOME/subtask_success

ses_BiqTpFyafkbpt3tvZbh29R.jsonl (1 event):
  DECISION/review_completed
```

### Sample Incomplete Coordinator Sessions

```
ses_4aa1d6e57ffeGfXIoIMNhTQ9JI.jsonl (7 events):
  DECISION/worker_spawned (x7)
  → Missing reviews

ses_3t9CP2ZG54wF3D982kZgps.jsonl (3 events):
  DECISION/review_completed (x3)
  → Missing spawns

test-review-1766636012605.jsonl (22 events):
  DECISION/review_completed (x22)
  → Missing spawns (likely test data)
```

---

**Generated by:** WildDawn (swarm worker agent)  
**Date:** 2025-12-25  
**Files analyzed:** 102 session files from `~/.config/swarm-tools/sessions/`
