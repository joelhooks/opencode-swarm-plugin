---
name: swarm-coordination
description: Multi-agent coordination patterns for OpenCode swarm workflows. Use when working on complex tasks that benefit from parallelization, when coordinating multiple agents, or when managing task decomposition. Do NOT use for simple single-agent tasks.
tags:
  - swarm
  - multi-agent
  - coordination
tools:
  - swarm_plan_prompt
  - swarm_decompose
  - swarm_validate_decomposition
  - swarm_spawn_subtask
  - swarm_complete
  - swarm_status
  - swarm_progress
  - beads_create_epic
  - beads_query
  - swarmmail_init
  - swarmmail_send
  - swarmmail_inbox
  - swarmmail_read_message
  - swarmmail_reserve
  - swarmmail_release
  - swarmmail_health
  - semantic-memory_find
  - cass_search
  - pdf-brain_search
  - skills_list
references:
  - references/strategies.md
  - references/coordinator-patterns.md
---

# Swarm Coordination

Multi-agent orchestration for parallel task execution. The coordinator breaks work into subtasks, spawns worker agents, monitors progress, and aggregates results.

## MANDATORY: Swarm Mail

**ALL coordination MUST use `swarmmail_*` tools.** This is non-negotiable.

Swarm Mail is embedded (no external server needed) and provides:

- File reservations to prevent conflicts
- Message passing between agents
- Thread-based coordination tied to beads

## When to Swarm

**DO swarm when:**

- Task touches 3+ files
- Natural parallel boundaries exist (frontend/backend/tests)
- Different specializations needed
- Time-to-completion matters

**DON'T swarm when:**

- Task is 1-2 files
- Heavy sequential dependencies
- Coordination overhead > benefit
- Tight feedback loop needed

**Heuristic:** If you can describe the task in one sentence without "and", don't swarm.

## Task Clarity Check (BEFORE Decomposing)

**Before decomposing, ask: Is this task clear enough to parallelize?**

### Vague Task Signals (ASK QUESTIONS FIRST)

| Signal                   | Example                        | Problem                          |
| ------------------------ | ------------------------------ | -------------------------------- |
| No files mentioned       | "improve performance"          | Where? Which files?              |
| Vague verbs              | "fix", "update", "make better" | What specifically?               |
| Large undefined scope    | "refactor the codebase"        | Which parts? What pattern?       |
| Missing success criteria | "add auth"                     | OAuth? JWT? Session? What flows? |
| Ambiguous boundaries     | "handle errors"                | Which errors? Where? How?        |

### How to Clarify

```markdown
The task "<task>" needs clarification before I can decompose it.

**Question:** [Specific question about scope/files/approach]

Options:
a) [Option A] - [trade-off]
b) [Option B] - [trade-off]
c) [Option C] - [trade-off]

I'd recommend (a) because [reason]. Which approach?
```

**Rules:**

