---
"opencode-swarm-plugin": patch
---

## 🐝 Eval Quality Gates: Signal Over Noise

The eval system now filters coordinator sessions to focus on high-quality data.

**Problem:** 67 of 82 captured sessions had <3 events - noise from aborted runs, test pokes, and incomplete swarms. This diluted eval scores and made metrics unreliable.

**Solution:** Quality filters applied BEFORE sampling:

| Filter | Default | Purpose |
|--------|---------|---------|
| `minEvents` | 3 | Skip incomplete/aborted sessions |
| `requireWorkerSpawn` | true | Ensure coordinator delegated work |
| `requireReview` | true | Ensure full swarm lifecycle |

**Impact:**
- Filters 93 noisy sessions automatically
- Overall eval score: 63% → 71% (true signal, not diluted)
- Coordinator discipline: 47% → 57% (accurate measurement)

**Usage:**
```typescript
// Default: high-quality sessions only
const sessions = await loadCapturedSessions();

// Override for specific analysis
const allSessions = await loadCapturedSessions({
  minEvents: 1,
  requireWorkerSpawn: false,
  requireReview: false,
});
```

Includes 7 unit tests covering filter logic and edge cases.
