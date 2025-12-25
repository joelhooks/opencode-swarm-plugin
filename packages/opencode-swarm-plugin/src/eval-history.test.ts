/**
 * Tests for eval-history - tracks eval run scores and calculates progressive phases
 *
 * TDD: RED phase - all tests should fail initially
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  type EvalRunRecord,
  type Phase,
  calculateVariance,
  getPhase,
  getScoreHistory,
  recordEvalRun,
} from "./eval-history.js";

describe("eval-history", () => {
  const testDir = path.join(import.meta.dir, ".test-eval-history");
  const testProjectPath = path.join(testDir, "test-project");

  beforeEach(() => {
    // Clean slate for each test
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testProjectPath, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe("recordEvalRun", () => {
    test("appends eval run to JSONL file", () => {
      const run: EvalRunRecord = {
        timestamp: new Date().toISOString(),
        eval_name: "swarm-decomposition",
        score: 0.85,
        run_count: 1,
      };

      recordEvalRun(testProjectPath, run);

      const historyPath = path.join(testProjectPath, ".opencode/eval-history.jsonl");
      expect(fs.existsSync(historyPath)).toBe(true);

      const content = fs.readFileSync(historyPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.eval_name).toBe("swarm-decomposition");
      expect(parsed.score).toBe(0.85);
      expect(parsed.run_count).toBe(1);
    });

    test("appends multiple runs sequentially", () => {
      const run1: EvalRunRecord = {
        timestamp: new Date().toISOString(),
        eval_name: "swarm-decomposition",
        score: 0.80,
        run_count: 1,
      };
      const run2: EvalRunRecord = {
        timestamp: new Date().toISOString(),
        eval_name: "swarm-decomposition",
        score: 0.85,
        run_count: 2,
      };

      recordEvalRun(testProjectPath, run1);
      recordEvalRun(testProjectPath, run2);

      const historyPath = path.join(testProjectPath, ".opencode/eval-history.jsonl");
      const content = fs.readFileSync(historyPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]);
      const parsed2 = JSON.parse(lines[1]);
      expect(parsed1.score).toBe(0.80);
      expect(parsed2.score).toBe(0.85);
    });

    test("creates directory if it doesn't exist", () => {
      const run: EvalRunRecord = {
        timestamp: new Date().toISOString(),
        eval_name: "test-eval",
        score: 0.90,
        run_count: 1,
      };

      // Directory doesn't exist yet
      const opencodePath = path.join(testProjectPath, ".opencode");
      expect(fs.existsSync(opencodePath)).toBe(false);

      recordEvalRun(testProjectPath, run);

      // Directory should be created
      expect(fs.existsSync(opencodePath)).toBe(true);
    });

    test("supports different eval names in same history", () => {
      const run1: EvalRunRecord = {
        timestamp: new Date().toISOString(),
        eval_name: "swarm-decomposition",
        score: 0.85,
        run_count: 1,
      };
      const run2: EvalRunRecord = {
        timestamp: new Date().toISOString(),
        eval_name: "coordinator-session",
        score: 0.75,
        run_count: 1,
      };

      recordEvalRun(testProjectPath, run1);
      recordEvalRun(testProjectPath, run2);

      const historyPath = path.join(testProjectPath, ".opencode/eval-history.jsonl");
      const content = fs.readFileSync(historyPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(2);

      const parsed1 = JSON.parse(lines[0]);
      const parsed2 = JSON.parse(lines[1]);
      expect(parsed1.eval_name).toBe("swarm-decomposition");
      expect(parsed2.eval_name).toBe("coordinator-session");
    });
  });

  describe("getScoreHistory", () => {
    test("returns empty array when no history exists", () => {
      const history = getScoreHistory(testProjectPath, "swarm-decomposition");
      expect(history).toEqual([]);
    });

    test("returns all runs for a specific eval", () => {
      const runs: EvalRunRecord[] = [
        {
          timestamp: new Date().toISOString(),
          eval_name: "swarm-decomposition",
          score: 0.80,
          run_count: 1,
        },
        {
          timestamp: new Date().toISOString(),
          eval_name: "swarm-decomposition",
          score: 0.85,
          run_count: 2,
        },
        {
          timestamp: new Date().toISOString(),
          eval_name: "coordinator-session",
          score: 0.70,
          run_count: 1,
        },
      ];

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const history = getScoreHistory(testProjectPath, "swarm-decomposition");
      expect(history).toHaveLength(2);
      expect(history[0].score).toBe(0.80);
      expect(history[1].score).toBe(0.85);
    });

    test("filters by eval_name correctly", () => {
      const runs: EvalRunRecord[] = [
        {
          timestamp: new Date().toISOString(),
          eval_name: "swarm-decomposition",
          score: 0.80,
          run_count: 1,
        },
        {
          timestamp: new Date().toISOString(),
          eval_name: "coordinator-session",
          score: 0.70,
          run_count: 1,
        },
        {
          timestamp: new Date().toISOString(),
          eval_name: "swarm-decomposition",
          score: 0.85,
          run_count: 2,
        },
      ];

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const decompositionHistory = getScoreHistory(testProjectPath, "swarm-decomposition");
      const coordinatorHistory = getScoreHistory(testProjectPath, "coordinator-session");

      expect(decompositionHistory).toHaveLength(2);
      expect(coordinatorHistory).toHaveLength(1);
      expect(coordinatorHistory[0].score).toBe(0.70);
    });

    test("returns runs in chronological order", () => {
      const baseTime = Date.now();
      const runs: EvalRunRecord[] = [
        {
          timestamp: new Date(baseTime).toISOString(),
          eval_name: "test-eval",
          score: 0.80,
          run_count: 1,
        },
        {
          timestamp: new Date(baseTime + 1000).toISOString(),
          eval_name: "test-eval",
          score: 0.85,
          run_count: 2,
        },
        {
          timestamp: new Date(baseTime + 2000).toISOString(),
          eval_name: "test-eval",
          score: 0.90,
          run_count: 3,
        },
      ];

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const history = getScoreHistory(testProjectPath, "test-eval");
      expect(history).toHaveLength(3);
      expect(history[0].score).toBe(0.80);
      expect(history[1].score).toBe(0.85);
      expect(history[2].score).toBe(0.90);
    });
  });

  describe("calculateVariance", () => {
    test("returns 0 for single score", () => {
      const variance = calculateVariance([0.85]);
      expect(variance).toBe(0);
    });

    test("returns 0 for identical scores", () => {
      const variance = calculateVariance([0.80, 0.80, 0.80, 0.80]);
      expect(variance).toBe(0);
    });

    test("calculates variance for varying scores", () => {
      // Scores: 0.70, 0.80, 0.90
      // Mean: 0.80
      // Deviations: -0.10, 0, 0.10
      // Squared deviations: 0.01, 0, 0.01
      // Variance: 0.02 / 3 = 0.00666...
      const variance = calculateVariance([0.70, 0.80, 0.90]);
      expect(variance).toBeCloseTo(0.00667, 5);
    });

    test("calculates variance for larger dataset", () => {
      // 10 scores with controlled variance
      const scores = [0.75, 0.76, 0.77, 0.78, 0.79, 0.80, 0.81, 0.82, 0.83, 0.84];
      const variance = calculateVariance(scores);
      expect(variance).toBeGreaterThan(0);
      expect(variance).toBeLessThan(0.01); // Should be small but not zero
    });

    test("handles empty array", () => {
      const variance = calculateVariance([]);
      expect(variance).toBe(0);
    });

    test("handles high variance scores", () => {
      const scores = [0.10, 0.50, 0.90];
      const variance = calculateVariance(scores);
      expect(variance).toBeGreaterThan(0.05);
    });
  });

  describe("getPhase", () => {
    test("returns bootstrap phase for <10 runs", () => {
      const runs: EvalRunRecord[] = [];
      for (let i = 1; i <= 9; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.80 + Math.random() * 0.1,
          run_count: i,
        });
      }

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const phase = getPhase(testProjectPath, "test-eval");
      expect(phase).toBe("bootstrap");
    });

    test("returns stabilization phase for 10-50 runs", () => {
      const runs: EvalRunRecord[] = [];
      for (let i = 1; i <= 25; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.80 + Math.random() * 0.1,
          run_count: i,
        });
      }

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const phase = getPhase(testProjectPath, "test-eval");
      expect(phase).toBe("stabilization");
    });

    test("returns production phase for >50 runs with low variance", () => {
      const runs: EvalRunRecord[] = [];
      // Create 60 runs with very low variance (0.80 ± 0.01)
      for (let i = 1; i <= 60; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.80 + (Math.random() * 0.02 - 0.01), // Variance ~0.00003
          run_count: i,
        });
      }

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const phase = getPhase(testProjectPath, "test-eval");
      expect(phase).toBe("production");
    });

    test("returns stabilization phase for >50 runs with high variance", () => {
      const runs: EvalRunRecord[] = [];
      // Create 60 runs with high variance
      // Variance = 0.1225 for alternating 0.1 and 0.8
      for (let i = 1; i <= 60; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: i % 2 === 0 ? 0.1 : 0.8,
          run_count: i,
        });
      }

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const phase = getPhase(testProjectPath, "test-eval");
      expect(phase).toBe("stabilization");
    });

    test("returns bootstrap phase when no history exists", () => {
      const phase = getPhase(testProjectPath, "nonexistent-eval");
      expect(phase).toBe("bootstrap");
    });

    test("phase transitions at exactly 10 runs", () => {
      const runs: EvalRunRecord[] = [];
      for (let i = 1; i <= 10; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.80,
          run_count: i,
        });
      }

      // Record 9 runs - should be bootstrap
      for (let i = 0; i < 9; i++) {
        recordEvalRun(testProjectPath, runs[i]);
      }
      expect(getPhase(testProjectPath, "test-eval")).toBe("bootstrap");

      // Add 10th run - should be stabilization
      recordEvalRun(testProjectPath, runs[9]);
      expect(getPhase(testProjectPath, "test-eval")).toBe("stabilization");
    });

    test("phase transitions at exactly 50 runs with low variance", () => {
      const runs: EvalRunRecord[] = [];
      for (let i = 1; i <= 51; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.80 + (Math.random() * 0.02 - 0.01),
          run_count: i,
        });
      }

      // Record 50 runs - should be stabilization
      for (let i = 0; i < 50; i++) {
        recordEvalRun(testProjectPath, runs[i]);
      }
      expect(getPhase(testProjectPath, "test-eval")).toBe("stabilization");

      // Add 51st run - should be production (if variance is low)
      recordEvalRun(testProjectPath, runs[50]);
      const phase = getPhase(testProjectPath, "test-eval");
      expect(phase).toBe("production");
    });

    test("variance threshold is 0.1", () => {
      const runs: EvalRunRecord[] = [];

      // Create 60 runs with variance just below 0.1
      // Mean = 0.80, stdev = 0.30, variance = 0.09
      for (let i = 1; i <= 60; i++) {
        runs.push({
          timestamp: new Date().toISOString(),
          eval_name: "test-eval",
          score: 0.80 + (i % 2 === 0 ? 0.15 : -0.15), // Produces variance ~0.0225
          run_count: i,
        });
      }

      for (const run of runs) {
        recordEvalRun(testProjectPath, run);
      }

      const phase = getPhase(testProjectPath, "test-eval");
      expect(phase).toBe("production");
    });
  });

  describe("phase progression integration", () => {
    test("complete lifecycle: bootstrap -> stabilization -> production", () => {
      const evalName = "lifecycle-test";

      // Phase 1: Bootstrap (0-9 runs)
      for (let i = 1; i <= 5; i++) {
        recordEvalRun(testProjectPath, {
          timestamp: new Date().toISOString(),
          eval_name: evalName,
          score: 0.75 + Math.random() * 0.2,
          run_count: i,
        });
      }
      expect(getPhase(testProjectPath, evalName)).toBe("bootstrap");

      // Phase 2: Stabilization (10-50 runs)
      for (let i = 6; i <= 30; i++) {
        recordEvalRun(testProjectPath, {
          timestamp: new Date().toISOString(),
          eval_name: evalName,
          score: 0.78 + Math.random() * 0.1,
          run_count: i,
        });
      }
      expect(getPhase(testProjectPath, evalName)).toBe("stabilization");

      // Phase 3: Production (>50 runs, low variance)
      for (let i = 31; i <= 60; i++) {
        recordEvalRun(testProjectPath, {
          timestamp: new Date().toISOString(),
          eval_name: evalName,
          score: 0.82 + (Math.random() * 0.02 - 0.01), // Very stable
          run_count: i,
        });
      }
      expect(getPhase(testProjectPath, evalName)).toBe("production");

      // Verify history
      const history = getScoreHistory(testProjectPath, evalName);
      expect(history).toHaveLength(60);
    });

    test("regression in production keeps phase as stabilization if variance increases", () => {
      const evalName = "regression-test";

      // Build stable production phase
      for (let i = 1; i <= 60; i++) {
        recordEvalRun(testProjectPath, {
          timestamp: new Date().toISOString(),
          eval_name: evalName,
          score: 0.85 + (Math.random() * 0.01 - 0.005),
          run_count: i,
        });
      }
      expect(getPhase(testProjectPath, evalName)).toBe("production");

      // Introduce regression (high variance) - need 50 wild runs to push variance > 0.1
      // 60 stable @ 0.85 + 50 wild @ 0.1/0.9 = variance ~0.103
      for (let i = 61; i <= 110; i++) {
        recordEvalRun(testProjectPath, {
          timestamp: new Date().toISOString(),
          eval_name: evalName,
          score: i % 2 === 0 ? 0.1 : 0.9,
          run_count: i,
        });
      }

      // Should drop back to stabilization due to high variance
      expect(getPhase(testProjectPath, evalName)).toBe("stabilization");
    });
  });
});
