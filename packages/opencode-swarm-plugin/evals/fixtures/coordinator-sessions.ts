/**
 * Coordinator Session Test Fixtures
 *
 * Synthetic coordinator sessions for testing coordinator-discipline scorers.
 * Each fixture demonstrates good or bad coordinator behavior.
 */

import type { CoordinatorSession } from "../../src/eval-capture.js";

/**
 * PERFECT COORDINATOR
 *
 * - No violations (no direct edits, tests, or reservations)
 * - 100% spawn efficiency (3/3 workers spawned)
 * - 100% review thoroughness (all workers reviewed)
 * - Fast time to first spawn (30s)
 */
export const perfectCoordinator: CoordinatorSession = {
  session_id: "test-session-perfect",
  epic_id: "test-epic-perfect",
  start_time: "2025-01-01T10:00:00.000Z",
  end_time: "2025-01-01T10:30:00.000Z",
  events: [
    // 1. Decomposition complete
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:00:00.000Z",
      event_type: "DECISION",
      decision_type: "decomposition_complete",
      payload: { subtask_count: 3 },
    },
    // 2. First spawn (30s after decomp)
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:00:30.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "BlueLake", bead_id: "test-epic-perfect.1" },
    },
    // 3. Second spawn
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:01:00.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "GreenMountain", bead_id: "test-epic-perfect.2" },
    },
    // 4. Third spawn
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:01:30.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "RedForest", bead_id: "test-epic-perfect.3" },
    },
    // 5. First worker completes
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:10:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "subtask_success",
      payload: { bead_id: "test-epic-perfect.1", worker: "BlueLake" },
    },
    // 6. First review
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:11:00.000Z",
      event_type: "DECISION",
      decision_type: "review_completed",
      payload: {
        bead_id: "test-epic-perfect.1",
        approved: true,
        issues: [],
      },
    },
    // 7. Second worker completes
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:15:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "subtask_success",
      payload: { bead_id: "test-epic-perfect.2", worker: "GreenMountain" },
    },
    // 8. Second review
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:16:00.000Z",
      event_type: "DECISION",
      decision_type: "review_completed",
      payload: {
        bead_id: "test-epic-perfect.2",
        approved: true,
        issues: [],
      },
    },
    // 9. Third worker completes
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:20:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "subtask_success",
      payload: { bead_id: "test-epic-perfect.3", worker: "RedForest" },
    },
    // 10. Third review
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:21:00.000Z",
      event_type: "DECISION",
      decision_type: "review_completed",
      payload: {
        bead_id: "test-epic-perfect.3",
        approved: true,
        issues: [],
      },
    },
    // 11. Epic complete
    {
      session_id: "test-session-perfect",
      epic_id: "test-epic-perfect",
      timestamp: "2025-01-01T10:30:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "epic_complete",
      payload: { epic_id: "test-epic-perfect", total_subtasks: 3 },
    },
  ],
};

/**
 * BAD COORDINATOR - Multiple Violations
 *
 * - 3 violations (edited file, ran tests, reserved files)
 * - 33% spawn efficiency (only 1/3 workers spawned)
 * - 0% review thoroughness (no reviews)
 * - Slow time to first spawn (10 minutes)
 */
