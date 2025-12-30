---
"opencode-swarm-plugin": patch
"swarm-mail": patch
---

## 🔧 Test Suite Stabilization & Global Database Path

> "The first step in fixing a broken window is to notice it."
> — The Pragmatic Programmer

```
     ___________
    |  PASSING  |
    |   TESTS   |
    |___________|
         ||
    ╔════╧════╗
    ║ 1538    ║
    ║  ✓ ✓ ✓  ║
    ╚═════════╝
```

### What Changed

**swarm-mail:**
- `getDatabasePath()` now ALWAYS returns global path (`~/.config/swarm-tools/swarm.db`)
- Local project databases will be auto-migrated in a future release (placeholder warning added)
- Auto-tagger LLM tests now opt-in via `RUN_LLM_TESTS=1` (prevents flaky CI)

**opencode-swarm-plugin:**
- Fixed type mismatches in compaction hook (HiveAdapter → MinimalHiveAdapter)
- Fixed eval capture in tool hooks (args not available in after hook)
- All 425 tests passing

### Why Global Database?

Single source of truth across all projects:
- No more orphaned databases in worktrees
- Consistent swarm state regardless of working directory
- Simpler backup/restore story

### ⚠️ Breaking: Local Databases Orphaned

Existing local databases at `{project}/.opencode/swarm.db` are **NOT migrated**.
They remain on disk but are no longer read. A warning is logged when detected.

**Tracked:** Cell `mjrd8cyhvnu` - Implement local-to-global DB migration

**If you have important data in local DBs**, wait for migration tool or manually copy:
```bash
# Check if you have local data
ls -la .opencode/swarm.db
```

### Test Results

| Package | Pass | Skip | Fail |
|---------|------|------|------|
| swarm-mail | 1113 | 29 | 0 |
| opencode-swarm-plugin | 425 | 0 | 0 |
