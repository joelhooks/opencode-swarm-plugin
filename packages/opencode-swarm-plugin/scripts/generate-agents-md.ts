#!/usr/bin/env bun
/**
 * AGENTS.md generator script
 * 
 * Ensures the monorepo AGENTS.md documents hivemind tools (ADR-011)
 * instead of deprecated semantic-memory and cass tools.
 * 
 * Usage: bun run scripts/generate-agents-md.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../..");
const AGENTS_MD_PATH = join(REPO_ROOT, "AGENTS.md");

/**
 * Hivemind section content (from ADR-011)
 */
const HIVEMIND_SECTION = `## Hivemind - Unified Memory System

The hive remembers everything. Learnings, sessions, patterns—all searchable.

**Unified storage:** Manual learnings and AI agent session histories stored in the same database, searchable together. Powered by libSQL vectors + Ollama embeddings.

**Inspired by [CASS (coding_agent_session_search)](https://github.com/Dicklesworthstone/coding_agent_session_search) by Dicklesworthstone** - sessions + semantic memory unified under one API.

**Indexed agents:** Claude Code, Codex, Cursor, Gemini, Aider, ChatGPT, Cline, OpenCode, Amp, Pi-Agent

### When to Use

- **BEFORE implementing** - check if you or any agent solved it before
- **After solving hard problems** - store learnings for future sessions
- **Debugging** - search past sessions for similar errors
- **Architecture decisions** - record reasoning, alternatives, tradeoffs
- **Project-specific patterns** - capture domain rules and gotchas

### Tools

| Tool | Purpose |
|------|---------|
| \`hivemind_store\` | Store a memory (learnings, decisions, patterns) |
| \`hivemind_find\` | Search all memories (learnings + sessions, semantic + FTS fallback) |
| \`hivemind_get\` | Get specific memory by ID |
| \`hivemind_remove\` | Delete outdated/incorrect memory |
| \`hivemind_validate\` | Confirm memory still accurate (resets 90-day decay timer) |
| \`hivemind_stats\` | Memory statistics and health check |
| \`hivemind_index\` | Index AI session directories |
| \`hivemind_sync\` | Sync to .hive/memories.jsonl (git-backed, team-shared) |

### Usage

**Store a learning** (include WHY, not just WHAT):

\`\`\`typescript
hivemind_store({
  information: "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions. Without buffer, token refresh can fail mid-request if expiry happens between check and use.",
  tags: "auth,oauth,tokens,race-conditions"
})
\`\`\`

**Search all memories** (learnings + sessions):

\`\`\`typescript
// Search everything
hivemind_find({ query: "token refresh", limit: 5 })

// Search only learnings (manual entries)
hivemind_find({ query: "authentication", collection: "default" })

// Search only Claude sessions
hivemind_find({ query: "Next.js caching", collection: "claude" })

// Search only Cursor sessions
hivemind_find({ query: "API design", collection: "cursor" })
\`\`\`

**Get specific memory**:

\`\`\`typescript
hivemind_get({ id: "mem_xyz123" })
\`\`\`

**Delete outdated memory**:

\`\`\`typescript
hivemind_remove({ id: "mem_old456" })
\`\`\`

**Validate memory is still accurate** (resets decay):

\`\`\`typescript
// Confirmed this memory is still relevant
hivemind_validate({ id: "mem_xyz123" })
\`\`\`

**Index new sessions**:

\`\`\`typescript
// Automatically indexes ~/.config/opencode/sessions, ~/.cursor-tutor, etc.
hivemind_index()
\`\`\`

**Sync to git**:

\`\`\`typescript
// Writes learnings to .hive/memories.jsonl for git sync
hivemind_sync()
\`\`\`

**Check stats**:

\`\`\`typescript
hivemind_stats()
\`\`\`

### Usage Pattern

\`\`\`bash
# 1. Before starting work - query for relevant learnings
hivemind_find({ query: "<task keywords>", limit: 5 })

# 2. Do the work...

# 3. After solving hard problem - store learning
hivemind_store({
  information: "<what you learned, WHY it matters>",
  tags: "<relevant,tags>"
})

# 4. Validate memories when you confirm they're still accurate
hivemind_validate({ id: "<memory-id>" })
\`\`\`

### Integration with Workflow

**At task start** (query BEFORE implementing):

\`\`\`bash
# Check if you or any agent solved similar problems
hivemind_find({ query: "OAuth token refresh buffer", limit: 5 })
\`\`\`

**During debugging** (search past sessions):

\`\`\`bash
# Find similar errors from past sessions
hivemind_find({ query: "cannot read property of undefined", collection: "claude" })
\`\`\`

**After solving problems** (store learnings):

\`\`\`bash
# Store root cause + solution, not just "fixed it"
hivemind_store({
  information: "Next.js searchParams causes dynamic rendering. Workaround: destructure in parent, pass as props to cached child.",
  tags: "nextjs,cache-components,dynamic-rendering,searchparams"
})
\`\`\`

**Learning from other agents**:

\`\`\`bash
# See how Cursor handled similar feature
hivemind_find({ query: "implement authentication", collection: "cursor" })
\`\`\`

**Pro tip:** Query Hivemind at the START of complex tasks. Past solutions (yours or other agents') save time and prevent reinventing wheels.`;

/**
 * Replace CASS section with Hivemind section in AGENTS.md
 * Idempotent: safe to run multiple times
 */
function updateAgentsMd(): void {
	const content = readFileSync(AGENTS_MD_PATH, "utf-8");

	// Check if already migrated
	if (content.includes("## Hivemind - Unified Memory System")) {
		console.log("✅ AGENTS.md already has Hivemind section (up to date)");
		return;
	}

	// Find CASS section (starts with ## CASS, ends before ## OpenCode Commands)
	const cassRegex =
		/## CASS - Cross-Agent Session Search[\s\S]*?(?=## OpenCode Commands)/;

	if (!cassRegex.test(content)) {
		console.error("❌ CASS section not found in AGENTS.md");
		console.error("   File may be in unexpected state.");
		process.exit(1);
	}

	// Replace with Hivemind section
	const updated = content.replace(cassRegex, `${HIVEMIND_SECTION}\n\n---\n\n`);

	// Verify no old tool references remain
	const hasOldTools =
		updated.includes("semantic-memory_") || updated.includes("cass_");
	if (hasOldTools) {
		console.error(
			"❌ Old tool references (semantic-memory/cass) still present after update",
		);
		process.exit(1);
	}

	// Verify Hivemind tools are present
	const hasHivemindTools = updated.includes("hivemind_store");
	if (!hasHivemindTools) {
		console.error("❌ Hivemind tools not found after update");
		process.exit(1);
	}

	writeFileSync(AGENTS_MD_PATH, updated, "utf-8");
	console.log("✅ Updated AGENTS.md with Hivemind section");
	console.log("   - Replaced CASS section");
	console.log("   - Removed old tool references");
	console.log("   - Added hivemind_* tools");
}

// Run if executed directly
if (import.meta.main) {
	updateAgentsMd();
}

export { updateAgentsMd, HIVEMIND_SECTION };
