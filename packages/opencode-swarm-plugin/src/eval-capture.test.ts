/**
 * Tests for eval-capture coordinator event schemas and session capture
 */
import { type Mock, afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type CoordinatorEvent,
  CoordinatorEventSchema,
  type CoordinatorSession,
  CoordinatorSessionSchema,
  captureCoordinatorEvent,
  saveSession,
} from "./eval-capture.js";

describe("CoordinatorEvent schemas", () => {
  describe("DECISION events", () => {
    test("validates strategy_selected event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "strategy_selected",
        payload: {
          strategy: "file-based",
          reasoning: "Files are well isolated",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates worker_spawned event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "worker_spawned",
        payload: {
          worker_id: "GreenStorm",
          subtask_id: "bd-123.1",
          files: ["src/test.ts"],
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates review_completed event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "review_completed",
        payload: {
          subtask_id: "bd-123.1",
          approved: true,
          issues_found: 0,
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates decomposition_complete event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "decomposition_complete",
        payload: {
          subtask_count: 3,
          strategy: "feature-based",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });
  });

  describe("VIOLATION events", () => {
    test("validates coordinator_edited_file event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "VIOLATION",
        violation_type: "coordinator_edited_file",
        payload: {
          file: "src/bad.ts",
          operation: "edit",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates coordinator_ran_tests event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "VIOLATION",
        violation_type: "coordinator_ran_tests",
        payload: {
          command: "bun test",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates coordinator_reserved_files event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "VIOLATION",
        violation_type: "coordinator_reserved_files",
        payload: {
          files: ["src/auth.ts"],
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates no_worker_spawned event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "VIOLATION",
        violation_type: "no_worker_spawned",
        payload: {
          subtask_id: "bd-123.1",
          reason: "Did work directly",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });
  });

  describe("OUTCOME events", () => {
    test("validates subtask_success event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "OUTCOME",
        outcome_type: "subtask_success",
        payload: {
          subtask_id: "bd-123.1",
          duration_ms: 45000,
          files_touched: ["src/auth.ts"],
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates subtask_retry event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "OUTCOME",
        outcome_type: "subtask_retry",
        payload: {
          subtask_id: "bd-123.1",
          retry_count: 2,
          reason: "Review rejected",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates subtask_failed event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "OUTCOME",
        outcome_type: "subtask_failed",
        payload: {
          subtask_id: "bd-123.1",
          error: "Type error in auth.ts",
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });

    test("validates epic_complete event", () => {
      const event: CoordinatorEvent = {
        session_id: "test-session",
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "OUTCOME",
        outcome_type: "epic_complete",
        payload: {
          success: true,
          total_duration_ms: 180000,
          subtasks_completed: 3,
        },
      };

      expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    });
  });
});

describe("CoordinatorSession schema", () => {
  test("validates complete session", () => {
    const session: CoordinatorSession = {
      session_id: "test-session",
      epic_id: "bd-123",
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      events: [
        {
          session_id: "test-session",
          epic_id: "bd-123",
          timestamp: new Date().toISOString(),
          event_type: "DECISION",
          decision_type: "strategy_selected",
          payload: { strategy: "file-based" },
        },
      ],
    };

    expect(() => CoordinatorSessionSchema.parse(session)).not.toThrow();
  });

  test("validates session without end_time", () => {
    const session: Partial<CoordinatorSession> = {
      session_id: "test-session",
      epic_id: "bd-123",
      start_time: new Date().toISOString(),
      events: [],
    };

    expect(() => CoordinatorSessionSchema.parse(session)).not.toThrow();
  });
});

describe("captureCoordinatorEvent", () => {
  let sessionDir: string;
  let sessionId: string;

  beforeEach(() => {
    sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
    sessionId = `test-${Date.now()}`;
  });

  afterEach(() => {
    // Clean up test session file
    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
  });

  test("creates session directory if not exists", () => {
    const event: CoordinatorEvent = {
      session_id: sessionId,
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "DECISION",
      decision_type: "strategy_selected",
      payload: { strategy: "file-based" },
    };

    captureCoordinatorEvent(event);

    expect(fs.existsSync(sessionDir)).toBe(true);
  });

  test("appends event to session file", () => {
    const event: CoordinatorEvent = {
      session_id: sessionId,
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "DECISION",
      decision_type: "strategy_selected",
      payload: { strategy: "file-based" },
    };

    captureCoordinatorEvent(event);

    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    expect(fs.existsSync(sessionPath)).toBe(true);

    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.session_id).toBe(sessionId);
    expect(parsed.event_type).toBe("DECISION");
  });

  test("appends multiple events to same session", () => {
    const event1: CoordinatorEvent = {
      session_id: sessionId,
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "DECISION",
      decision_type: "strategy_selected",
      payload: { strategy: "file-based" },
    };

    const event2: CoordinatorEvent = {
      session_id: sessionId,
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "VIOLATION",
      violation_type: "coordinator_edited_file",
      payload: { file: "src/bad.ts" },
    };

    captureCoordinatorEvent(event1);
    captureCoordinatorEvent(event2);

    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("saveSession", () => {
  let sessionDir: string;
  let sessionId: string;

  beforeEach(() => {
    sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
    sessionId = `test-${Date.now()}`;
  });

  afterEach(() => {
    // Clean up test session file
    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
  });

  test("wraps events in session structure", () => {
    // Capture some events
    const event1: CoordinatorEvent = {
      session_id: sessionId,
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "DECISION",
      decision_type: "strategy_selected",
      payload: { strategy: "file-based" },
    };

    captureCoordinatorEvent(event1);

    // Save session
    const session = saveSession({
      session_id: sessionId,
      epic_id: "bd-123",
    });

    expect(session).toBeDefined();
    expect(session.session_id).toBe(sessionId);
    expect(session.events).toHaveLength(1);
    expect(session.start_time).toBeDefined();
    expect(session.end_time).toBeDefined();
  });

  test("returns null if session file does not exist", () => {
    const session = saveSession({
      session_id: "nonexistent",
      epic_id: "bd-999",
    });

    expect(session).toBeNull();
  });
});
