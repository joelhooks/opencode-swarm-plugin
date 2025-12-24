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
 * Load captured coordinator sessions from ~/.config/swarm-tools/sessions/
 *
 * Reads all JSONL session files and returns CoordinatorSession objects.
 *
 * @param options - Filter options
 * @returns Array of coordinator sessions
 */
export async function loadCapturedSessions(options?: {
  sessionIds?: string[];
  limit?: number;
}): Promise<
  Array<{ session: import("../../src/eval-capture.js").CoordinatorSession }>
> {
  const { getSessionDir, readSessionEvents, saveSession } = await import(
    "../../src/eval-capture.js"
  );
  const sessionDir = getSessionDir();

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

  for (const file of targetFiles) {
    const sessionId = file.replace(".jsonl", "");

    try {
      const events = readSessionEvents(sessionId);
      if (events.length === 0) continue;

      // Find epic_id from first event
      const epicId = events[0]?.epic_id;
      if (!epicId) continue;

      const session = saveSession({ session_id: sessionId, epic_id: epicId });
      if (session) {
        sessions.push({ session });
      }
    } catch (error) {
      // Skip invalid sessions
      console.warn(`Failed to load session ${sessionId}:`, error);
    }

    // Apply limit if specified
    if (options?.limit && sessions.length >= options.limit) {
      break;
    }
  }

  return sessions;
}
