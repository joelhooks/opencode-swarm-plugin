/**
 * Test cases for decision quality evaluation
 *
 * Each case includes:
 * - input: Decision trace with strategy selection and optional precedent
 * - output: Outcome data with success/failure metrics
 * - expected: Validation criteria for scorer thresholds
 */

/**
 * Strategy selection fixture with outcome data.
 * Used to test strategySelectionQuality scorer.
 */
export interface StrategySelectionFixture {
  input: {
    task: string;
    strategy: string;
    precedent_task?: string;
    precedent_strategy?: string;
  };
  output: {
    strategy: string;
    outcome_success: boolean;
    error_count: number;
    duration_ms?: number;
  };
  expected: {
    min_score?: number;
    max_score?: number;
  };
}

/**
 * Precedent relevance fixture.
 * Used to test precedentRelevance scorer (LLM-as-judge).
 */
export interface PrecedentRelevanceFixture {
  input: {
    task: string;
    precedent_task: string;
    precedent_strategy: string;
  };
  expected: {
    min_score?: number;
    max_score?: number;
  };
}

/**
 * Strategy selection fixtures - known good and bad outcomes.
 */
export const strategySelectionFixtures: StrategySelectionFixture[] = [
  // ============================================================================
  // SUCCESSFUL STRATEGY SELECTIONS (should score high)
  // ============================================================================
  {
    input: {
      task: "Refactor auth module to use OAuth2",
      strategy: "file-based",
    },
    output: {
      strategy: "file-based",
      outcome_success: true,
      error_count: 0,
      duration_ms: 1800000, // 30 minutes
    },
    expected: {
      min_score: 0.9, // Should score very high - perfect outcome
    },
  },
  {
    input: {
      task: "Add user profile page with settings",
      strategy: "feature-based",
    },
    output: {
      strategy: "feature-based",
      outcome_success: true,
      error_count: 1, // Minor error but still succeeded
      duration_ms: 2400000, // 40 minutes
    },
    expected: {
      min_score: 0.7, // Good score - succeeded with minor issues
    },
  },
  {
    input: {
      task: "Fix critical security vulnerability in auth flow",
      strategy: "risk-based",
    },
    output: {
      strategy: "risk-based",
      outcome_success: true,
      error_count: 0,
      duration_ms: 1200000, // 20 minutes
    },
    expected: {
      min_score: 0.9, // High score - risk-based worked perfectly
    },
  },

  // ============================================================================
  // FAILED STRATEGY SELECTIONS (should score low)
  // ============================================================================
  {
    input: {
      task: "Add comprehensive error handling across codebase",
      strategy: "file-based",
    },
    output: {
      strategy: "file-based",
      outcome_success: false,
      error_count: 5,
      duration_ms: 5400000, // 90 minutes - took too long
    },
    expected: {
      max_score: 0.2, // Should score low - wrong strategy, failed outcome
    },
  },
  {
    input: {
      task: "Update button color in navigation bar",
      strategy: "feature-based",
    },
    output: {
      strategy: "feature-based",
      outcome_success: false,
      error_count: 3,
      duration_ms: 3600000, // 60 minutes - over-decomposed trivial task
    },
    expected: {
      max_score: 0.3, // Low score - feature-based overkill for simple task
    },
  },

  // ============================================================================
  // MODERATE CASES (should score mid-range)
  // ============================================================================
  {
    input: {
      task: "Implement caching layer for API responses",
      strategy: "file-based",
    },
    output: {
      strategy: "file-based",
      outcome_success: true,
      error_count: 3, // Several errors but eventually succeeded
      duration_ms: 4200000, // 70 minutes
    },
    expected: {
      min_score: 0.4,
      max_score: 0.6, // Mid-range - success but messy
    },
  },
];

/**
 * Precedent relevance fixtures - testing LLM-as-judge similarity scoring.
 */
export const precedentRelevanceFixtures: PrecedentRelevanceFixture[] = [
  // ============================================================================
  // HIGHLY RELEVANT PRECEDENTS (should score high)
  // ============================================================================
  {
    input: {
      task: "Add OAuth login with Google",
      precedent_task: "Implement OAuth refresh token flow",
      precedent_strategy: "feature-based",
    },
    expected: {
      min_score: 0.7, // Very related - both OAuth auth tasks
    },
  },
  {
    input: {
      task: "Refactor user authentication module",
      precedent_task: "Refactor auth module to use bcrypt",
      precedent_strategy: "file-based",
    },
    expected: {
      min_score: 0.8, // Nearly identical tasks
    },
  },
  {
    input: {
      task: "Add rate limiting to API endpoints",
      precedent_task: "Implement rate limiter with Redis",
      precedent_strategy: "feature-based",
    },
    expected: {
      min_score: 0.7, // Directly related tasks
    },
  },

  // ============================================================================
  // SOMEWHAT RELEVANT PRECEDENTS (should score mid-range)
  // ============================================================================
  {
    input: {
      task: "Add user profile page",
      precedent_task: "Add admin dashboard",
      precedent_strategy: "feature-based",
    },
    expected: {
      min_score: 0.4,
      max_score: 0.6, // Similar (both UI pages) but different domains
    },
  },
  {
    input: {
      task: "Optimize database queries",
      precedent_task: "Add caching layer for API responses",
      precedent_strategy: "file-based",
    },
    expected: {
      min_score: 0.4,
      max_score: 0.6, // Related (both performance) but different approaches
    },
  },

  // ============================================================================
  // IRRELEVANT PRECEDENTS (should score low)
  // ============================================================================
  {
    input: {
      task: "Add OAuth login",
      precedent_task: "Fix CSS styling bug in footer",
      precedent_strategy: "risk-based",
    },
    expected: {
      max_score: 0.3, // Completely unrelated
    },
  },
  {
    input: {
      task: "Implement user authentication",
      precedent_task: "Update README documentation",
      precedent_strategy: "file-based",
    },
    expected: {
      max_score: 0.2, // No relation whatsoever
    },
  },
  {
    input: {
      task: "Add database migration for users table",
      precedent_task: "Configure webpack build settings",
      precedent_strategy: "file-based",
    },
    expected: {
      max_score: 0.3, // Unrelated domains
    },
  },
];
