# opencode-swarm-plugin

**Multi-agent swarm coordination for OpenCode - break tasks into parallel subtasks, spawn worker agents, learn from outcomes.**

**🌐 Website:** [swarmtools.ai](https://swarmtools.ai)  
**📚 Full Documentation:** [swarmtools.ai/docs](https://swarmtools.ai/docs)

```
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
```

## Quickstart (<2 minutes)

### 1. Install

```bash
npm install -g opencode-swarm-plugin@latest
swarm setup
```

### 2. Initialize in Your Project

```bash
cd your-project
swarm init
```

### 3. Run Your First Swarm

```bash
# Inside OpenCode
/swarm "Add user authentication with OAuth"
```

**What happens:**
- Task decomposed into parallel subtasks (coordinator queries past similar tasks)
- Worker agents spawn with file reservations
- Progress tracked with auto-checkpoints at 25/50/75%
- Completion runs bug scans, releases file locks, records learnings

Done. You're swarming.

---

## Optional But Recommended

### Semantic Memory (for pattern learning)

```bash
brew install ollama
ollama serve &
ollama pull mxbai-embed-large
```

Without Ollama, memory falls back to full-text search (still works, just less semantic).

### Historical Context (CASS)

Queries past AI sessions for similar decompositions:

```bash
git clone https://github.com/Dicklesworthstone/coding_agent_session_search
cd coding_agent_session_search
pip install -e .
cass index  # Run periodically to index new sessions
```

### Bug Scanning (UBS)

Auto-runs on subtask completion:

```bash
git clone https://github.com/Dicklesworthstone/ultimate_bug_scanner
cd ultimate_bug_scanner
pip install -e .
```

Check status: `swarm doctor`

---

## Core Concepts

### The Hive 🐝

Work items (cells) stored in `.hive/` and synced to git. Each cell is a unit of work - think GitHub issue but local-first.

**Cell IDs:** Project-prefixed for clarity (e.g., `swarm-mail-lf2p4u-abc123` not generic `bd-xxx`)

### The Swarm

Parallel agents coordinated via **Swarm Mail** (message passing + file reservations). Coordinator spawns workers → workers reserve files → do work → report progress → complete with verification.

### Learning

- **Pattern maturity** tracks what decomposition strategies work
- **Confidence decay** fades unreliable patterns (90-day half-life)
- **Anti-pattern inversion** auto-marks failing approaches to avoid
- **Outcome tracking** learns from speed, errors, retries

### Checkpoint & Recovery

Auto-saves progress at milestones. Survives context death or crashes. Data stored in embedded libSQL (no external DB needed).

**When checkpoints happen:**
- Auto at 25%, 50%, 75% progress
- Before risky operations (via `swarm_checkpoint`)
- On errors (captures error context for recovery)

**Recovery:** `swarm_recover(project_key, epic_id)` returns full context to resume work.

---

## Tools Reference

### Hive (Work Item Tracking)

| Tool               | Purpose                               |
| ------------------ | ------------------------------------- |
| `hive_create`      | Create cell with type-safe validation |
| `hive_create_epic` | Atomic epic + subtasks creation       |
| `hive_query`       | Query with filters                    |
| `hive_update`      | Update status/description/priority    |
| `hive_close`       | Close with reason                     |
| `hive_start`       | Mark in-progress                      |
| `hive_ready`       | Get next unblocked cell               |
| `hive_sync`        | Sync to git                           |

> **Migration Note:** `beads_*` tools still work but show deprecation warnings. Update to `hive_*` tools.

### Swarm Mail (Agent Coordination)

| Tool                     | Purpose                          |
| ------------------------ | -------------------------------- |
| `swarmmail_init`         | Initialize session               |
| `swarmmail_send`         | Send message to agents           |
| `swarmmail_inbox`        | Fetch inbox (context-safe)       |
| `swarmmail_read_message` | Fetch one message body           |
| `swarmmail_reserve`      | Reserve files for exclusive edit |
| `swarmmail_release`      | Release reservations             |

### Swarm Orchestration

| Tool                           | Purpose                                         |
| ------------------------------ | ----------------------------------------------- |
| `swarm_select_strategy`        | Analyze task, recommend strategy                |
| `swarm_decompose`              | Generate decomposition prompt (queries CASS)    |
| `swarm_validate_decomposition` | Validate response, detect conflicts             |
| `swarm_subtask_prompt`         | Generate worker agent prompt                    |
| `swarm_status`                 | Get swarm progress by epic ID                   |
| `swarm_progress`               | Report subtask progress                         |
| `swarm_complete`               | Complete subtask (releases reservations)        |
| `swarm_checkpoint`             | Save progress snapshot (auto at 25/50/75%)      |
| `swarm_recover`                | Resume from checkpoint                          |
| `swarm_review`                 | Generate review prompt for coordinator          |
| `swarm_review_feedback`        | Send approval/rejection to worker (3-strike)    |

### Skills (Knowledge Injection)

| Tool            | Purpose                 |
| --------------- | ----------------------- |
| `skills_list`   | List available skills   |
| `skills_use`    | Load skill into context |
| `skills_read`   | Read skill content      |
| `skills_create` | Create new skill        |

**Bundled skills:**
- **testing-patterns** - 25 dependency-breaking techniques, characterization tests
- **swarm-coordination** - Multi-agent decomposition, file reservations
- **cli-builder** - Argument parsing, help text, subcommands
- **system-design** - Architecture decisions, module boundaries
- **learning-systems** - Confidence decay, pattern maturity
- **skill-creator** - Meta-skill for creating new skills

---

## What's New in v0.33

- **Pino logging infrastructure** - Structured JSON logs with daily rotation to `~/.config/swarm-tools/logs/`
- **Compaction hook instrumented** - 14 log points across all phases (START, GATHER, RENDER, DECIDE, COMPLETE)
- **`swarm log` CLI** - Query/tail logs with module, level, and time filters
- **Analytics queries** - 5 pre-built queries based on Four Golden Signals (latency, traffic, errors, saturation, conflicts)

### v0.32

- **libSQL storage** (embedded SQLite) replaced PGLite - no external DB needed
- **95% integration test coverage** - checkpoint/recovery proven with 9 tests
- **Coordinator review gate** - `swarm_review` + `swarm_review_feedback` with 3-strike rule
- **Smart ID resolution** - partial hashes work like git (`mjhgw0g` matches `opencode-swarm-monorepo-lf2p4u-mjhgw0ggt00`)
- **Auto-sync at key events** - no more forgotten `hive_sync` calls
- **Project-prefixed cell IDs** - `swarm-mail-xxx` instead of generic `bd-xxx`

---

## Architecture

Built on [swarm-mail](../swarm-mail) event sourcing primitives. Data stored in libSQL (embedded SQLite).

```
src/
├── hive.ts                # Work item tracking integration
├── swarm-mail.ts          # Agent coordination tools
├── swarm-orchestrate.ts   # Coordinator logic (spawns workers)
├── swarm-decompose.ts     # Task decomposition strategies
├── swarm-review.ts        # Review gate for completed work
├── skills.ts              # Knowledge injection system
├── learning.ts            # Pattern maturity, outcomes
├── anti-patterns.ts       # Anti-pattern detection
├── structured.ts          # JSON parsing utilities
└── schemas/               # Zod validation schemas
```

---

## Development

```bash
# From monorepo root
bun turbo build --filter=opencode-swarm-plugin
bun turbo test --filter=opencode-swarm-plugin
bun turbo typecheck --filter=opencode-swarm-plugin

# Or from this directory
bun run build
bun test
bun run typecheck
```

### Evaluation Pipeline

Test decomposition quality and coordinator discipline with **Evalite** (TypeScript-native eval framework):

```bash
# Run all evals
bun run eval:run

# Run specific suites
bun run eval:decomposition    # Task decomposition quality
bun run eval:coordinator      # Coordinator protocol compliance
bun run eval:compaction       # Compaction prompt quality

# Check eval status (progressive gates)
swarm eval status [eval-name]

# View history with trends
swarm eval history
```

**Progressive Gates:**

```
Phase             Runs    Gate Behavior
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Bootstrap         <10     ✅ Always pass (collect data)
Stabilization     10-50   ⚠️  Warn on >10% regression
Production        >50     ❌ Fail on >5% regression
```

**What gets evaluated:**

| Eval Suite            | Measures                                                      | Data Source                                      |
| --------------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| `swarm-decomposition` | Subtask independence, complexity balance, coverage, clarity   | Fixtures + `.opencode/eval-data.jsonl`           |
| `coordinator-session` | Violation count, spawn efficiency, review thoroughness        | `~/.config/swarm-tools/sessions/*.jsonl`         |
| `compaction-prompt`   | ID specificity, actionability, identity, forbidden tools      | Session compaction events                        |

**Learning Feedback Loop:**

When eval scores drop >15% from baseline, failure context is automatically stored to semantic memory. Future prompts query these learnings for context.

**Data capture locations:**
- Decomposition inputs/outputs: `.opencode/eval-data.jsonl`
- Eval history: `.opencode/eval-history.jsonl`
- Coordinator sessions: `~/.config/swarm-tools/sessions/*.jsonl`
- Subtask outcomes: swarm-mail database

See **[evals/README.md](./evals/README.md)** for full architecture, scorer details, CI integration, and how to write new evals.

---

## CLI

```bash
swarm setup     # Install and configure
swarm doctor    # Check dependencies (CASS, UBS, Ollama)
swarm init      # Initialize hive in project
swarm config    # Show config file paths
```

### Logging & Observability

Structured Pino logging with daily rotation:

```bash
# Enable pretty logging during development
SWARM_LOG_PRETTY=1 opencode

# Query logs
swarm log                      # Tail recent logs
swarm log compaction           # Filter by module
swarm log --level warn         # Filter by level (warn+)
swarm log --since 1h           # Last hour
swarm log --json | jq          # Pipe to jq for analysis
```

**Log files:** `~/.config/swarm-tools/logs/`
- `swarm.1log`, `swarm.2log`, ... (main logs)
- `compaction.1log`, ... (module-specific)
- Daily rotation, 14-day retention

---

## Further Reading

- **[Full Docs](https://swarmtools.ai/docs)** - Deep dives, patterns, best practices
- **[swarm-mail Package](../swarm-mail)** - Event sourcing primitives, database layer
- **[AGENTS.md](../../AGENTS.md)** - Monorepo guide, testing strategy, TDD workflow

> *"High-variability sequencing of whole-task problems."*  
> — 4C/ID Instructional Design Model

---

## License

MIT
