/**
 * Decision Quality Scorers
 *
 * Evaluates the quality of coordinator decision-making:
 * 1. Strategy Selection Quality - Did chosen strategy lead to success?
 * 2. Precedent Relevance - Were cited precedents actually similar?
 */
import { createScorer } from "evalite";
import { generateText, gateway } from "ai";
import type { GatewayModelId } from "ai";

const JUDGE_MODEL: GatewayModelId = "anthropic/claude-haiku-4-5";

/**
 * Strategy Selection Quality Scorer
 *
 * Evaluates whether the chosen decomposition strategy led to successful outcomes.
 * This is the ultimate test - did the decision actually work?
 *
 * Scoring:
 * - 1.0: Success with no errors
 * - 0.7-0.9: Success with minor errors (error_count 1-2)
 * - 0.4-0.6: Success with significant errors (error_count 3+)
 * - 0.0: Failure
 *
 * Based on calculateDecisionQuality() from swarm-mail/decision-trace-store.ts
 */
export const strategySelectionQuality = createScorer({
  name: "Strategy Selection Quality",
  description: "Did the chosen strategy lead to successful outcomes?",
  scorer: ({ output }) => {
    try {
      const outcome = typeof output === "string" ? JSON.parse(output) : output;

      const success = outcome.outcome_success ?? false;
      const errorCount = outcome.error_count ?? 0;

      // Failed outcomes get 0
      if (!success) {
        return {
          score: 0.0,
          message: `Strategy failed with ${errorCount} error(s)`,
        };
      }

      // Successful outcomes scored by error count
      if (errorCount === 0) {
        return {
          score: 1.0,
          message: "Strategy succeeded with no errors - perfect choice",
        };
      }

      if (errorCount <= 2) {
        const score = 0.9 - errorCount * 0.1; // 0.8-0.9 for 1-2 errors
        return {
          score,
          message: `Strategy succeeded with ${errorCount} minor error(s)`,
        };
      }

      // 3+ errors: penalize but don't go below 0.4 if completed
      const score = Math.max(0.4, 0.7 - (errorCount - 2) * 0.1);
      return {
        score,
        message: `Strategy succeeded but with ${errorCount} errors - suboptimal`,
      };
    } catch (error) {
      return {
        score: 0.0,
        message: `Failed to parse outcome: ${error}`,
      };
    }
  },
});

/**
 * Precedent Relevance Scorer (LLM-as-Judge)
 *
 * Evaluates whether cited precedent tasks are actually semantically similar
 * to the current task. Uses Claude Haiku to judge relevance.
 *
 * This catches cases where coordinators cite irrelevant precedents,
 * which can lead to poor strategy selection.
 *
 * Scoring:
 * - 0.8-1.0: Highly relevant (same domain, similar requirements)
 * - 0.5-0.7: Moderately relevant (related concepts, different scope)
 * - 0.0-0.4: Irrelevant (different domains, no meaningful overlap)
 */
export const precedentRelevance = createScorer({
  name: "Precedent Relevance (LLM Judge)",
  description: "Was cited precedent actually similar to the task?",
  scorer: async ({ input }) => {
    try {
      const data = typeof input === "object" && input !== null ? input : {};
      const task = "task" in data ? String(data.task) : "Unknown task";
      const precedentTask =
        "precedent_task" in data
          ? String(data.precedent_task)
          : "Unknown precedent";
      const precedentStrategy =
        "precedent_strategy" in data ? String(data.precedent_strategy) : "unknown";

      const { text } = await generateText({
        model: gateway(JUDGE_MODEL),
        prompt: `You are evaluating whether a precedent task is relevant to a current task.
This is for a multi-agent coordination system that uses past decisions to inform new ones.

CURRENT TASK:
${task}

CITED PRECEDENT TASK:
${precedentTask}
(Strategy used: ${precedentStrategy})

Evaluate the relevance of this precedent on these criteria:

1. DOMAIN SIMILARITY (40%): Are they in the same domain?
   - Same: "Add OAuth login" vs "Implement OAuth refresh tokens" (auth domain)
   - Different: "Add OAuth login" vs "Fix CSS styling bug" (auth vs UI)

2. TECHNICAL OVERLAP (30%): Do they involve similar technical challenges?
   - High: "Rate limiting with Redis" vs "Caching with Redis" (both Redis patterns)
   - Low: "Database migration" vs "Webpack config" (unrelated tech)

3. SCOPE SIMILARITY (20%): Are they similar in size/complexity?
   - Similar: "Add profile page" vs "Add dashboard" (both feature pages)
   - Different: "Refactor entire codebase" vs "Fix typo" (massive vs trivial)

4. STRATEGY APPLICABILITY (10%): Would the same strategy make sense?
   - Applicable: Both benefit from file-based decomposition
   - Inapplicable: One needs feature-based, other needs risk-based

Be harsh - irrelevant precedents waste coordinator time and lead to poor decisions.

Return ONLY valid JSON (no markdown, no explanation):
{"score": <0-100>, "reasoning": "<1-2 sentence explanation>"}`,
        maxOutputTokens: 256,
      });

      // Parse JSON response - handle potential markdown wrapping
      let jsonText = text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/```json?\n?/g, "").replace(/```$/g, "");
      }

      const result = JSON.parse(jsonText) as {
        score: number;
        reasoning: string;
      };

      return {
        score: result.score / 100,
        message: result.reasoning,
      };
    } catch (error) {
      // Don't fail the eval if judge fails - return neutral score
      return {
        score: 0.5,
        message: `LLM judge error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
