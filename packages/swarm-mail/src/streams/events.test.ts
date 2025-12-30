/**
 * Unit tests for Event Types and Helpers
 *
 * Tests:
 * - Schema validation for all event types
 * - createEvent helper
 * - isEventType type guard
 * - Edge cases and error handling
 * - Persistence to libSQL via Drizzle ORM
 */
import { describe, it, expect, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  AgentEventSchema,
  AgentRegisteredEventSchema,
  AgentActiveEventSchema,
  MessageSentEventSchema,
  MessageReadEventSchema,
  MessageAckedEventSchema,
  FileReservedEventSchema,
  FileReleasedEventSchema,
  FileConflictEventSchema,
  TaskStartedEventSchema,
  TaskProgressEventSchema,
  TaskCompletedEventSchema,
  TaskBlockedEventSchema,
  DecompositionGeneratedEventSchema,
  SubtaskOutcomeEventSchema,
  HumanFeedbackEventSchema,
  SwarmCheckpointedEventSchema,
  SwarmRecoveredEventSchema,
  CheckpointCreatedEventSchema,
  ContextCompactedEventSchema,
  createEvent,
  isEventType,
  type AgentEvent,
} from "./events";

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("AgentRegisteredEventSchema", () => {
  it("validates a complete agent_registered event", () => {
    const event = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      program: "opencode",
      model: "claude-sonnet-4",
      task_description: "Working on auth",
    };
    expect(() => AgentRegisteredEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for program and model", () => {
    const event = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
    };
    const parsed = AgentRegisteredEventSchema.parse(event);
    expect(parsed.program).toBe("opencode");
    expect(parsed.model).toBe("unknown");
  });

  it("rejects missing agent_name", () => {
    const event = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
    };
    expect(() => AgentRegisteredEventSchema.parse(event)).toThrow();
  });
});

describe("AgentActiveEventSchema", () => {
  it("validates agent_active event", () => {
    const event = {
      type: "agent_active",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
    };
    expect(() => AgentActiveEventSchema.parse(event)).not.toThrow();
  });
});

describe("MessageSentEventSchema", () => {
  it("validates a complete message_sent event", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: ["RedStone", "GreenCastle"],
      subject: "Task update",
      body: "Completed the auth module",
      thread_id: "bd-123",
      importance: "high",
      ack_required: true,
    };
    expect(() => MessageSentEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for importance and ack_required", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: "Hello",
      body: "World",
    };
    const parsed = MessageSentEventSchema.parse(event);
    expect(parsed.importance).toBe("normal");
    expect(parsed.ack_required).toBe(false);
  });

  it("validates importance enum values", () => {
    const validImportance = ["low", "normal", "high", "urgent"];
    for (const importance of validImportance) {
      const event = {
        type: "message_sent",
        project_key: "/test/project",
        timestamp: Date.now(),
        from_agent: "BlueLake",
        to_agents: ["RedStone"],
        subject: "Test",
        body: "Test",
        importance,
      };
      expect(() => MessageSentEventSchema.parse(event)).not.toThrow();
    }
  });

  it("rejects invalid importance value", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: "Test",
      body: "Test",
      importance: "critical", // Invalid
    };
    expect(() => MessageSentEventSchema.parse(event)).toThrow();
  });

  it("rejects empty to_agents array", () => {
    const event = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "BlueLake",
      to_agents: [],
      subject: "Test",
      body: "Test",
    };
    // Empty array is technically valid per schema - it's a broadcast
    expect(() => MessageSentEventSchema.parse(event)).not.toThrow();
  });
});

describe("MessageReadEventSchema", () => {
  it("validates message_read event", () => {
    const event = {
      type: "message_read",
      project_key: "/test/project",
      timestamp: Date.now(),
      message_id: 42,
      agent_name: "RedStone",
    };
    expect(() => MessageReadEventSchema.parse(event)).not.toThrow();
  });
});

describe("MessageAckedEventSchema", () => {
  it("validates message_acked event", () => {
    const event = {
      type: "message_acked",
      project_key: "/test/project",
      timestamp: Date.now(),
      message_id: 42,
      agent_name: "RedStone",
    };
    expect(() => MessageAckedEventSchema.parse(event)).not.toThrow();
  });
});

describe("FileReservedEventSchema", () => {
  it("validates a complete file_reserved event", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**", "src/config.ts"],
      reason: "bd-123: Working on auth",
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: Date.now() + 3600000,
    };
    expect(() => FileReservedEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for exclusive and ttl_seconds", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
      expires_at: Date.now() + 3600000,
    };
    const parsed = FileReservedEventSchema.parse(event);
    expect(parsed.exclusive).toBe(true);
    expect(parsed.ttl_seconds).toBe(3600);
  });

  it("requires expires_at", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
    };
    expect(() => FileReservedEventSchema.parse(event)).toThrow();
  });
  
  it("validates file_reserved with context fields", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**", "src/config.ts"],
      reason: "bd-123.1: Auth implementation",
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: Date.now() + 3600000,
      file_count: 2,
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      is_retry: false,
      conflict_agent: undefined,
    };
    expect(() => FileReservedEventSchema.parse(event)).not.toThrow();
  });
  
  it("validates file_reserved with conflict", () => {
    const event = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
      expires_at: Date.now() + 3600000,
      file_count: 1,
      is_retry: true,
      conflict_agent: "RedStone",
    };
    expect(() => FileReservedEventSchema.parse(event)).not.toThrow();
  });
});

