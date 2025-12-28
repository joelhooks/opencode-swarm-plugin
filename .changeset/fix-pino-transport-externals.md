---
"opencode-swarm-plugin": patch
---

## 🪵 pino-roll Now Works in Bundled CLI

```
  pino.transport()
       │
       ▼
  ┌─────────────┐      ┌─────────────┐
  │ worker_     │ ──►  │ require()   │ ──► pino-roll ✓
  │ threads     │      │ at runtime  │
  └─────────────┘      └─────────────┘
```

Fixed `unable to determine transport target for "pino-pretty"` error.

**Root cause:** `pino.transport()` spawns worker_threads that dynamically `require()` transport modules at runtime. When bundled, these modules couldn't be resolved because they were inlined into the bundle.

**Fix:** Added `pino-roll` and `pino-pretty` to build externals. Now they're resolved from `node_modules` at runtime instead of being bundled.

Logs now correctly write to `~/.config/swarm-tools/logs/` with daily rotation.

