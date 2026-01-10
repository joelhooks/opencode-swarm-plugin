---
description: Decompose a task into parallel subtasks and coordinate execution
---

# /swarm:swarm

Use this command to kick off a multi-agent swarm.

If no task is provided, ask the user for the task description before proceeding.

## Workflow
1. Clarify scope and success criteria if needed.
2. `swarmmail_init()` to register the session.
3. `swarm_decompose()` → `swarm_validate_decomposition()` for a safe plan.
4. `hive_create_epic()` to create the epic + subtasks.
5. `swarm_spawn_subtask()` for each subtask (workers reserve files).
6. Monitor with `swarm_status()` and `swarmmail_inbox()`.
7. Review workers with `swarm_review()` + `swarm_review_feedback()`.

## Usage
`/swarm:swarm Add OAuth authentication with Google and GitHub`