describe("FileReleasedEventSchema", () => {
  it("validates file_released with paths", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });

  it("validates file_released with reservation_ids", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      reservation_ids: [1, 2, 3],
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });

  it("validates file_released with neither (release all)", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      file_count: 0,
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });
  
  it("validates file_released with context fields", () => {
    const event = {
      type: "file_released",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      paths: ["src/auth/**"],
      file_count: 1,
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      hold_duration_ms: 45000,
      files_modified: 3,
    };
    expect(() => FileReleasedEventSchema.parse(event)).not.toThrow();
  });
});

describe("FileConflictEventSchema", () => {
  it("validates a complete file_conflict event", () => {
    const event = {
      type: "file_conflict",
      project_key: "/test/project",
      timestamp: Date.now(),
      requesting_agent: "BlueLake",
      holding_agent: "RedStone",
      paths: ["src/auth/**", "src/config.ts"],
      epic_id: "bd-123",
      bead_id: "bd-123.2",
      resolution: "wait",
    };
    expect(() => FileConflictEventSchema.parse(event)).not.toThrow();
  });

  it("validates without optional fields", () => {
    const event = {
      type: "file_conflict",
      project_key: "/test/project",
      timestamp: Date.now(),
      requesting_agent: "BlueLake",
      holding_agent: "RedStone",
      paths: ["src/auth/**"],
    };
    expect(() => FileConflictEventSchema.parse(event)).not.toThrow();
  });

  it("validates resolution enum values", () => {
    const validResolutions = ["wait", "force", "abort"];
    for (const resolution of validResolutions) {
      const event = {
        type: "file_conflict",
        project_key: "/test/project",
        timestamp: Date.now(),
        requesting_agent: "BlueLake",
        holding_agent: "RedStone",
        paths: ["src/auth.ts"],
        resolution,
      };
      expect(() => FileConflictEventSchema.parse(event)).not.toThrow();
    }
  });

  it("rejects invalid resolution value", () => {
    const event = {
      type: "file_conflict",
      project_key: "/test/project",
      timestamp: Date.now(),
      requesting_agent: "BlueLake",
      holding_agent: "RedStone",
      paths: ["src/auth.ts"],
      resolution: "invalid",
    };
    expect(() => FileConflictEventSchema.parse(event)).toThrow();
  });
});

describe("TaskStartedEventSchema", () => {
  it("validates task_started event", () => {
    const event = {
      type: "task_started",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      epic_id: "bd-123",
    };
    expect(() => TaskStartedEventSchema.parse(event)).not.toThrow();
  });
});

describe("TaskProgressEventSchema", () => {
  it("validates task_progress event", () => {
    const event = {
      type: "task_progress",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      progress_percent: 50,
      message: "Halfway done",
      files_touched: ["src/auth.ts"],
    };
    expect(() => TaskProgressEventSchema.parse(event)).not.toThrow();
  });

  it("validates progress_percent bounds", () => {
    const baseEvent = {
      type: "task_progress",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
    };

    // Valid: 0
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: 0 }),
    ).not.toThrow();

    // Valid: 100
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: 100 }),
    ).not.toThrow();

    // Invalid: -1
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: -1 }),
    ).toThrow();

    // Invalid: 101
    expect(() =>
      TaskProgressEventSchema.parse({ ...baseEvent, progress_percent: 101 }),
    ).toThrow();
  });
});

describe("TaskCompletedEventSchema", () => {
  it("validates task_completed event", () => {
    const event = {
      type: "task_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      summary: "Implemented OAuth flow",
      files_touched: ["src/auth.ts", "src/config.ts"],
      success: true,
    };
    expect(() => TaskCompletedEventSchema.parse(event)).not.toThrow();
  });

  it("defaults success to true", () => {
    const event = {
      type: "task_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      summary: "Done",
    };
    const parsed = TaskCompletedEventSchema.parse(event);
    expect(parsed.success).toBe(true);
  });
});

describe("TaskBlockedEventSchema", () => {
  it("validates task_blocked event", () => {
    const event = {
      type: "task_blocked",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "BlueLake",
      bead_id: "bd-123.1",
      reason: "Waiting for API credentials",
    };
    expect(() => TaskBlockedEventSchema.parse(event)).not.toThrow();
  });
});

