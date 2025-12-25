/**
 * Eval History Tracker - Progressive gates based on run history
 *
 * Tracks eval run scores over time and calculates the current phase:
 * - Bootstrap (<10 runs): No gates, just collect data
 * - Stabilization (10-50 runs): Warn on >10% regression
 * - Production (>50 runs + variance <0.1): Fail on >5% regression
 *
 * @module eval-history
 */
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Progressive phases based on run count and variance
 */
export type Phase = "bootstrap" | "stabilization" | "production";

/**
 * Single eval run record
 */
export interface EvalRunRecord {
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Name of the eval (e.g., "swarm-decomposition") */
  eval_name: string;
  /** Score (0-1 range typically) */
  score: number;
  /** Run count (monotonically increasing per eval) */
  run_count: number;
}

/**
 * Default path for eval history
 */
export const DEFAULT_EVAL_HISTORY_PATH = ".opencode/eval-history.jsonl";

/**
 * Variance threshold for production phase
 */
export const VARIANCE_THRESHOLD = 0.1;

/**
 * Run count thresholds for phase transitions
 */
export const BOOTSTRAP_THRESHOLD = 10;
export const STABILIZATION_THRESHOLD = 50;

/**
 * Get the eval history file path
 */
export function getEvalHistoryPath(projectPath: string): string {
  return path.join(projectPath, DEFAULT_EVAL_HISTORY_PATH);
}

/**
 * Ensure the eval history directory exists
 */
export function ensureEvalHistoryDir(projectPath: string): void {
  const historyPath = getEvalHistoryPath(projectPath);
  const dir = path.dirname(historyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Record an eval run to JSONL history
 *
 * Appends atomically to `.opencode/eval-history.jsonl`. Each line is a complete JSON object
 * representing one eval run (timestamp, eval name, score, run count).
 *
 * **Auto-creates directory** if `.opencode/` doesn't exist.
 *
 * **Thread-safe**: Uses `appendFileSync` for atomic writes (safe for concurrent eval runs).
 *
 * **Integration**: Called automatically by evalite runner after each eval completes.
 * Also callable manually for custom eval tracking.
 *
 * @param projectPath - Absolute path to project root
 * @param run - Eval run record with timestamp, eval_name, score, run_count
 *
 * @example
 * ```typescript
 * import { recordEvalRun } from "./eval-history.js";
 *
 * recordEvalRun("/path/to/project", {
 *   timestamp: new Date().toISOString(),
 *   eval_name: "swarm-decomposition",
 *   score: 0.92,
 *   run_count: 15,
 * });
 * ```
 */
export function recordEvalRun(
  projectPath: string,
  run: EvalRunRecord,
): void {
  ensureEvalHistoryDir(projectPath);
  const historyPath = getEvalHistoryPath(projectPath);
  const line = `${JSON.stringify(run)}\n`;
  fs.appendFileSync(historyPath, line, "utf-8");
}

/**
 * Read all eval run records from JSONL file
 *
 * Internal helper for parsing the history file
 */
function readAllRecords(projectPath: string): EvalRunRecord[] {
  const historyPath = getEvalHistoryPath(projectPath);

  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const content = fs.readFileSync(historyPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  return lines.map((line) => JSON.parse(line) as EvalRunRecord);
}

/**
 * Get score history for a specific eval
 *
 * Returns runs in chronological order (oldest first)
 */
export function getScoreHistory(
  projectPath: string,
  evalName: string,
): EvalRunRecord[] {
  return readAllRecords(projectPath).filter(
    (run) => run.eval_name === evalName,
  );
}

/**
 * Calculate statistical variance of scores
 *
 * Variance = mean of squared deviations from the mean
 * Formula: Σ((x - μ)²) / n
 */
export function calculateVariance(scores: number[]): number {
  if (scores.length <= 1) {
    return 0;
  }

  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  const variance = scores.reduce((sum, score) => {
    const deviation = score - mean;
    return sum + deviation * deviation;
  }, 0) / scores.length;

  return variance;
}

/**
 * Get the current phase for an eval based on run count and score variance
 *
 * Progressive phase logic ensures quality gates adapt to data maturity:
 *
 * - **Bootstrap (<10 runs)**: No gates, just collect baseline data
 * - **Stabilization (10-50 runs)**: Warn on >10% regression (but pass)
 * - **Production (>50 runs AND variance <0.1)**: Fail on >5% regression
 *
 * **Variance check**: If >50 runs but variance ≥0.1, stays in stabilization.
 * This prevents premature production gates when scores are still unstable.
 *
 * **Why variance matters**: An eval with wildly fluctuating scores isn't ready for
 * strict gates. Variance threshold (0.1) ensures the eval is consistent before
 * enforcing production-level quality control.
 *
 * @param projectPath - Absolute path to project root (contains `.opencode/eval-history.jsonl`)
 * @param evalName - Name of the eval (e.g., "swarm-decomposition")
 * @returns Current phase: "bootstrap" | "stabilization" | "production"
 *
 * @example
 * ```typescript
 * import { getPhase } from "./eval-history.js";
 *
 * const phase = getPhase("/path/to/project", "swarm-decomposition");
 *
 * if (phase === "production") {
 *   console.log("🚀 Production phase - strict gates enabled");
 * } else if (phase === "stabilization") {
 *   console.log("⚙️ Stabilization phase - warnings only");
 * } else {
 *   console.log("🌱 Bootstrap phase - collecting data");
 * }
 * ```
 */
export function getPhase(projectPath: string, evalName: string): Phase {
  const history = getScoreHistory(projectPath, evalName);

  if (history.length < BOOTSTRAP_THRESHOLD) {
    return "bootstrap";
  }

  if (history.length <= STABILIZATION_THRESHOLD) {
    return "stabilization";
  }

  // >50 runs - check variance
  const scores = history.map((run) => run.score);
  const variance = calculateVariance(scores);

  if (variance < VARIANCE_THRESHOLD) {
    return "production";
  }

  // High variance - stay in stabilization
  return "stabilization";
}
