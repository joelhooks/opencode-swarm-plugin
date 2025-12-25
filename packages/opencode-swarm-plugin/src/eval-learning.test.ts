/**
 * Tests for eval-learning.ts - Eval-to-Learning Feedback Loop
 *
 * TDD RED phase: Write failing tests first, then implement.
 *
 * Core behavior:
 * - Detect significant eval score drops (>15% from rolling average)
 * - Store failure context to semantic-memory with structured tags
 * - Ignore minor fluctuations (<15% variance)
 * - Configurable threshold for sensitivity tuning
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
	learnFromEvalFailure,
	type EvalLearningConfig,
	calculateRollingAverage,
	isSignificantDrop,
	formatFailureContext,
	createLearningConfig,
	DEFAULT_EVAL_LEARNING_CONFIG,
} from "./eval-learning";
import type { EvalRunRecord } from "./eval-history";
import type { MemoryAdapter } from "./memory-tools";

// ============================================================================
// Mock Memory Adapter
// ============================================================================

/**
 * Create a mock memory adapter for testing
 *
 * Tracks store() calls without hitting real storage
 */
function createMockMemoryAdapter(): MemoryAdapter {
	const storedMemories: Array<{
		information: string;
		tags?: string;
		metadata?: string;
	}> = [];

	return {
		store: mock(async (args) => {
			storedMemories.push(args);
			return {
				id: `mem_${Date.now()}`,
				message: "Stored successfully",
			};
		}),
		find: mock(async () => ({ results: [], total: 0 })),
		get: mock(async () => null),
		remove: mock(async () => ({ success: true, message: "Removed" })),
		validate: mock(async () => ({ success: true, message: "Validated" })),
		list: mock(async () => []),
		stats: mock(async () => ({
			total_memories: 0,
			total_embeddings: 0,
			collections: {},
		})),
		checkHealth: mock(async () => ({ ready: true, message: "OK" })),
		getStoredMemories: () => storedMemories,
	} as any;
}

// ============================================================================
// Tests: Rolling Average Calculation
// ============================================================================

describe("calculateRollingAverage", () => {
	test("returns 0 for empty history", () => {
		const avg = calculateRollingAverage([]);
		expect(avg).toBe(0);
	});

	test("returns single score for history of 1", () => {
		const history: EvalRunRecord[] = [
			{
				eval_name: "test",
				score: 0.85,
				timestamp: "2024-12-01T00:00:00Z",
				run_count: 1,
			},
		];

		const avg = calculateRollingAverage(history);
		expect(avg).toBe(0.85);
	});

	test("calculates average of last N runs (default 5)", () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.8, timestamp: "2024-12-01", run_count: 1 },
			{ eval_name: "test", score: 0.82, timestamp: "2024-12-02", run_count: 2 },
			{ eval_name: "test", score: 0.84, timestamp: "2024-12-03", run_count: 3 },
			{ eval_name: "test", score: 0.86, timestamp: "2024-12-04", run_count: 4 },
			{ eval_name: "test", score: 0.88, timestamp: "2024-12-05", run_count: 5 },
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-06", run_count: 6 },
		];

		const avg = calculateRollingAverage(history);
		// Last 5: 0.82, 0.84, 0.86, 0.88, 0.9 => avg = 0.86
		expect(avg).toBeCloseTo(0.86, 2);
	});

	test("uses custom window size", () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.8, timestamp: "2024-12-01", run_count: 1 },
			{ eval_name: "test", score: 0.85, timestamp: "2024-12-02", run_count: 2 },
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-03", run_count: 3 },
		];

		const avg = calculateRollingAverage(history, 2);
		// Last 2: 0.85, 0.9 => avg = 0.875
		expect(avg).toBeCloseTo(0.875, 3);
	});

	test("handles window larger than history", () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.8, timestamp: "2024-12-01", run_count: 1 },
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-02", run_count: 2 },
		];

		const avg = calculateRollingAverage(history, 10);
		// Uses all available: (0.8 + 0.9) / 2 = 0.85
		expect(avg).toBeCloseTo(0.85, 2);
	});
});

