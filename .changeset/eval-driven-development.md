---
"opencode-swarm-plugin": minor
"swarm-mail": patch
---

## 🐝 Eval-Driven Development: The System That Scores Itself

> "What gets measured gets managed." — Peter Drucker
> "What gets scored gets improved." — The Swarm

The plugin now evaluates its own output quality through a progressive gate system. Every compaction prompt gets scored, tracked, and learned from. Regressions become impossible to ignore.

### The Pipeline

```
CAPTURE → SCORE → STORE → GATE → LEARN → IMPROVE
   ↑                                      ↓
   └──────────────────────────────────────┘
```

### What's New

**Event Capture** (5 integration points)
- `detection_triggered` - When compaction is detected
- `prompt_generated` - Full LLM prompt captured
- `context_injected` - Final content before injection
- All events stored to `~/.config/swarm-tools/sessions/{session_id}.jsonl`

**5 Compaction Prompt Scorers**
- `epicIdSpecificity` - Real IDs, not placeholders (20%)
- `actionability` - Specific tool calls with values (20%)
- `coordinatorIdentity` - ASCII header + mandates (25%)
- `forbiddenToolsPresent` - Lists what NOT to do (15%)
- `postCompactionDiscipline` - First tool is correct (20%)

**Progressive Gates**
| Phase | Threshold | Behavior |
|-------|-----------|----------|
| Bootstrap | N/A | Always pass, building baseline |
| Stabilization | 0.6 | Warn but pass |
| Production | 0.7 | Fail CI on regression |

**CLI Commands**
```bash
swarm eval status          # Current phase, thresholds, scores
swarm eval history         # Trends with sparklines ▁▂▃▄▅▆▇█
swarm eval run [--ci]      # Execute evals, gate check
```

**CI Integration**
- Runs after tests pass
- Posts results as PR comment with emoji status
- Only fails in production phase with actual regression

**Learning Feedback Loop**
- Significant score drops auto-stored to semantic memory
- Future agents learn from past failures
- Pattern maturity tracking

### Breaking Changes

None. All new functionality is additive.

### Files Changed

- `src/eval-capture.ts` - Event capture with Zod schemas
- `src/eval-gates.ts` - Progressive gate logic
- `src/eval-history.ts` - Score tracking over time
- `src/eval-learning.ts` - Failure-to-learning extraction
- `src/compaction-prompt-scoring.ts` - 5 pure scoring functions
- `evals/compaction-prompt.eval.ts` - Evalite integration
- `bin/swarm.ts` - CLI commands
- `.github/workflows/ci.yml` - CI integration

### Test Coverage

- 422 new tests for eval-capture
- 48 CLI tests
- 7 integration tests for capture wiring
- All existing tests still passing