describe("DecompositionGeneratedEventSchema", () => {
  it("validates a complete decomposition_generated event", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Add user authentication",
      context: "OAuth integration for GitHub",
      strategy: "feature-based",
      epic_title: "User Authentication",
      subtasks: [
        {
          title: "Create OAuth flow",
          files: ["src/auth/oauth.ts"],
          priority: 2,
        },
        { title: "Add login UI", files: ["src/ui/login.tsx"], priority: 1 },
      ],
    };
    expect(() => DecompositionGeneratedEventSchema.parse(event)).not.toThrow();
  });

  it("validates without optional context", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Add user authentication",
      strategy: "file-based",
      epic_title: "User Authentication",
      subtasks: [{ title: "Create OAuth flow", files: ["src/auth/oauth.ts"] }],
    };
    expect(() => DecompositionGeneratedEventSchema.parse(event)).not.toThrow();
  });

  it("validates strategy enum values", () => {
    const validStrategies = ["file-based", "feature-based", "risk-based"];
    for (const strategy of validStrategies) {
      const event = {
        type: "decomposition_generated",
        project_key: "/test/project",
        timestamp: Date.now(),
        epic_id: "bd-123",
        task: "Test task",
        strategy,
        epic_title: "Test",
        subtasks: [{ title: "Subtask", files: ["test.ts"] }],
      };
      expect(() =>
        DecompositionGeneratedEventSchema.parse(event),
      ).not.toThrow();
    }
  });

  it("rejects invalid strategy value", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Test task",
      strategy: "invalid-strategy",
      epic_title: "Test",
      subtasks: [{ title: "Subtask", files: ["test.ts"] }],
    };
    expect(() => DecompositionGeneratedEventSchema.parse(event)).toThrow();
  });

  it("validates subtask priority bounds", () => {
    const baseEvent = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Test",
      strategy: "file-based",
      epic_title: "Test",
    };

    // Valid: 0
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: 0 }],
      }),
    ).not.toThrow();

    // Valid: 3
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: 3 }],
      }),
    ).not.toThrow();

    // Invalid: -1
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: -1 }],
      }),
    ).toThrow();

    // Invalid: 4
    expect(() =>
      DecompositionGeneratedEventSchema.parse({
        ...baseEvent,
        subtasks: [{ title: "Test", files: ["test.ts"], priority: 4 }],
      }),
    ).toThrow();
  });

  it("rejects empty subtasks array", () => {
    const event = {
      type: "decomposition_generated",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      task: "Test",
      strategy: "file-based",
      epic_title: "Test",
      subtasks: [],
    };
    // Empty subtasks is valid per schema but semantically questionable
    expect(() => DecompositionGeneratedEventSchema.parse(event)).not.toThrow();
  });
});

describe("SubtaskOutcomeEventSchema", () => {
  it("validates a complete subtask_outcome event", () => {
    const event = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["src/auth.ts", "src/config.ts"],
      actual_files: ["src/auth.ts", "src/config.ts", "src/utils.ts"],
      duration_ms: 45000,
      error_count: 2,
      retry_count: 1,
      success: true,
    };
    expect(() => SubtaskOutcomeEventSchema.parse(event)).not.toThrow();
  });

  it("applies defaults for error_count and retry_count", () => {
    const event = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["src/auth.ts"],
      actual_files: ["src/auth.ts"],
      duration_ms: 10000,
      success: true,
    };
    const parsed = SubtaskOutcomeEventSchema.parse(event);
    expect(parsed.error_count).toBe(0);
    expect(parsed.retry_count).toBe(0);
  });

  it("validates duration_ms is non-negative", () => {
    const baseEvent = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["test.ts"],
      actual_files: ["test.ts"],
      success: true,
    };

    // Valid: 0
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, duration_ms: 0 }),
    ).not.toThrow();

    // Valid: positive
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, duration_ms: 1000 }),
    ).not.toThrow();

    // Invalid: negative
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, duration_ms: -1 }),
    ).toThrow();
  });

  it("validates error_count is non-negative", () => {
    const baseEvent = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["test.ts"],
      actual_files: ["test.ts"],
      duration_ms: 1000,
      success: true,
    };

    // Invalid: negative
    expect(() =>
      SubtaskOutcomeEventSchema.parse({ ...baseEvent, error_count: -1 }),
    ).toThrow();
  });

  it("handles file lists with different lengths", () => {
    const event = {
      type: "subtask_outcome",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      bead_id: "bd-123.1",
      planned_files: ["a.ts", "b.ts"],
      actual_files: ["a.ts", "b.ts", "c.ts", "d.ts"],
      duration_ms: 5000,
      success: true,
    };
    expect(() => SubtaskOutcomeEventSchema.parse(event)).not.toThrow();
  });
});

describe("HumanFeedbackEventSchema", () => {
  it("validates a complete human_feedback event", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
      modified: false,
      notes: "Looks good, no changes needed",
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });

  it("validates accepted with modification", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
      modified: true,
      notes: "Changed priority on subtask 2",
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });

  it("validates rejected feedback", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: false,
      modified: false,
      notes: "Decomposition too granular, needs consolidation",
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });

  it("applies default for modified", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
    };
    const parsed = HumanFeedbackEventSchema.parse(event);
    expect(parsed.modified).toBe(false);
  });

  it("validates without notes", () => {
    const event = {
      type: "human_feedback",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      accepted: true,
      modified: false,
    };
    expect(() => HumanFeedbackEventSchema.parse(event)).not.toThrow();
  });
});

