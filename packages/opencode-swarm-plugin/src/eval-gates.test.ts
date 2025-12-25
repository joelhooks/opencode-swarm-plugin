/**
 * Tests for progressive eval gates
 *
 * TDD approach:
 * RED: Tests written first, all failing
 * GREEN: Minimal implementation to pass
 * REFACTOR: Clean up while keeping tests green
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { checkGate } from "./eval-gates.js";
import { recordEvalRun } from "./eval-history.js";

const TEST_PROJECT = "/tmp/eval-gates-test";

beforeEach(() => {
	// Clean slate for each test
	if (fs.existsSync(TEST_PROJECT)) {
		fs.rmSync(TEST_PROJECT, { recursive: true });
	}
	fs.mkdirSync(TEST_PROJECT, { recursive: true });
});

afterEach(() => {
	// Cleanup
	if (fs.existsSync(TEST_PROJECT)) {
		fs.rmSync(TEST_PROJECT, { recursive: true });
	}
});

/**
 * Helper to create run history
 */
function seedHistory(evalName: string, scores: number[]): void {
	for (let i = 0; i < scores.length; i++) {
		recordEvalRun(TEST_PROJECT, {
			timestamp: new Date(Date.now() + i * 1000).toISOString(),
			eval_name: evalName,
			score: scores[i],
			run_count: i + 1,
		});
	}
}

describe("checkGate - Bootstrap Phase (<10 runs)", () => {
	test("always passes with 0 runs", () => {
		const result = checkGate(TEST_PROJECT, "my-eval", 0.5);

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("bootstrap");
		expect(result.message).toContain("Bootstrap phase");
	});

	test("always passes with 9 runs, even with score drop", () => {
		seedHistory("my-eval", [0.9, 0.88, 0.87, 0.86, 0.85, 0.84, 0.83, 0.82, 0.81]);

		const result = checkGate(TEST_PROJECT, "my-eval", 0.5); // 50% drop

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("bootstrap");
		expect(result.message).toContain("Bootstrap phase");
	});

	test("provides run count in message", () => {
		seedHistory("my-eval", [0.8, 0.8, 0.8]);

		const result = checkGate(TEST_PROJECT, "my-eval", 0.75);

		expect(result.message).toContain("3/10");
	});
});

describe("checkGate - Stabilization Phase (10-50 runs)", () => {
	test("exactly 10 runs enters stabilization", () => {
		seedHistory("my-eval", Array(10).fill(0.85));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.84);

		expect(result.phase).toBe("stabilization");
	});

	test("passes with <10% regression", () => {
		seedHistory("my-eval", Array(15).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.82); // 8.8% drop

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("stabilization");
		expect(result.message).toContain("acceptable");
	});

	test("WARNS on >10% regression but still passes", () => {
		seedHistory("my-eval", Array(15).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.8); // 11.1% drop

		expect(result.passed).toBe(true); // Still passes in stabilization
		expect(result.phase).toBe("stabilization");
		expect(result.message).toContain("regression");
		expect(result.message).toMatch(/10%|11%/); // Should mention threshold
	});

	test("edge case: exactly 10% regression", () => {
		seedHistory("my-eval", Array(20).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.81); // Exactly 10% drop

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("stabilization");
	});

	test("passes with score improvement", () => {
		seedHistory("my-eval", Array(25).fill(0.8));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.95);

		expect(result.passed).toBe(true);
		expect(result.message).toContain("acceptable");
	});

	test("exactly 50 runs still in stabilization", () => {
		seedHistory("my-eval", Array(50).fill(0.85));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.84);

		expect(result.phase).toBe("stabilization");
	});
});

describe("checkGate - Production Phase (>50 runs + variance <0.1)", () => {
	test("enters production with 51 stable runs", () => {
		seedHistory("my-eval", Array(51).fill(0.85));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.84);

		expect(result.phase).toBe("production");
	});

	test("FAILS on >5% regression in production", () => {
		seedHistory("my-eval", Array(60).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.84); // 6.7% drop

		expect(result.passed).toBe(false);
		expect(result.phase).toBe("production");
		expect(result.message).toContain("FAIL");
		expect(result.message).toMatch(/5%|6%/);
	});

	test("passes with <5% regression in production", () => {
		seedHistory("my-eval", Array(60).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.86); // 4.4% drop

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("production");
		expect(result.message).toContain("acceptable");
	});

	test("edge case: exactly 5% regression", () => {
		seedHistory("my-eval", Array(60).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.855); // Exactly 5% drop

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("production");
	});

	test("stays in stabilization if variance too high (>0.1) despite >50 runs", () => {
		// Need significant wild variance to push above 0.1
		// From memory: 60 stable + 50 alternating wild = variance ~0.103
		const stableRuns = Array(60).fill(0.85);
		const wildRuns = Array(50)
			.fill(0)
			.map((_, i) => (i % 2 === 0 ? 0.1 : 0.9));
		seedHistory("my-eval", [...stableRuns, ...wildRuns]);

		const result = checkGate(TEST_PROJECT, "my-eval", 0.84);

		expect(result.phase).toBe("stabilization");
		expect(result.message).toContain("variance");
	});

	test("passes with score improvement in production", () => {
		seedHistory("my-eval", Array(60).fill(0.8));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.95);

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("production");
	});
});

