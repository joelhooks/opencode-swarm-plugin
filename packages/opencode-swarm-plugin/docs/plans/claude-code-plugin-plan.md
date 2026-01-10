# Claude Code Swarm Plugin - Implementation Plan

**Status**: Draft
**Created**: 2025-01-10
**Goal**: Enable swarm multi-agent coordination in Claude Code via official plugin system

## Overview

Create a Claude Code plugin that exposes swarm functionality through:
- Slash commands for common operations
- Skills for auto-invoked coordination knowledge
- Hooks for session lifecycle
- MCP server for native tool access
- CLI commands for installation/management

## Plugin Structure

```
packages/opencode-swarm-plugin/
├── claude-plugin/                    # Plugin root (bundled with package)
│   ├── .claude-plugin/
│   │   └── plugin.json               # Plugin manifest (ONLY file in .claude-plugin)
│   ├── commands/
│   │   ├── swarm.md                  # /swarm:swarm - decompose & coordinate
│   │   ├── hive.md                   # /swarm:hive - task management
│   │   ├── status.md                 # /swarm:status - check progress
│   │   ├── inbox.md                  # /swarm:inbox - check messages
│   │   └── handoff.md                # /swarm:handoff - end session properly
│   ├── agents/
│   │   ├── coordinator.md            # Coordinator subagent
│   │   └── worker.md                 # Worker subagent template
│   ├── skills/
│   │   └── swarm-coordination/
│   │       └── SKILL.md              # Auto-invoked coordination knowledge
│   ├── hooks/
│   │   └── hooks.json                # SessionStart, UserPromptSubmit hooks
│   ├── .mcp.json                     # MCP server configuration (standard schema)
│   ├── .lsp.json                     # Optional LSP config
│   └── bin/
│       └── swarm-mcp-server.ts       # MCP server entrypoint (inside plugin root)
└── bin/
    └── swarm.ts                      # CLI (outside plugin root)
```

**Plugin root rules (Claude Code docs):**
- `.claude-plugin/` contains **only** `plugin.json`.
- Everything needed at runtime must live **inside** the plugin root.
- Installed plugins are cached, so avoid any `../` references or external paths.

## Phase 1: Plugin Foundation

### 1.1 Plugin Manifest

**File**: `claude-plugin/.claude-plugin/plugin.json`

```json
{
  "name": "swarm",
  "description": "Multi-agent task decomposition and coordination for Claude Code",
  "version": "0.1.0",
  "author": {
    "name": "Joel Hooks"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/joelhooks/opencode-swarm-plugin"
  },
  "keywords": ["multi-agent", "coordination", "tasks", "parallel"],
  "license": "MIT"
}
```

**Note:** `plugin.json` can also embed `mcpServers` instead of a separate `.mcp.json`.

### 1.2 MCP Server Configuration

**File**: `claude-plugin/.mcp.json` **or** `claude-plugin/.claude-plugin/plugin.json`

Claude Code expects the **standard MCP schema**:

```json
{
  "mcpServers": {
    "swarm-tools": {
      "command": "swarm",
      "args": ["mcp-serve"],
      "description": "Swarm multi-agent coordination tools"
    }
  }
}
```

**Option B (embedded entrypoint inside plugin root)**
```json
{
  "mcpServers": {
    "swarm-tools": {
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/bin/swarm-mcp-server.ts"],
      "description": "Swarm multi-agent coordination tools"
    }
  }
}
```

**Decision**: Use the standard schema and keep all paths inside the plugin root. No `../` references.

**Lifecycle note**: Claude Code auto-launches the MCP process from `mcpServers` config. No manual server run is required; `swarm mcp-serve` is debug-only.

### 1.3 Core Skill

**File**: `claude-plugin/skills/swarm-coordination/SKILL.md`

```yaml
---
name: swarm-coordination
description: Multi-agent task decomposition and parallel execution. Use when decomposing large tasks, coordinating parallel work, or managing distributed development across multiple agents.
---
```

Content covers:
- When to use swarm (parallelizable tasks, multi-file changes)
- Coordinator vs Worker patterns
- Tool naming conventions (`mcp__swarm-tools__hive_create`)
- File reservation workflow
- Message passing patterns
- Session handoff requirements

## Phase 2: Slash Commands

### 2.1 Main Swarm Command

**File**: `claude-plugin/commands/swarm.md`

```yaml
---
description: Decompose a task into parallel subtasks and coordinate execution
---
```

