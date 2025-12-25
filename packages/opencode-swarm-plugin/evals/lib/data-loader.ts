/**
 * PGlite-backed eval data loader
 *
 * Loads real decomposition outcomes from the eval_records table
 * for use in Evalite evals.
 */
import * as fs from "node:fs";
import {
  getEvalRecords,
  getEvalStats,
  type EvalRecord,
} from "swarm-mail";

export interface EvalCase {
  input: { task: string; context?: string };
  expected: {
    minSubtasks: number;
    maxSubtasks: number;
    requiredFiles?: string[];
    overallSuccess?: boolean;
  };
  actual?: EvalRecord;
}

/**
 * Load eval cases from PGlite
 *
 * @param projectKey - Project key for filtering records
 * @param options - Filter options
 * @returns Array of eval cases ready for Evalite
 */
export async function loadEvalCases(
  projectKey: string,
  options?: {
    limit?: number;
    strategy?: "file-based" | "feature-based" | "risk-based";
    successOnly?: boolean;
    projectPath?: string;
  },
): Promise<EvalCase[]> {
  const { limit, strategy, successOnly, projectPath } = options ?? {};

  // Query eval records from PGlite
  const records = await getEvalRecords(
    projectKey,
    { limit, strategy },
    projectPath,
  );

  // Filter by success if requested
  const filtered = successOnly
    ? records.filter((r) => r.overall_success === true)
    : records;

  // Transform to EvalCase format
  return filtered.map((record) => ({
    input: {
      task: record.task,
      context: record.context ?? undefined,
    },
    expected: {
      minSubtasks: 2,
      maxSubtasks: record.subtasks.length,
      requiredFiles: record.subtasks.flatMap((s) => s.files),
      overallSuccess: record.overall_success ?? undefined,
    },
    actual: record,
  }));
}

/**
 * Check if we have enough real data to run evals
 *
 * @param projectKey - Project key to check
 * @param minRecords - Minimum number of records required (default: 5)
 * @param projectPath - Optional project path for database lookup
 * @returns True if enough data exists
 */
export async function hasRealEvalData(
  projectKey: string,
  minRecords: number = 5,
  projectPath?: string,
): Promise<boolean> {
  const stats = await getEvalStats(projectKey, projectPath);
  return stats.totalRecords >= minRecords;
}

/**
 * Get eval data stats for reporting
 *
 * @param projectKey - Project key to query
 * @param projectPath - Optional project path for database lookup
 * @returns Summary of available eval data
 */
export async function getEvalDataSummary(
  projectKey: string,
  projectPath?: string,
): Promise<{
  totalRecords: number;
  successRate: number;
  byStrategy: Record<string, number>;
  hasEnoughData: boolean;
}> {
  const stats = await getEvalStats(projectKey, projectPath);

  return {
    totalRecords: stats.totalRecords,
    successRate: stats.successRate,
    byStrategy: stats.byStrategy,
    hasEnoughData: stats.totalRecords >= 5,
  };
}

/**
 * Check if a session meets quality criteria
 */
function meetsQualityCriteria(
  session: import("../../src/eval-capture.js").CoordinatorSession,
  criteria: {
    minEvents: number;
    requireWorkerSpawn: boolean;
    requireReview: boolean;
  },
): boolean {
  // Filter 1: minEvents
  if (session.events.length < criteria.minEvents) {
    return false;
  }

  // Filter 2: requireWorkerSpawn
  if (
    criteria.requireWorkerSpawn &&
    !session.events.some(
      (e) => e.event_type === "DECISION" && e.decision_type === "worker_spawned",
    )
  ) {
    return false;
  }

  // Filter 3: requireReview
  if (
    criteria.requireReview &&
    !session.events.some(
      (e) =>
        e.event_type === "DECISION" && e.decision_type === "review_completed",
    )
  ) {
    return false;
  }

  return true;
}

