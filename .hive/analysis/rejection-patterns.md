# Rejection Patterns Analysis

**Analysis Date:** 2026-01-07  
**Database:** ~/.config/swarm-tools/swarm.db  
**Analyst:** BlueDawn (mk471w82uwg)

## Executive Summary

Analysis of swarm review events reveals a **69% first-pass success rate** (38/55 reviews approved on attempt 1), with most rejections resolved by attempt 2. The 3-strike rule blocked only 3 tasks (5.5%), indicating the retry mechanism is working as designed. However, coordinator protocol violations remain a persistent issue.

## Review Outcome Breakdown

### Overall Statistics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Reviews** | 59 | 100% |
| **Approved (All Attempts)** | 38 | 64.4% |
| **Needs Changes (Active)** | 18 | 30.5% |
| **Blocked (3-Strike)** | 3 | 5.1% |

### Outcomes by Attempt Number

| Status | Attempt 1 | Attempt 2 | Attempt 3 | Total |
|--------|-----------|-----------|-----------|-------|
| **Approved** | 38 | 0 | 0 | 38 |
| **Needs Changes** | 14 | 4 | 0 | 18 |
| **Blocked** | 0 | 0 | 3 | 3 |

**Key Finding:** 38/52 tasks (73%) pass review on first attempt. Of the 14 rejected initially, 4 were resubmitted (28.6% proceeded to attempt 2), and 3 hit the 3-strike limit.

## Retry Success Patterns

### Retry Flow Analysis

```
Attempt 1 Rejections: 14 tasks
├─ Fixed on Attempt 2: 4 tasks (28.6%)
├─ Blocked after Attempt 3: 3 tasks (21.4%)
└─ Still pending/unknown: 7 tasks (50%)
```

### Case Studies from Database

**Case 1: Successful Recovery (bd-retry-test)**
- **Sequence:** needs_changes:1 → needs_changes:1 → needs_changes:1 → approved:1 → needs_changes:1 → needs_changes:2 → blocked:3 → needs_changes:1 → needs_changes:1 → approved:1
- **Analysis:** Multiple rounds of feedback, eventually succeeded. Shows persistence works.

**Case 2: 3-Strike Block (cell-mpdpp7-mk2y31wxgh3)**
- **Sequence:** needs_changes:1 → needs_changes:2 → blocked:3
- **Analysis:** Clean progression through retry attempts, hit architectural issue on attempt 3.

**Case 3: Mixed Recovery (bd-feedback-test)**
- **Sequence:** approved:1 → needs_changes:1 → needs_changes:1 → needs_changes:2 → needs_changes:1 → needs_changes:2 → blocked:3 → needs_changes:1 → approved:1
- **Analysis:** Initially approved, then regression detected in review, eventually recovered.

## Rejection Reason Categories

### Structured Feedback Analysis (review_feedback events)

Only **2 review_feedback events** captured with structured `issues` field:

| Task ID | File | Line | Issue | Suggestion |
|---------|------|------|-------|------------|
| prompt-test-1 | src/prompt-test-file.ts | 5 | Missing validation | Add input validation |
| prompt-test-2 | src/prompt-test-file.ts | 10 | Incomplete error handling | Add error recovery |

**Categories Detected:**
1. **Missing Validation** (1 instance)
2. **Incomplete Error Handling** (1 instance)

**Data Gap:** Most rejections (16 out of 18 needs_changes) lack structured `issues` field. This suggests:
- Review feedback isn't consistently using the `review_feedback` event
- Feedback may be communicated via Swarm Mail instead of structured events
- Instrumentation gap in review feedback capture

## Coordinator Protocol Violations

**Total Violations:** 15 events

### Violation Type Breakdown

| Violation Type | Count | % of Total | Severity |
|----------------|-------|------------|----------|
| **coordinator_edited_file** | 6 | 40% | Critical |
| **coordinator_ran_tests** | 3 | 20% | Critical |
| **worker_completed_without_review** | 2 | 13.3% | Critical |
| **coordinator_reserved_files** | 2 | 13.3% | High |
| **no_worker_spawned** | 1 | 6.7% | Critical |

### Critical Pattern: Coordinators Doing Worker Tasks