Prompts Claude to:
1. Analyze the task for parallelization opportunities
2. Create an epic with subtasks using `hive_create_epic`
3. Initialize swarm mail session
4. Spawn worker agents for each subtask
5. Monitor progress and aggregate results

**Usage**: `/swarm:swarm Add OAuth authentication with Google and GitHub providers`

### 2.2 Hive Command (Task Management)

**File**: `claude-plugin/commands/hive.md`

```yaml
---
description: Query and manage swarm tasks (cells)
---
```

Operations:
- List open/in-progress tasks
- Create new tasks
- Update task status
- Close completed tasks
- Show task hierarchy

**Usage**:
- `/swarm:hive` - show current tasks
- `/swarm:hive create "Fix auth bug"` - create task
- `/swarm:hive close bd-123 "Done"` - close task

### 2.3 Status Command

**File**: `claude-plugin/commands/status.md`

```yaml
---
description: Check swarm coordination status - workers, messages, reservations
---
```

Shows:
- Active epic and subtasks
- Worker status (if coordinator)
- File reservations
- Recent messages
- Overall progress percentage

**Usage**: `/swarm:status`

### 2.4 Inbox Command

**File**: `claude-plugin/commands/inbox.md`

```yaml
---
description: Check swarm mail inbox for messages from other agents
---
```

**Usage**: `/swarm:inbox`

### 2.5 Handoff Command

**File**: `claude-plugin/commands/handoff.md`

```yaml
---
description: Properly end a swarm session - release reservations, sync state, generate continuation prompt
---
```

Does:
1. Release file reservations
2. Update task statuses
3. Sync hive to git
4. Generate handoff prompt for next session

**Usage**: `/swarm:handoff`

## Phase 3: Subagents

### 3.1 Coordinator Agent

**File**: `claude-plugin/agents/coordinator.md`

```yaml
---
name: coordinator
description: Orchestrates parallel task execution across multiple worker agents
model: opus
skills:
  - swarm-coordination
# Avoid `mcp__swarm-tools__*` if we decide to curate tools later.
tools:
  - mcp__swarm-tools__*
  - Task
  - Read
  - Write
  - Edit
  - Bash
---
```

Instructions for:
- Epic creation and decomposition
- Worker spawning strategy
- Progress monitoring
- Result aggregation
- Error handling and retries

### 3.2 Worker Agent

**File**: `claude-plugin/agents/worker.md`

```yaml
---
name: worker
description: Executes a single subtask with file reservation and status reporting
model: sonnet
skills:
  - swarm-coordination
# Background subagents do NOT get MCP access. Keep workers foreground if tools are required.
tools:
  - mcp__swarm-tools__swarmmail_*
  - mcp__swarm-tools__hive_*
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---
```

Instructions for:
- Initialize with subtask context
- Reserve files before editing
- Report progress via swarm mail
- Close task when complete
- Release reservations

**Claude Code subagent constraints:**
- Subagents do **not** inherit skills automatically; list `skills` explicitly.
- Background subagents do **not** get MCP access, so keep tool-using workers in the foreground.

## Phase 4: Hooks

**File**: `claude-plugin/hooks/hooks.json`

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "swarm claude session-start"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "swarm claude user-prompt"
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "swarm claude pre-compact"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "swarm claude session-end"
          }
        ]
      }
    ]
  }
}
```

**Hook stdout behavior (Claude Code docs):**
- Only `SessionStart` and `UserPromptSubmit` hook output is injected into context.
- Use structured JSON: `{ "additionalContext": "..." }` for reliable injection.
- `PreCompact` and `SessionEnd` output is **not** injected (use for side effects only).

### Hook Commands to Implement

```bash
# Called on session start - detect active swarm, output JSON additionalContext
swarm claude session-start

# Called on each prompt submit - refresh swarm context when needed
swarm claude user-prompt

# Called before compaction - preserve swarm state (no context injection)
swarm claude pre-compact

# Called on session end - cleanup reservations (no context injection)
swarm claude session-end
```

## Phase 5: CLI Commands

Add to `bin/swarm.ts`:

### 5.1 Installation Commands

```bash
# Show plugin path (for --plugin-dir during development)
swarm claude path
# Output: /Users/joel/.bun/lib/.../claude-plugin

# Dev-only: symlink for local testing (NOT primary install path)
swarm claude install
# Creates: ~/.claude/plugins/swarm -> /path/to/claude-plugin

# Project-local install for offline usage
swarm claude init
# Creates: .claude/commands/swarm.md, etc. (standalone mode)

