/**
 * Eval-to-Learning Feedback Loop
 *
 * Automatically stores eval failures to semantic memory for learning.
 * When eval scores drop significantly from rolling average (default >15%),
 * stores context to semantic-memory with tags for future prompt generation.
 *
 * ## Usage
 *
 * ```typescript
 * import { learnFromEvalFailure } from "./eval-learning";
 * import { getHivemindAdapter } from "./hivemind-tools";
 * import { getScoreHistory } from "./eval-history";
 *
 * const memoryAdapter = await getHivemindAdapter();
 * const history = getScoreHistory(projectPath, "compaction-test");
 *
 * const result = await learnFromEvalFailure(
 *   "compaction-test",
 *   currentScore,
 *   history,
 *   memoryAdapter
 * );
 *
 * if (result.triggered) {
 *   console.log(`📉 Regression detected: ${(result.drop_percentage * 100).toFixed(1)}% drop`);
 *   console.log(`Memory ID: ${result.memory_id}`);
 * }
 * ```
 *
 * ## Integration Points
 *
 * - **After each eval run**: Call to detect regressions automatically
 * - **Memory tags**: `eval-failure`, `{eval-name}`, `regression`
 * - **Future prompts**: Query memories with these tags for context
 * - **Scorer context**: Optional detail about which scorer failed
 *
 * ## Customization
 *
 * ```typescript
 * const customConfig = {
 *   dropThreshold: 0.10,  // 10% threshold (more sensitive)
 *   windowSize: 10,        // Last 10 runs for baseline
 * };
 *
 * await learnFromEvalFailure(
 *   "test",
 *   score,
 *   history,
 *   adapter,
 *   { config: customConfig }
 * );
 * ```
 *
 * @module eval-learning
 */

import type { EvalRunRecord } from "./eval-history";
import type { MemoryAdapter } from "./hivemind-tools";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for eval-to-learning feedback
 */
export interface EvalLearningConfig {
	/** Threshold for significant drop (0-1, default 0.15 = 15%) */
	dropThreshold: number;
	/** Rolling average window size (default 5 runs) */
	windowSize: number;
}

/**
 * Default configuration
 */
export const DEFAULT_EVAL_LEARNING_CONFIG: EvalLearningConfig = {
	dropThreshold: 0.15, // 15% drop triggers storage
	windowSize: 5, // Last 5 runs for baseline
};

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from learning check
 */
export interface LearningResult {
	/** Whether the check triggered memory storage */
	triggered: boolean;
	/** Baseline score from rolling average */
	baseline: number;
	/** Current score */
	current: number;
	/** Drop percentage (0-1, e.g., 0.20 = 20% drop) */
	drop_percentage: number;
	/** Memory ID if stored */
	memory_id?: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate rolling average of recent scores
 *
 * Uses last N runs (default 5) to establish baseline.
 * If history shorter than window, uses all available.
 *
 * @param history - Score history (chronological order)
 * @param windowSize - Number of recent runs to average (default 5)
 * @returns Average score (0 if empty)
 */
export function calculateRollingAverage(
	history: EvalRunRecord[],
	windowSize: number = 5,
): number {
	if (history.length === 0) {
		return 0;
	}

	const recentRuns = history.slice(-windowSize);
	const sum = recentRuns.reduce((acc, run) => acc + run.score, 0);
	return sum / recentRuns.length;
}

/**
 * Check if current score is a significant drop from baseline
 *
 * Significant = drop exceeds threshold (default 15%).
 * Formula: (baseline - current) / baseline >= threshold
 *
 * @param currentScore - Current eval score
 * @param baseline - Baseline score (rolling average)
 * @param threshold - Drop threshold (default 0.15 = 15%)
 * @returns True if drop is significant
 */
export function isSignificantDrop(
	currentScore: number,
	baseline: number,
	threshold: number = 0.15,
): boolean {
	// Avoid division by zero
	if (baseline === 0) {
		return false;
	}

	const drop = (baseline - currentScore) / baseline;
	return drop >= threshold;
}

/**
 * Format failure context for semantic memory storage
 *
 * Creates human-readable description of the failure with
 * quantified metrics and optional scorer context.
 *
 * @param evalName - Name of eval that failed
 * @param currentScore - Current score
 * @param baseline - Baseline score
 * @param scorerContext - Optional context about which scorer failed
 * @returns Formatted context string
 */
export function formatFailureContext(
	evalName: string,
	currentScore: number,
	baseline: number,
	scorerContext?: string,
): string {
	const dropPercentage =
		baseline > 0 ? ((baseline - currentScore) / baseline) * 100 : 0;

	const lines = [
		`Eval "${evalName}" regression detected:`,
		`- Current score: ${currentScore.toFixed(2)}`,
		`- Baseline (rolling avg): ${baseline.toFixed(2)}`,
		`- Drop: ${dropPercentage.toFixed(1)}%`,
	];

	if (scorerContext) {
		lines.push("", "Scorer context:", scorerContext);
	}

	lines.push(
		"",
		"Action: Review recent changes that may have caused regression.",
		"Query this memory when generating future prompts for this eval.",
	);

	return lines.join("\n");
}

/**
 * Main learning function - automatically stores eval failures to semantic memory
 *
 * **Closed-loop learning**: When eval scores drop significantly from baseline,
 * this function stores failure context to semantic memory. Future prompt generation
 * queries these memories for context, preventing repeated mistakes.
 *
 * **Trigger condition**: Score drops >15% (default) from rolling average baseline.
 * Uses last 5 runs (default) to establish baseline, not just previous run.
 *
 * **What gets stored**:
 * - Eval name, baseline score, current score, drop percentage
 * - Scorer-specific context (which scorer failed, why)
 * - Timestamp and metadata for querying
 * - Tags: `eval-failure`, `{eval-name}`, `regression`
 *
 * **Future use**: Before generating prompts for the same eval, query semantic memory
 * with tags to inject learnings from past failures.
 *
 * **Integration points**:
 * - After each eval run (in evalite runner or CI)
 * - In `checkGate()` when regression detected
 * - Manual calls for custom eval tracking
 *
 * @param evalName - Name of eval (e.g., "compaction-test", "coordinator-behavior")
 * @param currentScore - Current eval score (typically 0-1 range)
 * @param history - Score history in chronological order (oldest first)
 * @param memoryAdapter - Semantic memory adapter (from `getMemoryAdapter()`)
 * @param options - Optional config (thresholds, window size) and scorer context
 * @param options.config - Custom thresholds (dropThreshold, windowSize)
 * @param options.scorerContext - Details about which scorer failed (for context)
 * @returns Learning result with trigger status, baseline, drop percentage, memory ID
 *
 * @example
 * ```typescript
 * import { learnFromEvalFailure } from "./eval-learning.js";
 * import { getHivemindAdapter } from "./hivemind-tools.js";
 * import { getScoreHistory } from "./eval-history.js";
 *
 * const memoryAdapter = await getHivemindAdapter();
 * const history = getScoreHistory("/path/to/project", "coordinator-behavior");
 *
 * const result = await learnFromEvalFailure(
 *   "coordinator-behavior",
 *   0.68,  // Current score
 *   history,
 *   memoryAdapter,
 *   { scorerContext: "violationCount: 5 violations (coordinator edited files)" }
 * );
 *
 * if (result.triggered) {
 *   console.log(`📉 Regression detected: ${(result.drop_percentage * 100).toFixed(1)}% drop`);
 *   console.log(`Stored to memory: ${result.memory_id}`);
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Custom threshold (more sensitive)
 * const result = await learnFromEvalFailure(
 *   "critical-eval",
 *   0.85,
 *   history,
 *   memoryAdapter,
 *   {
 *     config: {
 *       dropThreshold: 0.10,  // 10% threshold (default is 15%)
 *       windowSize: 10,       // Last 10 runs for baseline (default is 5)
 *     },
 *   }
 * );
 * ```
 */
export async function learnFromEvalFailure(
	evalName: string,
	currentScore: number,
	history: EvalRunRecord[],
	memoryAdapter: MemoryAdapter,
	options?: {
		config?: EvalLearningConfig;
		scorerContext?: string;
	},
): Promise<LearningResult> {
	const config = options?.config ?? DEFAULT_EVAL_LEARNING_CONFIG;

	// Calculate baseline from rolling average
	const baseline = calculateRollingAverage(history, config.windowSize);

	// Check if this is a significant drop
	const dropPercentage =
		baseline > 0 ? (baseline - currentScore) / baseline : 0;
	const significant = isSignificantDrop(
		currentScore,
		baseline,
		config.dropThreshold,
	);

	const result: LearningResult = {
		triggered: significant,
		baseline,
		current: currentScore,
		drop_percentage: dropPercentage,
	};

	// Store to semantic memory if significant
	if (significant) {
		const information = formatFailureContext(
			evalName,
			currentScore,
			baseline,
			options?.scorerContext,
		);

		const tags = ["eval-failure", evalName, "regression"].join(",");

		const metadata = JSON.stringify({
			eval_name: evalName,
			baseline_score: baseline,
			current_score: currentScore,
			drop_percentage: dropPercentage,
			timestamp: new Date().toISOString(),
		});

		const storeResult = await memoryAdapter.store({
			information,
			tags,
			metadata,
		});

		if (storeResult.id) {
			result.memory_id = storeResult.id;
		}
	}

	return result;
}

// ============================================================================
// Convenience Exports
// ============================================================================

/**
 * Create custom learning config with specific threshold
 *
 * Helper for common use case: custom drop threshold.
 *
 * @param dropThreshold - Drop threshold (0-1)
 * @param windowSize - Optional window size (default 5)
 * @returns Custom config
 *
 * @example
 * ```typescript
 * const config = createLearningConfig(0.10); // 10% threshold
 * await learnFromEvalFailure("test", score, history, adapter, { config });
 * ```
 */
export function createLearningConfig(
	dropThreshold: number,
	windowSize?: number,
): EvalLearningConfig {
	return {
		dropThreshold,
		windowSize: windowSize ?? DEFAULT_EVAL_LEARNING_CONFIG.windowSize,
	};
}