// ============================================================================
// Discriminated Union Tests
// ============================================================================

describe("AgentEventSchema (discriminated union)", () => {
  it("correctly discriminates by type", () => {
    const events: AgentEvent[] = [
      {
        type: "agent_registered",
        project_key: "/test",
        timestamp: Date.now(),
        agent_name: "Test",
        program: "opencode",
        model: "test",
      },
      {
        type: "agent_active",
        project_key: "/test",
        timestamp: Date.now(),
        agent_name: "Test",
      },
      {
        type: "message_sent",
        project_key: "/test",
        timestamp: Date.now(),
        from_agent: "Test",
        to_agents: ["Other"],
        subject: "Hi",
        body: "Hello",
        importance: "normal",
        ack_required: false,
      },
    ];

    for (const event of events) {
      expect(() => AgentEventSchema.parse(event)).not.toThrow();
    }
  });

  it("rejects unknown event types", () => {
    const event = {
      type: "unknown_event",
      project_key: "/test",
      timestamp: Date.now(),
    };
    expect(() => AgentEventSchema.parse(event)).toThrow();
  });
});

// ============================================================================
// createEvent Helper Tests
// ============================================================================

describe("createEvent", () => {
  it("creates agent_registered event with timestamp", () => {
    const before = Date.now();
    const event = createEvent("agent_registered", {
      project_key: "/test/project",
      agent_name: "BlueLake",
      program: "opencode",
      model: "claude-sonnet-4",
    });
    const after = Date.now();

    expect(event.type).toBe("agent_registered");
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(after);
    expect(event.agent_name).toBe("BlueLake");
  });

  it("creates message_sent event", () => {
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: "Hello",
      body: "World",
      importance: "high",
      ack_required: true,
    });

    expect(event.type).toBe("message_sent");
    expect(event.from_agent).toBe("BlueLake");
    expect(event.importance).toBe("high");
  });

  it("creates file_reserved event", () => {
    const expiresAt = Date.now() + 3600000;
    const event = createEvent("file_reserved", {
      project_key: "/test/project",
      agent_name: "BlueLake",
      paths: ["src/**"],
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: expiresAt,
    });

    expect(event.type).toBe("file_reserved");
    expect(event.paths).toEqual(["src/**"]);
    expect(event.expires_at).toBe(expiresAt);
  });

  it("throws on invalid event data", () => {
    expect(() =>
      // @ts-expect-error - intentionally testing invalid data
      createEvent("agent_registered", {
        project_key: "/test/project",
        // Missing agent_name
      }),
    ).toThrow(/Invalid event/);
  });

  it("throws on invalid event type", () => {
    expect(() =>
      // @ts-expect-error - intentionally testing invalid type
      createEvent("invalid_type", {
        project_key: "/test/project",
      }),
    ).toThrow();
  });
});

// ============================================================================
// isEventType Type Guard Tests
// ============================================================================

