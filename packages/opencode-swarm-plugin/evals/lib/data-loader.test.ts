/**
 * Tests for data-loader quality filters
 *
 * TDD approach: RED → GREEN → REFACTOR
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CoordinatorEvent } from "../../src/eval-capture.js";
import { loadCapturedSessions } from "./data-loader.js";

// Test helper: create a temp session directory
let tempSessionDir: string;

beforeEach(() => {
  tempSessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-sessions-"));
});

afterEach(() => {
  if (fs.existsSync(tempSessionDir)) {
    fs.rmSync(tempSessionDir, { recursive: true });
  }
});

/**
 * Helper: create a session JSONL file with events
 */
function createSessionFile(
  sessionId: string,
  events: CoordinatorEvent[],
): void {
  const filePath = path.join(tempSessionDir, `${sessionId}.jsonl`);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  fs.writeFileSync(filePath, lines, "utf-8");
}

/**
 * Helper: create minimal events
 */
function createEvent(
  sessionId: string,
  epicId: string,
  type: "DECISION" | "VIOLATION" | "OUTCOME",
  subtype: string,
): CoordinatorEvent {
  const base = {
    session_id: sessionId,
    epic_id: epicId,
    timestamp: new Date().toISOString(),
    payload: {},
  };

  if (type === "DECISION") {
    return {
      ...base,
      event_type: "DECISION" as const,
      decision_type: subtype as any,
    };
  } else if (type === "VIOLATION") {
    return {
      ...base,
      event_type: "VIOLATION" as const,
      violation_type: subtype as any,
    };
  } else {
    return {
      ...base,
      event_type: "OUTCOME" as const,
      outcome_type: subtype as any,
    };
  }
}