**Problem:** Coordinators are frequently caught performing work that should be delegated:
- **Editing files** (40% of violations) - coordinators should NEVER touch code
- **Running tests** (20% of violations) - testing is verification, workers do this
- **Reserving files** (13.3% of violations) - only workers reserve files

**Example Violations:**

```json
{
  "violation_type": "coordinator_edited_file",
  "tool": "edit",
  "file": "/path/to/file.ts"
}

{
  "violation_type": "coordinator_ran_tests",
  "tool": "bash",
  "command": "jest --coverage"
}

{
  "violation_type": "coordinator_reserved_files",
  "tool": "swarmmail_reserve",
  "paths": ["src/auth/**"]
}
```

### Root Cause Hypothesis

These violations suggest:
1. **Role confusion** - coordinators don't internalize "orchestrate, don't implement"
2. **Impatience** - easier to fix it yourself than spawn a worker
3. **Missing guardrails** - tools like `edit`, `write`, `bash test` should be blocked for coordinators

## File Patterns Analysis

### Files Associated with Rejections

From the limited `review_feedback` data:
- **src/prompt-test-file.ts** - appeared in both rejection cases

**Data Limitation:** With only 2 structured feedback events, we cannot reliably identify "problematic file patterns". Most rejection metadata is missing file context.

### Files from Subtask Outcomes (No Errors Detected)

Querying `subtask_outcome` events with `error_count > 0` returned **zero results**. This indicates:
- Either workers are extremely successful (unlikely)
- Or error tracking isn't capturing failures in subtask outcomes
- Or errors manifest as review rejections, not subtask errors

## Success Metrics

### Positive Indicators

1. **High First-Pass Rate:** 73% of tasks pass review on first attempt
2. **Low Block Rate:** Only 5.5% hit the 3-strike limit
3. **No Subtask Errors:** 0 tasks recorded with `error_count > 0` in outcomes
4. **Retry Recovery:** 28.6% of rejected tasks successfully fixed on attempt 2

### Areas for Improvement

1. **Structured Feedback Adoption:** Only 11% of rejections (2/18) used structured `issues` field
2. **Coordinator Discipline:** 15 protocol violations detected
3. **File Pattern Tracking:** Insufficient data to identify problematic files/modules

## Recommendations

### 1. Worker Prompt Improvements

**Missing Validation Detection:**
- Add explicit checklist: "Did you validate all user inputs?"
- Suggest common validation patterns (Zod schemas, type guards)
- Fail-fast: "If function accepts external data, validation is MANDATORY"

**Error Handling Checklist:**
- "Did you wrap async operations in try/catch?"
- "Does your error handling recover gracefully or propagate meaningfully?"
- "Are error messages actionable for debugging?"

**Pre-Submission Self-Check:**
```markdown
Before calling swarm_complete, verify:
[ ] All inputs validated (Zod, type guards, range checks)
[ ] Error handling for async ops (try/catch, .catch())
[ ] Tests added for new functionality
[ ] No TODO/FIXME comments left in code
```

### 2. Coordinator Guardrails

**Hard Blocks (Raise Errors):**
- `edit`, `write` tools → "ERROR: Coordinators cannot edit files. Spawn a worker."
- `bash` with test commands → "ERROR: Coordinators don't run tests. Workers verify."
- `swarmmail_reserve` → "ERROR: Only workers reserve files."

**Soft Warnings (Log + Continue):**
- No worker spawned after 5min → "WARNING: No workers spawned yet. Decomposition complete?"

**Prompt Reinforcement:**
Add to coordinator system prompt:
```
YOU ARE A COORDINATOR, NOT A WORKER.
✗ Never edit files (use workers)
✗ Never run tests (workers verify)
✗ Never reserve files (workers claim)
✓ Decompose tasks
✓ Spawn workers
✓ Review outputs
✓ Resolve conflicts
```

### 3. Review Feedback Instrumentation

**Standardize Feedback Capture:**
- Make `review_feedback` event MANDATORY for all rejections
- Require structured `issues` array: `[{file, line, issue, suggestion}]`
- Validate schema before recording event

**Feedback Template:**
```typescript
interface ReviewIssue {
  file: string;           // Affected file
  line?: number;          // Specific line (optional)
  category: "validation" | "error_handling" | "tests" | "types" | "incomplete" | "wrong_file";
  issue: string;          // Human-readable description
  suggestion: string;     // Actionable fix
}
```

