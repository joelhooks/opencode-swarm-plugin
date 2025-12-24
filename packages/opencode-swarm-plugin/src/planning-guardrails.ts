/**
 * Planning Guardrails
 *
 * Detects when agents are about to make planning mistakes and warns them.
 * Non-blocking - just emits warnings to help agents self-correct.
 *
 * @module planning-guardrails
 */

import { captureCoordinatorEvent } from "./eval-capture.js";

/**
 * Patterns that suggest file modification work
 * These indicate the todo is about implementation, not tracking
 */
const FILE_MODIFICATION_PATTERNS = [
  /\bimplement\b/i,
  /\bcreate\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\badd\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\bupdate\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\bmodify\b/i,
  /\brefactor\b/i,
  /\bextract\b/i,
  /\bmigrate\b/i,
  /\bconvert\b/i,
  /\brewrite\b/i,
  /\bfix\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /\bwrite\b.*\.(ts|js|tsx|jsx|py|rs|go|java|rb|swift|kt)/i,
  /src\//i,
  /lib\//i,
  /packages?\//i,
  /components?\//i,
];

/**
 * Patterns that suggest this is tracking/coordination work (OK for todowrite)
 */
const TRACKING_PATTERNS = [
  /\breview\b/i,
  /\bcheck\b/i,
  /\bverify\b/i,
  /\btest\b.*pass/i,
  /\brun\b.*test/i,
  /\bdeploy\b/i,
  /\bmerge\b/i,
  /\bpr\b/i,
  /\bpush\b/i,
  /\bcommit\b/i,
];

/**
 * Result of analyzing todowrite args
 */
export interface TodoWriteAnalysis {
  /** Whether this looks like parallel work that should use swarm */
  looksLikeParallelWork: boolean;

  /** Number of todos that look like file modifications */
  fileModificationCount: number;

  /** Total number of todos */
  totalCount: number;

  /** Warning message if applicable */
  warning?: string;
}

/**
 * Analyze todowrite args to detect potential planning mistakes
 *
 * Triggers warning when:
 * - 6+ todos created in one call
 * - Most todos match file modification patterns
 * - Few todos match tracking patterns
 *
 * @param args - The todowrite tool arguments
 * @returns Analysis result with optional warning
 */
export function analyzeTodoWrite(args: { todos?: unknown[] }): TodoWriteAnalysis {
  const todos = args.todos;

  // Not enough todos to analyze
  if (!todos || !Array.isArray(todos) || todos.length < 6) {
    return {
      looksLikeParallelWork: false,
      fileModificationCount: 0,
      totalCount: todos?.length ?? 0,
    };
  }

  // Count todos that look like file modifications
  let fileModificationCount = 0;

  for (const todo of todos) {
    if (typeof todo !== "object" || todo === null) continue;

    const content = (todo as { content?: string }).content ?? "";

    // Check if it matches file modification patterns
    const isFileModification = FILE_MODIFICATION_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    // Check if it matches tracking patterns
    const isTracking = TRACKING_PATTERNS.some((pattern) =>
      pattern.test(content)
    );

    if (isFileModification && !isTracking) {
      fileModificationCount++;
    }
    // trackingCount not currently used but kept for future ratio analysis
  }

  // Trigger warning if most todos look like file modifications
  const ratio = fileModificationCount / todos.length;
  const looksLikeParallelWork = ratio >= 0.5 && fileModificationCount >= 4;

  if (looksLikeParallelWork) {
    return {
      looksLikeParallelWork: true,
      fileModificationCount,
      totalCount: todos.length,
      warning: `⚠️  This looks like a multi-file implementation plan (${fileModificationCount}/${todos.length} items are file modifications).

Consider using swarm instead:
  swarm_decompose → hive_create_epic → parallel task spawns

TodoWrite is for tracking progress, not parallelizable implementation work.
Swarm workers can complete these ${fileModificationCount} tasks in parallel.

(Continuing with todowrite - this is just a suggestion)`,
    };
  }

  return {
    looksLikeParallelWork: false,
    fileModificationCount,
    totalCount: todos.length,
  };
}

/**
 * Check if a tool call should trigger planning guardrails
 *
 * @param toolName - Name of the tool being called
 * @returns Whether this tool should be analyzed
 */
export function shouldAnalyzeTool(toolName: string): boolean {
  return toolName === "todowrite" || toolName === "TodoWrite";
}

/**
 * Violation patterns for coordinator behavior detection
 *
 * These patterns identify when a coordinator is performing work
 * that should be delegated to worker agents.
 *
 * @example
 * ```ts
 * // Bad: Coordinator editing files
 * if (VIOLATION_PATTERNS.FILE_MODIFICATION_TOOLS.includes("edit")) { ... }
 *
 * // Good: Worker editing files
 * // (no violation when agentContext === "worker")
 * ```
 */
