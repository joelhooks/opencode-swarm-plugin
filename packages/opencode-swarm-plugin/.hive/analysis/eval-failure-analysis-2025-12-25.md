# Eval Failure Analysis Report
**Date:** 2025-12-25
**Analyst:** BrightStar
**Cell:** opencode-swarm-plugin--ys7z8-mjlk7jsl4tt
**Epic:** opencode-swarm-plugin--ys7z8-mjlk7js9bt1

## Executive Summary

Two eval failures analyzed:
- **example.eval.ts**: 0% score - structural bug in eval setup
- **compaction-prompt.eval.ts**: 53% score - case sensitivity + missing forbidden tools

Both are fixable with code changes. No test data quality issues.

---

## example.eval.ts - 0% Score

### Status
❌ **CRITICAL** - Complete failure (0%)

### Root Cause
**Eval structure mismatch** between data provider and task function.

### Technical Details

**File:** `evals/example.eval.ts`
**Lines:** 14-30

The eval has a fundamental flow error:

```typescript
// Line 14-26: data() provides BOTH input AND expected output
data: async () => {
  return [
    {
      input: "Test task",                    // ← String for task function
      output: JSON.stringify({               // ← Expected output (ignored!)
        epic: { title: "Test Epic", ... },
        subtasks: [...]
      }),
    },
  ];
},

// Line 28-30: task() does passthrough
task: async (input) => {
  return input;  // ← Returns "Test task" string, NOT the CellTree
},

// Line 31: Scorer expects CellTree JSON
scorers: [subtaskIndependence],
```

**What happens:**
1. Evalite passes `input` ("Test task") to task function
2. Task returns "Test task" string unchanged
3. Scorer `subtaskIndependence` receives "Test task"
4. Scorer tries to parse as CellTree JSON → **FAILS**
5. Score: 0%

The `output` field in `data()` is ignored by Evalite - it's the `task()` return value that gets scored.