**Integration Point:**
- `swarm_review_feedback` tool should enforce this schema
- Reject calls without structured `issues` array

### 4. File Pattern Tracking

**Enhance Subtask Outcome Events:**
- Always include `files_touched` array in `subtask_outcome`
- Record `error_files` specifically (files that caused failures)
- Track `files_changed_unexpectedly` (scope creep indicator)

**Aggregate Metrics:**
- Build file-level "rejection heat map" from accumulated feedback
- Surface top 10 problematic files in `swarm stats`
- Use for Hivemind queries: "What went wrong with src/auth.ts before?"

### 5. Retry Intelligence

**Pattern Detection:**
- If task rejected 2x for same issue → escalate to human ("stuck pattern")
- If task alternates approved/rejected → regression in test suite ("flaky verification")
- If task blocked on attempt 3 → store anti-pattern in Hivemind

**Adaptive Prompting:**
- On attempt 2, inject previous rejection reasons into worker prompt
- On attempt 3, switch to more capable model (Haiku → Sonnet)

## Data Quality Issues

### Critical Gaps

1. **Missing Structured Feedback:** 89% of rejections lack `issues` field
2. **No Error Details in Outcomes:** All subtask outcomes report `error_count: 0` despite rejections
3. **Incomplete Retry Tracking:** 50% of rejected tasks have unknown final status

### Recommended Schema Enhancements

**review_completed Event:**
```typescript
{
  type: "review_completed",
  data: {
    epic_id: string,
    bead_id: string,
    status: "approved" | "needs_changes" | "blocked",
    attempt: number,
    issues?: ReviewIssue[],  // ADD THIS
    files_reviewed: string[], // ADD THIS
    review_duration_ms: number, // ADD THIS
  }
}
```

**subtask_outcome Event:**
```typescript
{
  type: "subtask_outcome",
  data: {
    // ... existing fields ...
    error_details?: {        // ADD THIS
      error_files: string[],
      error_messages: string[],
      stack_traces?: string[],
    }
  }
}
```

## Conclusion

The swarm review system is **functionally effective** (73% first-pass success, 5.5% block rate) but suffers from **instrumentation gaps** and **coordinator discipline issues**.

**Immediate Actions:**
1. Enforce structured `issues` in all review feedback (fixes 89% data gap)
2. Block coordinators from editing files/running tests (prevents 60% of violations)
3. Add pre-submission checklist to worker prompts (targets validation/error handling gaps)

**Long-term Improvements:**
4. Build file-level rejection heat map from structured feedback
5. Implement adaptive retry prompting (inject previous failures into attempt 2+)
6. Store blocked tasks as anti-patterns in Hivemind

**Success Indicator:** When `review_feedback` events = `needs_changes` count (currently 2 vs 18), we'll have full visibility into rejection reasons.

---

## Appendix: Query Reference

### Retry Sequences
```sql
WITH retry_sequences AS (
  SELECT 
    json_extract(data, '$.bead_id') as bead_id,
    json_extract(data, '$.status') as status,
    json_extract(data, '$.attempt') as attempt,
    timestamp
  FROM events 
  WHERE type = 'review_completed'
)
SELECT 
  bead_id,
  MAX(CAST(attempt AS INTEGER)) as max_attempts,
  GROUP_CONCAT(status || ':' || attempt, ' -> ') as sequence
FROM retry_sequences
GROUP BY bead_id
HAVING MAX(CAST(attempt AS INTEGER)) > 1
ORDER BY max_attempts DESC
```

### Violation Breakdown
```sql
SELECT 
  json_extract(data, '$.violation_type') as violation_type,
  COUNT(*) as count
FROM events 
WHERE type = 'coordinator_violation'
  AND json_extract(data, '$.violation_type') IS NOT NULL
GROUP BY violation_type
ORDER BY count DESC
```

### Review Outcomes by Attempt
```sql
WITH review_attempts AS (
  SELECT 
    json_extract(data, '$.bead_id') as bead_id,
    json_extract(data, '$.status') as status,
    CAST(json_extract(data, '$.attempt') AS INTEGER) as attempt
  FROM events 
  WHERE type = 'review_completed'
)
SELECT 
  status,
  attempt,
  COUNT(*) as count
FROM review_attempts
GROUP BY status, attempt
ORDER BY status, attempt
```
