/**
 * Custom scorers for compaction hook evaluation
 *
 * These scorers validate that the compaction hook correctly:
 * 1. Detects swarm state (confidence level)
 * 2. Injects appropriate context (full/fallback/none)
 * 3. Includes required patterns in context
 * 4. Excludes placeholder/generic content
 */

import { createScorer } from "evalite";

/**
 * Expected output from compaction hook tests
 */
export interface CompactionResult {
  detected: boolean;
  confidence: "high" | "medium" | "low" | "none";
  contextInjected: boolean;
  contextType: "full" | "fallback" | "none";
  injectedContext: string;
}

/**
 * Expected criteria from test case
 */
export interface CompactionExpected {
  confidence: "high" | "medium" | "low" | "none";
  contextInjected: boolean;
  contextType: "full" | "fallback" | "none";
  mustContain?: string[];
  mustNotContain?: string[];
}

/**
 * Validates that detection confidence matches expected level
 *
 * Confidence determines what gets injected:
 * - HIGH/MEDIUM: Full coordinator context
 * - LOW: Fallback detection prompt
 * - NONE: No injection
 *
 * Score: 1.0 if confidence matches, 0.0 otherwise
 */
export const confidenceAccuracy = createScorer({
  name: "Confidence Accuracy",
  description: "Validates detection confidence matches expected level",
  scorer: ({ output, expected }) => {
    try {
      const result = JSON.parse(String(output)) as CompactionResult;
      const exp = expected as CompactionExpected;

      if (result.confidence === exp.confidence) {
        return {
          score: 1,
          message: `Correct confidence: ${result.confidence}`,
        };
      }

      return {
        score: 0,
        message: `Wrong confidence: got ${result.confidence}, expected ${exp.confidence}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse result: ${error}`,
      };
    }
  },
});

/**
 * Validates that context injection matches expected behavior
 *
 * Checks:
 * - Whether context was injected (boolean)
 * - What type of context (full/fallback/none)
 *
 * Score: 1.0 if both match, 0.5 if only injection status matches, 0.0 otherwise
 */
export const contextInjectionCorrectness = createScorer({
  name: "Context Injection Correctness",
  description: "Validates context injection matches expected behavior",
  scorer: ({ output, expected }) => {
    try {
      const result = JSON.parse(String(output)) as CompactionResult;
      const exp = expected as CompactionExpected;

      const injectionMatches = result.contextInjected === exp.contextInjected;
      const typeMatches = result.contextType === exp.contextType;

      if (injectionMatches && typeMatches) {
        return {
          score: 1,
          message: `Correct injection: ${result.contextType}`,
        };
      }

      if (injectionMatches) {
        return {
          score: 0.5,
          message: `Injection status correct but wrong type: got ${result.contextType}, expected ${exp.contextType}`,
        };
      }

      return {
        score: 0,
        message: `Wrong injection: got ${result.contextInjected ? result.contextType : "none"}, expected ${exp.contextInjected ? exp.contextType : "none"}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse result: ${error}`,
      };
    }
  },
});

/**
 * Validates that injected context contains required patterns
 *
 * For coordinator resumption, context MUST include:
 * - Swarm continuation instructions
 * - Tool names (swarm_status, swarmmail_inbox)
 * - Actionable language ("COORDINATOR", "Keep Cooking")
 *
 * Score: ratio of required patterns found (0.0 to 1.0)
 */