export const badCoordinator: CoordinatorSession = {
  session_id: "test-session-bad",
  epic_id: "test-epic-bad",
  start_time: "2025-01-01T10:00:00.000Z",
  end_time: "2025-01-01T11:00:00.000Z",
  events: [
    // 1. Decomposition complete
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:00:00.000Z",
      event_type: "DECISION",
      decision_type: "decomposition_complete",
      payload: { subtask_count: 3 },
    },
    // 2. VIOLATION: Coordinator edited file directly
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:01:00.000Z",
      event_type: "VIOLATION",
      violation_type: "coordinator_edited_file",
      payload: { file: "src/auth.ts", reason: "should spawn worker instead" },
    },
    // 3. VIOLATION: Coordinator ran tests
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:02:00.000Z",
      event_type: "VIOLATION",
      violation_type: "coordinator_ran_tests",
      payload: { command: "bun test", reason: "workers do verification" },
    },
    // 4. VIOLATION: Coordinator reserved files
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:03:00.000Z",
      event_type: "VIOLATION",
      violation_type: "coordinator_reserved_files",
      payload: { paths: ["src/**"], reason: "only workers reserve" },
    },
    // 5. First spawn (10 minutes after decomp - way too slow)
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:10:00.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "BlueLake", bead_id: "test-epic-bad.1" },
    },
    // 6. Worker completes (but no review!)
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:20:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "subtask_success",
      payload: { bead_id: "test-epic-bad.1", worker: "BlueLake" },
    },
    // 7. VIOLATION: No worker spawned for subtask 2
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:30:00.000Z",
      event_type: "VIOLATION",
      violation_type: "no_worker_spawned",
      payload: { bead_id: "test-epic-bad.2", reason: "coordinator did work directly" },
    },
    // 8. VIOLATION: No worker spawned for subtask 3
    {
      session_id: "test-session-bad",
      epic_id: "test-epic-bad",
      timestamp: "2025-01-01T10:40:00.000Z",
      event_type: "VIOLATION",
      violation_type: "no_worker_spawned",
      payload: { bead_id: "test-epic-bad.3", reason: "coordinator did work directly" },
    },
  ],
};

/**
 * DECENT COORDINATOR - Some Issues
 *
 * - 1 violation (ran tests once)
 * - 100% spawn efficiency (2/2 workers spawned)
 * - 50% review thoroughness (reviewed only 1/2)
 * - Good time to first spawn (45s)
 */
export const decentCoordinator: CoordinatorSession = {
  session_id: "test-session-decent",
  epic_id: "test-epic-decent",
  start_time: "2025-01-01T10:00:00.000Z",
  end_time: "2025-01-01T10:25:00.000Z",
  events: [
    // 1. Decomposition complete
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:00:00.000Z",
      event_type: "DECISION",
      decision_type: "decomposition_complete",
      payload: { subtask_count: 2 },
    },
    // 2. First spawn (45s - acceptable)
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:00:45.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "BlueLake", bead_id: "test-epic-decent.1" },
    },
    // 3. Second spawn
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:01:00.000Z",
      event_type: "DECISION",
      decision_type: "worker_spawned",
      payload: { worker: "GreenMountain", bead_id: "test-epic-decent.2" },
    },
    // 4. First worker completes
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:10:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "subtask_success",
      payload: { bead_id: "test-epic-decent.1", worker: "BlueLake" },
    },
    // 5. First review
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:11:00.000Z",
      event_type: "DECISION",
      decision_type: "review_completed",
      payload: {
        bead_id: "test-epic-decent.1",
        approved: true,
        issues: [],
      },
    },
    // 6. VIOLATION: Ran tests (one slip-up)
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:15:00.000Z",
      event_type: "VIOLATION",
      violation_type: "coordinator_ran_tests",
      payload: { command: "bun test", reason: "should let worker verify" },
    },
    // 7. Second worker completes
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:20:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "subtask_success",
      payload: { bead_id: "test-epic-decent.2", worker: "GreenMountain" },
    },
    // 8. No review for second worker (50% review rate)
    // 9. Epic complete
    {
      session_id: "test-session-decent",
      epic_id: "test-epic-decent",
      timestamp: "2025-01-01T10:25:00.000Z",
      event_type: "OUTCOME",
      outcome_type: "epic_complete",
      payload: { epic_id: "test-epic-decent", total_subtasks: 2 },
    },
  ],
};

/**
 * All test fixtures
 */
export const coordinatorSessionFixtures = [
  perfectCoordinator,
  badCoordinator,
  decentCoordinator,
];
