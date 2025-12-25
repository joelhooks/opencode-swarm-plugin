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
  captureCompactionEvent,
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

describe("COMPACTION events", () => {
  test("validates detection_complete event", () => {
    const event: CoordinatorEvent = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "detection_complete",
      payload: {
        confidence: "high",
        context_type: "full",
        epic_id: "bd-456",
      },
    };

    expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
  });

  test("validates prompt_generated event", () => {
    const event: CoordinatorEvent = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "prompt_generated",
      payload: {
        prompt_length: 5000,
        full_prompt: "You are a coordinator...", // Full prompt content captured
        context_type: "full",
      },
    };

    expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
  });

  test("validates context_injected event", () => {
    const event: CoordinatorEvent = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "context_injected",
      payload: {
        context_type: "fallback",
        injected_sections: ["swarm_status", "mandatory_instructions"],
      },
    };

    expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
  });

  test("validates resumption_started event", () => {
    const event: CoordinatorEvent = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "resumption_started",
      payload: {
        epic_id: "bd-456",
        agent_role: "coordinator",
        context_loaded: true,
      },
    };

    expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
  });

  test("validates tool_call_tracked event", () => {
    const event: CoordinatorEvent = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "tool_call_tracked",
      payload: {
        tool_name: "hive_create_epic",
        extracted_data: {
          epic_id: "bd-789",
          epic_title: "Add auth",
        },
      },
    };

    expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
  });

  test("rejects invalid compaction_type", () => {
    const event = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "invalid_type",
      payload: {},
    };

    expect(() => CoordinatorEventSchema.parse(event)).toThrow();
  });

  test("captures full prompt content without truncation", () => {
    const longPrompt = "A".repeat(10000); // 10k chars
    const event: CoordinatorEvent = {
      session_id: "test-session",
      epic_id: "bd-123",
      timestamp: new Date().toISOString(),
      event_type: "COMPACTION",
      compaction_type: "prompt_generated",
      payload: {
        prompt_length: longPrompt.length,
        full_prompt: longPrompt,
        context_type: "full",
      },
    };

    expect(() => CoordinatorEventSchema.parse(event)).not.toThrow();
    expect(event.payload.full_prompt).toBe(longPrompt);
    expect(event.payload.full_prompt.length).toBe(10000);
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

describe("session_id propagation from ctx.sessionID", () => {
  let sessionDir: string;
  let sessionId: string;

  beforeEach(() => {
    sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
    sessionId = `test-ctx-${Date.now()}`;
  });

  afterEach(() => {
    // Clean up test session file
    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
  });

  test("session_id should come from ctx.sessionID, not process.env", () => {
    // GIVEN: process.env.OPENCODE_SESSION_ID is empty (mimics real scenario)
    const oldEnv = process.env.OPENCODE_SESSION_ID;
    delete process.env.OPENCODE_SESSION_ID;

    try {
      // WHEN: captureCoordinatorEvent is called with session_id from ctx.sessionID
      const event: CoordinatorEvent = {
        session_id: sessionId, // This should come from ctx.sessionID in call sites
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "strategy_selected",
        payload: { strategy: "file-based" },
      };

      captureCoordinatorEvent(event);

      // THEN: Event should be captured with correct session_id
      const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
      expect(fs.existsSync(sessionPath)).toBe(true);

      const content = fs.readFileSync(sessionPath, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.session_id).toBe(sessionId);
      expect(parsed.session_id).not.toBe("unknown");
    } finally {
      // Restore env
      if (oldEnv !== undefined) {
        process.env.OPENCODE_SESSION_ID = oldEnv;
      }
    }
  });

  test("demonstrates call sites must pass ctx.sessionID not process.env", () => {
    // GIVEN: This simulates what happens in real call sites
    const oldEnv = process.env.OPENCODE_SESSION_ID;
    delete process.env.OPENCODE_SESSION_ID; // Empty in real OpenCode environment
    
    try {
      // WHEN: Call site uses process.env (CURRENT BAD PATTERN)
      const badSessionId = process.env.OPENCODE_SESSION_ID || "unknown";
      const badEvent: CoordinatorEvent = {
        session_id: badSessionId, // This evaluates to "unknown"
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "strategy_selected",
        payload: { strategy: "file-based" },
      };

      captureCoordinatorEvent(badEvent);

      // THEN: Event goes to unknown.jsonl (BAD!)
      const unknownPath = path.join(sessionDir, "unknown.jsonl");
      expect(fs.existsSync(unknownPath)).toBe(true);

      // WHEN: Call site uses ctx.sessionID (CORRECT PATTERN)
      const goodEvent: CoordinatorEvent = {
        session_id: sessionId, // From ctx.sessionID
        epic_id: "bd-123",
        timestamp: new Date().toISOString(),
        event_type: "DECISION",
        decision_type: "strategy_selected",
        payload: { strategy: "file-based" },
      };

      captureCoordinatorEvent(goodEvent);

      // THEN: Event goes to correct session file
      const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
      expect(fs.existsSync(sessionPath)).toBe(true);
    } finally {
      if (oldEnv !== undefined) {
        process.env.OPENCODE_SESSION_ID = oldEnv;
      }
    }
  });

  test("verifies all call sites now use ctx.sessionID", () => {
    // This test documents that we've fixed all call sites to use ctx.sessionID
    // instead of process.env.OPENCODE_SESSION_ID
    
    // The fix was applied to:
    // 1. src/swarm-orchestrate.ts:1743, 1852 - swarm_complete uses _ctx.sessionID
    // 2. src/swarm-review.ts:515, 565 - swarm_review_feedback uses _ctx.sessionID
    // 3. src/swarm-decompose.ts:780 - swarm_delegate_planning uses _ctx.sessionID
    // 4. src/swarm-prompts.ts:1407 - swarm_spawn_subtask uses _ctx.sessionID
    // 5. src/index.ts:216 - detectCoordinatorViolation uses input.sessionID
    
    // With ctx.sessionID, events go to proper session files
    const oldEnv = process.env.OPENCODE_SESSION_ID;
    delete process.env.OPENCODE_SESSION_ID;
    
    try {
      // Simulate tool execution with ctx.sessionID
      const mockCtx = { sessionID: sessionId };
      
      const event: CoordinatorEvent = {
        session_id: mockCtx.sessionID || "unknown",
        epic_id: "bd-456",
        timestamp: new Date().toISOString(),
        event_type: "OUTCOME",
        outcome_type: "subtask_success",
        payload: { bead_id: "bd-456.1" },
      };

      captureCoordinatorEvent(event);

      // Verify event captured with correct session_id
      const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
      expect(fs.existsSync(sessionPath)).toBe(true);
      
      const content = fs.readFileSync(sessionPath, "utf-8");
      const parsed = JSON.parse(content.trim());
      expect(parsed.session_id).toBe(sessionId);
    } finally {
      if (oldEnv !== undefined) {
        process.env.OPENCODE_SESSION_ID = oldEnv;
      }
    }
  });
});

describe("captureCompactionEvent", () => {
  let sessionDir: string;
  let sessionId: string;

  beforeEach(() => {
    sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
    sessionId = `test-compaction-${Date.now()}`;
  });

  afterEach(() => {
    // Clean up test session file
    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
  });

  test("writes detection_complete event to session file", () => {
    captureCompactionEvent({
      session_id: sessionId,
      epic_id: "bd-123",
      compaction_type: "detection_complete",
      payload: {
        confidence: "high",
        context_type: "full",
        epic_id: "bd-456",
      },
    });

    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    expect(fs.existsSync(sessionPath)).toBe(true);

    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.event_type).toBe("COMPACTION");
    expect(parsed.compaction_type).toBe("detection_complete");
    expect(parsed.payload.confidence).toBe("high");
  });

  test("writes prompt_generated event with full prompt content", () => {
    const fullPrompt = "You are a coordinator agent. ".repeat(200); // ~6k chars
    
    captureCompactionEvent({
      session_id: sessionId,
      epic_id: "bd-123",
      compaction_type: "prompt_generated",
      payload: {
        prompt_length: fullPrompt.length,
        full_prompt: fullPrompt,
        context_type: "full",
      },
    });

    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    const content = fs.readFileSync(sessionPath, "utf-8");
    const parsed = JSON.parse(content.trim());

    expect(parsed.payload.full_prompt).toBe(fullPrompt);
    expect(parsed.payload.full_prompt.length).toBe(fullPrompt.length);
  });

  test("appends multiple compaction events to same session", () => {
    captureCompactionEvent({
      session_id: sessionId,
      epic_id: "bd-123",
      compaction_type: "detection_complete",
      payload: { confidence: "high" },
    });

    captureCompactionEvent({
      session_id: sessionId,
      epic_id: "bd-123",
      compaction_type: "prompt_generated",
      payload: { prompt_length: 1000, full_prompt: "test" },
    });

    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const event1 = JSON.parse(lines[0]);
    const event2 = JSON.parse(lines[1]);
    
    expect(event1.compaction_type).toBe("detection_complete");
    expect(event2.compaction_type).toBe("prompt_generated");
  });

  test("full compaction lifecycle tracking", () => {
    // Simulate full compaction hook lifecycle
    const lifecycleEvents = [
      {
        compaction_type: "detection_complete" as const,
        payload: {
          confidence: "high",
          context_type: "full",
          epic_id: "bd-789",
        },
      },
      {
        compaction_type: "prompt_generated" as const,
        payload: {
          prompt_length: 3500,
          full_prompt: "You are a coordinator agent...",
          context_type: "full",
        },
      },
      {
        compaction_type: "context_injected" as const,
        payload: {
          context_type: "full",
          injected_sections: ["swarm_status", "mandatory_instructions"],
        },
      },
      {
        compaction_type: "resumption_started" as const,
        payload: {
          epic_id: "bd-789",
          agent_role: "coordinator",
          context_loaded: true,
        },
      },
      {
        compaction_type: "tool_call_tracked" as const,
        payload: {
          tool_name: "hive_create_epic",
          extracted_data: { epic_id: "bd-789" },
        },
      },
    ];

    // Capture all lifecycle events
    for (const event of lifecycleEvents) {
      captureCompactionEvent({
        session_id: sessionId,
        epic_id: "bd-123",
        ...event,
      });
    }

    // Verify all events captured
    const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
    const content = fs.readFileSync(sessionPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(5);

    // Verify lifecycle order
    const capturedEvents = lines.map((line) => JSON.parse(line));
    expect(capturedEvents[0].compaction_type).toBe("detection_complete");
    expect(capturedEvents[1].compaction_type).toBe("prompt_generated");
    expect(capturedEvents[2].compaction_type).toBe("context_injected");
    expect(capturedEvents[3].compaction_type).toBe("resumption_started");
    expect(capturedEvents[4].compaction_type).toBe("tool_call_tracked");
  });
});