### Impact
- Example eval is useless for validation
- False signal that scorer infrastructure is broken (it's not)
- Wastes CI time

### Proposed Fix

**Option 1: Remove output from data (recommended)**
```typescript
data: async () => {
  return [
    {
      input: {
        epic: { title: "Test Epic", description: "Test" },
        subtasks: [
          { title: "Subtask 1", files: ["a.ts"], estimated_complexity: 1 },
          { title: "Subtask 2", files: ["b.ts"], estimated_complexity: 1 },
        ],
      },
    },
  ];
},

task: async (input) => {
  return JSON.stringify(input);  // Stringify the CellTree
},
```

**Option 2: Fix task to use output**
```typescript
// Keep data() as-is, but fix task:
task: async (input, context) => {
  return context.expected.output;  // Use the output from data()
},
```

Option 1 is cleaner - task functions should generate output, not just pass through.

---

## compaction-prompt.eval.ts - 53% Score

### Status
⚠️ **DEGRADED** - Below target (53% vs 100% historical)

### Root Causes

#### RC1: Case-Sensitive Forbidden Tool Patterns (15% weight)

**File:** `src/compaction-prompt-scoring.ts`
**Lines:** 213-218

```typescript
const forbiddenTools = [
  /\bEdit\b/,     // ← Requires capital E
  /\bWrite\b/,    // ← Requires capital W
  /swarmmail_reserve/,
  /git commit/,
];
```

**File:** `evals/fixtures/compaction-prompt-cases.ts`
**Lines:** 76-83 (perfect fixture)

```
- edit      // ← lowercase e
- write     // ← lowercase w
- bash (for file modifications)
```

**Evidence:**
```javascript
/\bEdit\b/.test("- Edit")  // ✅ true
/\bEdit\b/.test("- edit")  // ❌ false (word boundary + case)
```

**Impact:**
- Perfect fixture: 0/4 forbidden tools matched
- Forbidden tools scorer: 0% (should be 75-100%)
- Overall impact: 15% of total score lost

#### RC2: Missing Forbidden Tools (15% weight)

Scorer expects **4 tools**:
1. Edit (or edit)
2. Write (or write)
3. swarmmail_reserve
4. git commit

Perfect fixture has **3 tools** (and case mismatch):
1. edit ❌ (lowercase)
2. write ❌ (lowercase)
3. bash ❌ (not in scorer's list)

Missing: swarmmail_reserve, git commit

**Impact:**
- Even if case fixed, still only 2/4 tools = 50% on this scorer
- Weighted: 50% × 15% = 7.5% contribution (should be 15%)

#### RC3: "bash" Not in Scorer's List

Fixtures mention "bash (for file modifications)" as forbidden, but scorer doesn't check for it.
This creates a 3-way mismatch:
- Fixture lists: edit, write, bash
- Scorer checks: Edit, Write, swarmmail_reserve, git commit
- Overlap: 0 tools (due to case)

### Score Breakdown - Perfect Fixture

Expected (if 100%):
```
epicIdSpecificity:        20% × 1.0 = 20%
actionability:            20% × 1.0 = 20%
coordinatorIdentity:      25% × 1.0 = 25%
forbiddenToolsPresent:    15% × 1.0 = 15%
postCompactionDiscipline: 20% × 1.0 = 20%
                                 ─────
TOTAL:                              100%
```

Actual (current):
```
epicIdSpecificity:        20% × 1.0 = 20% ✅
actionability:            20% × 1.0 = 20% ✅
coordinatorIdentity:      25% × 1.0 = 25% ✅
forbiddenToolsPresent:    15% × 0.0 =  0% ❌ (0/4 matched)
postCompactionDiscipline: 20% × 1.0 = 20% ✅
                                 ─────
TOTAL:                               85%
```

Perfect fixture alone should score 85%, but overall eval is 53%.
This means the 5 "bad" fixtures are pulling average down further (expected behavior).

### Historical Context

Semantic memory claims 100% score previously. Likely scenarios:
1. **Never actually ran** - aspiration documented before implementation
2. **Ran with different fixtures** - fixtures were updated after scorer was written
3. **Scorer was case-insensitive before** - regression in recent commit aa12943

Commit aa12943 (2025-12-24) added the eval infrastructure. This is brand new code.

### Proposed Fixes

#### Fix 1: Make Scorer Case-Insensitive (Recommended)

**File:** `src/compaction-prompt-scoring.ts`
**Lines:** 213-218

```typescript
const forbiddenTools = [
  /\bedit\b/i,              // Case insensitive with 'i' flag
  /\bwrite\b/i,             // Case insensitive
  /\bbash\b/i,              // Add bash (was missing)
  /swarmmail_reserve/i,     // Keep, add 'i' for safety
  /git commit/i,            // Keep, add 'i' for safety
];
```

**Rationale:**
- Coordinators might capitalize differently in prompts
- Real prompts won't always match exact case
- More robust matching

#### Fix 2: Update Fixtures to Match Scorer (Alternative)

**File:** `evals/fixtures/compaction-prompt-cases.ts`
**Lines:** 76-83 (and all other fixtures)

```
- Edit                           // Capital E
- Write                          // Capital W
- bash (for file modifications)  // Keep or remove
- swarmmail_reserve              // ADD
- git commit                     // ADD
```

**Rationale:**
- Keeps scorer strict (may catch real case issues)
- Makes fixtures comprehensive (all 5 tools)
- More explicit about what's forbidden

#### Fix 3: Hybrid (Best of Both)

1. Make scorer case-insensitive (Fix 1)
2. Update fixtures to include all 5 tools (Fix 2)
3. Remove "bash" from fixtures if not in coordinator forbidden list

```typescript
// Scorer (5 tools, case-insensitive):
const forbiddenTools = [
  /\bedit\b/i,
  /\bwrite\b/i,
  /swarmmail_reserve/i,
  /git\s+commit/i,
  /\bread\b/i,  // Consider adding - coordinators shouldn't read, should check status
];
```

```
// Fixture:
- Edit
- Write
- swarmmail_reserve (only workers reserve files)
- git commit (workers commit their changes)
```

### Risk Assessment

**If we fix this, will scores jump to 100%?**

**Perfect fixture:** 85% → 100% (if all 4 tools matched)
**Other fixtures:** Depends on their issues

Looking at fixture expected values:
- Fixture 0 (perfect): Should be 100%
- Fixture 1 (placeholder): Should fail (expected)
- Fixture 2 (generic): Should fail (expected)
- Fixture 3 (weak identity): Should partially fail (expected)
- Fixture 4 (missing forbidden): Should fail on forbidden tools only
- Fixture 5 (wrong first tool): Should fail on discipline only

Average across 6 fixtures: ~66% expected (not 100%)

**So 53% → ~70-80%** is realistic after fixes (not 100%).

To get higher scores, need to fix issues in bad fixtures too, but those are SUPPOSED to fail.
The scorer is working correctly on those.

---

## Recommendations

### Immediate Actions (P0)

1. **Fix example.eval.ts structure** - 5 min fix, unblocks that eval
2. **Make forbidden tools case-insensitive** - 5 min fix, +15-20% score boost
3. **Add missing tools to fixtures** - 10 min, comprehensive coverage

### Medium-term Actions (P1)

4. **Verify 100% claim in semantic memory** - Check if historical data exists
5. **Document scorer expectations** - Add comments to fixtures explaining weights
6. **Add unit tests for scorers** - Test edge cases independently

### Long-term Actions (P2)

7. **Consider LLM-as-judge for semantic checks** - Case-insensitive by nature
8. **Add visual diff in eval output** - Show what's missing from prompts
9. **Create eval dashboard** - Track scores over time, detect regressions

---

## Conclusion

Both evals have **code bugs, not test data issues**:
- example.eval.ts: Structural bug (task/data mismatch)
- compaction-prompt.eval.ts: Case sensitivity + incomplete tool list

Fixes are straightforward and low-risk. After fixes, expect:
- example.eval.ts: 0% → 100%
- compaction-prompt.eval.ts: 53% → 70-80%

The 100% historical score in semantic memory is likely aspirational - these evals are brand new (commit aa12943, Dec 24).

**Ready to implement fixes or escalate for review?**
