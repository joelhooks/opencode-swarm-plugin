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
import { createChildLogger } from "./logger";

let _logger: any | undefined;

/**
 * Get logger instance (lazy initialization for testability)
 *
 * Logs to: ~/.config/swarm-tools/logs/compaction.1log
 *
 * Log structure:
 * - START: session_id, trigger
 * - GATHER: source (swarm-mail|hive), duration_ms, stats/counts
 * - DETECT: confidence, detected, reason_count, reasons
 * - INJECT: confidence, context_length, context_type (full|fallback|none)
 * - COMPLETE: duration_ms, success, detected, confidence, context_injected
 */
function getLog() {
  if (!_logger) {
    _logger = createChildLogger("compaction");
  }
  return _logger;
}

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
// Dynamic Context Building
// ============================================================================

/**
 * Build dynamic swarm state section from detected state
 * 
 * This injects SPECIFIC values instead of placeholders, making the context
 * immediately actionable on resume.
 */
function buildDynamicSwarmState(state: SwarmState): string {
  const parts: string[] = [];
  
  parts.push("## 🐝 Current Swarm State\n");
  
  if (state.epicId && state.epicTitle) {
    parts.push(`**Epic:** ${state.epicId} - ${state.epicTitle}`);
    
    const totalSubtasks = state.subtasks.closed + state.subtasks.in_progress + 
                          state.subtasks.open + state.subtasks.blocked;
    
    if (totalSubtasks > 0) {
      parts.push(`**Subtasks:**`);
      if (state.subtasks.closed > 0) parts.push(`  - ${state.subtasks.closed} closed`);
      if (state.subtasks.in_progress > 0) parts.push(`  - ${state.subtasks.in_progress} in_progress`);
      if (state.subtasks.open > 0) parts.push(`  - ${state.subtasks.open} open`);
      if (state.subtasks.blocked > 0) parts.push(`  - ${state.subtasks.blocked} blocked`);
    }
  }
  
  parts.push(`**Project:** ${state.projectPath}`);
  
  if (state.epicId) {
    parts.push(`\n## ⚠️ YOU ARE THE COORDINATOR - DO NOT DO WORK DIRECTLY`);
    parts.push(``);
    parts.push(`**Your role:** Orchestrate workers, review their output, unblock dependencies.`);
    parts.push(`**NOT your role:** Run tests, edit files, fetch docs, or do implementation work.`);
    parts.push(``);
    parts.push(`**RESUME STEPS:**`);
    parts.push(`1. Check swarm status: \`swarm_status(epic_id="${state.epicId}", project_key="${state.projectPath}")\``);
    parts.push(`2. Check inbox for worker messages: \`swarmmail_inbox(limit=5)\``);
    parts.push(`3. For any in_progress subtasks: Check if workers returned results, review with \`swarm_review\``);
    parts.push(`4. For any open subtasks: Spawn workers with \`swarm_spawn_subtask\``);
    parts.push(`5. For any blocked subtasks: Investigate blockers, unblock or reassign`);
    parts.push(``);
    parts.push(`**NEVER:** Run \`bun test\`, edit source files, or do worker tasks yourself.`);
  }
  
  return parts.join("\n");
}

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
  /** Specific swarm state data for context injection */
  state?: SwarmState;
}

/**
 * Specific swarm state captured during detection
 */
interface SwarmState {
  epicId?: string;
  epicTitle?: string;
  projectPath: string;
  subtasks: {
    closed: number;
    in_progress: number;
    open: number;
    blocked: number;
  };
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
  let state: SwarmState | undefined;

