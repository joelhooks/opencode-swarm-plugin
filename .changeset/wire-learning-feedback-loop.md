---
"opencode-swarm-plugin": minor
"swarm-mail": patch
---

## 🐝 The Hive Learns From Its Mistakes

```
     ___
    /   \    "Pattern failed 4 times..."
   | o o |   "...make that 5."
    \ ~ /    "AVOID: Split by file type"
     |||
    /   \
```

The learning system feedback loop is now fully wired. Patterns that consistently fail get auto-deprecated so future swarms don't repeat the same mistakes.

**What changed:**

### Anti-Pattern Auto-Deprecation (opencode-swarm-plugin)
- `swarm_complete` now extracts decomposition patterns from epic descriptions
- Records success/failure observations via `recordPatternObservation()`
- Patterns exceeding 60% failure rate auto-invert to anti-patterns with "AVOID:" prefix
- Response includes `pattern_observations` with extracted patterns and any inversions

### Migration Fix (swarm-mail)
- Fixed stale `created_at` column reference in events table migration
- Resolves: `SQLITE_ERROR: table events has no column named created_at`

### CLI Bundling (opencode-swarm-plugin)
- CLI now bundles `swarm-mail` directly instead of marking it external
- Prevents version mismatch when globally installed via npm
- CLI size: 4.71 MB → 13.57 MB (acceptable tradeoff for reliability)

**Why it matters:**
- Swarms now learn from failures automatically
- Bad decomposition strategies get flagged before they waste more time
- The 60% threshold + 3 observation minimum prevents hasty deprecation

> "The definition of insanity is doing the same thing over and over and expecting different results."
> — *Not actually Einstein, but the swarm agrees*