describe("loadCapturedSessions - quality filters", () => {
  test("filters out sessions with fewer than minEvents (default: 3)", async () => {
    // Create sessions with different event counts
    createSessionFile("session-2-events", [
      createEvent("session-2-events", "epic-1", "DECISION", "worker_spawned"),
      createEvent("session-2-events", "epic-1", "OUTCOME", "subtask_success"),
    ]);

    createSessionFile("session-3-events", [
      createEvent("session-3-events", "epic-2", "DECISION", "worker_spawned"),
      createEvent("session-3-events", "epic-2", "DECISION", "review_completed"),
      createEvent("session-3-events", "epic-2", "OUTCOME", "subtask_success"),
    ]);

    createSessionFile("session-5-events", [
      createEvent("session-5-events", "epic-3", "DECISION", "worker_spawned"),
      createEvent("session-5-events", "epic-3", "DECISION", "review_completed"),
      createEvent("session-5-events", "epic-3", "OUTCOME", "subtask_success"),
      createEvent("session-5-events", "epic-3", "OUTCOME", "subtask_success"),
      createEvent("session-5-events", "epic-3", "OUTCOME", "epic_complete"),
    ]);

    const sessions = await loadCapturedSessions({
      minEvents: 3,
      sessionDir: tempSessionDir,
    });

    // Should only get sessions with >= 3 events
    expect(sessions.length).toBe(2);
    expect(
      sessions.some((s) => s.session.session_id === "session-3-events"),
    ).toBe(true);
    expect(
      sessions.some((s) => s.session.session_id === "session-5-events"),
    ).toBe(true);
    expect(
      sessions.some((s) => s.session.session_id === "session-2-events"),
    ).toBe(false);
  });

  test("filters out sessions without worker_spawned event when requireWorkerSpawn=true", async () => {
    // Session WITH worker_spawned
    createSessionFile("session-with-spawn", [
      createEvent("session-with-spawn", "epic-1", "DECISION", "worker_spawned"),
      createEvent(
        "session-with-spawn",
        "epic-1",
        "DECISION",
        "review_completed",
      ),
      createEvent("session-with-spawn", "epic-1", "OUTCOME", "subtask_success"),
    ]);

    // Session WITHOUT worker_spawned
    createSessionFile("session-no-spawn", [
      createEvent(
        "session-no-spawn",
        "epic-2",
        "DECISION",
        "strategy_selected",
      ),
      createEvent(
        "session-no-spawn",
        "epic-2",
        "DECISION",
        "decomposition_complete",
      ),
      createEvent("session-no-spawn", "epic-2", "OUTCOME", "epic_complete"),
    ]);

    const sessions = await loadCapturedSessions({
      requireWorkerSpawn: true,
      sessionDir: tempSessionDir,
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0]?.session.session_id).toBe("session-with-spawn");
  });

  test("filters out sessions without review_completed event when requireReview=true", async () => {
    // Session WITH review
    createSessionFile("session-with-review", [
      createEvent(
        "session-with-review",
        "epic-1",
        "DECISION",
        "worker_spawned",
      ),
      createEvent(
        "session-with-review",
        "epic-1",
        "DECISION",
        "review_completed",
      ),
      createEvent("session-with-review", "epic-1", "OUTCOME", "subtask_success"),
    ]);

    // Session WITHOUT review
    createSessionFile("session-no-review", [
      createEvent("session-no-review", "epic-2", "DECISION", "worker_spawned"),
      createEvent("session-no-review", "epic-2", "OUTCOME", "subtask_success"),
      createEvent("session-no-review", "epic-2", "OUTCOME", "epic_complete"),
    ]);

    const sessions = await loadCapturedSessions({
      requireReview: true,
      sessionDir: tempSessionDir,
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0]?.session.session_id).toBe("session-with-review");
  });

  test("allows disabling filters individually", async () => {
    // Session with only 2 events, no worker_spawned, no review
    createSessionFile("session-low-quality", [
      createEvent(
        "session-low-quality",
        "epic-1",
        "DECISION",
        "strategy_selected",
      ),
      createEvent("session-low-quality", "epic-1", "OUTCOME", "epic_complete"),
    ]);

    // Disable all filters
    const sessions = await loadCapturedSessions({
      minEvents: 0,
      requireWorkerSpawn: false,
      requireReview: false,
      sessionDir: tempSessionDir,
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0]?.session.session_id).toBe("session-low-quality");
  });

  test("applies limit AFTER filtering", async () => {
    // Create 5 high-quality sessions
    for (let i = 1; i <= 5; i++) {
      createSessionFile(`session-${i}`, [
        createEvent(`session-${i}`, `epic-${i}`, "DECISION", "worker_spawned"),
        createEvent(
          `session-${i}`,
          `epic-${i}`,
          "DECISION",
          "review_completed",
        ),
        createEvent(`session-${i}`, `epic-${i}`, "OUTCOME", "subtask_success"),
      ]);
    }

    // Create 3 low-quality sessions (will be filtered out)
    for (let i = 6; i <= 8; i++) {
      createSessionFile(`session-${i}`, [
        createEvent(`session-${i}`, `epic-${i}`, "DECISION", "strategy_selected"),
      ]);
    }

    // Filter first (remove 3 low-quality), then limit to 2
    const sessions = await loadCapturedSessions({
      minEvents: 3,
      requireWorkerSpawn: true,
      requireReview: true,
      limit: 2,
      sessionDir: tempSessionDir,
    });

    // Should get 2 sessions from the 5 high-quality ones
    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.session.events.length >= 3)).toBe(true);
  });

  test("combines all filters correctly", async () => {
    // High-quality session (passes all filters)
    createSessionFile("session-high-quality", [
      createEvent(
        "session-high-quality",
        "epic-1",
        "DECISION",
        "worker_spawned",
      ),
      createEvent(
        "session-high-quality",
        "epic-1",
        "DECISION",
        "review_completed",
      ),
      createEvent("session-high-quality", "epic-1", "OUTCOME", "subtask_success"),
      createEvent("session-high-quality", "epic-1", "OUTCOME", "epic_complete"),
    ]);

    // Missing worker_spawned
    createSessionFile("session-no-spawn", [
      createEvent(
        "session-no-spawn",
        "epic-2",
        "DECISION",
        "review_completed",
      ),
      createEvent("session-no-spawn", "epic-2", "OUTCOME", "subtask_success"),
      createEvent("session-no-spawn", "epic-2", "OUTCOME", "epic_complete"),
    ]);

    // Missing review_completed
    createSessionFile("session-no-review", [
      createEvent("session-no-review", "epic-3", "DECISION", "worker_spawned"),
      createEvent("session-no-review", "epic-3", "OUTCOME", "subtask_success"),
      createEvent("session-no-review", "epic-3", "OUTCOME", "epic_complete"),
    ]);

    // Too few events
    createSessionFile("session-too-few", [
      createEvent("session-too-few", "epic-4", "DECISION", "worker_spawned"),
      createEvent("session-too-few", "epic-4", "DECISION", "review_completed"),
    ]);

    const sessions = await loadCapturedSessions({
      minEvents: 3,
      requireWorkerSpawn: true,
      requireReview: true,
      sessionDir: tempSessionDir,
    });

    // Only high-quality session should pass
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.session.session_id).toBe("session-high-quality");
  });

  test("defaults are: minEvents=3, requireWorkerSpawn=true, requireReview=true", async () => {
    // Create one session that meets defaults
    createSessionFile("session-meets-defaults", [
      createEvent(
        "session-meets-defaults",
        "epic-1",
        "DECISION",
        "worker_spawned",
      ),
      createEvent(
        "session-meets-defaults",
        "epic-1",
        "DECISION",
        "review_completed",
      ),
      createEvent(
        "session-meets-defaults",
        "epic-1",
        "OUTCOME",
        "subtask_success",
      ),
    ]);

    // Create one that doesn't
    createSessionFile("session-fails-defaults", [
      createEvent(
        "session-fails-defaults",
        "epic-2",
        "DECISION",
        "strategy_selected",
      ),
    ]);

    // Call with NO options except sessionDir - should use defaults
    const sessions = await loadCapturedSessions({
      sessionDir: tempSessionDir,
    });

    expect(sessions.length).toBe(1);
    expect(sessions[0]?.session.session_id).toBe("session-meets-defaults");
  });
});