describe("checkGate - Baseline Calculation", () => {
	test("uses mean of all historical scores as baseline", () => {
		// Need 10+ runs to exit bootstrap and see baseline in message
		seedHistory("my-eval", [0.8, 0.85, 0.9, 0.95, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9]); // mean = 0.9

		const result = checkGate(TEST_PROJECT, "my-eval", 0.88);

		// 0.88 is ~2.2% drop from 0.9 mean (within stabilization tolerance)
		expect(result.passed).toBe(true);
		expect(result.message).toContain("0.90"); // Should show baseline
	});

	test("handles different eval names independently", () => {
		seedHistory("eval-a", Array(15).fill(0.9));
		seedHistory("eval-b", Array(15).fill(0.5));

		const resultA = checkGate(TEST_PROJECT, "eval-a", 0.88);
		const resultB = checkGate(TEST_PROJECT, "eval-b", 0.48);

		expect(resultA.passed).toBe(true);
		expect(resultB.passed).toBe(true);
	});
});

describe("checkGate - Edge Cases", () => {
	test("handles score of 0", () => {
		seedHistory("my-eval", Array(15).fill(0.8));

		const result = checkGate(TEST_PROJECT, "my-eval", 0);

		expect(result.passed).toBe(true); // Still passes in stabilization with warning
		expect(result.message).toContain("regression");
	});

	test("handles perfect score of 1.0", () => {
		seedHistory("my-eval", Array(15).fill(0.9));

		const result = checkGate(TEST_PROJECT, "my-eval", 1.0);

		expect(result.passed).toBe(true);
	});

	test("handles no history file (first run)", () => {
		// No seedHistory call - empty project

		const result = checkGate(TEST_PROJECT, "my-eval", 0.75);

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("bootstrap");
	});

	test("handles baseline of 0 (avoid division by zero)", () => {
		seedHistory("my-eval", Array(15).fill(0));

		const result = checkGate(TEST_PROJECT, "my-eval", 0.5);

		expect(result.passed).toBe(true);
		expect(result.message).not.toContain("NaN");
		expect(result.message).not.toContain("Infinity");
	});
});

describe("checkGate - Configurable Thresholds", () => {
	test("accepts custom stabilization threshold", () => {
		seedHistory("my-eval", Array(15).fill(0.9));

		// 15% regression with custom 20% threshold - should pass
		const result = checkGate(TEST_PROJECT, "my-eval", 0.765, {
			stabilizationThreshold: 0.2, // 20% instead of default 10%
		});

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("stabilization");
		expect(result.message).toContain("acceptable");
	});

	test("accepts custom production threshold", () => {
		seedHistory("my-eval", Array(60).fill(0.9));

		// 7% regression with custom 10% threshold - should pass
		const result = checkGate(TEST_PROJECT, "my-eval", 0.837, {
			productionThreshold: 0.1, // 10% instead of default 5%
		});

		expect(result.passed).toBe(true);
		expect(result.phase).toBe("production");
	});

	test("custom threshold makes test fail when exceeded", () => {
		seedHistory("my-eval", Array(60).fill(0.9));

		// 7% regression with custom 3% threshold - should fail
		const result = checkGate(TEST_PROJECT, "my-eval", 0.837, {
			productionThreshold: 0.03, // 3% instead of default 5%
		});

		expect(result.passed).toBe(false);
		expect(result.phase).toBe("production");
		expect(result.message).toContain("FAIL");
	});

	test("partial config uses defaults for unspecified thresholds", () => {
		seedHistory("my-eval", Array(15).fill(0.9));

		// Only override production threshold
		const result = checkGate(TEST_PROJECT, "my-eval", 0.88, {
			productionThreshold: 0.01,
			// stabilizationThreshold not specified - uses default 0.1
		});

		expect(result.passed).toBe(true); // 2.2% regression < 10% stabilization default
	});
});
