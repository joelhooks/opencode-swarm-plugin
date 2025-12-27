/**
 * Decision Trace Integration Tests
 *
 * Tests the helper functions that wire decision trace capture into swarm tools.
 * 
 * Note: These tests verify the helper functions don't throw and return expected types.
 * The actual database operations are tested in swarm-mail's decision-trace-store.test.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  traceStrategySelection,
  traceWorkerSpawn,
  traceReviewDecision,
  traceFileSelection,
  traceScopeChange,
  getEpicDecisionTraces,
  getDecisionTracesByType,
  extractMemoryIds,
} from "./decision-trace-integration.js";
import { createLibSQLAdapter, createLibSQLStreamsSchema, getDatabasePath } from "swarm-mail";
import type { DatabaseAdapter } from "swarm-mail";

describe("Decision Trace Integration", () => {
  // Use a test project path - the helpers will create their own DB connection
  const testProjectKey = "/tmp/decision-trace-test-entity-links";
  
  let testDb: DatabaseAdapter;
  let testDbPath: string;
  
  beforeAll(async () => {
    // Use the ACTUAL path that getTraceDb() will use
    testDbPath = getDatabasePath(testProjectKey);
    testDb = await createLibSQLAdapter({ url: `file:${testDbPath}` });
    await createLibSQLStreamsSchema(testDb);
  });
  
  afterAll(async () => {
    await testDb.close?.();
  });

  describe("traceStrategySelection", () => {
    test("captures strategy selection with minimal input", async () => {
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        strategy: "file-based",
        reasoning: "File-based chosen due to clear file boundaries",
      });

      // Should return a trace ID (or empty string on failure)
      expect(typeof traceId).toBe("string");
    });

    test("captures strategy selection with full context", async () => {
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456",
        strategy: "feature-based",
        reasoning: "Feature-based for new functionality",
        confidence: 0.85,
        taskPreview: "Add user authentication with OAuth",
        inputsGathered: [
          { source: "cass", query: "auth oauth", results: 3 },
          { source: "semantic-memory", query: "auth patterns", results: 2 },
        ],
        alternatives: [
          { strategy: "file-based", score: 0.6, reason: "Less suitable for new features" },
        ],
        precedentCited: {
          memoryId: "mem-789",
          similarity: 0.92,
        },
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceWorkerSpawn", () => {
    test("captures worker spawn decision", async () => {
      const traceId = await traceWorkerSpawn({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456.1",
        workerName: "BlueLake",
        subtaskTitle: "Implement auth service",
        files: ["src/auth/service.ts", "src/auth/types.ts"],
        model: "claude-sonnet-4-5",
        spawnOrder: 1,
        isParallel: true,
        rationale: "First subtask in parallel batch",
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceReviewDecision", () => {
    test("captures review approval", async () => {
      const traceId = await traceReviewDecision({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456.1",
        workerId: "BlueLake",
        status: "approved",
        summary: "Clean implementation, tests pass",
        attemptNumber: 1,
        remainingAttempts: 3,
        rationale: "All criteria met",
      });

      expect(typeof traceId).toBe("string");
    });

    test("captures review rejection with issues", async () => {
      const traceId = await traceReviewDecision({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-123",
        beadId: "bead-456.2",
        workerId: "DarkHawk",
        status: "needs_changes",
        summary: "Type safety issues found",
        issues: [
          { file: "src/auth/service.ts", line: 42, issue: "Missing null check", suggestion: "Add optional chaining" },
          { file: "src/auth/types.ts", line: 15, issue: "Type too broad", suggestion: "Use discriminated union" },
        ],
        attemptNumber: 2,
        remainingAttempts: 1,
        rationale: "Critical type safety issues need fixing",
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceFileSelection", () => {
    test("captures file selection decision", async () => {
      const traceId = await traceFileSelection({
        projectKey: testProjectKey,
        agentName: "BlueLake",
        epicId: "epic-123",
        beadId: "bead-456.1",
        filesSelected: ["src/auth/service.ts"],
        filesOwned: ["src/auth/service.ts", "src/auth/types.ts"],
        rationale: "Starting with service implementation",
        scopeExpanded: false,
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("traceScopeChange", () => {
    test("captures scope expansion", async () => {
      const traceId = await traceScopeChange({
        projectKey: testProjectKey,
        agentName: "BlueLake",
        epicId: "epic-123",
        beadId: "bead-456.1",
        filesAdded: ["src/auth/utils.ts"],
        reason: "Need utility functions for token handling",
        coordinatorApproved: true,
      });

      expect(typeof traceId).toBe("string");
    });

    test("captures scope contraction", async () => {
      const traceId = await traceScopeChange({
        projectKey: testProjectKey,
        agentName: "DarkHawk",
        epicId: "epic-123",
        beadId: "bead-456.2",
        filesRemoved: ["src/auth/legacy.ts"],
        reason: "Legacy file not needed for this task",
        coordinatorApproved: false,
      });

      expect(typeof traceId).toBe("string");
    });
  });

  describe("Query helpers", () => {
    test("getEpicDecisionTraces returns array", async () => {
      const traces = await getEpicDecisionTraces(testProjectKey, "epic-123");
      // Should return an array (may be empty if traces weren't persisted to this DB)
      expect(Array.isArray(traces)).toBe(true);
    });

    test("getDecisionTracesByType returns array", async () => {
      const traces = await getDecisionTracesByType(testProjectKey, "strategy_selection");
      expect(Array.isArray(traces)).toBe(true);
    });
  });
  
  describe("extractMemoryIds", () => {
    test("returns empty array for undefined precedent", () => {
      const result = extractMemoryIds(undefined);
      expect(result).toEqual([]);
    });
    
    test("returns empty array for null precedent", () => {
      const result = extractMemoryIds(null);
      expect(result).toEqual([]);
    });
    
    test("returns empty array for precedent without memoryId", () => {
      const result = extractMemoryIds({ similarity: 0.85 });
      expect(result).toEqual([]);
    });
    
    test("returns array with single memoryId", () => {
      const result = extractMemoryIds({ memoryId: "mem-123", similarity: 0.92 });
      expect(result).toEqual(["mem-123"]);
    });
    
    test("returns array from memoryIds field", () => {
      const result = extractMemoryIds({ 
        memoryIds: ["mem-123", "mem-456"],
        similarity: 0.88 
      });
      expect(result).toEqual(["mem-123", "mem-456"]);
    });
    
    test("handles empty memoryIds array", () => {
      const result = extractMemoryIds({ memoryIds: [] });
      expect(result).toEqual([]);
    });
  });
  
  describe("Entity Link Creation", () => {
    test("traceStrategySelection creates no entity links without precedent", async () => {
      // Call trace function without precedent
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        strategy: "file-based",
        reasoning: "No precedent case",
      });
      
      expect(traceId).toBeTruthy();
      
      // Query entity links - should be none
      const result = await testDb.query(
        `SELECT * FROM entity_links WHERE source_decision_id = ?`,
        [traceId]
      );
      
      expect(result.rows?.length || 0).toBe(0);
    });
    
    test("traceStrategySelection creates entity link for memory precedent", async () => {
      // Call trace function WITH precedent
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-entity-test",
        strategy: "feature-based",
        reasoning: "Using precedent",
        precedentCited: {
          memoryId: "mem-abc123",
          similarity: 0.95,
        },
      });
      
      expect(traceId).toBeTruthy();
      
      // Query entity links
      const result = await testDb.query(
        `SELECT * FROM entity_links WHERE source_decision_id = ?`,
        [traceId]
      );
      
      // Should have created one entity link
      expect(result.rows?.length).toBe(1);
      
      const link = result.rows?.[0];
      expect(link?.target_entity_type).toBe("memory");
      expect(link?.target_entity_id).toBe("mem-abc123");
      expect(link?.link_type).toBe("cites_precedent");
      expect(link?.strength).toBe(0.95);
      expect(link?.context).toContain("precedent");
    });
    
    test("traceStrategySelection creates multiple entity links for multiple memories", async () => {
      const traceId = await traceStrategySelection({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-multi-mem",
        strategy: "risk-based",
        reasoning: "Multiple precedents",
        precedentCited: {
          memoryIds: ["mem-xyz789", "mem-def456"],
          similarity: 0.88,
        },
      });
      
      expect(traceId).toBeTruthy();
      
      // Query entity links
      const result = await testDb.query(
        `SELECT * FROM entity_links WHERE source_decision_id = ? ORDER BY target_entity_id`,
        [traceId]
      );
      
      // Should have created two entity links
      expect(result.rows?.length).toBe(2);
      
      const links = result.rows || [];
      expect(links[0]?.target_entity_id).toBe("mem-def456");
      expect(links[1]?.target_entity_id).toBe("mem-xyz789");
      
      links.forEach(link => {
        expect(link?.target_entity_type).toBe("memory");
        expect(link?.link_type).toBe("cites_precedent");
        expect(link?.strength).toBe(0.88);
      });
    });
    
    test("traceWorkerSpawn creates entity links for assigned files", async () => {
      const traceId = await traceWorkerSpawn({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-files",
        beadId: "bead-123",
        subtaskTitle: "Implement auth",
        files: ["src/auth.ts", "src/types.ts"],
      });
      
      expect(traceId).toBeTruthy();
      
      // Query entity links
      const result = await testDb.query(
        `SELECT * FROM entity_links WHERE source_decision_id = ? ORDER BY target_entity_id`,
        [traceId]
      );
      
      // Should have created file entity links
      expect(result.rows?.length).toBe(2);
      
      const links = result.rows || [];
      expect(links[0]?.target_entity_type).toBe("file");
      expect(links[0]?.target_entity_id).toBe("src/auth.ts");
      expect(links[0]?.link_type).toBe("assigns_file");
      
      expect(links[1]?.target_entity_id).toBe("src/types.ts");
    });
    
    test("traceReviewDecision creates entity link to worker agent", async () => {
      const traceId = await traceReviewDecision({
        projectKey: testProjectKey,
        agentName: "coordinator",
        epicId: "epic-review",
        beadId: "bead-456",
        workerId: "DarkHawk",
        status: "approved",
        summary: "Good work",
      });
      
      expect(traceId).toBeTruthy();
      
      // Query entity links
      const result = await testDb.query(
        `SELECT * FROM entity_links WHERE source_decision_id = ?`,
        [traceId]
      );
      
      // Should have created agent entity link
      expect(result.rows?.length).toBe(1);
      
      const link = result.rows?.[0];
      expect(link?.target_entity_type).toBe("agent");
      expect(link?.target_entity_id).toBe("DarkHawk");
      expect(link?.link_type).toBe("reviewed_work_by");
    });
  });
});