// ============================================================================
// Tests: Significant Drop Detection
// ============================================================================

describe("isSignificantDrop", () => {
	test("returns false when current equals baseline", () => {
		expect(isSignificantDrop(0.85, 0.85)).toBe(false);
	});

	test("returns false when current is higher than baseline", () => {
		expect(isSignificantDrop(0.9, 0.85)).toBe(false);
	});

	test("returns false for drop below threshold (default 15%)", () => {
		// Drop of 10%: 0.85 -> 0.765 (90% of 0.85)
		expect(isSignificantDrop(0.765, 0.85)).toBe(false);
	});

	test("returns true for drop at threshold (15%)", () => {
		// Drop of exactly 15%: 0.85 -> 0.7225 (85% of 0.85)
		// Use slightly lower to account for floating point precision
		expect(isSignificantDrop(0.722, 0.85)).toBe(true);
	});

	test("returns true for drop above threshold (20%)", () => {
		// Drop of 20%: 0.85 -> 0.68 (80% of 0.85)
		expect(isSignificantDrop(0.68, 0.85)).toBe(true);
	});

	test("uses custom threshold", () => {
		// Drop of 8%: 0.85 -> 0.782 (92% of 0.85)
		// Default (15%) => false
		expect(isSignificantDrop(0.782, 0.85)).toBe(false);

		// Custom threshold (5%) => true
		expect(isSignificantDrop(0.782, 0.85, 0.05)).toBe(true);
	});

	test("returns false when baseline is 0 (avoid division by zero)", () => {
		expect(isSignificantDrop(0, 0)).toBe(false);
		expect(isSignificantDrop(0.5, 0)).toBe(false);
	});
});

// ============================================================================
// Tests: Failure Context Formatting
// ============================================================================

describe("formatFailureContext", () => {
	test("includes eval name, scores, and drop percentage", () => {
		const context = formatFailureContext("compaction-test", 0.68, 0.85);

		expect(context).toContain("compaction-test");
		expect(context).toContain("0.68");
		expect(context).toContain("0.85");
		expect(context).toContain("20.0%"); // (0.85 - 0.68) / 0.85 = 20%
	});

	test("includes optional scorer context", () => {
		const scorerContext = "violationCount scorer failed: 5 violations detected";
		const context = formatFailureContext(
			"coordinator-behavior",
			0.5,
			0.8,
			scorerContext,
		);

		expect(context).toContain("coordinator-behavior");
		expect(context).toContain(scorerContext);
	});

	test("handles baseline of 0 gracefully", () => {
		const context = formatFailureContext("test", 0.5, 0);
		expect(context).not.toContain("NaN");
		expect(context).not.toContain("Infinity");
	});
});

// ============================================================================
// Tests: Main learnFromEvalFailure Function
// ============================================================================

