---
"opencode-swarm-plugin": patch
---

> "Tasks should be composable to more complex tasks." — *Dynamic State Charts: Composition and Coordination of Complex Robot Behavior*

     [swarm]--[swarm]--[swarm]
          \         /
           \       /
            [hive]

## Prompts Use Swarm Tools Only

Swarm prompts and skills now reference only `hive_*`, `swarmmail_*`, `swarm_*`, and `hivemind_*` tools. Deprecated `bd`, `cass`, and `semantic_memory` references are removed to keep coordination consistent.

**What changed**
- Updated swarm coordination skill and prompt templates to use `hivemind_*` for memory.
- Removed deprecated tool names from prompts and added test coverage.

**Why it matters**
- Ensures Claude Code plugin guidance matches the supported toolchain.
- Prevents drifting into deprecated interfaces that no longer exist.

**Backward compatible:** No API changes; guidance and prompts only.