# Uninstall dev symlink
swarm claude uninstall
# Removes: ~/.claude/plugins/swarm
```

**Install flow guidance:**
- Primary flow is Claude Code `/plugin` marketplace install or `claude /plugin install <name>`.
- Symlink install is for local development only; installed plugins are cached, so avoid external paths.

### 5.2 MCP Server Command (Debug Only)

```bash
# Debug-only manual run (Claude Code auto-launches via mcpServers)
swarm mcp-serve
# Starts stdio MCP server exposing all swarm tools
```

### 5.3 Hook Helper Commands

```bash
# Session lifecycle helpers (called by hooks)
swarm claude session-start   # Detect swarm, output context
swarm claude pre-compact     # Preserve state for compaction
swarm claude session-end     # Cleanup
```

## Phase 6: MCP Server Implementation

**File**: `claude-plugin/bin/swarm-mcp-server.ts`

```typescript
#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { allTools } from "../dist/index.js";

// Expose all swarm tools via MCP protocol
// Tools available as: mcp__swarm-tools__<tool_name>
```

**Note:** Keep the MCP server entrypoint inside the plugin root and import from bundled output that ships with the plugin.

Key considerations:
- Direct tool execution (no CLI spawn)
- Session ID from environment or generated
- Proper error handling and JSON responses
- Tool schema conversion (Zod -> JSON Schema)

## Implementation Order

### Sprint 1: Foundation
1. [ ] Create `claude-plugin/` directory structure
2. [ ] Write `plugin.json` manifest
3. [ ] Implement `swarm mcp-serve` command
4. [ ] Create `.mcp.json` configuration
5. [ ] Test: `claude --plugin-dir ./claude-plugin` loads successfully

### Sprint 2: Core Skill & Commands
6. [ ] Write `skills/swarm-coordination/SKILL.md`
7. [ ] Write `commands/swarm.md` (main decomposition)
8. [ ] Write `commands/hive.md` (task management)
9. [ ] Write `commands/status.md`
10. [ ] Test: Slash commands work

### Sprint 3: Agents
11. [ ] Write `agents/coordinator.md`
12. [ ] Write `agents/worker.md`
13. [ ] Test: Subagent spawning works

### Sprint 4: Hooks & Lifecycle
14. [ ] Write `hooks/hooks.json`
15. [ ] Implement `swarm claude session-start`
16. [ ] Implement `swarm claude pre-compact`
17. [ ] Implement `swarm claude session-end`
18. [ ] Test: Hooks fire correctly

### Sprint 5: CLI Integration
19. [ ] Implement `swarm claude path`
20. [ ] Implement `swarm claude install`
21. [ ] Implement `swarm claude uninstall`
22. [ ] Implement `swarm claude init` (standalone mode)
23. [ ] Update `swarm setup` to offer Claude Code option
24. [ ] Test: Full installation flow

### Sprint 6: Polish
25. [ ] Write commands/inbox.md
26. [ ] Write commands/handoff.md
27. [ ] Add to swarm doctor (Claude Code checks)
28. [ ] Documentation in README
29. [ ] Test: End-to-end swarm coordination in Claude Code

## Dependency: swarm-mail Package

The Claude Code plugin depends on `swarm-mail` - a separate package in this monorepo that provides the core coordination engine.

### What swarm-mail Provides

```
swarm-mail (packages/swarm-mail/)
├── Event Store       - Append-only log with 30+ event types
├── Projections       - Materialized views (agents, messages, reservations)
├── Hive Adapter      - Git-synced work items (cells, epics)
├── Semantic Memory   - Vector embeddings (Ollama + libSQL vec)
├── Session Indexing  - Cross-agent conversation search
└── Storage           - libSQL (embedded SQLite via Drizzle ORM)
```

### Storage Location

```
~/.config/swarm-tools/libsql/<project-hash>/swarm.db
```

Each project gets isolated storage keyed by path hash.

### Dependency Chain

```
Claude Code Plugin
└── opencode-swarm-plugin (allTools)
    ├── hiveTools        → swarm-mail/HiveAdapter
    ├── swarmMailTools   → swarm-mail/getSwarmMailLibSQL
    ├── hivemindTools    → swarm-mail/SemanticMemory
    └── swarmTools       → swarm-mail/events
