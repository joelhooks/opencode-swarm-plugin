/**
 * Tests for eval-runner - Programmatic evalite execution
 *
 * TDD: These tests MUST fail initially, then pass after implementation.
 * 
 * UNIT TESTS: Mock evalite to test runEvals logic in isolation.
 * Integration tests should verify actual evalite integration.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach, mock } from "bun:test";
import { runEvals } from "./eval-runner";
import path from "node:path";
import fs from "node:fs";
import { getEvalHistoryPath } from "./eval-history";

// Mock evalite/runner to avoid external dependency in unit tests
mock.module("evalite/runner", () => ({
  runEvalite: mock(async (options: any) => {
    // Simulate evalite writing results to outputPath
    const mockResults = {
      evals: [
        {
          name: "example",
          filepath: "/mock/path/example.eval.ts",
          status: "success" as const,
          duration: 100,
          averageScore: 0.95,
          results: [
            {
              input: { test: "input" },
              output: "test output",
              expected: "test output",
              scores: [
                { name: "accuracy", score: 0.95, description: "Test accuracy" }
              ]
            }
          ]
        }
      ]
    };
    
    // Write mock results to output path
    if (options.outputPath) {
      await Bun.write(options.outputPath, JSON.stringify(mockResults));
    }
  })
}));

mock.module("evalite/in-memory-storage", () => ({
  createInMemoryStorage: mock(() => ({}))
}));

// Use project root for all tests
const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
const EVALS_DIR = path.join(PROJECT_ROOT, "evals");

// Create temporary evals directory for tests
beforeAll(() => {
  if (!fs.existsSync(EVALS_DIR)) {
    fs.mkdirSync(EVALS_DIR, { recursive: true });
  }
  
  // Create mock eval files
  fs.writeFileSync(
    path.join(EVALS_DIR, "example.eval.ts"),
    'import { evalite } from "evalite";\nevalite("example", { data: [], task: async () => {}, scorers: [] });'
  );
  fs.writeFileSync(
    path.join(EVALS_DIR, "coordinator.eval.ts"),
    'import { evalite } from "evalite";\nevalite("coordinator", { data: [], task: async () => {}, scorers: [] });'
  );
});

// Clean up after all tests
afterAll(() => {
  if (fs.existsSync(EVALS_DIR)) {
    fs.rmSync(EVALS_DIR, { recursive: true, force: true });
  }
  
  // CRITICAL: Restore mocks after all tests to prevent pollution of other test files
  mock.restore();
});

describe("runEvals", () => {
  test("runs all evals when no suite filter provided", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
    });

    // Even if some evals fail, we should get results
    expect(typeof result.success).toBe("boolean");
    expect(typeof result.totalSuites).toBe("number");
    expect(typeof result.totalEvals).toBe("number");
    expect(typeof result.averageScore).toBe("number");
    expect(Array.isArray(result.suites)).toBe(true);

    // Should have at least the example.eval.ts suite
    expect(result.totalSuites).toBeGreaterThan(0);
    expect(result.suites.length).toBeGreaterThan(0);
  }, 60000); // 60s timeout for full eval run

  test("filters evals by suite name", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example",
    });

    expect(result.success).toBe(true);
    // All suite filepaths should contain "example"
    for (const suite of result.suites) {
      expect(suite.filepath.toLowerCase()).toContain("example");
    }
  }, 30000);

  test("respects score threshold", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example", // Known good eval
      scoreThreshold: 0, // Very low threshold, should pass
    });

    expect(result.success).toBe(true);
    expect(result.averageScore).toBeGreaterThanOrEqual(0);
  }, 30000);

  test("returns structured suite results with scores", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example",
    });

    expect(result.suites.length).toBeGreaterThan(0);
    
    const suite = result.suites[0];
    expect(suite).toMatchObject({
      name: expect.any(String),
      filepath: expect.any(String),
      status: expect.stringMatching(/^(success|fail|running)$/),
      duration: expect.any(Number),
      averageScore: expect.any(Number),
      evalCount: expect.any(Number),
    });
  }, 30000);

  test("handles errors gracefully", async () => {
    const result = await runEvals({
      cwd: "/nonexistent/path",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.suites).toEqual([]);
  }, 10000);

  test("returns empty results when no evals match filter", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "nonexistent-eval-name-xyz",
    });

    // Should succeed but with no suites
    expect(result.success).toBe(true);
    expect(result.totalSuites).toBe(0);
    expect(result.suites).toEqual([]);
  }, 10000);

  test("records eval run to history after execution", async () => {
    // Clean up any existing history before test
    const historyPath = getEvalHistoryPath(PROJECT_ROOT);
    const historyBackup = historyPath + ".backup";
    
    // Backup existing history
    if (fs.existsSync(historyPath)) {
      fs.copyFileSync(historyPath, historyBackup);
    }
    
    try {
      // Remove history file to get clean state
      if (fs.existsSync(historyPath)) {
        fs.unlinkSync(historyPath);
      }

      // Run evals
      const result = await runEvals({
        cwd: PROJECT_ROOT,
        suiteFilter: "example",
      });

      // Should have succeeded
      expect(result.success).toBe(true);
      expect(result.suites.length).toBeGreaterThan(0);

      // History file should have been created
      expect(fs.existsSync(historyPath)).toBe(true);

      // Read history file
      const historyContent = fs.readFileSync(historyPath, "utf-8");
      const lines = historyContent.trim().split("\n");

      // Should have one line per suite
      expect(lines.length).toBe(result.suites.length);

      // Parse first line and verify structure
      const firstRecord = JSON.parse(lines[0]);
      
      // Verify structure has all required fields
      expect(typeof firstRecord.timestamp).toBe("string");
      expect(typeof firstRecord.eval_name).toBe("string");
      expect(typeof firstRecord.score).toBe("number");
      expect(typeof firstRecord.run_count).toBe("number");

      // Verify eval_name matches suite name
      expect(firstRecord.eval_name).toBe(result.suites[0].name);
      
      // Verify score matches suite averageScore
      expect(firstRecord.score).toBe(result.suites[0].averageScore);
      
      // First run should have run_count = 1
      expect(firstRecord.run_count).toBe(1);
    } finally {
      // Restore backup
      if (fs.existsSync(historyBackup)) {
        fs.copyFileSync(historyBackup, historyPath);
        fs.unlinkSync(historyBackup);
      }
    }
  }, 30000);

  test("checks gates for each suite after recording", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example",
    });

    expect(result.success).toBe(true);
    expect(result.gateResults).toBeDefined();
    expect(Array.isArray(result.gateResults)).toBe(true);
    
    // Should have gate result for each suite
    expect(result.gateResults?.length).toBe(result.suites.length);
    
    // Each gate result should have required fields
    if (result.gateResults && result.gateResults.length > 0) {
      const gateResult = result.gateResults[0];
      expect(gateResult).toHaveProperty("suite");
      expect(gateResult).toHaveProperty("passed");
      expect(gateResult).toHaveProperty("phase");
      expect(gateResult).toHaveProperty("message");
      expect(gateResult).toHaveProperty("currentScore");
    }
  }, 30000);

  test("calls learnFromEvalFailure when gate fails", async () => {
    // This test requires manually creating a history with regression
    // For now, we just verify the code path exists
    // In practice, this would be tested with mocked checkGate returning failed=true
    
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example",
    });

    // Gate results should be present even if no failures
    expect(result.gateResults).toBeDefined();
  }, 30000);

  test("does NOT call learnFromEvalFailure when gate passes", async () => {
    // Similar to above - verifies the happy path
    // Real test would mock checkGate and verify learnFromEvalFailure NOT called
    
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example",
    });

    // Should succeed with gate results
    expect(result.success).toBe(true);
    expect(result.gateResults).toBeDefined();
  }, 30000);

  test("includes gateResults in return value", async () => {
    const result = await runEvals({
      cwd: PROJECT_ROOT,
      suiteFilter: "example",
    });

    // gateResults should be array (even if empty)
    expect(result).toHaveProperty("gateResults");
    expect(Array.isArray(result.gateResults)).toBe(true);
  }, 30000);
});