export const VIOLATION_PATTERNS = {
  /**
   * Tool names that modify files
   *
   * Coordinators should NEVER call these tools directly.
   * Workers reserve files and make modifications.
   */
  FILE_MODIFICATION_TOOLS: ["edit", "write"],

  /**
   * Tool names for file reservations
   *
   * Coordinators don't reserve files - workers do this
   * before editing to prevent conflicts.
   */
  RESERVATION_TOOLS: ["swarmmail_reserve", "agentmail_reserve"],

  /**
   * Regex patterns that indicate test execution in bash commands
   *
   * Coordinators review test results, workers run tests.
   * Matches common test runners and test file patterns.
   */
  TEST_EXECUTION_PATTERNS: [
    /\bbun\s+test\b/i,
    /\bnpm\s+(run\s+)?test/i,
    /\byarn\s+(run\s+)?test/i,
    /\bpnpm\s+(run\s+)?test/i,
    /\bjest\b/i,
    /\bvitest\b/i,
    /\bmocha\b/i,
    /\bava\b/i,
    /\btape\b/i,
    /\.test\.(ts|js|tsx|jsx)\b/i,
    /\.spec\.(ts|js|tsx|jsx)\b/i,
  ],
} as const;

/**
 * Result of violation detection
 */
export interface ViolationDetectionResult {
  /** Whether a violation was detected */
  isViolation: boolean;

  /** Type of violation if detected */
  violationType?:
    | "coordinator_edited_file"
    | "coordinator_ran_tests"
    | "coordinator_reserved_files"
    | "no_worker_spawned";

  /** Human-readable message */
  message?: string;

  /** Payload data for the violation */
  payload?: Record<string, unknown>;
}

/**
 * Detect coordinator violations in real-time
 *
 * Checks for patterns that indicate a coordinator is doing work
 * that should be delegated to workers:
 * 1. Edit/Write tool calls (coordinators plan, workers implement)
 * 2. Test execution (workers verify, coordinators review)
 * 3. File reservations (workers reserve before editing)
 * 4. No worker spawned after decomposition (coordinators must delegate)
 *
 * When a violation is detected, captures it via captureCoordinatorEvent().
 *
 * @param params - Detection parameters
 * @returns Violation detection result
 */
export function detectCoordinatorViolation(params: {
  sessionId: string;
  epicId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  agentContext: "coordinator" | "worker";
  checkNoSpawn?: boolean;
}): ViolationDetectionResult {
  const { sessionId, epicId, toolName, toolArgs, agentContext, checkNoSpawn = false } = params;

  // Only check coordinator violations
  if (agentContext !== "coordinator") {
    return { isViolation: false };
  }

  // Check for file modification violation
  if (VIOLATION_PATTERNS.FILE_MODIFICATION_TOOLS.includes(toolName as any)) {
    const file = (toolArgs.filePath as string) || "";
    const payload = { tool: toolName, file };

    captureCoordinatorEvent({
      session_id: sessionId,
      epic_id: epicId,
      timestamp: new Date().toISOString(),
      event_type: "VIOLATION",
      violation_type: "coordinator_edited_file",
      payload,
    });

    return {
      isViolation: true,
      violationType: "coordinator_edited_file",
      message: `⚠️ Coordinator should not edit files directly. Coordinators should spawn workers to implement changes.`,
      payload,
    };
  }

  // Check for test execution violation
  if (toolName === "bash") {
    const command = (toolArgs.command as string) || "";
    const isTestCommand = VIOLATION_PATTERNS.TEST_EXECUTION_PATTERNS.some((pattern) =>
      pattern.test(command),
    );

    if (isTestCommand) {
      const payload = { tool: toolName, command };

      captureCoordinatorEvent({
        session_id: sessionId,
        epic_id: epicId,
        timestamp: new Date().toISOString(),
        event_type: "VIOLATION",
        violation_type: "coordinator_ran_tests",
        payload,
      });

      return {
        isViolation: true,
        violationType: "coordinator_ran_tests",
        message: `⚠️ Coordinator should not run tests directly. Workers run tests as part of their implementation verification.`,
        payload,
      };
    }
  }

  // Check for file reservation violation
  if (VIOLATION_PATTERNS.RESERVATION_TOOLS.includes(toolName as any)) {
    const paths = (toolArgs.paths as string[]) || [];
    const payload = { tool: toolName, paths };

    captureCoordinatorEvent({
      session_id: sessionId,
      epic_id: epicId,
      timestamp: new Date().toISOString(),
      event_type: "VIOLATION",
      violation_type: "coordinator_reserved_files",
      payload,
    });

    return {
      isViolation: true,
      violationType: "coordinator_reserved_files",
      message: `⚠️ Coordinator should not reserve files. Workers reserve files before editing to prevent conflicts.`,
      payload,
    };
  }

  // Check for no worker spawned after decomposition
  if (toolName === "hive_create_epic" && checkNoSpawn) {
    const epicTitle = (toolArgs.epic_title as string) || "";
    const subtasks = (toolArgs.subtasks as unknown[]) || [];
    const payload = { epic_title: epicTitle, subtask_count: subtasks.length };

    captureCoordinatorEvent({
      session_id: sessionId,
      epic_id: epicId,
      timestamp: new Date().toISOString(),
      event_type: "VIOLATION",
      violation_type: "no_worker_spawned",
      payload,
    });

    return {
      isViolation: true,
      violationType: "no_worker_spawned",
      message: `⚠️ Coordinator created decomposition without spawning workers. After hive_create_epic, use swarm_spawn_subtask for each task.`,
      payload,
    };
  }

  return { isViolation: false };
}