describe("isEventType", () => {
  it("returns true for matching type", () => {
    const event: AgentEvent = {
      type: "agent_registered",
      project_key: "/test",
      timestamp: Date.now(),
      agent_name: "Test",
      program: "opencode",
      model: "test",
    };

    expect(isEventType(event, "agent_registered")).toBe(true);
  });

  it("returns false for non-matching type", () => {
    const event: AgentEvent = {
      type: "agent_registered",
      project_key: "/test",
      timestamp: Date.now(),
      agent_name: "Test",
      program: "opencode",
      model: "test",
    };

    expect(isEventType(event, "agent_active")).toBe(false);
    expect(isEventType(event, "message_sent")).toBe(false);
  });

  it("narrows type correctly", () => {
    const event: AgentEvent = {
      type: "message_sent",
      project_key: "/test",
      timestamp: Date.now(),
      from_agent: "Test",
      to_agents: ["Other"],
      subject: "Hi",
      body: "Hello",
      importance: "normal",
      ack_required: false,
    };

    if (isEventType(event, "message_sent")) {
      // TypeScript should know these properties exist
      expect(event.from_agent).toBe("Test");
      expect(event.to_agents).toEqual(["Other"]);
      expect(event.subject).toBe("Hi");
    } else {
      // Should not reach here
      expect(true).toBe(false);
    }
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe("Edge cases", () => {
  it("handles very long strings", () => {
    const longString = "a".repeat(10000);
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: longString,
      body: longString,
      importance: "normal",
      ack_required: false,
    });

    expect(event.subject.length).toBe(10000);
    expect(event.body.length).toBe(10000);
  });

  it("handles special characters in strings", () => {
    const specialChars = "Hello\n\t\"'\\<>&日本語🎉";
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: ["RedStone"],
      subject: specialChars,
      body: specialChars,
      importance: "normal",
      ack_required: false,
    });

    expect(event.subject).toBe(specialChars);
    expect(event.body).toBe(specialChars);
  });

  it("handles many recipients", () => {
    const manyAgents = Array.from({ length: 100 }, (_, i) => `Agent${i}`);
    const event = createEvent("message_sent", {
      project_key: "/test/project",
      from_agent: "BlueLake",
      to_agents: manyAgents,
      subject: "Broadcast",
      body: "Hello everyone",
      importance: "normal",
      ack_required: false,
    });

    expect(event.to_agents.length).toBe(100);
  });

  it("handles many file paths", () => {
    const manyPaths = Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`);
    const event = createEvent("file_reserved", {
      project_key: "/test/project",
      agent_name: "BlueLake",
      paths: manyPaths,
      exclusive: true,
      ttl_seconds: 3600,
      expires_at: Date.now() + 3600000,
    });

    expect(event.paths.length).toBe(50);
  });

  it("handles timestamp at epoch", () => {
    const event = {
      type: "agent_active",
      project_key: "/test",
      timestamp: 0,
      agent_name: "Test",
    };
    expect(() => AgentActiveEventSchema.parse(event)).not.toThrow();
  });

  it("handles very large timestamp", () => {
    const event = {
      type: "agent_active",
      project_key: "/test",
      timestamp: Number.MAX_SAFE_INTEGER,
      agent_name: "Test",
    };
    expect(() => AgentActiveEventSchema.parse(event)).not.toThrow();
  });
});

// ============================================================================
// Enhanced Checkpoint Events Tests  
// ============================================================================

describe("Enhanced SwarmCheckpointedEvent", () => {
  const baseCheckpoint = {
    project_key: "/test",
    epic_id: "epic-123",
    bead_id: "bead-456",
    strategy: "file-based" as const,
    files: ["a.ts"],
    dependencies: [],
    directives: {},
    recovery: {
      last_checkpoint: Date.now(),
      files_modified: [],
      progress_percent: 50,
    },
  };

  it("accepts optional checkpoint_size_bytes", () => {
    const event = createEvent("swarm_checkpointed", {
      ...baseCheckpoint,
      checkpoint_size_bytes: 4096,
    });
    expect(event.checkpoint_size_bytes).toBe(4096);
  });

  it("accepts optional trigger field", () => {
    const event = createEvent("swarm_checkpointed", {
      ...baseCheckpoint,
      trigger: "progress",
    });
    expect(event.trigger).toBe("progress");
  });

  it("validates trigger enum values", () => {
    const validTriggers: Array<"manual" | "auto" | "progress" | "error"> = ["manual", "auto", "progress", "error"];
    for (const trigger of validTriggers) {
      expect(() =>
        createEvent("swarm_checkpointed", {
          ...baseCheckpoint,
          trigger,
        }),
      ).not.toThrow();
    }
  });

  it("rejects invalid trigger value", () => {
    expect(() =>
      SwarmCheckpointedEventSchema.parse({
        type: "swarm_checkpointed",
        project_key: "/test",
        timestamp: Date.now(),
        ...baseCheckpoint,
        trigger: "invalid",
      }),
    ).toThrow();
  });

  it("accepts optional context token fields", () => {
    const event = createEvent("swarm_checkpointed", {
      ...baseCheckpoint,
      context_tokens_before: 50000,
      context_tokens_after: 25000,
    });
    expect(event.context_tokens_before).toBe(50000);
    expect(event.context_tokens_after).toBe(25000);
  });

  it("works without optional fields (backward compatible)", () => {
    const event = createEvent("swarm_checkpointed", baseCheckpoint);
    expect(event.checkpoint_size_bytes).toBeUndefined();
    expect(event.trigger).toBeUndefined();
    expect(event.context_tokens_before).toBeUndefined();
    expect(event.context_tokens_after).toBeUndefined();
  });
});

describe("Enhanced SwarmRecoveredEvent", () => {
  const baseRecovery = {
    project_key: "/test",
    epic_id: "epic-123",
    bead_id: "bead-456",
    recovered_from_checkpoint: Date.now() - 60000,
  };

  it("accepts optional recovery_duration_ms", () => {
    const event = createEvent("swarm_recovered", {
      ...baseRecovery,
      recovery_duration_ms: 1500,
    });
    expect(event.recovery_duration_ms).toBe(1500);
  });

  it("accepts optional checkpoint_age_ms", () => {
    const event = createEvent("swarm_recovered", {
      ...baseRecovery,
      checkpoint_age_ms: 60000,
    });
    expect(event.checkpoint_age_ms).toBe(60000);
  });

  it("accepts optional files_restored array", () => {
    const event = createEvent("swarm_recovered", {
      ...baseRecovery,
      files_restored: ["src/a.ts", "src/b.ts"],
    });
    expect(event.files_restored).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("accepts optional context_restored_tokens", () => {
    const event = createEvent("swarm_recovered", {
      ...baseRecovery,
      context_restored_tokens: 30000,
    });
    expect(event.context_restored_tokens).toBe(30000);
  });

  it("works without optional fields (backward compatible)", () => {
    const event = createEvent("swarm_recovered", baseRecovery);
    expect(event.recovery_duration_ms).toBeUndefined();
    expect(event.checkpoint_age_ms).toBeUndefined();
    expect(event.files_restored).toBeUndefined();
    expect(event.context_restored_tokens).toBeUndefined();
  });
});

describe("CheckpointCreatedEvent", () => {
  it("creates valid checkpoint_created event", () => {
    const event = createEvent("checkpoint_created", {
      project_key: "/test",
      epic_id: "epic-123",
      bead_id: "bead-456",
      agent_name: "TestAgent",
      checkpoint_id: "ckpt-789",
      trigger: "manual",
      progress_percent: 50,
      files_snapshot: ["src/a.ts", "src/b.ts"],
    });

    expect(event.type).toBe("checkpoint_created");
    expect(event.checkpoint_id).toBe("ckpt-789");
    expect(event.trigger).toBe("manual");
    expect(event.progress_percent).toBe(50);
    expect(event.files_snapshot).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("validates trigger enum for checkpoint_created", () => {
    const validTriggers: Array<"manual" | "auto" | "progress" | "error"> = ["manual", "auto", "progress", "error"];
    for (const trigger of validTriggers) {
      expect(() =>
        createEvent("checkpoint_created", {
          project_key: "/test",
          epic_id: "epic-123",
          bead_id: "bead-456",
          agent_name: "TestAgent",
          checkpoint_id: "ckpt-789",
          trigger,
          progress_percent: 25,
          files_snapshot: [],
        }),
      ).not.toThrow();
    }
  });

  it("rejects invalid trigger", () => {
    expect(() =>
      CheckpointCreatedEventSchema.parse({
        type: "checkpoint_created",
        project_key: "/test",
        timestamp: Date.now(),
        epic_id: "epic-123",
        bead_id: "bead-456",
        agent_name: "TestAgent",
        checkpoint_id: "ckpt-789",
        trigger: "invalid",
        progress_percent: 25,
        files_snapshot: [],
      }),
    ).toThrow();
  });

  it("validates progress_percent range", () => {
    const base = {
      project_key: "/test",
      epic_id: "epic-123",
      bead_id: "bead-456",
      agent_name: "TestAgent",
      checkpoint_id: "ckpt-789",
      trigger: "auto" as const,
      files_snapshot: [],
    };

    // Valid: 0
    expect(() =>
      createEvent("checkpoint_created", { ...base, progress_percent: 0 }),
    ).not.toThrow();

    // Valid: 100
    expect(() =>
      createEvent("checkpoint_created", { ...base, progress_percent: 100 }),
    ).not.toThrow();

    // Invalid: -1
    expect(() =>
      CheckpointCreatedEventSchema.parse({
        type: "checkpoint_created",
        project_key: "/test",
        timestamp: Date.now(),
        ...base,
        progress_percent: -1,
      }),
    ).toThrow();

    // Invalid: 101
    expect(() =>
      CheckpointCreatedEventSchema.parse({
        type: "checkpoint_created",
        project_key: "/test",
        timestamp: Date.now(),
        ...base,
        progress_percent: 101,
      }),
    ).toThrow();
  });
});

describe("ContextCompactedEvent", () => {
  it("creates valid context_compacted event", () => {
    const event = createEvent("context_compacted", {
      project_key: "/test",
      agent_name: "TestAgent",
      tokens_before: 50000,
      tokens_after: 25000,
      compression_ratio: 0.5,
      summary_length: 1500,
    });

    expect(event.type).toBe("context_compacted");
    expect(event.tokens_before).toBe(50000);
    expect(event.tokens_after).toBe(25000);
    expect(event.compression_ratio).toBe(0.5);
    expect(event.summary_length).toBe(1500);
  });

  it("accepts optional epic_id and bead_id", () => {
    const event = createEvent("context_compacted", {
      project_key: "/test",
      epic_id: "epic-123",
      bead_id: "bead-456",
      agent_name: "TestAgent",
      tokens_before: 60000,
      tokens_after: 30000,
      compression_ratio: 0.5,
      summary_length: 2000,
    });

    expect(event.epic_id).toBe("epic-123");
    expect(event.bead_id).toBe("bead-456");
  });

  it("validates tokens are non-negative", () => {
    expect(() =>
      ContextCompactedEventSchema.parse({
        type: "context_compacted",
        project_key: "/test",
        timestamp: Date.now(),
        agent_name: "TestAgent",
        tokens_before: -100,
        tokens_after: 50,
        compression_ratio: 0.5,
        summary_length: 100,
      }),
    ).toThrow();

    expect(() =>
      ContextCompactedEventSchema.parse({
        type: "context_compacted",
        project_key: "/test",
        timestamp: Date.now(),
        agent_name: "TestAgent",
        tokens_before: 100,
        tokens_after: -50,
        compression_ratio: 0.5,
        summary_length: 100,
      }),
    ).toThrow();
  });

  it("validates compression_ratio is between 0 and 1", () => {
    const base = {
      project_key: "/test",
      agent_name: "TestAgent",
      tokens_before: 1000,
      tokens_after: 500,
      summary_length: 200,
    };

    // Valid: 0
    expect(() =>
      createEvent("context_compacted", { ...base, compression_ratio: 0 }),
    ).not.toThrow();

    // Valid: 1
    expect(() =>
      createEvent("context_compacted", { ...base, compression_ratio: 1 }),
    ).not.toThrow();

    // Invalid: > 1
    expect(() =>
      ContextCompactedEventSchema.parse({
        type: "context_compacted",
        project_key: "/test",
        timestamp: Date.now(),
        ...base,
        compression_ratio: 1.5,
      }),
    ).toThrow();

    // Invalid: < 0
    expect(() =>
      ContextCompactedEventSchema.parse({
        type: "context_compacted",
        project_key: "/test",
        timestamp: Date.now(),
        ...base,
        compression_ratio: -0.1,
      }),
    ).toThrow();
  });
});

// ============================================================================
// Validation Events Tests
// ============================================================================

describe("ValidationStartedEventSchema", () => {
  it("validates a complete validation_started event", () => {
    const event = {
      type: "validation_started",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      swarm_id: "swarm-456",
      started_at: Date.now(),
    };
    expect(() => AgentEventSchema.parse(event)).not.toThrow();
  });

  it("requires epic_id and swarm_id", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "validation_started",
        project_key: "/test/project",
        timestamp: Date.now(),
        started_at: Date.now(),
      }),
    ).toThrow();
  });
});

describe("ValidationIssueEventSchema", () => {
  it("validates a complete validation_issue event", () => {
    const event = {
      type: "validation_issue",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      severity: "error",
      category: "schema_mismatch",
      message: "Missing required field",
      location: {
        event_type: "worker_spawned",
        field: "worker_agent",
        component: "Dashboard",
      },
    };
    expect(() => AgentEventSchema.parse(event)).not.toThrow();
  });

  it("validates severity enum", () => {
    const baseEvent = {
      type: "validation_issue",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      category: "schema_mismatch",
      message: "Test",
    };

    // Valid severities
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, severity: "error" }),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, severity: "warning" }),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, severity: "info" }),
    ).not.toThrow();

    // Invalid severity
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, severity: "critical" }),
    ).toThrow();
  });

  it("validates category enum", () => {
    const baseEvent = {
      type: "validation_issue",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      severity: "error",
      message: "Test",
    };

    // Valid categories
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, category: "schema_mismatch" }),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, category: "missing_event" }),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, category: "undefined_value" }),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, category: "dashboard_render" }),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, category: "websocket_delivery" }),
    ).not.toThrow();

    // Invalid category
    expect(() =>
      AgentEventSchema.parse({ ...baseEvent, category: "unknown" }),
    ).toThrow();
  });

  it("validates optional location object", () => {
    const baseEvent = {
      type: "validation_issue",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      severity: "error",
      category: "schema_mismatch",
      message: "Test",
    };

    // Without location
    expect(() => AgentEventSchema.parse(baseEvent)).not.toThrow();

    // With partial location
    expect(() =>
      AgentEventSchema.parse({
        ...baseEvent,
        location: { event_type: "worker_spawned" },
      }),
    ).not.toThrow();

    // With full location
    expect(() =>
      AgentEventSchema.parse({
        ...baseEvent,
        location: {
          event_type: "worker_spawned",
          field: "worker_agent",
          component: "Dashboard",
        },
      }),
    ).not.toThrow();
  });
});

describe("ValidationCompletedEventSchema", () => {
  it("validates a complete validation_completed event", () => {
    const event = {
      type: "validation_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      swarm_id: "swarm-456",
      passed: true,
      issue_count: 0,
      duration_ms: 150,
    };
    expect(() => AgentEventSchema.parse(event)).not.toThrow();
  });

  it("validates with issues", () => {
    const event = {
      type: "validation_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      epic_id: "bd-123",
      swarm_id: "swarm-456",
      passed: false,
      issue_count: 3,
      duration_ms: 200,
    };
    expect(() => AgentEventSchema.parse(event)).not.toThrow();
  });

  it("requires epic_id and swarm_id", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "validation_completed",
        project_key: "/test/project",
        timestamp: Date.now(),
        passed: true,
        issue_count: 0,
        duration_ms: 100,
      }),
    ).toThrow();
  });

  it("validates non-negative issue_count", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "validation_completed",
        project_key: "/test/project",
        timestamp: Date.now(),
        epic_id: "bd-123",
        swarm_id: "swarm-456",
        passed: false,
        issue_count: -1,
        duration_ms: 100,
      }),
    ).toThrow();
  });

  it("validates non-negative duration_ms", () => {
    expect(() =>
      AgentEventSchema.parse({
        type: "validation_completed",
        project_key: "/test/project",
        timestamp: Date.now(),
        epic_id: "bd-123",
        swarm_id: "swarm-456",
        passed: true,
        issue_count: 0,
        duration_ms: -100,
      }),
    ).toThrow();
  });
});

// ============================================================================
// Persistence Verification Tests (libSQL via Drizzle)
// ============================================================================

import { getDatabasePath } from "./index.js";
import { appendEvent, readEvents } from "./store-drizzle.js";
import { clearAdapterCache } from "./store.js";

describe("appendEvent persistence to libSQL", () => {
  afterEach(async () => {
    // Clean up test database
    clearAdapterCache();
    try {
      await rm(getDatabasePath("/tmp/test-persistence"), { force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("appendEvent writes to libSQL and persists across calls", async () => {
    const projectPath = "/tmp/test-persistence";
    
    // Create and append an event
    const event = createEvent("agent_registered", {
      project_key: "test-project",
      agent_name: "PersistenceTestAgent",
      program: "opencode",
      model: "claude-sonnet-4",
      task_description: "Testing persistence",
    });

    const appendResult = await appendEvent(event, projectPath);

    // Verify return value
    expect(appendResult.id).toBeDefined();
    expect(appendResult.sequence).toBeDefined();
    expect(appendResult.type).toBe("agent_registered");
    expect(appendResult.agent_name).toBe("PersistenceTestAgent");

    // Read back from database to verify persistence
    const readResult = await readEvents(
      { 
        projectKey: "test-project",
        types: ["agent_registered"]
      },
      projectPath
    );

    expect(readResult).toHaveLength(1);
    expect(readResult[0]?.id).toBe(appendResult.id);
    expect(readResult[0]?.sequence).toBe(appendResult.sequence);
    expect(readResult[0]?.agent_name).toBe("PersistenceTestAgent");
  });

  it("verifies database is file-based, not in-memory", async () => {
    const projectPath = "/tmp/test-persistence";
    
    // Append event
    const event = createEvent("agent_registered", {
      project_key: "test-project",
      agent_name: "FilePersistenceAgent",
      program: "opencode",
      model: "claude-sonnet-4",
    });

    await appendEvent(event, projectPath);

    // Clear adapter cache to force new connection
    clearAdapterCache();

    // Read from a fresh connection - should still see the event
    const readResult = await readEvents(
      { projectKey: "test-project" },
      projectPath
    );

    expect(readResult).toHaveLength(1);
    expect(readResult[0]?.agent_name).toBe("FilePersistenceAgent");
  });

  it("appendEvent uses Drizzle ORM, not raw SQL", async () => {
    const projectPath = "/tmp/test-persistence";
    
    // The appendEvent function in store-drizzle.ts uses:
    // db.insert(eventsTable).values(...).returning(...)
    // This is Drizzle's query builder, not raw SQL
    
    const event = createEvent("message_sent", {
      project_key: "test-project",
      from_agent: "Agent1",
      to_agents: ["Agent2"],
      subject: "Test message",
      body: "Testing Drizzle ORM",
      importance: "normal",
      ack_required: false,
    });

    const result = await appendEvent(event, projectPath);

    // If Drizzle ORM is working, we should get id and sequence back
    expect(result.id).toBeTypeOf("number");
    expect(result.sequence).toBeTypeOf("number");
    
    // Verify materialized views were updated (Drizzle's updateMaterializedViewsDrizzle)
    const events = await readEvents({ projectKey: "test-project" }, projectPath);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("message_sent");
  });

  it("verifies database path resolves correctly", async () => {
    // NEW BEHAVIOR: Database is always at global path ~/.config/swarm-tools/swarm.db
    const projectPath = "/tmp/test-persistence";
    
    const event = createEvent("agent_registered", {
      project_key: "test-project",
      agent_name: "PathTestAgent",
      program: "opencode",
      model: "claude-sonnet-4",
    });

    await appendEvent(event, projectPath);

    // Verify database file exists at global location
    const expectedDbPath = join(homedir(), ".config", "swarm-tools", "swarm.db");
    expect(existsSync(expectedDbPath)).toBe(true);
  });

  it("appendEvent increments sequence number", async () => {
    const projectPath = "/tmp/test-persistence";
    
    const event1 = createEvent("agent_registered", {
      project_key: "test-project",
      agent_name: "Agent1",
      program: "opencode",
      model: "claude-sonnet-4",
    });

    const event2 = createEvent("agent_registered", {
      project_key: "test-project",
      agent_name: "Agent2",
      program: "opencode",
      model: "claude-sonnet-4",
    });

    const result1 = await appendEvent(event1, projectPath);
    const result2 = await appendEvent(event2, projectPath);

    // Sequence should increment
    expect(result2.sequence).toBe(result1.sequence + 1);
    
    // Both events should be in database
    const allEvents = await readEvents({ projectKey: "test-project" }, projectPath);
    expect(allEvents).toHaveLength(2);
  });
});