export const requiredPatternsPresent = createScorer({
  name: "Required Patterns Present",
  description: "Validates injected context contains required patterns",
  scorer: ({ output, expected }) => {
    try {
      const result = JSON.parse(String(output)) as CompactionResult;
      const exp = expected as CompactionExpected;

      // If no context injected, check that mustContain is empty
      if (!result.contextInjected) {
        if (!exp.mustContain || exp.mustContain.length === 0) {
          return {
            score: 1,
            message: "No context injected (expected)",
          };
        }
        return {
          score: 0,
          message: "No context injected but patterns were expected",
        };
      }

      // Check required patterns
      if (!exp.mustContain || exp.mustContain.length === 0) {
        return {
          score: 1,
          message: "No required patterns to check",
        };
      }

      const found = exp.mustContain.filter((pattern) =>
        result.injectedContext.includes(pattern),
      );

      const score = found.length / exp.mustContain.length;

      if (score === 1) {
        return {
          score: 1,
          message: `All ${exp.mustContain.length} required patterns found`,
        };
      }

      const missing = exp.mustContain.filter(
        (pattern) => !result.injectedContext.includes(pattern),
      );

      return {
        score,
        message: `${found.length}/${exp.mustContain.length} patterns found. Missing: ${missing.join(", ")}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse result: ${error}`,
      };
    }
  },
});

/**
 * Validates that injected context excludes forbidden patterns
 *
 * Context should NOT contain:
 * - Placeholder IDs ("bd-xxx")
 * - Generic/template language
 * - Wrong context type markers
 *
 * Score: 1.0 if no forbidden patterns found, 0.0 if any found
 */
export const forbiddenPatternsAbsent = createScorer({
  name: "Forbidden Patterns Absent",
  description: "Validates injected context excludes forbidden patterns",
  scorer: ({ output, expected }) => {
    try {
      const result = JSON.parse(String(output)) as CompactionResult;
      const exp = expected as CompactionExpected;

      // If no context injected, all checks pass
      if (!result.contextInjected) {
        return {
          score: 1,
          message: "No context injected (no forbidden patterns possible)",
        };
      }

      // Check forbidden patterns
      if (!exp.mustNotContain || exp.mustNotContain.length === 0) {
        return {
          score: 1,
          message: "No forbidden patterns to check",
        };
      }

      const foundForbidden = exp.mustNotContain.filter((pattern) =>
        result.injectedContext.includes(pattern),
      );

      if (foundForbidden.length === 0) {
        return {
          score: 1,
          message: "No forbidden patterns found",
        };
      }

      return {
        score: 0,
        message: `Forbidden patterns found: ${foundForbidden.join(", ")}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse result: ${error}`,
      };
    }
  },
});

/**
 * Composite scorer: Overall compaction quality
 *
 * Combines all compaction-specific checks into single score.
 * Weighted average:
 * - Confidence accuracy: 25%
 * - Context injection: 25%
 * - Required patterns: 30%
 * - Forbidden patterns: 20%
 *
 * Score: 0.0 to 1.0
 */
export const compactionQuality = createScorer({
  name: "Overall Compaction Quality",
  description: "Composite score for compaction hook correctness",
  scorer: async ({ output, expected, input }) => {
    try {
      // Run all scorers
      const scores = {
        confidence: await confidenceAccuracy({ output, expected, input }),
        injection: await contextInjectionCorrectness({ output, expected, input }),
        required: await requiredPatternsPresent({ output, expected, input }),
        forbidden: await forbiddenPatternsAbsent({ output, expected, input }),
      };

      // Weighted average
      const weights = {
        confidence: 0.25,
        injection: 0.25,
        required: 0.3,
        forbidden: 0.2,
      };

      const totalScore =
        (scores.confidence.score ?? 0) * weights.confidence +
        (scores.injection.score ?? 0) * weights.injection +
        (scores.required.score ?? 0) * weights.required +
        (scores.forbidden.score ?? 0) * weights.forbidden;

      const details = [
        `Confidence: ${((scores.confidence.score ?? 0) * 100).toFixed(0)}%`,
        `Injection: ${((scores.injection.score ?? 0) * 100).toFixed(0)}%`,
        `Required: ${((scores.required.score ?? 0) * 100).toFixed(0)}%`,
        `Forbidden: ${((scores.forbidden.score ?? 0) * 100).toFixed(0)}%`,
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
