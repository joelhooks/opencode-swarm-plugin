/**
 * Post-Compaction Tool Call Tracker Tests
 *
 * TDD: RED → GREEN → REFACTOR
 *
 * Tests tracking of tool calls after compaction resumption.
 * Emits resumption_started on first tool call, then tool_call_tracked for each call (max 20).
 * Detects coordinator violations: Edit, Write, swarmmail_reserve are forbidden.
 */
import { describe, test, expect, beforeEach, mock } from "bun:test";
import {
  createPostCompactionTracker,
  type PostCompactionTracker,
  type ToolCallEvent,
} from "./post-compaction-tracker";

describe("PostCompactionTracker - TDD", () => {
  let tracker: PostCompactionTracker;
  let mockCapture: ReturnType<typeof mock>;

  beforeEach(() => {
    mockCapture = mock((event: any) => {});
    tracker = createPostCompactionTracker({
      sessionId: "test-session",
      epicId: "mjkwehsqnbm",
      onEvent: mockCapture,
    });
  });

  // ============================================================================
  // RED: Test resumption_started event
  // ============================================================================

  test("emits resumption_started on first tool call", () => {
    const toolCall: ToolCallEvent = {
      tool: "read",
      args: { filePath: "/test/file.ts" },
      timestamp: Date.now(),
    };

    tracker.trackToolCall(toolCall);

    expect(mockCapture).toHaveBeenCalledTimes(2); // resumption_started + tool_call_tracked
    const firstCall = mockCapture.mock.calls[0][0];
    expect(firstCall.compaction_type).toBe("resumption_started");
    expect(firstCall.payload.session_id).toBe("test-session");
    expect(firstCall.payload.epic_id).toBe("mjkwehsqnbm");
  });

  test("resumption_started only emitted once", () => {
    tracker.trackToolCall({
      tool: "read",
      args: {},
      timestamp: Date.now(),
    });
    tracker.trackToolCall({
      tool: "glob",
      args: {},
      timestamp: Date.now(),
    });

    // First call: resumption_started + tool_call_tracked
    // Second call: tool_call_tracked only
    expect(mockCapture).toHaveBeenCalledTimes(3);

    const calls = mockCapture.mock.calls;
    expect(calls[0][0].compaction_type).toBe("resumption_started");
    expect(calls[1][0].compaction_type).toBe("tool_call_tracked");
    expect(calls[2][0].compaction_type).toBe("tool_call_tracked");
  });

  // ============================================================================
  // RED: Test tool_call_tracked event
  // ============================================================================

  test("emits tool_call_tracked for each of first 20 calls", () => {
    for (let i = 0; i < 20; i++) {
      tracker.trackToolCall({
        tool: `tool-${i}`,
        args: {},
        timestamp: Date.now(),
      });
    }

    // First call: resumption_started + tool_call_tracked = 2
    // Next 19 calls: tool_call_tracked only = 19
    // Total: 21 events (1 resumption_started + 20 tool_call_tracked)
    expect(mockCapture).toHaveBeenCalledTimes(21);

    const trackedEvents = mockCapture.mock.calls.filter(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    );
    expect(trackedEvents).toHaveLength(20);
  });

  test("tool_call_tracked includes tool name and args", () => {
    tracker.trackToolCall({
      tool: "edit",
      args: { filePath: "/test.ts", oldString: "foo", newString: "bar" },
      timestamp: Date.now(),
    });

    const trackedEvent = mockCapture.mock.calls.find(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    )?.[0];

    expect(trackedEvent).toBeDefined();
    expect(trackedEvent.payload.tool).toBe("edit");
    expect(trackedEvent.payload.args.filePath).toBe("/test.ts");
    expect(trackedEvent.payload.call_number).toBe(1);
  });

  // ============================================================================
  // RED: Test coordinator violation detection
  // ============================================================================

  test("detects Edit as coordinator violation", () => {
    tracker.trackToolCall({
      tool: "edit",
      args: { filePath: "/test.ts", oldString: "a", newString: "b" },
      timestamp: Date.now(),
    });

    const trackedEvent = mockCapture.mock.calls.find(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    )?.[0];

    expect(trackedEvent.payload.is_coordinator_violation).toBe(true);
    expect(trackedEvent.payload.violation_reason).toBe(
      "Coordinators NEVER edit files - spawn worker instead",
    );
  });

  test("detects Write as coordinator violation", () => {
    tracker.trackToolCall({
      tool: "write",
      args: { filePath: "/new.ts", content: "export {}" },
      timestamp: Date.now(),
    });

    const trackedEvent = mockCapture.mock.calls.find(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    )?.[0];

    expect(trackedEvent.payload.is_coordinator_violation).toBe(true);
    expect(trackedEvent.payload.violation_reason).toBe(
      "Coordinators NEVER write files - spawn worker instead",
    );
  });

  test("detects swarmmail_reserve as coordinator violation", () => {
    tracker.trackToolCall({
      tool: "swarmmail_reserve",
      args: { paths: ["/src/**"], reason: "test" },
      timestamp: Date.now(),
    });

    const trackedEvent = mockCapture.mock.calls.find(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    )?.[0];

    expect(trackedEvent.payload.is_coordinator_violation).toBe(true);
    expect(trackedEvent.payload.violation_reason).toBe(
      "Coordinators NEVER reserve files - workers reserve files",
    );
  });

  test("does not flag Read as violation", () => {
    tracker.trackToolCall({
      tool: "read",
      args: { filePath: "/test.ts" },
      timestamp: Date.now(),
    });

    const trackedEvent = mockCapture.mock.calls.find(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    )?.[0];

    expect(trackedEvent.payload.is_coordinator_violation).toBe(false);
    expect(trackedEvent.payload.violation_reason).toBeUndefined();
  });

  test("does not flag swarm_spawn_subtask as violation", () => {
    tracker.trackToolCall({
      tool: "swarm_spawn_subtask",
      args: { bead_id: "bd-123", subtask_title: "Test" },
      timestamp: Date.now(),
    });

    const trackedEvent = mockCapture.mock.calls.find(
      (call: any) => call[0].compaction_type === "tool_call_tracked",
    )?.[0];

    expect(trackedEvent.payload.is_coordinator_violation).toBe(false);
  });

  // ============================================================================
  // RED: Test tracking stops after 20 calls
  // ============================================================================

  test("stops tracking after 20 calls", () => {
    for (let i = 0; i < 25; i++) {
      tracker.trackToolCall({
        tool: `tool-${i}`,
        args: {},
        timestamp: Date.now(),
      });
    }

    // Should only track first 20: 1 resumption_started + 20 tool_call_tracked
    expect(mockCapture).toHaveBeenCalledTimes(21);
  });

  test("returns tracking status", () => {
    expect(tracker.isTracking()).toBe(true);

    for (let i = 0; i < 20; i++) {
      tracker.trackToolCall({
        tool: `tool-${i}`,
        args: {},
        timestamp: Date.now(),
      });
    }

    expect(tracker.isTracking()).toBe(false);
  });

  // ============================================================================
  // RED: Test configurable limit
  // ============================================================================

  test("respects custom call limit", () => {
    const customTracker = createPostCompactionTracker({
      sessionId: "test",
      epicId: "test",
      onEvent: mockCapture,
      maxCalls: 5,
    });

    for (let i = 0; i < 10; i++) {
      customTracker.trackToolCall({
        tool: `tool-${i}`,
        args: {},
        timestamp: Date.now(),
      });
    }

    // 1 resumption_started + 5 tool_call_tracked
    expect(mockCapture).toHaveBeenCalledTimes(6);
  });
});
