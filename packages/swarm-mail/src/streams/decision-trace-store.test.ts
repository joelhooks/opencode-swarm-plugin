/**
 * Decision Trace Store Tests
 *
 * TDD tests for decision trace storage and retrieval.
 * Tests the service layer for capturing coordinator/worker decision-making.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLibSQLAdapter } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import { createLibSQLStreamsSchema } from "./libsql-schema.js";
import {
  createDecisionTrace,
  getDecisionTracesByEpic,
  getDecisionTracesByAgent,
  getDecisionTracesByType,
  linkOutcomeToTrace,
  type DecisionTraceInput,
  // New functions will be imported dynamically in tests to ensure they exist
} from "./decision-trace-store.js";

describe("DecisionTraceStore", () => {
  let db: DatabaseAdapter;

  beforeAll(async () => {
    db = await createLibSQLAdapter({ url: ":memory:" });
    await createLibSQLStreamsSchema(db);
  });

  afterAll(async () => {
    await db.close?.();
  });

  describe("createDecisionTrace", () => {
    test("creates a decision trace with all fields", async () => {
      const input: DecisionTraceInput = {
        decision_type: "strategy_selection",
        epic_id: "epic-001",
        bead_id: "bead-001",
        agent_name: "coordinator",
        project_key: "/project/path",
        decision: { strategy: "file-based", confidence: 0.85 },
        rationale: "File-based chosen due to clear file boundaries",
        inputs_gathered: [
          { source: "cass", query: "similar tasks", results: 3 },
        ],
        policy_evaluated: { rule: "prefer file-based for <5 files", matched: true },
        alternatives: [
          { strategy: "feature-based", reason: "rejected: cross-cutting concerns" },
        ],
        precedent_cited: { memory_id: "mem-xyz", similarity: 0.92 },
      };

      const trace = await createDecisionTrace(db, input);

      expect(trace.id).toMatch(/^dt-/);
      expect(trace.decision_type).toBe("strategy_selection");
      expect(trace.agent_name).toBe("coordinator");
      expect(trace.rationale).toBe("File-based chosen due to clear file boundaries");
      expect(trace.timestamp).toBeGreaterThan(0);
    });

    test("creates a decision trace with minimal fields", async () => {
      const input: DecisionTraceInput = {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project/path",
        decision: { worker: "BlueLake", task: "bead-002" },
      };

      const trace = await createDecisionTrace(db, input);

      expect(trace.id).toMatch(/^dt-/);
      expect(trace.decision_type).toBe("worker_spawn");
      expect(trace.epic_id).toBeNull();
      expect(trace.rationale).toBeNull();
    });

    test("generates unique IDs for each trace", async () => {
      const input: DecisionTraceInput = {
        decision_type: "review_decision",
        agent_name: "coordinator",
        project_key: "/project/path",
        decision: { approved: true },
      };

      const trace1 = await createDecisionTrace(db, input);
      const trace2 = await createDecisionTrace(db, input);

      expect(trace1.id).not.toBe(trace2.id);
    });
  });

  describe("getDecisionTracesByEpic", () => {
    test("returns all traces for an epic in chronological order", async () => {
      const epicId = "epic-query-test";

      // Create traces with different timestamps
      await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        epic_id: epicId,
        agent_name: "coordinator",
        project_key: "/project",
        decision: { step: 1 },
      });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        epic_id: epicId,
        agent_name: "coordinator",
        project_key: "/project",
        decision: { step: 2 },
      });

      const traces = await getDecisionTracesByEpic(db, epicId);

      expect(traces.length).toBeGreaterThanOrEqual(2);
      expect(traces[0].decision_type).toBe("strategy_selection");
      expect(traces[1].decision_type).toBe("worker_spawn");
    });

    test("returns empty array for non-existent epic", async () => {
      const traces = await getDecisionTracesByEpic(db, "epic-does-not-exist");
      expect(traces).toEqual([]);
    });
  });

  describe("getDecisionTracesByAgent", () => {
    test("returns all traces for an agent", async () => {
      const agentName = "test-agent-unique";

      await createDecisionTrace(db, {
        decision_type: "file_selection",
        agent_name: agentName,
        project_key: "/project",
        decision: { files: ["a.ts", "b.ts"] },
      });

      const traces = await getDecisionTracesByAgent(db, agentName);

      expect(traces.length).toBeGreaterThanOrEqual(1);
      expect(traces[0].agent_name).toBe(agentName);
    });
  });

  describe("getDecisionTracesByType", () => {
    test("returns all traces of a specific type", async () => {
      const uniqueType = "unique_decision_type";

      await createDecisionTrace(db, {
        decision_type: uniqueType,
        agent_name: "coordinator",
        project_key: "/project",
        decision: { unique: true },
      });

      const traces = await getDecisionTracesByType(db, uniqueType);

      expect(traces.length).toBeGreaterThanOrEqual(1);
      expect(traces[0].decision_type).toBe(uniqueType);
    });
  });

  describe("linkOutcomeToTrace", () => {
    test("links an outcome event to a decision trace", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { worker: "BlueLake" },
      });

      const outcomeEventId = 42;
      await linkOutcomeToTrace(db, trace.id, outcomeEventId);

      // Verify by querying
      const result = await db.query<{ outcome_event_id: number }>(
        `SELECT outcome_event_id FROM decision_traces WHERE id = ?`,
        [trace.id]
      );

      expect(result.rows[0].outcome_event_id).toBe(42);
    });
  });

  describe("decision types", () => {
    test("supports strategy_selection type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
        inputs_gathered: [{ source: "cass", results: 5 }],
      });

      expect(trace.decision_type).toBe("strategy_selection");
    });

    test("supports worker_spawn type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { worker: "BlueLake", bead_id: "bead-123" },
      });

      expect(trace.decision_type).toBe("worker_spawn");
    });

    test("supports review_decision type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "review_decision",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { approved: false, issues: ["missing tests"] },
      });

      expect(trace.decision_type).toBe("review_decision");
    });

    test("supports file_selection type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "file_selection",
        agent_name: "worker-1",
        project_key: "/project",
        decision: { files: ["src/auth.ts"], reason: "auth changes" },
      });

      expect(trace.decision_type).toBe("file_selection");
    });

    test("supports scope_change type", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "scope_change",
        agent_name: "worker-1",
        project_key: "/project",
        decision: { added: ["src/utils.ts"], reason: "dependency discovered" },
      });

      expect(trace.decision_type).toBe("scope_change");
    });
  });

  describe("findSimilarDecisions", () => {
    test("finds similar strategy_selection decisions by task description", async () => {
      // Create historical decisions
      await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based", task: "add auth service", confidence: 0.85 },
        rationale: "Clear file boundaries for auth",
      });

      await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "feature-based", task: "add user profiles", confidence: 0.75 },
        rationale: "Cross-cutting UI changes",
      });

      // Find similar decisions - should match "auth" in "add auth service"
      const { findSimilarDecisions } = await import("./decision-trace-store.js");
      const similar = await findSimilarDecisions(db, "auth", 5);

      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0]).toHaveProperty("id");
      expect(similar[0]).toHaveProperty("decision_type", "strategy_selection");
      expect(similar[0]).toHaveProperty("decision");
    });

    test("limits results to specified count", async () => {
      // Create many decisions
      for (let i = 0; i < 10; i++) {
        await createDecisionTrace(db, {
          decision_type: "strategy_selection",
          agent_name: "coordinator",
          project_key: "/project",
          decision: { strategy: "file-based", task: `task ${i}` },
        });
      }

      const { findSimilarDecisions } = await import("./decision-trace-store.js");
      const similar = await findSimilarDecisions(db, "task", 3);

      expect(similar.length).toBeLessThanOrEqual(3);
    });

    test("includes outcome information if linked", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based", task: "auth service" },
      });

      await linkOutcomeToTrace(db, trace.id, 123);

      const { findSimilarDecisions } = await import("./decision-trace-store.js");
      const similar = await findSimilarDecisions(db, "auth", 5);

      const found = similar.find(s => s.id === trace.id);
      expect(found?.outcome_event_id).toBe(123);
    });
  });

  describe("createEntityLink", () => {
    test("creates a link between decision and entity", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      const { createEntityLink } = await import("./decision-trace-store.js");
      const link = await createEntityLink(db, {
        source_decision_id: trace.id,
        target_entity_type: "memory",
        target_entity_id: "mem-xyz",
        link_type: "cites_precedent",
        strength: 0.92,
        context: "Similar auth task from 2 weeks ago",
      });

      expect(link.id).toMatch(/^el-/);
      expect(link.source_decision_id).toBe(trace.id);
      expect(link.target_entity_type).toBe("memory");
      expect(link.link_type).toBe("cites_precedent");
      expect(link.strength).toBe(0.92);
    });

    test("creates link with default strength", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "worker_spawn",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { worker: "BlueLake" },
      });

      const { createEntityLink } = await import("./decision-trace-store.js");
      const link = await createEntityLink(db, {
        source_decision_id: trace.id,
        target_entity_type: "epic",
        target_entity_id: "epic-001",
        link_type: "applies_pattern",
      });

      expect(link.strength).toBe(1.0);
    });

    test("supports all entity types", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      const { createEntityLink } = await import("./decision-trace-store.js");
      const entityTypes = ["epic", "pattern", "file", "agent", "memory"];

      for (const entityType of entityTypes) {
        const link = await createEntityLink(db, {
          source_decision_id: trace.id,
          target_entity_type: entityType,
          target_entity_id: `${entityType}-123`,
          link_type: "similar_to",
        });

        expect(link.target_entity_type).toBe(entityType);
      }
    });
  });

  describe("getDecisionsByMemoryPattern", () => {
    test("finds all decisions that cite a specific memory", async () => {
      const memoryId = "mem-auth-pattern";

      // Create decisions that cite this memory
      const trace1 = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      const trace2 = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "feature-based" },
      });

      const { createEntityLink, getDecisionsByMemoryPattern } = await import("./decision-trace-store.js");
      
      await createEntityLink(db, {
        source_decision_id: trace1.id,
        target_entity_type: "memory",
        target_entity_id: memoryId,
        link_type: "cites_precedent",
      });

      await createEntityLink(db, {
        source_decision_id: trace2.id,
        target_entity_type: "memory",
        target_entity_id: memoryId,
        link_type: "cites_precedent",
      });

      const decisions = await getDecisionsByMemoryPattern(db, memoryId);

      expect(decisions.length).toBeGreaterThanOrEqual(2);
      expect(decisions.map(d => d.id)).toContain(trace1.id);
      expect(decisions.map(d => d.id)).toContain(trace2.id);
    });

    test("returns empty array if memory not cited", async () => {
      const { getDecisionsByMemoryPattern } = await import("./decision-trace-store.js");
      const decisions = await getDecisionsByMemoryPattern(db, "mem-nonexistent");

      expect(decisions).toEqual([]);
    });

    test("includes link metadata with decisions", async () => {
      const memoryId = "mem-with-context";
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      const { createEntityLink, getDecisionsByMemoryPattern } = await import("./decision-trace-store.js");
      
      await createEntityLink(db, {
        source_decision_id: trace.id,
        target_entity_type: "memory",
        target_entity_id: memoryId,
        link_type: "cites_precedent",
        strength: 0.88,
        context: "Very similar auth pattern",
      });

      const decisions = await getDecisionsByMemoryPattern(db, memoryId);

      expect(decisions[0]).toHaveProperty("link_strength", 0.88);
      expect(decisions[0]).toHaveProperty("link_context", "Very similar auth pattern");
    });
  });

  describe("calculateDecisionQuality", () => {
    test("calculates quality score from linked outcome events", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      // Simulate successful outcome by creating events
      const successEvent = await db.query(
        `INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?) RETURNING id`,
        ["swarm.completed", "/project", Date.now(), JSON.stringify({ success: true, errors: 0 })]
      );

      await linkOutcomeToTrace(db, trace.id, successEvent.rows[0].id);

      const { calculateDecisionQuality } = await import("./decision-trace-store.js");
      const quality = await calculateDecisionQuality(db, trace.id);

      expect(quality).toHaveProperty("decision_id", trace.id);
      expect(quality).toHaveProperty("quality_score");
      expect(quality.quality_score).toBeGreaterThan(0);
    });

    test("returns null quality if no outcome linked", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      const { calculateDecisionQuality } = await import("./decision-trace-store.js");
      const quality = await calculateDecisionQuality(db, trace.id);

      expect(quality).toHaveProperty("decision_id", trace.id);
      expect(quality.quality_score).toBeNull();
    });

    test("lower score for decisions with failed outcomes", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      // Simulate failed outcome
      const failEvent = await db.query(
        `INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?) RETURNING id`,
        ["swarm.failed", "/project", Date.now(), JSON.stringify({ success: false, errors: 5 })]
      );

      await linkOutcomeToTrace(db, trace.id, failEvent.rows[0].id);

      const { calculateDecisionQuality } = await import("./decision-trace-store.js");
      const quality = await calculateDecisionQuality(db, trace.id);

      expect(quality.quality_score).toBeLessThanOrEqual(0.5);
    });
  });

  describe("getStrategySuccessRates", () => {
    test("aggregates success rates by strategy type", async () => {
      // Create successful file-based decisions
      for (let i = 0; i < 3; i++) {
        const trace = await createDecisionTrace(db, {
          decision_type: "strategy_selection",
          agent_name: "coordinator",
          project_key: "/project",
          decision: { strategy: "file-based" },
        });

        const event = await db.query(
          `INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?) RETURNING id`,
          ["swarm.completed", "/project", Date.now(), JSON.stringify({ success: true })]
        );

        await linkOutcomeToTrace(db, trace.id, event.rows[0].id);
      }

      // Create failed feature-based decision
      const failTrace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "feature-based" },
      });

      const failEvent = await db.query(
        `INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?) RETURNING id`,
        ["swarm.failed", "/project", Date.now(), JSON.stringify({ success: false })]
      );

      await linkOutcomeToTrace(db, failTrace.id, failEvent.rows[0].id);

      const { getStrategySuccessRates } = await import("./decision-trace-store.js");
      const rates = await getStrategySuccessRates(db);

      expect(rates).toBeInstanceOf(Array);
      const fileBased = rates.find(r => r.strategy === "file-based");
      const featureBased = rates.find(r => r.strategy === "feature-based");

      expect(fileBased).toBeDefined();
      expect(fileBased?.success_rate).toBeGreaterThan(0.5);
      expect(featureBased?.success_rate).toBeLessThan(1.0);
    });

    test("includes decision count and average quality", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "risk-based" },
      });

      const event = await db.query(
        `INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?) RETURNING id`,
        ["swarm.completed", "/project", Date.now(), JSON.stringify({ success: true })]
      );

      await linkOutcomeToTrace(db, trace.id, event.rows[0].id);

      const { getStrategySuccessRates } = await import("./decision-trace-store.js");
      const rates = await getStrategySuccessRates(db);

      const riskBased = rates.find(r => r.strategy === "risk-based");
      expect(riskBased).toHaveProperty("total_decisions");
      expect(riskBased).toHaveProperty("avg_quality");
      expect(riskBased?.total_decisions).toBeGreaterThan(0);
    });

    test("returns empty array if no strategy decisions exist", async () => {
      const { getStrategySuccessRates } = await import("./decision-trace-store.js");
      
      // Clear any existing strategy_selection decisions
      await db.query(`DELETE FROM decision_traces WHERE decision_type = 'strategy_selection'`);
      
      const rates = await getStrategySuccessRates(db);
      expect(rates).toEqual([]);
    });
  });

  describe("linkOutcomeToTrace with quality update", () => {
    test("updates quality_score when linking outcome", async () => {
      const trace = await createDecisionTrace(db, {
        decision_type: "strategy_selection",
        agent_name: "coordinator",
        project_key: "/project",
        decision: { strategy: "file-based" },
      });

      const event = await db.query(
        `INSERT INTO events (type, project_key, timestamp, data) VALUES (?, ?, ?, ?) RETURNING id`,
        ["swarm.completed", "/project", Date.now(), JSON.stringify({ success: true, errors: 0 })]
      );

      await linkOutcomeToTrace(db, trace.id, event.rows[0].id);

      // Check if quality_score was updated
      const result = await db.query<{ quality_score: number | null }>(
        `SELECT quality_score FROM decision_traces WHERE id = ?`,
        [trace.id]
      );

      // Quality score should be computed and stored
      expect(result.rows[0].quality_score).not.toBeNull();
      expect(result.rows[0].quality_score).toBeGreaterThan(0);
    });
  });
});
