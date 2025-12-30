---
"opencode-swarm-plugin": minor
"swarm-mail": minor
---

## The Hive Remembers Everything

```
                    🧠
                   /  \
                  /    \      "One mind to remember them all,
                 / HIVE \      one mind to find them,
                / MIND   \     one mind to bring them all
               /          \    and in the context bind them."
              /____________\
                   |||
         ┌────────┴┴┴────────┐
         │                   │
    ┌────┴────┐         ┌────┴────┐
    │ Learnings│         │ Sessions │
    │ (manual) │         │ (indexed)│
    └────┬────┘         └────┬────┘
         │                   │
         └─────────┬─────────┘
                   ▼
            ┌─────────────┐
            │  memories   │  ← Same table
            │   table     │  ← Same vectors
            │  (libSQL)   │  ← Same search
            └─────────────┘
```

> *"The palest ink is better than the best memory."* — Chinese Proverb

### ADR-011: Hivemind Memory Unification

**15 tools → 8 tools.** Sessions and learnings are now unified under one namespace.

**What changed:**

| Old Tool | New Tool |
|----------|----------|
| `semantic-memory_store` | `hivemind_store` |
| `semantic-memory_find` | `hivemind_find` |
| `semantic-memory_get` | `hivemind_get` |
| `semantic-memory_remove` | `hivemind_remove` |
| `semantic-memory_validate` | `hivemind_validate` |
| `cass_search` | `hivemind_find` (collection filter) |
| `cass_view` | `hivemind_get` |
| `cass_index` | `hivemind_index` |
| `cass_stats` | `hivemind_stats` |
| NEW | `hivemind_sync` |

**Why it matters:**

1. **No more naming collision** - External `semantic-memory` MCP was shadowing our internal tools
2. **Unified search** - `hivemind_find` searches both learnings AND sessions in one query
3. **Collection filter** - `collection: "claude"` for Claude sessions, `collection: "default"` for learnings
4. **Simpler mental model** - Sessions ARE memories, just from a different source

**Backward compatible:** All old tool names (`semantic-memory_*`, `cass_*`) still work via deprecation aliases. They'll emit warnings but won't break.

**Migration:** None required. Old tool names continue to work. Update at your leisure.

**117+ tests** covering all tools, lifecycle, deprecation aliases, and integration points.
