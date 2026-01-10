---
name: swarm-coordination
description: Multi-agent coordination patterns for OpenCode swarm workflows. Use when work benefits from parallelization or coordination.
tags:
  - swarm
  - multi-agent
  - coordination
tools:
  - "*"
related_skills:
  - testing-patterns
  - system-design
  - cli-builder
---

# Swarm Coordination

This skill guides multi-agent coordination for OpenCode swarm workflows.

## When to Use

- Tasks touching 3+ files
- Parallelizable work (frontend/backend/tests)
- Work requiring specialized agents
- Time-to-completion matters

Avoid swarming for 1–2 file changes or tightly sequential work.

## Tool Access (Wildcard)

This skill is configured with `tools: ["*"]` per user choice. If you need curated access later, replace the wildcard with explicit tool lists.

## Foreground vs Background

- **Foreground agents** can access MCP tools.
- **Background agents** do **not** have MCP tools.
- Use foreground workers for `swarmmail_*`, `swarm_*`, `hive_*`, and MCP calls.
- Use background workers for doc edits and static work only.

## MCP Lifecycle Mitigation

Claude Code auto-launches MCP servers from `mcpServers` configuration. Do **not** require manual `swarm mcp-serve` except for debugging.

## Coordinator Protocol (High-Level)

1. Initialize Swarm Mail (`swarmmail_init`).
2. Query past learnings (`hivemind_find`).
3. Decompose (`swarm_plan_prompt` + `swarm_validate_decomposition`).
4. Spawn workers with explicit file lists.
5. Review worker output (`swarm_review` + `swarm_review_feedback`).
6. Record outcomes (`swarm_complete`).

## Worker Protocol (High-Level)

1. Initialize Swarm Mail (`swarmmail_init`).
2. Reserve files (`swarmmail_reserve`).
3. Work within scope and report progress.
4. Complete with `swarm_complete`.

## File Reservations

Workers must reserve files **before** editing and release via `swarm_complete`.
Coordinators never reserve files.

## Progress Reporting

Use `swarm_progress` at 25%, 50%, and 75% completion to trigger auto-checkpoints.

## Skill Loading Guidance

Workers should load skills based on task type:

- Tests or fixes → `testing-patterns`
- Architecture → `system-design`
- CLI work → `cli-builder`
- Coordination → `swarm-coordination`
