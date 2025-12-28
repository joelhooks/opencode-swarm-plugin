---
"opencode-swarm-plugin": patch
---

## 🐝 Logger Finally Works in Global Installs

```
  BEFORE: pino.transport()          AFTER: pino.destination()
  
     ┌────────────┐                    ┌────────────┐
     │ worker     │                    │ main       │
     │ thread     │ ──CRASH──►         │ thread     │ ──WORKS──►
     │ require()  │  module not        │ sync write │
     └────────────┘  found             └────────────┘
```

Fixed `unable to determine transport target for "pino-pretty"` in global installs.

**Root cause:** `pino.transport()` spawns worker_threads that `require()` modules. In global installs (`bun install -g`), the worker can't find modules because they're hoisted to a different location than the package.

**Fix:** Replaced `pino.transport()` with `pino.destination()`:
- Default: stdout JSON (works everywhere)
- `SWARM_LOG_FILE=1`: writes to `~/.config/swarm-tools/logs/swarm.log`
- Removed pino-roll/pino-pretty from runtime (they were causing worker thread issues)

Simple, reliable logging that works in bundled CLIs, global installs, and local dev.

