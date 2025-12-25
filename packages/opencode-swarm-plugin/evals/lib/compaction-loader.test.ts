/**
 * Compaction Data Loader Tests
 *
 * Tests loading COMPACTION events from session JSONL files.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CoordinatorEvent } from "../../src/eval-capture.js";
import {
  loadCompactionEvents,
  loadCompactionSessions,
} from "./compaction-loader.js";

// Test fixtures directory
const TEST_SESSION_DIR = path.join(
  os.tmpdir(),
  `test-sessions-${Date.now()}`,
);

/**
 * Create a test session JSONL file
 */
function createSessionFile(
  sessionId: string,
  events: CoordinatorEvent[],
): void {
  const sessionPath = path.join(TEST_SESSION_DIR, `${sessionId}.jsonl`);
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  fs.writeFileSync(sessionPath, `${lines}\n`, "utf-8");
}

beforeAll(() => {
  // Create test session directory
  fs.mkdirSync(TEST_SESSION_DIR, { recursive: true });

  // Create test session files with COMPACTION events
  createSessionFile("session-1", [
    {
      session_id: "session-1",
      epic_id: "epic-1",
      timestamp: "2025-01-01T10:00:00.000Z",
      event_type: "DECISION",
      decision_type: "decomposition_complete",
      payload: { subtask_count: 3 },
    },
    {
      session_id: "session-1",
      epic_id: "epic-1",
      timestamp: "2025-01-01T10:05:00.000Z",
      event_type: "COMPACTION",
      compaction_type: "detection_complete",
      payload: {
        confidence: "high",
        context_type: "full",
        epic_id: "epic-1",
      },
    },
    {
      session_id: "session-1",
      epic_id: "epic-1",
      timestamp: "2025-01-01T10:06:00.000Z",
      event_type: "COMPACTION",
      compaction_type: "prompt_generated",
      payload: {
        prompt_length: 5000,
        full_prompt: "You are a coordinator...",
        context_type: "full",
      },
    },
  ]);

  createSessionFile("session-2", [
    {
      session_id: "session-2",
      epic_id: "epic-2",
      timestamp: "2025-01-02T10:00:00.000Z",
      event_type: "COMPACTION",
      compaction_type: "context_injected",
      payload: {
        injection_point: "tool_call",
        context_length: 3000,
      },
    },
    {
      session_id: "session-2",
      epic_id: "epic-2",
      timestamp: "2025-01-02T10:01:00.000Z",
      event_type: "COMPACTION",
      compaction_type: "resumption_started",
      payload: {
        epic_id: "epic-2",
        resumption_type: "coordinator",
      },
    },
  ]);

  // Session with no COMPACTION events
  createSessionFile("session-3", [
    {
      session_id: "session-3",
      epic_id: "epic-3",
      timestamp: "2025-01-03T10:00:00.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "BlueLake", bead_id: "epic-3.1" },
    },
  ]);
});

afterAll(() => {
  // Clean up test session directory
  if (fs.existsSync(TEST_SESSION_DIR)) {
    fs.rmSync(TEST_SESSION_DIR, { recursive: true });
  }
});

describe("loadCompactionEvents", () => {
  test("loads all COMPACTION events from session directory", async () => {
    const events = await loadCompactionEvents(TEST_SESSION_DIR);

    expect(events.length).toBe(4);
    expect(events.every((e) => e.event_type === "COMPACTION")).toBe(true);
  });

  test("filters by compaction_type", async () => {
    const events = await loadCompactionEvents(TEST_SESSION_DIR, {
      compaction_type: "detection_complete",
    });

    expect(events.length).toBe(1);
    expect(events[0].compaction_type).toBe("detection_complete");
  });

  test("filters by session_ids", async () => {
    const events = await loadCompactionEvents(TEST_SESSION_DIR, {
      sessionIds: ["session-1"],
    });

    expect(events.length).toBe(2);
    expect(events.every((e) => e.session_id === "session-1")).toBe(true);
  });

  test("applies limit", async () => {
    const events = await loadCompactionEvents(TEST_SESSION_DIR, {
      limit: 2,
    });

    expect(events.length).toBe(2);
  });

  test("combines filters", async () => {
    const events = await loadCompactionEvents(TEST_SESSION_DIR, {
      compaction_type: "prompt_generated",
      sessionIds: ["session-1"],
      limit: 1,
    });

    expect(events.length).toBe(1);
    expect(events[0].compaction_type).toBe("prompt_generated");
    expect(events[0].session_id).toBe("session-1");
  });

  test("returns empty array for non-existent directory", async () => {
    const events = await loadCompactionEvents("/non/existent/path");

    expect(events).toEqual([]);
  });

  test("skips invalid JSONL lines", async () => {
    // Create session with invalid JSON
    const invalidPath = path.join(TEST_SESSION_DIR, "session-invalid.jsonl");
    fs.writeFileSync(
      invalidPath,
      'invalid json\n{"session_id": "session-valid", "event_type": "COMPACTION", "compaction_type": "detection_complete", "epic_id": "epic-4", "timestamp": "2025-01-04T10:00:00.000Z", "payload": {}}\n',
      "utf-8",
    );

    const events = await loadCompactionEvents(TEST_SESSION_DIR);

    // Should skip invalid line but include valid one
    expect(events.some((e) => e.session_id === "session-valid")).toBe(true);

    // Clean up
    fs.unlinkSync(invalidPath);
  });
});

describe("loadCompactionSessions", () => {
  test("groups events by session_id", async () => {
    const sessions = await loadCompactionSessions(TEST_SESSION_DIR);

    expect(sessions.length).toBe(2); // session-1 and session-2 (session-3 has no COMPACTION events)
    expect(sessions[0].session_id).toBeDefined();
    expect(sessions[0].events.length).toBeGreaterThan(0);
  });

  test("includes session metadata", async () => {
    const sessions = await loadCompactionSessions(TEST_SESSION_DIR);

    const session1 = sessions.find((s) => s.session_id === "session-1");
    expect(session1).toBeDefined();
    if (session1) {
      expect(session1.epic_id).toBe("epic-1");
      expect(session1.start_time).toBeDefined();
      expect(session1.end_time).toBeDefined();
    }
  });

  test("filters by compaction_type", async () => {
    const sessions = await loadCompactionSessions(TEST_SESSION_DIR, {
      compaction_type: "detection_complete",
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0].session_id).toBe("session-1");
  });

  test("filters by session_ids", async () => {
    const sessions = await loadCompactionSessions(TEST_SESSION_DIR, {
      sessionIds: ["session-2"],
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0].session_id).toBe("session-2");
  });

  test("applies limit", async () => {
    const sessions = await loadCompactionSessions(TEST_SESSION_DIR, {
      limit: 1,
    });

    expect(sessions.length).toBe(1);
  });

  test("returns empty array for non-existent directory", async () => {
    const sessions = await loadCompactionSessions("/non/existent/path");

    expect(sessions).toEqual([]);
  });

  test("excludes sessions with no COMPACTION events", async () => {
    const sessions = await loadCompactionSessions(TEST_SESSION_DIR);

    expect(sessions.every((s) => s.session_id !== "session-3")).toBe(true);
  });
});
