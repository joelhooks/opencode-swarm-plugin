/**
 * Decision Quality Eval
 *
 * Evaluates the quality of coordinator decision-making:
 * 1. Strategy Selection Quality - Did chosen strategy lead to success?
 * 2. Precedent Relevance - Were cited precedents actually similar?
 *
 * Uses:
 * - Outcome-based scoring (did it work?)
 * - LLM-as-judge for semantic similarity
 *
 * Run with: pnpm evalite evals/decision-quality.eval.ts
 *
 * Requires: AI_GATEWAY_API_KEY environment variable
 */
import { evalite } from "evalite";
import {
  strategySelectionQuality,
  precedentRelevance,
} from "./scorers/decision-quality-scorers.js";
import {
  strategySelectionFixtures,
  precedentRelevanceFixtures,
} from "./fixtures/decision-quality-fixtures.js";

// ============================================================================
// Eval Suites
// ============================================================================

/**
 * Strategy Selection Quality Eval
 *
 * Tests whether strategy selection decisions led to successful outcomes.
 * Uses fixtures with known good/bad outcomes.
 */
evalite("Strategy Selection Quality", {
  data: async () =>
    strategySelectionFixtures.map((fixture) => ({
      input: {
        ...fixture.input,
        outcome: fixture.output, // Embed outcome in input for scorer
      },
      expected: fixture.expected,
    })),

  // Task returns the outcome for scoring
  task: async (input) => {
    return input.outcome;
  },

  scorers: [strategySelectionQuality],
});

/**
 * Precedent Relevance Eval
 *
 * Tests whether cited precedents are actually semantically similar to tasks.
 * Uses LLM-as-judge to evaluate relevance.
 */
evalite("Precedent Relevance", {
  data: async () =>
    precedentRelevanceFixtures.map((fixture) => ({
      input: fixture.input,
      expected: fixture.expected,
    })),

  // Task is pass-through - LLM judge evaluates input directly
  task: async (input) => input,

  scorers: [precedentRelevance],
});

/**
 * Edge Cases: Strategy Selection
 *
 * Tests extreme outcomes (perfect success vs catastrophic failure).
 */
evalite("Strategy Selection Edge Cases", {
  data: async () => [
    {
      input: {
        task: "Trivial task - fix typo",
        strategy: "file-based",
        outcome: {
          strategy: "file-based",
          outcome_success: true,
          error_count: 0,
          duration_ms: 300000, // 5 minutes
        },
      },
      expected: { min_score: 0.9 },
    },
    {
      input: {
        task: "Complex refactor - migrate entire auth system",
        strategy: "feature-based",
        outcome: {
          strategy: "feature-based",
          outcome_success: false,
          error_count: 10,
          duration_ms: 10800000, // 3 hours
        },
      },
      expected: { max_score: 0.1 },
    },
  ],

  task: async (input) => {
    return input.outcome;
  },

  scorers: [strategySelectionQuality],
});

/**
 * Edge Cases: Precedent Relevance
 *
 * Tests obvious matches vs completely unrelated tasks.
 */
evalite("Precedent Relevance Edge Cases", {
  data: async () => [
    {
      input: {
        task: "Add OAuth login with Google",
        precedent_task: "Add OAuth login with GitHub",
        precedent_strategy: "feature-based",
      },
      expected: { min_score: 0.9 }, // Nearly identical
    },
    {
      input: {
        task: "Implement user authentication",
        precedent_task: "Update package.json scripts",
        precedent_strategy: "file-based",
      },
      expected: { max_score: 0.2 }, // Completely unrelated
    },
  ],

  task: async (input) => input,

  scorers: [precedentRelevance],
});
