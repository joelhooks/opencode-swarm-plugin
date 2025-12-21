/**
 * Swarm-Aware Compaction Hook
 *
 * Provides context preservation during OpenCode session compaction.
 * When context is compacted, this hook injects instructions for the summarizer
 * to preserve swarm coordination state and enable seamless resumption.
 *
 * ## Philosophy: Err on the Side of Continuation
 * 
 * It's better to inject swarm context unnecessarily than to lose an active swarm.
 * The cost of a false positive (extra context) is low.
 * The cost of a false negative (lost swarm) is high - wasted work, confused agents.
 *
 * Hook signature (from @opencode-ai/plugin):
 * ```typescript
 * "experimental.session.compacting"?: (
 *   input: { sessionID: string },
 *   output: { context: string[] }
 * ) => Promise<void>
 * ```
 *
 * @example
 * ```typescript
 * import { SWARM_COMPACTION_CONTEXT, createCompactionHook } from "opencode-swarm-plugin";
 *
 * const hooks: Hooks = {
 *   "experimental.session.compacting": createCompactionHook(),
 * };
 * ```
 */

import { getHiveAdapter, getHiveWorkingDirectory } from "./hive";
import { checkSwarmHealth } from "swarm-mail";

// ============================================================================
// Compaction Context
// ============================================================================

/**
 * Swarm-aware compaction context
 *
 * Injected during compaction to keep the swarm cooking. The coordinator should
 * wake up from compaction and immediately resume orchestration - spawning agents,
 * monitoring progress, unblocking work.
 *
 * This is NOT about preserving state for a human - it's about the swarm continuing
 * autonomously after context compression.
 */
export const SWARM_COMPACTION_CONTEXT = `## 🐝 SWARM ACTIVE - Keep Cooking

You are the **COORDINATOR** of an active swarm. Context was compacted but the swarm is still running.

**YOUR JOB:** Keep orchestrating. Spawn agents. Monitor progress. Unblock work. Ship it.

### Preserve in Summary

Extract from session context:

1. **Epic & Subtasks** - IDs, titles, status, file assignments
2. **What's Running** - Which agents are active, what they're working on  
3. **What's Blocked** - Blockers and what's needed to unblock
4. **What's Done** - Completed work and any follow-ups needed
5. **What's Next** - Pending subtasks ready to spawn

### Summary Format

\`\`\`
## 🐝 Swarm State

**Epic:** <bd-xxx> - <title>
**Project:** <path>
**Progress:** X/Y subtasks complete

**Active:**
- <bd-xxx>: <title> [in_progress] → <agent> working on <files>

**Blocked:**
- <bd-xxx>: <title> - BLOCKED: <reason>

**Completed:**
- <bd-xxx>: <title> ✓

**Ready to Spawn:**
- <bd-xxx>: <title> (files: <...>)
\`\`\`

### On Resume - IMMEDIATELY

1. \`swarm_status(epic_id="<epic>", project_key="<path>")\` - Get current state
2. \`swarmmail_inbox(limit=5)\` - Check for agent messages
3. \`swarm_review(project_key, epic_id, task_id, files_touched)\` - Review any completed work
4. \`swarm_review_feedback(project_key, task_id, worker_id, status, issues)\` - Approve or request changes
5. **Spawn ready subtasks** - Don't wait, fire them off
6. **Unblock blocked work** - Resolve dependencies, reassign if needed
7. **Collect completed work** - Close done subtasks, verify quality

### Keep the Swarm Cooking

- **Spawn aggressively** - If a subtask is ready and unblocked, spawn an agent
- **Monitor actively** - Check status, read messages, respond to blockers
- **Close the loop** - When all subtasks done, verify and close the epic
- **Don't stop** - The swarm runs until the epic is closed

**You are not waiting for instructions. You are the coordinator. Coordinate.**
`;

/**
 * Fallback detection prompt - tells the compactor what to look for
 * 
 * Used when we can't definitively detect a swarm but want to be safe.
 * The compactor can check the conversation context for these patterns.
 */
export const SWARM_DETECTION_FALLBACK = `## 🐝 Swarm Detection - Check Your Context

**IMPORTANT:** Before summarizing, check if this session involves an active swarm.

Look for ANY of these patterns in the conversation:

### Tool Calls (definite swarm sign)
- \`swarm_decompose\`, \`swarm_spawn_subtask\`, \`swarm_status\`, \`swarm_complete\`
- \`swarmmail_init\`, \`swarmmail_reserve\`, \`swarmmail_send\`
- \`hive_create_epic\`, \`hive_start\`, \`hive_close\`

### IDs and Names
- Cell IDs: \`bd-xxx\`, \`bd-xxx.N\` (subtask format)
- Agent names: BlueLake, RedMountain, GreenValley, etc.
- Epic references: "epic", "subtask", "parent"

### Coordination Language
- "spawn", "worker", "coordinator"
- "reserve", "reservation", "files"
- "blocked", "unblock", "dependency"
- "progress", "complete", "in_progress"

### If You Find Swarm Evidence

Include this in your summary:
1. Epic ID and title
2. Project path
3. Subtask status (running/blocked/done/pending)
4. Any blockers or issues
5. What should happen next

**Then tell the resumed session:**
"This is an active swarm. Check swarm_status and swarmmail_inbox immediately."
`;