  try {
    const projectKey = getHiveWorkingDirectory();
    
    // Initialize state with project path
    state = {
      projectPath: projectKey,
      subtasks: {
        closed: 0,
        in_progress: 0,
        open: 0,
        blocked: 0,
      },
    };

    // Check 1: Active reservations in swarm-mail (HIGH confidence)
    const swarmMailStart = Date.now();
    try {
      const health = await checkSwarmHealth(projectKey);
      const duration = Date.now() - swarmMailStart;

      getLog().debug(
        {
          source: "swarm-mail",
          duration_ms: duration,
          healthy: health.healthy,
          stats: health.stats,
        },
        "checked swarm-mail health",
      );

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
    } catch (error) {
      getLog().debug(
        {
          source: "swarm-mail",
          duration_ms: Date.now() - swarmMailStart,
          error: error instanceof Error ? error.message : String(error),
        },
        "swarm-mail check failed",
      );
      // Swarm-mail not available, continue with other checks
    }

    // Check 2: Hive cells (various confidence levels)
    const hiveStart = Date.now();
    try {
      const adapter = await getHiveAdapter(projectKey);
      const cells = await adapter.queryCells(projectKey, {});
      const duration = Date.now() - hiveStart;

      if (Array.isArray(cells) && cells.length > 0) {
        // HIGH: Any in_progress cells
        const inProgress = cells.filter((c) => c.status === "in_progress");
        if (inProgress.length > 0) {
          highConfidence = true;
          reasons.push(`${inProgress.length} cells in_progress`);
        }

        // MEDIUM: Open subtasks (cells with parent_id)
        const subtasks = cells.filter(
          (c) => c.status === "open" && c.parent_id,
        );
        if (subtasks.length > 0) {
          mediumConfidence = true;
          reasons.push(`${subtasks.length} open subtasks`);
        }

        // MEDIUM: Unclosed epics
        const openEpics = cells.filter(
          (c) => c.type === "epic" && c.status !== "closed",
        );
        if (openEpics.length > 0) {
          mediumConfidence = true;
          reasons.push(`${openEpics.length} unclosed epics`);
          
          // Capture in_progress epic data for state
          const inProgressEpic = openEpics.find((c) => c.status === "in_progress");
          if (inProgressEpic && state) {
            state.epicId = inProgressEpic.id;
            state.epicTitle = inProgressEpic.title;
            
            // Count subtasks for this epic
            const epicSubtasks = cells.filter((c) => c.parent_id === inProgressEpic.id);
            state.subtasks.closed = epicSubtasks.filter((c) => c.status === "closed").length;
            state.subtasks.in_progress = epicSubtasks.filter((c) => c.status === "in_progress").length;
            state.subtasks.open = epicSubtasks.filter((c) => c.status === "open").length;
            state.subtasks.blocked = epicSubtasks.filter((c) => c.status === "blocked").length;
            
            getLog().debug(
              {
                epic_id: state.epicId,
                epic_title: state.epicTitle,
                subtasks_closed: state.subtasks.closed,
                subtasks_in_progress: state.subtasks.in_progress,
                subtasks_open: state.subtasks.open,
                subtasks_blocked: state.subtasks.blocked,
              },
              "captured epic state for context",
            );
          }
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

        getLog().debug(
          {
            source: "hive",
            duration_ms: duration,
            total_cells: cells.length,
            in_progress: inProgress.length,
            open_subtasks: subtasks.length,
            open_epics: openEpics.length,
            recent_updates: recentCells.length,
          },
          "checked hive cells",
        );
      } else {
        getLog().debug(
          { source: "hive", duration_ms: duration, total_cells: 0 },
          "hive empty",
        );
      }
    } catch (error) {
      getLog().debug(
        {
          source: "hive",
          duration_ms: Date.now() - hiveStart,
          error: error instanceof Error ? error.message : String(error),
        },
        "hive check failed",
      );
      // Hive not available, continue
    }
  } catch (error) {
    // Project detection failed, use fallback
    lowConfidence = true;
    reasons.push("Could not detect project, using fallback");
    getLog().debug(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "project detection failed",
    );
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

  const result = {
    detected: confidence !== "none",
    confidence,
    reasons,
    state,
  };

  getLog().debug(
    {
      detected: result.detected,
      confidence: result.confidence,
      reason_count: result.reasons.length,
      reasons: result.reasons,
      has_state: !!result.state,
    },
    "swarm detection complete",
  );

  return result;
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
    input: { sessionID: string },
    output: { context: string[] },
  ): Promise<void> => {
    const startTime = Date.now();

    getLog().info(
      {
        session_id: input.sessionID,
        trigger: "session_compaction",
      },
      "compaction started",
    );

    try {
      const detection = await detectSwarm();

      if (
        detection.confidence === "high" ||
        detection.confidence === "medium"
      ) {
        // Definite or probable swarm - inject full context
        const header = `[Swarm detected: ${detection.reasons.join(", ")}]\n\n`;
        
        // Build dynamic state section if we have specific data
        let dynamicState = "";
        if (detection.state && detection.state.epicId) {
          dynamicState = buildDynamicSwarmState(detection.state) + "\n\n";
        }
        
        const contextContent = header + dynamicState + SWARM_COMPACTION_CONTEXT;
        output.context.push(contextContent);

        getLog().info(
          {
            confidence: detection.confidence,
            context_length: contextContent.length,
            context_type: "full",
            reasons: detection.reasons,
            has_dynamic_state: !!dynamicState,
            epic_id: detection.state?.epicId,
          },
          "injected swarm context",
        );
      } else if (detection.confidence === "low") {
        // Possible swarm - inject fallback detection prompt
        const header = `[Possible swarm: ${detection.reasons.join(", ")}]\n\n`;
        const contextContent = header + SWARM_DETECTION_FALLBACK;
        output.context.push(contextContent);

        getLog().info(
          {
            confidence: detection.confidence,
            context_length: contextContent.length,
            context_type: "fallback",
            reasons: detection.reasons,
          },
          "injected swarm context",
        );
      } else {
        getLog().debug(
          {
            confidence: detection.confidence,
            context_type: "none",
          },
          "no swarm detected, skipping injection",
        );
      }
      // confidence === "none" - no injection, probably not a swarm

      const duration = Date.now() - startTime;
      getLog().info(
        {
          duration_ms: duration,
          success: true,
          detected: detection.detected,
          confidence: detection.confidence,
          context_injected: output.context.length > 0,
        },
        "compaction complete",
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      getLog().error(
        {
          duration_ms: duration,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        "compaction failed",
      );
      // Don't throw - compaction hook failures shouldn't break the session
    }
  };
}