/**
 * Load captured coordinator sessions from ~/.config/swarm-tools/sessions/
 *
 * Reads all JSONL session files and returns CoordinatorSession objects.
 *
 * Quality filters are applied to focus on high-signal coordinator sessions:
 * - minEvents: Filter out incomplete/aborted sessions (default: 3)
 * - requireWorkerSpawn: Ensure session delegated to workers (default: true)
 * - requireReview: Ensure coordinator reviewed work (default: true)
 *
 * Filters are applied BEFORE the limit for accurate sampling.
 *
 * @param options - Filter options
 * @returns Array of coordinator sessions that meet quality criteria
 */
export async function loadCapturedSessions(options?: {
  sessionIds?: string[];
  limit?: number;
  /** Minimum number of events required (default: 3) */
  minEvents?: number;
  /** Require at least one worker_spawned event (default: true) */
  requireWorkerSpawn?: boolean;
  /** Require at least one review_completed event (default: true) */
  requireReview?: boolean;
  /** Override session directory for testing */
  sessionDir?: string;
}): Promise<
  Array<{ session: import("../../src/eval-capture.js").CoordinatorSession }>
> {
  const { getSessionDir, readSessionEvents, saveSession } = await import(
    "../../src/eval-capture.js"
  );
  const sessionDir = options?.sessionDir ?? getSessionDir();

  // Default quality filters
  const qualityCriteria = {
    minEvents: options?.minEvents ?? 3,
    requireWorkerSpawn: options?.requireWorkerSpawn ?? true,
    requireReview: options?.requireReview ?? true,
  };

  // If session dir doesn't exist, return empty
  if (!fs.existsSync(sessionDir)) {
    return [];
  }

  // Read all .jsonl files in session directory
  const files = fs
    .readdirSync(sessionDir)
    .filter((f) => f.endsWith(".jsonl"));

  // Filter by sessionIds if provided
  const targetFiles = options?.sessionIds
    ? files.filter((f) => options.sessionIds?.includes(f.replace(".jsonl", "")))
    : files;

  // Load each session
  const sessions: Array<{
    session: import("../../src/eval-capture.js").CoordinatorSession;
  }> = [];
  let filteredOutCount = 0;

  for (const file of targetFiles) {
    const sessionId = file.replace(".jsonl", "");

    try {
      let events: import("../../src/eval-capture.js").CoordinatorEvent[];

      // If custom sessionDir, read directly; otherwise use eval-capture functions
      if (options?.sessionDir) {
        const sessionPath = `${sessionDir}/${sessionId}.jsonl`;
        if (!fs.existsSync(sessionPath)) continue;

        const content = fs.readFileSync(sessionPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        const { CoordinatorEventSchema } = await import(
          "../../src/eval-capture.js"
        );
        events = lines.map((line) => {
          const parsed = JSON.parse(line);
          return CoordinatorEventSchema.parse(parsed);
        });
      } else {
        events = readSessionEvents(sessionId);
      }

      if (events.length === 0) continue;

      // Find epic_id from first event
      const epicId = events[0]?.epic_id;
      if (!epicId) continue;

      // Build session object
      const session: import("../../src/eval-capture.js").CoordinatorSession = {
        session_id: sessionId,
        epic_id: epicId,
        start_time: events[0]?.timestamp ?? new Date().toISOString(),
        end_time: events[events.length - 1]?.timestamp,
        events,
      };
      if (!session) continue;

      // Apply quality filters BEFORE limit
      if (meetsQualityCriteria(session, qualityCriteria)) {
        sessions.push({ session });
      } else {
        filteredOutCount++;
      }
    } catch (error) {
      // Skip invalid sessions
      console.warn(`Failed to load session ${sessionId}:`, error);
    }

    // Apply limit AFTER filtering
    if (options?.limit && sessions.length >= options.limit) {
      break;
    }
  }

  // Log filtering stats for visibility
  if (filteredOutCount > 0) {
    console.log(
      `Filtered out ${filteredOutCount} sessions (minEvents=${qualityCriteria.minEvents}, requireWorkerSpawn=${qualityCriteria.requireWorkerSpawn}, requireReview=${qualityCriteria.requireReview})`,
    );
  }

  return sessions;
}
