---
"swarm-mail": patch
"opencode-swarm-plugin": patch
---

## 🔬 Smart Operations: From Eval Purgatory to Integration Paradise

```
     BEFORE                          AFTER
   ┌─────────┐                    ┌─────────┐
   │ evalite │ ──CORRUPT──►       │ bun:test│
   │ vitest  │   VTAB!            │  vec0   │
   │  vec0?  │                    │   ✓     │
   └────╳────┘                    └────✓────┘
        │                              │
        │  "database disk image        │  5 pass, 2 skip
        │   is malformed"              │  (libSQL bug, not us)
        ▼                              ▼
      💀 RIP                        🎉 ALIVE
```

> "They test implementation detail and hurt migrations."
> — *The Coding Career Handbook*

Migrated `smart-operations.eval.ts` from evalite to bun:test integration tests.

**Why?** The sqlite-vec (vec0) extension loads fine in bun's native test runner but throws `SQLITE_CORRUPT_VTAB` in vitest/evalite. Rather than mock the unmockable, we moved where the tests can breathe.

**What moved:**
- `evals/smart-operations.eval.ts` → `swarm-mail/src/memory/__tests__/smart-operations.integration.test.ts`
- Deleted: `evals/fixtures/smart-operations-fixtures.ts`
- Deleted: `evals/scorers/smart-operations-scorer.ts`

**Test results:** 5 pass, 2 skip (UPDATE/DELETE have a separate libSQL corruption bug being tracked)

**The eval tested:** ADD/UPDATE/DELETE/NOOP smart memory operations with LLM-powered decision making. Now it actually runs.
