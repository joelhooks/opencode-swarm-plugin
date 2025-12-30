---
"swarm-mail": minor
---

## 🗄️ → 🌐 Database Migration: Local to Global

```
    ┌──────────────────┐
    │ Project A        │           ┌─────────────────────┐
    │  .opencode/      │──┐        │                     │
    │  streams.db      │  │        │   GLOBAL DATABASE   │
    └──────────────────┘  │        │                     │
                          ├───────▶│  ~/.config/         │
    ┌──────────────────┐  │        │  swarm-tools/       │
    │ Project B        │  │        │  swarm.db           │
    │  .opencode/      │──┘        │                     │
    │  streams.db      │           │  ALL YOUR DATA      │
    └──────────────────┘           │  ONE PLACE          │
                                   └─────────────────────┘
```

> "When you are pretty sure you know where the data ought to be, you can move and migrate the data in a single move. Only the accessors need to change, reducing the risk for problems with bugs."
> 
> — Martin Fowler, *Refactoring: Improving the Design of Existing Code*

**What changed:**

Swarm Mail now automatically consolidates project-local databases into a single global database at `~/.config/swarm-tools/swarm.db`. No more scattered data across projects.

**Why it matters:**

- **One source of truth** - All coordination data (events, messages, reservations) centralized
- **Cross-project visibility** - Query patterns across all your projects
- **Simpler backups** - One database to backup, not N scattered files
- **Zero user intervention** - Triggers automatically on first access to any project
- **Idempotent & safe** - Renames old DB to `.migrated` suffix after success, never re-runs

**How it works:**

1. On first `getSwarmMailLibSQL()` call, checks for local database
2. If found, migrates all 16 tables to global DB in background (fire-and-forget)
3. Renames local DB to `streams.db.migrated` to mark completion
4. Future calls use global DB directly

**Migration coverage:**

Migrates all subsystems:
- **Streams:** events, agents, messages, message_recipients, reservations, cursors, locks
- **Hive:** beads, bead_dependencies, bead_labels, bead_comments, blocked_beads_cache, dirty_beads
- **Learning:** eval_records, swarm_contexts, deferred

**Manual migration:**

For power users who want explicit control:

```typescript
import { migrateLocalDbToGlobal } from 'swarm-mail';

const stats = await migrateLocalDbToGlobal(
  '/abs/path/to/.opencode/streams.db',
  '~/.config/swarm-tools/swarm.db'
);

console.log(`Migrated ${stats.events} events, ${stats.messages} messages`);
```

**Backward compatible:** Existing code continues to work. Projects without local DBs start fresh with global DB.