// ============================================================================
// Swarm Detection
// ============================================================================

/**
 * Detection result with confidence level
 */
interface SwarmDetection {
  detected: boolean;
  confidence: "high" | "medium" | "low" | "none";
  reasons: string[];
}

/**
 * Check for swarm sign - evidence a swarm passed through
 * 
 * Uses multiple signals with different confidence levels:
 * - HIGH: Active reservations, in_progress cells
 * - MEDIUM: Open subtasks, unclosed epics, recent activity
 * - LOW: Any cells exist, swarm-mail initialized
 * 
 * Philosophy: Err on the side of continuation.
 */
async function detectSwarm(): Promise<SwarmDetection> {
  const reasons: string[] = [];
  let highConfidence = false;
  let mediumConfidence = false;
  let lowConfidence = false;

  try {
    const projectKey = getHiveWorkingDirectory();

    // Check 1: Active reservations in swarm-mail (HIGH confidence)
    try {
      const health = await checkSwarmHealth(projectKey);
      if (health.healthy && health.stats) {
        if (health.stats.reservations > 0) {
          highConfidence = true;
          reasons.push(`${health.stats.reservations} active file reservations`);
        }
        if (health.stats.agents > 0) {
          mediumConfidence = true;
          reasons.push(`${health.stats.agents} registered agents`);
        }
        if (health.stats.messages > 0) {
          lowConfidence = true;
          reasons.push(`${health.stats.messages} swarm messages`);
        }
      }
    } catch {
      // Swarm-mail not available, continue with other checks
    }

    // Check 2: Hive cells (various confidence levels)
    try {
      const adapter = await getHiveAdapter(projectKey);
      const cells = await adapter.queryCells(projectKey, {});

      if (Array.isArray(cells) && cells.length > 0) {
        // HIGH: Any in_progress cells
        const inProgress = cells.filter((c) => c.status === "in_progress");
        if (inProgress.length > 0) {
          highConfidence = true;
          reasons.push(`${inProgress.length} cells in_progress`);
        }

        // MEDIUM: Open subtasks (cells with parent_id)
        const subtasks = cells.filter(
          (c) => c.status === "open" && c.parent_id
        );
        if (subtasks.length > 0) {
          mediumConfidence = true;
          reasons.push(`${subtasks.length} open subtasks`);
        }

        // MEDIUM: Unclosed epics
        const openEpics = cells.filter(
          (c) => c.type === "epic" && c.status !== "closed"
        );
        if (openEpics.length > 0) {
          mediumConfidence = true;
          reasons.push(`${openEpics.length} unclosed epics`);
        }

        // MEDIUM: Recently updated cells (last hour)
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        const recentCells = cells.filter((c) => c.updated_at > oneHourAgo);
        if (recentCells.length > 0) {
          mediumConfidence = true;
          reasons.push(`${recentCells.length} cells updated in last hour`);
        }

        // LOW: Any cells exist at all
        if (cells.length > 0) {
          lowConfidence = true;
          reasons.push(`${cells.length} total cells in hive`);
        }
      }
    } catch {
      // Hive not available, continue
    }
  } catch {
    // Project detection failed, use fallback
    lowConfidence = true;
    reasons.push("Could not detect project, using fallback");
  }

  // Determine overall confidence
  let confidence: "high" | "medium" | "low" | "none";
  if (highConfidence) {
    confidence = "high";
  } else if (mediumConfidence) {
    confidence = "medium";
  } else if (lowConfidence) {
    confidence = "low";
  } else {
    confidence = "none";
  }

  return {
    detected: confidence !== "none",
    confidence,
    reasons,
  };
}

// ============================================================================
// Hook Registration
// ============================================================================

/**
 * Create the compaction hook for use in plugin registration
 *
 * Injects swarm context based on detection confidence:
 * - HIGH/MEDIUM: Full swarm context (definitely/probably a swarm)
 * - LOW: Fallback detection prompt (let compactor check context)
 * - NONE: No injection (probably not a swarm)
 *
 * Philosophy: Err on the side of continuation. A false positive costs
 * a bit of context space. A false negative loses the swarm.
 *
 * @example
 * ```typescript
 * import { createCompactionHook } from "opencode-swarm-plugin";
 *
 * export const SwarmPlugin: Plugin = async () => ({
 *   tool: { ... },
 *   "experimental.session.compacting": createCompactionHook(),
 * });
 * ```
 */
export function createCompactionHook() {
  return async (
    _input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> => {
    const detection = await detectSwarm();

    if (detection.confidence === "high" || detection.confidence === "medium") {
      // Definite or probable swarm - inject full context
      const header = `[Swarm detected: ${detection.reasons.join(", ")}]\n\n`;
      output.context.push(header + SWARM_COMPACTION_CONTEXT);
    } else if (detection.confidence === "low") {
      // Possible swarm - inject fallback detection prompt
      const header = `[Possible swarm: ${detection.reasons.join(", ")}]\n\n`;
      output.context.push(header + SWARM_DETECTION_FALLBACK);
    }
    // confidence === "none" - no injection, probably not a swarm
  };
}