```

The MCP server doesn't need to call CLI - it imports `allTools` which already wraps swarm-mail.

### Implications for Claude Code Plugin

1. **No external servers**: swarm-mail is local-first (embedded libSQL), so the MCP server is self-contained

2. **Ollama optional**: Semantic memory features (hivemind_*) need Ollama for embeddings, but gracefully degrade to FTS5 search

3. **Git sync for Hive**: Cells stored in `.hive/` directory, synced via git - works across Claude Code sessions

4. **Session ID mapping**: swarm-mail tracks sessions - Claude Code needs consistent session ID for state continuity

### Plugin Installation Must Handle

```bash
swarm claude install
# Should:
# 1. Ensure swarm-mail database initialized
# 2. Create ~/.config/swarm-tools/ if needed
# 3. Verify libSQL works on user's platform
# 4. Optionally check Ollama availability
```

### Tool Categories from swarm-mail

| Category | Tools | swarm-mail API |
|----------|-------|----------------|
| Hive (tasks) | hive_create, hive_query, hive_ready, hive_close | HiveAdapter |
| Swarm Mail | swarmmail_init, swarmmail_send, swarmmail_reserve | getSwarmMailLibSQL |
| Semantic Memory | hivemind_store, hivemind_find | createSemanticMemory |
| Session Search | cass_search, cass_index | ChunkProcessor, SessionParser |

---

## Resolved Decisions (Claude Code Docs)

1. **Plugin root layout**: `.claude-plugin/` contains only `plugin.json`; all other files live at plugin root.
2. **No external paths**: installed plugins are cached, so avoid `../` references or paths outside plugin root.
3. **Path variable**: use `${CLAUDE_PLUGIN_ROOT}` for any absolute plugin paths.
4. **MCP schema**: `.mcp.json` uses top-level `mcpServers` (or embed in `plugin.json`).
5. **Hook output**: only `SessionStart` and `UserPromptSubmit` inject stdout; use JSON `{ "additionalContext": "..." }`.
6. **Subagents**: skills must be explicitly listed; background subagents do not have MCP access.
7. **Install flow**: `/plugin` marketplace is primary; symlink install is dev-only.

## Open Questions

1. **MCP Server Process**: Standard schema is set, but do we prefer:
   - A standalone `swarm mcp-serve` command?
   - An embedded entrypoint under `claude-plugin/bin/`?
   - If Claude Code manages lifecycle, do we need any health checks?

2. **Tool Filtering + Wildcard Risk**: `mcp__swarm-tools__*` grants all tools.
   - Risk: accidental access to destructive or internal tools
   - Decision: expose all vs curated subset (safe-by-default)

3. **Session ID**: How to maintain session identity across:
   - Multiple Claude Code sessions
   - Coordinator spawning workers
   - Context compaction

4. **Worker Spawning**: Coordinators use foreground subagents for MCP tools.
   - How do we enforce/guide this in the prompt templates?
   - Do we need separate entrypoints for background-only workers?

## Mitigations for Unknowns

- **Tool wildcard risk**: Default to a curated allowlist in agent configs; provide an opt-in `mcp__swarm-tools__*` mode for power users; document any destructive tools explicitly.
- **Session ID continuity**: Prefer Claude Code session ID if provided; otherwise persist a stable session ID in swarm-mail per project and rehydrate via hooks.
- **MCP lifecycle**: Rely on Claude Code auto-launch from `mcpServers` (no manual run); add a lightweight tool health check for diagnostics; ensure tool handlers are idempotent on restart.
- **Hook injection limits**: Only `SessionStart` + `UserPromptSubmit` inject context; always emit JSON `{ "additionalContext": "..." }` and keep payloads small; treat `PreCompact`/`SessionEnd` as side-effect-only.
- **Subagent MCP access**: Keep tool-using workers in the foreground; add a separate background worker template that avoids MCP tools; make coordinator prompts enforce the correct worker type.

## Testing Strategy

### Unit Tests
- MCP server tool registration
- Hook command output
- CLI command behavior

### Integration Tests
- Plugin loads in Claude Code
- Slash commands execute tools
- Hooks fire at correct lifecycle points

### E2E Tests
- Full swarm decomposition flow
- Coordinator spawns workers
- Workers complete and report back
- State survives compaction

## Success Criteria

1. `claude --plugin-dir $(swarm claude path)` loads without errors
2. `/swarm:swarm "task"` decomposes into parallel subtasks
3. `/swarm:status` shows accurate swarm state
4. `/swarm:hive` manages tasks correctly
5. Session compaction preserves swarm context
6. `swarm claude install` enables auto-loading on Claude Code start