describe("learnFromEvalFailure", () => {
	let mockAdapter: MemoryAdapter;

	beforeEach(() => {
		mockAdapter = createMockMemoryAdapter();
	});

	test("stores memory when score drops significantly", async () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.85, timestamp: "2024-12-01", run_count: 1 },
			{ eval_name: "test", score: 0.84, timestamp: "2024-12-02", run_count: 2 },
			{ eval_name: "test", score: 0.86, timestamp: "2024-12-03", run_count: 3 },
			{ eval_name: "test", score: 0.85, timestamp: "2024-12-04", run_count: 4 },
			{ eval_name: "test", score: 0.84, timestamp: "2024-12-05", run_count: 5 },
		];
		const currentScore = 0.68; // Drop of ~20%

		const result = await learnFromEvalFailure(
			"test-eval",
			currentScore,
			history,
			mockAdapter,
		);

		expect(result.triggered).toBe(true);
		expect(result.baseline).toBeCloseTo(0.848, 2);
		expect(result.drop_percentage).toBeCloseTo(0.198, 2); // ~20%

		// Verify memory was stored
		expect(mockAdapter.store).toHaveBeenCalledTimes(1);

		const storedMemory = (mockAdapter as any).getStoredMemories()[0];
		expect(storedMemory.information).toContain("test-eval");
		expect(storedMemory.information).toContain("0.68");
		expect(storedMemory.tags).toContain("eval-failure");
		expect(storedMemory.tags).toContain("test-eval");
	});

	test("does not store memory for minor fluctuations", async () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.85, timestamp: "2024-12-01", run_count: 1 },
			{ eval_name: "test", score: 0.84, timestamp: "2024-12-02", run_count: 2 },
		];
		const currentScore = 0.8; // Drop of ~5%, below 15% threshold

		const result = await learnFromEvalFailure(
			"test-eval",
			currentScore,
			history,
			mockAdapter,
		);

		expect(result.triggered).toBe(false);
		expect(mockAdapter.store).not.toHaveBeenCalled();
	});

	test("includes scorer context in memory if provided", async () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-01", run_count: 1 },
		];
		const currentScore = 0.7; // Drop of ~22%
		const scorerContext = "violationCount: 8 protocol violations";

		await learnFromEvalFailure(
			"coordinator-behavior",
			currentScore,
			history,
			mockAdapter,
			{ scorerContext },
		);

		const storedMemory = (mockAdapter as any).getStoredMemories()[0];
		expect(storedMemory.information).toContain(scorerContext);
	});

	test("uses custom threshold when provided", async () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-01", run_count: 1 },
		];
		const currentScore = 0.85; // Drop of ~5.5%

		const customConfig: EvalLearningConfig = {
			...DEFAULT_EVAL_LEARNING_CONFIG,
			dropThreshold: 0.05, // 5% threshold
		};

		const result = await learnFromEvalFailure(
			"test-eval",
			currentScore,
			history,
			mockAdapter,
			{ config: customConfig },
		);

		expect(result.triggered).toBe(true);
		expect(mockAdapter.store).toHaveBeenCalledTimes(1);
	});

	test("handles empty history gracefully", async () => {
		const result = await learnFromEvalFailure(
			"test-eval",
			0.5,
			[],
			mockAdapter,
		);

		expect(result.triggered).toBe(false);
		expect(result.baseline).toBe(0);
		expect(mockAdapter.store).not.toHaveBeenCalled();
	});

	test("generates structured tags for semantic search", async () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-01", run_count: 1 },
		];
		const currentScore = 0.7; // Significant drop

		await learnFromEvalFailure(
			"compaction-test",
			currentScore,
			history,
			mockAdapter,
		);

		const storedMemory = (mockAdapter as any).getStoredMemories()[0];
		const tags = storedMemory.tags;

		expect(tags).toContain("eval-failure");
		expect(tags).toContain("compaction-test");
		expect(tags).toContain("regression");
	});

	test("stores metadata for future prompt generation", async () => {
		const history: EvalRunRecord[] = [
			{ eval_name: "test", score: 0.9, timestamp: "2024-12-01", run_count: 1 },
		];
		const currentScore = 0.7;

		await learnFromEvalFailure("test-eval", currentScore, history, mockAdapter);

		const storedMemory = (mockAdapter as any).getStoredMemories()[0];
		expect(storedMemory.metadata).toBeDefined();

		const metadata = JSON.parse(storedMemory.metadata!);
		expect(metadata.eval_name).toBe("test-eval");
		expect(metadata.baseline_score).toBeCloseTo(0.9, 2);
		expect(metadata.current_score).toBe(0.7);
		expect(metadata.drop_percentage).toBeCloseTo(0.222, 2);
	});
});

// ============================================================================
// Tests: Convenience Helpers
// ============================================================================

describe("createLearningConfig", () => {
	test("creates config with custom threshold", () => {
		const config = createLearningConfig(0.1);

		expect(config.dropThreshold).toBe(0.1);
		expect(config.windowSize).toBe(DEFAULT_EVAL_LEARNING_CONFIG.windowSize);
	});

	test("accepts custom window size", () => {
		const config = createLearningConfig(0.2, 10);

		expect(config.dropThreshold).toBe(0.2);
		expect(config.windowSize).toBe(10);
	});
});