- ONE question at a time (don't overwhelm)
- Offer 2-3 concrete options when possible
- Lead with your recommendation and why
- Wait for answer before asking next question

### Clear Task Signals (PROCEED to decompose)

| Signal             | Example                        | Why it's clear   |
| ------------------ | ------------------------------ | ---------------- |
| Specific files     | "update src/auth/\*.ts"        | Scope defined    |
| Concrete verbs     | "migrate from X to Y"          | Action defined   |
| Defined scope      | "the payment module"           | Boundaries clear |
| Measurable outcome | "tests pass", "no type errors" | Success criteria |

**When in doubt, ask.** A 30-second clarification beats a 30-minute wrong decomposition.

## Coordinator Workflow

### Phase 1: Initialize Swarm Mail (FIRST)

```typescript
// ALWAYS initialize first - registers you as coordinator
await swarmmail_init({
  project_path: "$PWD",
  task_description: "Swarm: <task summary>",
});
```

### Phase 2: Knowledge Gathering (MANDATORY)

Before decomposing, query ALL knowledge sources:

```typescript
// 1. Past learnings from this project
semantic_memory_find({ query: "<task keywords>", limit: 5 });

// 2. How similar tasks were solved before
cass_search({ query: "<task description>", limit: 5 });

// 3. Design patterns and prior art
pdf_brain_search({ query: "<domain concepts>", limit: 5 });

// 4. Available skills to inject into workers
skills_list();
```

Synthesize findings into `shared_context` for workers.

### Phase 3: Decomposition (DELEGATE TO SUBAGENT)

> **⚠️ CRITICAL: Context Preservation Pattern**
>
> **NEVER do planning inline in the coordinator thread.** Decomposition work (file reading, CASS searching, reasoning about task breakdown) consumes massive amounts of context and will exhaust your token budget on long swarms.
>
> **ALWAYS delegate planning to a `swarm/planner` subagent** and receive only the structured BeadTree JSON result back.

**❌ Anti-Pattern (Context-Heavy):**

```typescript
// DON'T DO THIS - pollutes main thread context
const plan = await swarm_plan_prompt({ task, ... });
// ... agent reasons about decomposition inline ...
// ... context fills with file contents, analysis ...
const validation = await swarm_validate_decomposition({ ... });
```

**✅ Correct Pattern (Context-Lean):**

```typescript
// 1. Create planning bead with full context
await beads_create({
  title: `Plan: ${taskTitle}`,
  type: "task",
  description: `Decompose into subtasks. Context: ${synthesizedContext}`,
});

// 2. Delegate to swarm/planner subagent
const planningResult = await Task({
  subagent_type: "swarm/planner",
  description: `Decompose task: ${taskTitle}`,
  prompt: `
You are a swarm planner. Generate a BeadTree for this task.

## Task
${taskDescription}

## Synthesized Context
${synthesizedContext}

## Instructions
1. Use swarm_plan_prompt(task="...", max_subtasks=5, query_cass=true)
2. Reason about decomposition strategy
3. Generate BeadTree JSON
4. Validate with swarm_validate_decomposition
5. Return ONLY the validated BeadTree JSON (no analysis, no file contents)

Output format: Valid BeadTree JSON only.
  `,
});

// 3. Parse result (subagent already validated)
const beadTree = JSON.parse(planningResult);

// 4. Create epic + subtasks atomically
await beads_create_epic({
  epic_title: beadTree.epic.title,
  epic_description: beadTree.epic.description,
  subtasks: beadTree.subtasks,
});
```

**Why This Matters:**

- **Main thread context stays clean** - only receives final JSON, not reasoning
- **Subagent context is disposable** - gets garbage collected after planning
- **Scales to long swarms** - coordinator can manage 10+ workers without exhaustion
- **Faster coordination** - less context = faster responses when monitoring workers

### Phase 4: Reserve Files (via Swarm Mail)

```typescript
// Reserve files for each subtask BEFORE spawning workers
await swarmmail_reserve({
  paths: ["src/auth/**"],
  reason: "bd-123: Auth service implementation",
  ttl_seconds: 3600,
  exclusive: true,
});
```

**Rules:**

- No file overlap between subtasks
- Coordinator mediates conflicts
- `swarm_complete` auto-releases

### Phase 5: Spawn Workers

```typescript
for (const subtask of subtasks) {
  const prompt = await swarm_spawn_subtask({
    bead_id: subtask.id,
    epic_id: epic.id,
    subtask_title: subtask.title,
    subtask_description: subtask.description,
    files: subtask.files,
    shared_context: synthesizedContext,
  });

  // Spawn via Task tool
  Task({
    subagent_type: "swarm/worker",
    prompt: prompt.worker_prompt,
  });
}
```

### Phase 6: Monitor & Intervene

```typescript
// Check progress
const status = await swarm_status({ epic_id, project_key });

// Check for messages from workers
const inbox = await swarmmail_inbox({ limit: 5 });

// Read specific message if needed
const message = await swarmmail_read_message({ message_id: N });

// Intervene if needed (see Intervention Patterns)
```

### Phase 7: Aggregate & Complete

- Verify all subtasks completed
- Run final verification (typecheck, tests)
- Close epic with summary
- Release any remaining reservations
- Record outcomes for learning

```typescript
await swarm_complete({
  project_key: "$PWD",
  agent_name: "coordinator",
  bead_id: epic_id,
  summary: "All subtasks complete",
  files_touched: [...],
});
await swarmmail_release(); // Release any remaining reservations
await beads_sync();
```

## Decomposition Strategies

Four strategies, auto-selected by task keywords:

| Strategy           | Best For                      | Keywords                              |
| ------------------ | ----------------------------- | ------------------------------------- |
| **file-based**     | Refactoring, migrations       | refactor, migrate, rename, update all |
| **feature-based**  | New features, vertical slices | add, implement, build, create         |
| **risk-based**     | Bug fixes, security           | fix, bug, security, critical          |
| **research-based** | Investigation, discovery      | research, investigate, explore        |

See `references/strategies.md` for full details.

## Communication Protocol

Workers communicate via Swarm Mail with epic ID as thread:

```typescript
// Progress update
swarmmail_send({
  to: ["coordinator"],
  subject: "Auth API complete",
  body: "Endpoints ready at /api/auth/*",
  thread_id: epic_id,
});

// Blocker
swarmmail_send({
  to: ["coordinator"],
  subject: "BLOCKED: Need DB schema",
  body: "Can't proceed without users table",
  thread_id: epic_id,
  importance: "urgent",
});
```

**Coordinator checks inbox regularly** - don't let workers spin.

## Intervention Patterns

| Signal                  | Action                               |
| ----------------------- | ------------------------------------ |
| Worker blocked >5 min   | Check inbox, offer guidance          |
| File conflict           | Mediate, reassign files              |
| Worker asking questions | Answer directly                      |
| Scope creep             | Redirect, create new bead for extras |
| Repeated failures       | Take over or reassign                |

## Failure Recovery

### Incompatible Outputs

Two workers produce conflicting results.

**Fix:** Pick one approach, re-run other with constraint.

### Worker Drift

Worker implements something different than asked.

**Fix:** Revert, re-run with explicit instructions.

### Cascade Failure

One blocker affects multiple subtasks.

**Fix:** Unblock manually, reassign dependent work, accept partial completion.

## Anti-Patterns

| Anti-Pattern                | Symptom                                    | Fix                                  |
| --------------------------- | ------------------------------------------ | ------------------------------------ |
| **Decomposing Vague Tasks** | Wrong subtasks, wasted agent cycles        | Ask clarifying questions FIRST       |
| **Mega-Coordinator**        | Coordinator editing files                  | Coordinator only orchestrates        |
| **Silent Swarm**            | No communication, late conflicts           | Require updates, check inbox         |
| **Over-Decomposed**         | 10 subtasks for 20 lines                   | 2-5 subtasks max                     |
| **Under-Specified**         | "Implement backend"                        | Clear goal, files, criteria          |
| **Inline Planning** ⚠️      | Context pollution, exhaustion on long runs | Delegate planning to subagent        |
| **Heavy File Reading**      | Coordinator reading 10+ files              | Subagent reads, returns summary only |
| **Deep CASS Drilling**      | Multiple cass_search calls inline          | Subagent searches, summarizes        |
| **Manual Decomposition**    | Hand-crafting subtasks without validation  | Use swarm_plan_prompt + validation   |

## Shared Context Template

```markdown
## Project Context

- Repository: {repo}
- Stack: {tech stack}
- Patterns: {from pdf-brain}

## Task Context

- Epic: {title}
- Goal: {success criteria}
- Constraints: {scope, time}

## Prior Art

- Similar tasks: {from CASS}
- Learnings: {from semantic-memory}

## Coordination

- Active subtasks: {list}
- Reserved files: {list}
- Thread: {epic_id}
```

## Swarm Mail Quick Reference

| Tool                     | Purpose                             |
| ------------------------ | ----------------------------------- |
| `swarmmail_init`         | Initialize session (REQUIRED FIRST) |
| `swarmmail_send`         | Send message to agents              |
| `swarmmail_inbox`        | Check inbox (max 5, no bodies)      |
| `swarmmail_read_message` | Read specific message body          |
| `swarmmail_reserve`      | Reserve files for exclusive editing |
| `swarmmail_release`      | Release file reservations           |
| `swarmmail_ack`          | Acknowledge message                 |
| `swarmmail_health`       | Check database health               |

## Full Swarm Flow

```typescript
// 1. Initialize Swarm Mail FIRST
swarmmail_init({ project_path: "$PWD", task_description: "..." });

// 2. Gather knowledge
semantic_memory_find({ query });
cass_search({ query });
pdf_brain_search({ query });
skills_list();

// 3. Decompose
swarm_plan_prompt({ task });
swarm_validate_decomposition();
beads_create_epic();

// 4. Reserve files
swarmmail_reserve({ paths, reason, ttl_seconds });

// 5. Spawn workers (loop)
swarm_spawn_subtask();

// 6. Monitor
swarm_status();
swarmmail_inbox();
swarmmail_read_message({ message_id });

// 7. Complete
swarm_complete();
swarmmail_release();
beads_sync();
```

See `references/coordinator-patterns.md` for detailed patterns.

## ASCII Art, Whimsy & Diagrams (MANDATORY)

**We fucking LOVE visual flair.** Every swarm session should include:

### Session Summaries

When completing a swarm, output a beautiful summary with:

- ASCII art banner (figlet-style or custom)
- Box-drawing characters for structure
- Architecture diagrams showing what was built
- Stats (files modified, subtasks completed, etc.)
- A memorable quote or cow saying "ship it"

### During Coordination

- Use tables for status updates
- Draw dependency trees with box characters
- Show progress with visual indicators

### Examples

**Session Complete Banner:**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃         🐝 SWARM COMPLETE 🐝                 ┃
┃                                              ┃
┃   Epic: Add Authentication                   ┃
┃   Subtasks: 4/4 ✓                            ┃
┃   Files: 12 modified                         ┃
┃                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

**Architecture Diagram:**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   INPUT     │────▶│  PROCESS    │────▶│   OUTPUT    │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Dependency Tree:**

```
epic-123
├── epic-123.1 ✓ Auth service
├── epic-123.2 ✓ Database schema
├── epic-123.3 ◐ API routes (in progress)
└── epic-123.4 ○ Tests (pending)
```

**Ship It:**

```
    \   ^__^
     \  (oo)\_______
        (__)\       )\/\
            ||----w |
            ||     ||

    moo. ship it.
```

**This is not optional.** PRs get shared on Twitter. Session summaries get screenshot. Make them memorable. Make them beautiful. Make them fun.

Box-drawing characters: `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ━ ┃ ┏ ┓ ┗ ┛`
Progress indicators: `✓ ✗ ◐ ○ ● ▶ ▷ ★ ☆ 🐝`
