/**
 * Coordinator Discipline Scorers - Evaluate coordinator behavior
 *
 * These scorers measure whether a coordinator follows the protocol:
 * 1. Don't edit files directly (spawn workers)
 * 2. Don't run tests directly (workers do verification)
 * 3. Spawn workers for all subtasks
 * 4. Review worker output before accepting
 * 5. Minimize time to first spawn (don't overthink)
 *
 * Inputs: CoordinatorSession from eval-capture
 */

import { createScorer } from "evalite";
import type { CoordinatorSession } from "../../src/eval-capture.js";

/**
 * Violation Count Scorer
 *
 * Counts VIOLATION events in the session.
 * Each violation reduces score by 0.2.
 *
 * Violations tracked:
 * - coordinator_edited_file (should spawn worker instead)
 * - coordinator_ran_tests (workers do verification)
 * - coordinator_reserved_files (only workers reserve)
 * - no_worker_spawned (subtask exists but no worker)
 *
 * Score: 1.0 - (0.2 * violation_count), floored at 0.0
 */
export const violationCount = createScorer({
  name: "Violation Count",
  description: "Coordinator followed protocol (no direct edits, tests, or reservations)",
  scorer: ({ output }) => {
    try {
      const session = JSON.parse(String(output)) as CoordinatorSession;

      // Count violations
      const violations = session.events.filter(
        (e) => e.event_type === "VIOLATION"
      );

      const count = violations.length;
      const score = Math.max(0, 1.0 - count * 0.2);

      if (count === 0) {
        return {
          score: 1.0,
          message: "Perfect - 0 violations",
        };
      }

      return {
        score,
        message: `${count} violations detected`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CoordinatorSession: ${error}`,
      };
    }
  },
});

/**
 * Spawn Efficiency Scorer
 *
 * Measures whether workers were spawned for all subtasks.
 * Coordinators should delegate work, not do it themselves.
 *
 * Score: workers_spawned / subtasks_planned
 */
export const spawnEfficiency = createScorer({
  name: "Spawn Efficiency",
  description: "Workers spawned for all subtasks (delegation ratio)",
  scorer: ({ output }) => {
    try {
      const session = JSON.parse(String(output)) as CoordinatorSession;

      // Find decomposition_complete event (has subtask count)
      const decomp = session.events.find(
        (e) =>
          e.event_type === "DECISION" &&
          e.decision_type === "decomposition_complete"
      );

      if (!decomp) {
        return {
          score: 0,
          message: "No decomposition event found",
        };
      }

      const subtaskCount = (decomp.payload as { subtask_count?: number })?.subtask_count || 0;

      if (subtaskCount === 0) {
        return {
          score: 0,
          message: "No subtasks planned",
        };
      }

      // Count worker_spawned events
      const spawned = session.events.filter(
        (e) =>
          e.event_type === "DECISION" && e.decision_type === "worker_spawned"
      ).length;

      const score = spawned / subtaskCount;

      return {
        score,
        message: `${spawned}/${subtaskCount} workers spawned (${(score * 100).toFixed(0)}%)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CoordinatorSession: ${error}`,
      };
    }
  },
});

/**
 * Review Thoroughness Scorer
 *
 * Measures whether coordinator reviewed worker output.
 * Should have review_completed events for all finished subtasks.
 *
 * Score: reviews_completed / workers_finished
 */
export const reviewThoroughness = createScorer({
  name: "Review Thoroughness",
  description: "Coordinator reviewed all worker output",
  scorer: ({ output }) => {
    try {
      const session = JSON.parse(String(output)) as CoordinatorSession;

      // Count finished workers (subtask_success or subtask_failed)
      const finished = session.events.filter(
        (e) =>
          e.event_type === "OUTCOME" &&
          (e.outcome_type === "subtask_success" ||
            e.outcome_type === "subtask_failed")
      ).length;

      if (finished === 0) {
        return {
          score: 1.0,
          message: "No finished workers to review",
        };
      }

      // Count review_completed events
      const reviewed = session.events.filter(
        (e) =>
          e.event_type === "DECISION" && e.decision_type === "review_completed"
      ).length;

      const score = reviewed / finished;

      return {
        score,
        message: `${reviewed}/${finished} workers reviewed (${(score * 100).toFixed(0)}%)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CoordinatorSession: ${error}`,
      };
    }
  },
});

/**
 * Time to First Spawn Scorer
 *
 * Measures how fast the coordinator spawned the first worker.
 * Overthinking and perfectionism delays workers and blocks progress.
 *
 * Normalization:
 * - < 60s: 1.0 (excellent)
 * - 60-300s: linear decay to 0.5
 * - > 300s: 0.0 (way too slow)
 *
 * Score: normalized to 0-1 (faster is better)
 */
export const timeToFirstSpawn = createScorer({
  name: "Time to First Spawn",
  description: "Coordinator spawned workers quickly (no overthinking)",
  scorer: ({ output }) => {
    try {
      const session = JSON.parse(String(output)) as CoordinatorSession;

      // Find decomposition_complete event
      const decomp = session.events.find(
        (e) =>
          e.event_type === "DECISION" &&
          e.decision_type === "decomposition_complete"
      );

      if (!decomp) {
        return {
          score: 0,
          message: "No decomposition event found",
        };
      }

      // Find first worker_spawned event
      const firstSpawn = session.events.find(
        (e) =>
          e.event_type === "DECISION" && e.decision_type === "worker_spawned"
      );

      if (!firstSpawn) {
        return {
          score: 0,
          message: "No worker spawned",
        };
      }

      // Calculate time delta
      const decompTime = new Date(decomp.timestamp).getTime();
      const spawnTime = new Date(firstSpawn.timestamp).getTime();
      const deltaMs = spawnTime - decompTime;

      // Normalize: < 60s = 1.0, > 300s = 0.0, linear in between
      const EXCELLENT_MS = 60_000;
      const POOR_MS = 300_000;

      let score: number;
      if (deltaMs < EXCELLENT_MS) {
        score = 1.0;
      } else if (deltaMs > POOR_MS) {
        score = 0.0;
      } else {
        // Linear decay from 1.0 to 0.0
        score = 1.0 - (deltaMs - EXCELLENT_MS) / (POOR_MS - EXCELLENT_MS);
      }

      const seconds = Math.round(deltaMs / 1000);

      return {
        score,
        message: `First spawn after ${deltaMs}ms (${seconds}s)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CoordinatorSession: ${error}`,
      };
    }
  },
});

/**
 * Overall Discipline Scorer
 *
 * Weighted composite of all coordinator discipline metrics.
 *
 * Weights:
 * - Violations: 30% (most critical - breaking protocol)
 * - Spawn efficiency: 25% (delegation is key)
 * - Review thoroughness: 25% (quality gate)
 * - Time to first spawn: 20% (bias toward action)
 *
 * Score: 0.0 to 1.0
 */
export const overallDiscipline = createScorer({
  name: "Overall Coordinator Discipline",
  description: "Composite score for coordinator protocol adherence",
  scorer: async ({ output, expected, input }) => {
    try {
      // Run all scorers
      const scores = {
        violations: await violationCount({ output, expected, input }),
        spawn: await spawnEfficiency({ output, expected, input }),
        review: await reviewThoroughness({ output, expected, input }),
        speed: await timeToFirstSpawn({ output, expected, input }),
      };

      // Weighted average
      const weights = {
        violations: 0.3,
        spawn: 0.25,
        review: 0.25,
        speed: 0.2,
      };

      const totalScore =
        (scores.violations.score ?? 0) * weights.violations +
        (scores.spawn.score ?? 0) * weights.spawn +
        (scores.review.score ?? 0) * weights.review +
        (scores.speed.score ?? 0) * weights.speed;

      const details = [
        `Violations: ${((scores.violations.score ?? 0) * 100).toFixed(0)}%`,
        `Spawn: ${((scores.spawn.score ?? 0) * 100).toFixed(0)}%`,
        `Review: ${((scores.review.score ?? 0) * 100).toFixed(0)}%`,
        `Speed: ${((scores.speed.score ?? 0) * 100).toFixed(0)}%`,
      ].join(", ");

      return {
        score: totalScore,
        message: `Overall: ${(totalScore * 100).toFixed(0)}% (${details})`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to compute composite score: ${error}`,
      };
    }
  },
});
