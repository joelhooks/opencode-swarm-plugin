# opencode-swarm-plugin

[![npm version](https://img.shields.io/npm/v/opencode-swarm-plugin.svg)](https://www.npmjs.com/package/opencode-swarm-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Multi-agent swarm coordination for [OpenCode](https://opencode.ai) with learning capabilities, beads integration, and Agent Mail.

## What It Does

Break complex tasks into parallel subtasks, spawn agents to work on them, and coordinate via messaging. The plugin learns from outcomes to improve future decompositions.

- **Swarm coordination** - Decompose tasks, spawn parallel agents, track progress
- **Beads integration** - Git-backed issue tracking with type-safe wrappers
- **Agent Mail** - File reservations, async messaging between agents
- **Learning** - Tracks what works, avoids patterns that fail
- **Graceful degradation** - Works with whatever tools are available

## Quick Start

```bash
# 1. Install the plugin globally
npm install -g opencode-swarm-plugin

# 2. Run interactive setup
swarm setup
```

The setup wizard will:

- Check for required dependencies (OpenCode, Beads)
- Offer to install missing dependencies
- Let you select optional dependencies (Agent Mail, Redis, etc.)
- Create the plugin wrapper, /swarm command, and @swarm-planner agent

Then initialize your project:

```bash
cd your-project
swarm init
```

That's it! Now use `/swarm "your task"` in OpenCode.

## CLI Commands

```
swarm setup    Interactive installer - checks and installs dependencies
swarm doctor   Health check - shows status of all dependencies
swarm init     Initialize beads in current project
swarm version  Show version
swarm help     Show this help
```

### swarm setup

Interactive installer that guides you through the complete setup:

```
┌  opencode-swarm-plugin v0.9.0
│
◇  Checking dependencies...
│
◆  OpenCode
◆  Beads
◆  Go
▲  Agent Mail (optional)
▲  Redis (optional)
│
◆  Install optional dependencies?
│  ◻ Agent Mail - Multi-agent coordination
│  ◻ Redis - Rate limiting
│
◇  Setting up OpenCode integration...
│
◆  Plugin: ~/.config/opencode/plugins/swarm.ts
◆  Command: ~/.config/opencode/commands/swarm.md
◆  Agent: ~/.config/opencode/agents/swarm-planner.md
│
└  Setup complete!
```

### swarm doctor

Check the health of all dependencies:

```
┌  swarm doctor v0.9.0
│
◇  Required dependencies:
│
◆  OpenCode v1.0.134
◆  Beads v0.29.0
│
◇  Optional dependencies:
│
◆  Go v1.25.2 - Required for Agent Mail
▲  Agent Mail - not found
◆  Redis - Rate limiting
│
└  All required dependencies installed. 1 optional missing.
```

### swarm init

Initialize beads in your project with an interactive wizard:

```
┌  swarm init v0.9.0
│
◇  Initializing beads...
◆  Created .beads/ directory
│
◆  Create your first bead?
│  ● Yes / ○ No
│
◇  Bead title: Implement user authentication
◇  Type: Feature
│
└  Project initialized!
```

## Usage

```bash
# In OpenCode, run:
/swarm "Add user authentication with OAuth"

# Or invoke the planner directly:
@swarm-planner "Refactor all components to use hooks"
```

## Dependencies

| Dependency                                                      | Purpose                               | Install                                                                                         | Required |
| --------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| [OpenCode](https://opencode.ai)                                 | Plugin host                           | `brew install sst/tap/opencode`                                                                 | Yes      |
| [Beads](https://github.com/steveyegge/beads)                    | Git-backed issue tracking             | `curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh \| bash` | Yes      |
| [Agent Mail](https://github.com/joelhooks/agent-mail)           | Multi-agent coordination              | `go install github.com/joelhooks/agent-mail/cmd/agent-mail@latest`                              | No\*     |
| [CASS](https://github.com/Dicklesworthstone/cass)               | Historical context from past sessions | See repo                                                                                        | No\*     |
| [UBS](https://github.com/joelhooks/ubs)                         | Pre-completion bug scanning           | See repo                                                                                        | No\*     |
| [semantic-memory](https://github.com/joelhooks/semantic-memory) | Learning persistence                  | `npm install -g semantic-memory`                                                                | No\*     |
| [Redis](https://redis.io)                                       | Rate limiting                         | `brew install redis`                                                                            | No\*     |

\*The plugin gracefully degrades without optional dependencies.

> **Tip**: Use [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for a web UI to visualize your beads.

### Verify Installation

```bash
swarm doctor
```

This checks all dependencies and shows install commands for anything missing.

## Tools Reference

### Swarm Tools

| Tool                           | Description                                                         |
| ------------------------------ | ------------------------------------------------------------------- |
| `swarm_select_strategy`        | Analyze task and recommend decomposition strategy                   |
| `swarm_plan_prompt`            | Generate strategy-specific planning prompt with CASS integration    |
| `swarm_decompose`              | Generate decomposition prompt (lower-level than plan_prompt)        |
| `swarm_validate_decomposition` | Validate decomposition response, detect conflicts                   |
| `swarm_spawn_subtask`          | Generate prompt for worker agent with Agent Mail/beads instructions |
| `swarm_complete`               | Mark subtask complete, run UBS scan, release reservations           |
| `swarm_status`                 | Get swarm status by epic ID                                         |
| `swarm_progress`               | Report progress on a subtask                                        |
| `swarm_record_outcome`         | Record outcome for learning (duration, errors, retries)             |

### Beads Tools

| Tool                | Description                                 |
| ------------------- | ------------------------------------------- |
| `beads_create`      | Create a new bead with type-safe validation |
| `beads_create_epic` | Create epic with subtasks atomically        |
| `beads_query`       | Query beads with filters                    |
| `beads_update`      | Update bead status/description/priority     |
| `beads_close`       | Close a bead with reason                    |
| `beads_start`       | Mark bead as in-progress                    |
| `beads_ready`       | Get next unblocked bead                     |
| `beads_sync`        | Sync beads to git and push                  |

### Agent Mail Tools

| Tool                         | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `agentmail_init`             | Initialize session, register agent             |
| `agentmail_send`             | Send message to other agents                   |
| `agentmail_inbox`            | Fetch inbox (max 5, no bodies - context safe)  |
| `agentmail_read_message`     | Fetch ONE message body by ID                   |
| `agentmail_summarize_thread` | Summarize thread (preferred over fetching all) |
| `agentmail_reserve`          | Reserve file paths for exclusive editing       |
| `agentmail_release`          | Release file reservations                      |

### Structured Output Tools

| Tool                         | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `structured_extract_json`    | Extract JSON from markdown/text                |
| `structured_validate`        | Validate response against schema               |
| `structured_parse_bead_tree` | Parse and validate bead tree for epic creation |

## Decomposition Strategies

### File-Based

Best for refactoring, migrations, pattern changes.

- Group files by directory or type
- Handle shared types/utilities first
- Minimize cross-directory dependencies

### Feature-Based

Best for new features, adding functionality.

- Each subtask is a complete vertical slice
- Start with data layer, then logic, then UI
- Keep related components together

### Risk-Based

Best for bug fixes, security issues.

- Write tests FIRST
- Isolate risky changes
- Audit similar code for same issue

## Learning

The plugin learns from outcomes:

- **Confidence decay** - Criteria weights fade unless revalidated (90-day half-life)
- **Implicit feedback** - Fast + success = helpful, slow + errors = harmful
- **Pattern maturity** - candidate → established → proven (or deprecated)
- **Anti-patterns** - Patterns with >60% failure rate auto-invert

## Context Preservation

The plugin enforces context-safe defaults:

| Constraint          | Default    | Reason                         |
| ------------------- | ---------- | ------------------------------ |
| Inbox limit         | 5 messages | Prevents context exhaustion    |
| Bodies excluded     | Always     | Fetch individually when needed |
| Summarize preferred | Yes        | Key points, not raw dump       |

## Rate Limiting

Client-side rate limits (Redis primary, SQLite fallback):

| Endpoint | Per Minute | Per Hour |
| -------- | ---------- | -------- |
| send     | 20         | 200      |
| reserve  | 10         | 100      |
| inbox    | 60         | 600      |

Configure via `OPENCODE_RATE_LIMIT_{ENDPOINT}_PER_MIN` env vars.

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT
