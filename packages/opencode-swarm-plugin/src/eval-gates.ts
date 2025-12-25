/**
 * Progressive Eval Gates
 *
 * Enforces quality gates based on eval history and current phase:
 * - Bootstrap (<10 runs): Always pass, collect data
 * - Stabilization (10-50 runs): Pass but warn on >10% regression
 * - Production (>50 runs + variance <0.1): Fail on >5% regression
 *
 * @module eval-gates
 */
import { calculateVariance, getPhase, getScoreHistory } from "./eval-history.js";

/**
 * Result from a gate check
 */
export interface GateResult {
	/** Whether the gate passed */
	passed: boolean;
	/** Current phase */
	phase: "bootstrap" | "stabilization" | "production";
	/** Human-readable message */
	message: string;
	/** Baseline score (mean of history) */
	baseline?: number;
	/** Current score */
	currentScore: number;
	/** Regression percentage (negative = improvement) */
	regressionPercent?: number;
}

/**
 * Configuration for gate thresholds
 */
export interface GateConfig {
	/** Regression threshold for stabilization phase (default: 0.1 = 10%) */
	stabilizationThreshold?: number;
	/** Regression threshold for production phase (default: 0.05 = 5%) */
	productionThreshold?: number;
}

/**
 * Default regression thresholds by phase
 */
export const DEFAULT_THRESHOLDS = {
	stabilization: 0.1, // 10% regression warning
	production: 0.05, // 5% regression failure
} as const;

/**
 * Calculate baseline score (mean of all historical scores)
 */
function calculateBaseline(history: ReturnType<typeof getScoreHistory>, currentScore: number): number {
	if (history.length === 0) {
		return currentScore;
	}
	return history.reduce((sum, run) => sum + run.score, 0) / history.length;
}

/**
 * Calculate regression percentage from baseline
 *
 * Returns 0 if baseline is 0 to avoid division by zero.
 * Positive = regression (score dropped), negative = improvement
 */
function calculateRegression(baseline: number, currentScore: number): number {
	if (baseline === 0) {
		return 0;
	}
	return (baseline - currentScore) / baseline;
}

/**
 * Format regression message with scores
 */
function formatRegressionMessage(
	regressionPercent: number,
	baseline: number,
	currentScore: number,
): string {
	return `${(regressionPercent * 100).toFixed(1)}% regression (baseline: ${baseline.toFixed(2)}, current: ${currentScore.toFixed(2)})`;
}

/**
 * Check if the current eval score passes the quality gate
 *
 * Progressive gates adapt based on data maturity:
 * - **Bootstrap (<10 runs)**: Always pass, focus on collecting baseline data
 * - **Stabilization (10-50 runs)**: Warn on >10% regression (default), but pass
 * - **Production (>50 runs + variance <0.1)**: Fail on >5% regression (default)
 *
 * **Baseline calculation**: Mean of all historical scores for this eval (not just last run).
 *
 * **Regression formula**: `(baseline - current) / baseline`
 * - Positive = regression (score dropped)
 * - Negative = improvement
 * - Returns 0 if baseline is 0 (avoids division by zero)
 *
 * **Variance threshold (0.1)**: High variance keeps eval in stabilization phase even with >50 runs.
 * This prevents premature production gates when scores are still unstable.
 *
 * **CI Integration**: Production gates can fail PRs. Use `swarm eval status` to check phase before merging.
 *
 * @param projectPath - Absolute path to project root (contains `.opencode/eval-history.jsonl`)
 * @param evalName - Name of the eval (e.g., "swarm-decomposition", "coordinator-behavior")
 * @param currentScore - Current score to check (typically 0-1 range)
 * @param config - Optional threshold configuration (defaults: stabilization=0.1, production=0.05)
 * @returns Gate check result with pass/fail, phase, baseline, regression details
 *
 * @example
 * ```typescript
 * import { checkGate } from "./eval-gates.js";
 *
 * const result = checkGate("/path/to/project", "swarm-decomposition", 0.89);
 *
 * if (!result.passed) {
 *   console.error(`❌ Gate FAILED: ${result.message}`);
 *   process.exit(1); // Fail CI
 * }
 *
 * console.log(`✅ ${result.phase} phase: ${result.message}`);
 * ```
 *
 * @example
 * ```typescript
 * // Custom thresholds for sensitive eval
 * const result = checkGate("/path", "critical-eval", 0.92, {
 *   stabilizationThreshold: 0.05,  // 5% threshold in stabilization
 *   productionThreshold: 0.02,     // 2% threshold in production
 * });
 * ```
 */
export function checkGate(
	projectPath: string,
	evalName: string,
	currentScore: number,
	config?: GateConfig,
): GateResult {
	const thresholds = {
		stabilization: config?.stabilizationThreshold ?? DEFAULT_THRESHOLDS.stabilization,
		production: config?.productionThreshold ?? DEFAULT_THRESHOLDS.production,
	};

	const phase = getPhase(projectPath, evalName);
	const history = getScoreHistory(projectPath, evalName);

	// Bootstrap phase - always pass
	if (phase === "bootstrap") {
		return {
			passed: true,
			phase: "bootstrap",
			message: `Bootstrap phase (${history.length}/10 runs) - collecting data`,
			currentScore,
		};
	}

	// Calculate baseline and regression
	const baseline = calculateBaseline(history, currentScore);
	const regressionPercent = calculateRegression(baseline, currentScore);
	const regressionMsg = formatRegressionMessage(regressionPercent, baseline, currentScore);

	// Stabilization phase - warn on regression but pass
	if (phase === "stabilization") {
		if (regressionPercent > thresholds.stabilization) {
			return {
				passed: true,
				phase: "stabilization",
				message: `Stabilization phase: ${regressionMsg} - exceeds ${(thresholds.stabilization * 100).toFixed(0)}% threshold but still passing`,
				baseline,
				currentScore,
				regressionPercent,
			};
		}

		// Check if we have high variance (>50 runs but can't enter production)
		if (history.length > 50) {
			const scores = history.map((run) => run.score);
			const variance = calculateVariance(scores);
			return {
				passed: true,
				phase: "stabilization",
				message: `Stabilization phase: ${regressionMsg} - acceptable. High variance (${variance.toFixed(3)}) prevents production phase.`,
				baseline,
				currentScore,
				regressionPercent,
			};
		}

		return {
			passed: true,
			phase: "stabilization",
			message: `Stabilization phase: ${regressionMsg} - acceptable`,
			baseline,
			currentScore,
			regressionPercent,
		};
	}

	// Production phase - fail on regression exceeding threshold
	if (regressionPercent > thresholds.production) {
		return {
			passed: false,
			phase: "production",
			message: `Production phase FAIL: ${regressionMsg} - exceeds ${(thresholds.production * 100).toFixed(0)}% threshold`,
			baseline,
			currentScore,
			regressionPercent,
		};
	}

	return {
		passed: true,
		phase: "production",
		message: `Production phase: ${regressionMsg} - acceptable`,
		baseline,
		currentScore,
		regressionPercent,
	};
}
