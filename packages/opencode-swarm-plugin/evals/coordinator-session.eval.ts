/**
 * Coordinator Session Eval - Scores Real Captured Sessions
 *
 * Tests that coordinators follow protocol:
 * 1. Don't edit files directly (spawn workers)
 * 2. Don't run tests directly (workers do verification)
 * 3. Spawn workers for all subtasks
 * 4. Review worker output before accepting
 * 5. Minimize time to first spawn (don't overthink)
 *
 * ## Data Sources
 *
 * - **Real sessions**: Captured from ~/.config/swarm-tools/sessions/*.jsonl
 * - **Synthetic fixtures**: Test cases in fixtures/coordinator-sessions.ts
 *
 * ## Test Flow
 *
 * 1. Load captured sessions from disk (via loadCapturedSessions)
 * 2. Load synthetic fixtures for baseline validation
 * 3. Run coordinator-discipline scorers on all sessions
 * 4. Output scores and violation details
 *
 * Run with: pnpm eval:dev (watch mode) or pnpm eval:run (once)
 */

import { evalite } from "evalite";
import { coordinatorSessionFixtures } from "./fixtures/coordinator-sessions.js";
import { loadCapturedSessions } from "./lib/data-loader.js";
import {
  overallDiscipline,
  reviewThoroughness,
  spawnEfficiency,
  timeToFirstSpawn,
  violationCount,
} from "./scorers/index.js";

/**
 * Test 1: Synthetic Fixtures (Baseline)
 *
 * Validates scorers against known-good and known-bad coordinator sessions.
 * These should have predictable scores.
 */
evalite("Coordinator Discipline - Synthetic Fixtures", {
  data: async () =>
    coordinatorSessionFixtures.map((fixture) => ({
      input: fixture,
      expected: {
        session_id: fixture.session_id,
        epic_id: fixture.epic_id,
      },
    })),

  task: async (input) => {
    // Return session as JSON string for scorers
    return JSON.stringify(input);
  },

  scorers: [
    violationCount,
    spawnEfficiency,
    reviewThoroughness,
    timeToFirstSpawn,
    overallDiscipline,
  ],
});

/**
 * Test 2: Real Captured Sessions
 *
 * Loads sessions from ~/.config/swarm-tools/sessions/ and scores them.
 * This eval will skip if no captured sessions exist.
 */
evalite("Coordinator Discipline - Real Sessions", {
  data: async () => {
    // Try to load real sessions
    const captured = await loadCapturedSessions({ limit: 20 });

    // If no real sessions, return empty (eval will skip)
    if (captured.length === 0) {
      console.log(
        "\n⚠️  No real coordinator sessions found in ~/.config/swarm-tools/sessions/",
      );
      console.log(
        "   Run a coordinator session with eval capture enabled to populate data.\n",
      );
      return [];
    }

    console.log(
      `\n✓ Loaded ${captured.length} real coordinator sessions for evaluation\n`,
    );

    return captured.map(({ session }) => ({
      input: session,
      expected: {
        session_id: session.session_id,
        epic_id: session.epic_id,
      },
    }));
  },

  task: async (input) => {
    return JSON.stringify(input);
  },

  scorers: [
    violationCount,
    spawnEfficiency,
    reviewThoroughness,
    timeToFirstSpawn,
    overallDiscipline,
  ],
});

/**
 * Test 3: Perfect vs Bad Comparison
 *
 * Direct comparison between perfectCoordinator and badCoordinator fixtures
 * to validate scorer ranges and weighting.
 */
evalite("Coordinator Discipline - Perfect vs Bad", {
  data: async () => [
    {
      input: coordinatorSessionFixtures[0], // perfectCoordinator
      expected: {
        name: "perfect",
        expectedViolations: 0,
        expectedSpawnEfficiency: 1.0,
        expectedReviewThoroughness: 1.0,
      },
    },
    {
      input: coordinatorSessionFixtures[1], // badCoordinator
      expected: {
        name: "bad",
        expectedViolations: 5, // 3 direct violations + 2 no_worker_spawned
        expectedSpawnEfficiency: 0.33, // 1/3 workers spawned
        expectedReviewThoroughness: 0.0, // 0 reviews
      },
    },
  ],

  task: async (input) => {
    return JSON.stringify(input);
  },

  scorers: [
    violationCount,
    spawnEfficiency,
    reviewThoroughness,
    timeToFirstSpawn,
    overallDiscipline,
  ],
});
