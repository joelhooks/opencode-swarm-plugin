import { createScorer } from "evalite";
import { generateText, gateway } from "ai";
import type { GatewayModelId } from "ai";
import type { CellTree } from "opencode-swarm-plugin";

const JUDGE_MODEL: GatewayModelId = "anthropic/claude-haiku-4-5";

/**
 * Custom scorers for evaluating swarm task decomposition quality
 */

/**
 * Checks that no files appear in multiple subtasks
 *
 * Independent subtasks are critical for parallel execution.
 * File conflicts cause merge conflicts and coordination overhead.
 *
 * Score: 1.0 if no conflicts, 0.0 if conflicts found
 */
export const subtaskIndependence = createScorer({
  name: "Subtask Independence",
  description: "Checks that no files appear in multiple subtasks",
  scorer: ({ output }) => {
    try {
      const beadTree = JSON.parse(String(output)) as CellTree;
      const fileMap = new Map<string, number>();

      // Track which files appear in which subtasks
      beadTree.subtasks.forEach((subtask) => {
        subtask.files?.forEach((file) => {
          const count = fileMap.get(file) || 0;
          fileMap.set(file, count + 1);
        });
      });

      // Check for conflicts
      const conflicts = Array.from(fileMap.entries()).filter(
        ([_, count]) => count > 1,
      );

      if (conflicts.length > 0) {
        return {
          score: 0,
          message: `File conflicts found: ${conflicts.map(([f]) => f).join(", ")}`,
        };
      }

      return {
        score: 1,
        message: "No file conflicts - subtasks are independent",
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CellTree: ${error}`,
      };
    }
  },
});

// ============================================================================
// Outcome-based scorers
// ============================================================================

export {
  executionSuccess,
  timeBalance,
  scopeAccuracy,
  scopeDrift,
  noRework,
} from "./outcome-scorers.js";

// ============================================================================
// Compaction-specific scorers
// ============================================================================

export {
  confidenceAccuracy,
  contextInjectionCorrectness,
  requiredPatternsPresent,
  forbiddenPatternsAbsent,
  compactionQuality,
} from "./compaction-scorers.js";

// ============================================================================
// Coordinator discipline scorers
// ============================================================================

export {
  violationCount,
  spawnEfficiency,
  reviewThoroughness,
  timeToFirstSpawn,
  overallDiscipline,
} from "./coordinator-discipline.js";

// ============================================================================
// Decision quality scorers
// ============================================================================

export {
  strategySelectionQuality,
  precedentRelevance,
} from "./decision-quality-scorers.js";

/**
 * Checks that subtasks cover the full task scope
 *
 * Incomplete coverage means:
 * - Missing functionality
 * - Follow-up work required
 * - Task not actually complete
 *
 * Score: ratio of expected files covered (0.0 to 1.0)
 * If no expected files specified, checks that subtasks exist
 */
export const coverageCompleteness = createScorer({
  name: "Coverage Completeness",
  description: "Checks that subtasks cover the full task scope",
  scorer: ({ output, expected }) => {
    try {
      const beadTree = JSON.parse(String(output)) as CellTree;

      // If expected files specified, check coverage
      const expectedData = expected as Record<string, unknown> | undefined;
      if (expectedData && Array.isArray(expectedData.requiredFiles)) {
        const allFiles = new Set(
          beadTree.subtasks.flatMap((st) => st.files || []),
        );

        const requiredFiles = expectedData.requiredFiles as string[];
        const coveredFiles = requiredFiles.filter((f) => allFiles.has(f));
        const coverage = coveredFiles.length / requiredFiles.length;

        return {
          score: coverage,
          message: `${coveredFiles.length}/${requiredFiles.length} required files covered`,
        };
      }

      // Otherwise, check min/max subtask count
      const minSubtasks = (expectedData?.minSubtasks as number) || 1;
      const maxSubtasks = (expectedData?.maxSubtasks as number) || 10;
      const count = beadTree.subtasks.length;

      if (count < minSubtasks) {
        return {
          score: 0,
          message: `Too few subtasks: ${count} < ${minSubtasks}`,
        };
      }

      if (count > maxSubtasks) {
        return {
          score: 0.5,
          message: `Too many subtasks: ${count} > ${maxSubtasks} (over-decomposed)`,
        };
      }

      return {
        score: 1,
        message: `Good subtask count: ${count} (${minSubtasks}-${maxSubtasks})`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CellTree: ${error}`,
      };
    }
  },
});

/**
 * Checks that each subtask has clear, actionable instructions
 *
 * Vague instructions lead to:
 * - Agent confusion and blocking
 * - Incorrect implementations
 * - Need for coordinator intervention
 *
 * Score: Average of per-subtask instruction quality
 */
export const instructionClarity = createScorer({
  name: "Instruction Clarity",
  description: "Checks that subtasks have clear, actionable instructions",
  scorer: ({ output }) => {
    try {
      const beadTree = JSON.parse(String(output)) as CellTree;

      if (beadTree.subtasks.length === 0) {
        return {
          score: 0,
          message: "No subtasks found",
        };
      }

      // Check each subtask for clarity signals
      const scores = beadTree.subtasks.map((subtask) => {
        let score = 0.5; // baseline

        // Has description?
        if (subtask.description && subtask.description.length > 20) {
          score += 0.2;
        }

        // Has files specified?
        if (subtask.files && subtask.files.length > 0) {
          score += 0.2;
        }

        // Title is specific (not generic)?
        const genericWords = ["update", "fix", "add", "change", "modify"];
        const titleLower = subtask.title.toLowerCase();
        const isGeneric = genericWords.some(
          (word) => titleLower === word || titleLower.startsWith(`${word} `),
        );
        if (!isGeneric) {
          score += 0.1;
        }

        return Math.min(1.0, score);
      });

      const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;

      return {
        score: avgScore,
        message: `Average instruction clarity: ${(avgScore * 100).toFixed(0)}%`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse CellTree: ${error}`,
      };
    }
  },
});

// ============================================================================
// LLM-as-Judge Scorers
// ============================================================================

/**
 * LLM-as-judge scorer for decomposition coherence
 *
 * Uses Claude Haiku to evaluate whether subtasks are truly independent,
 * well-scoped, and complete. This catches nuances that heuristics miss:
 * - Semantic dependencies between subtasks
 * - Scope that's too big or too trivial
 * - Missing pieces that would block completion
 *
 * Only use for decomposition evals - this is where it matters.
 */
export const decompositionCoherence = createScorer({
  name: "Decomposition Coherence (LLM Judge)",
  description:
    "LLM evaluates whether subtasks are truly independent and well-scoped",
  scorer: async ({ output, input }) => {
    try {
      const decomposition =
        typeof output === "string" ? output : JSON.stringify(output, null, 2);

      // Get original task from input if available
      const originalTask =
        typeof input === "object" && input !== null && "task" in input
          ? String((input as { task: string }).task)
          : "Unknown task";

      const { text } = await generateText({
        model: gateway(JUDGE_MODEL),
        prompt: `You are evaluating a task decomposition for parallel agent execution.

ORIGINAL TASK:
${originalTask}

DECOMPOSITION:
${decomposition}

Evaluate on these criteria (be harsh - bad decompositions waste expensive parallel work):

1. INDEPENDENCE (25%): Can subtasks truly run in parallel? Look for:
   - Shared state dependencies (one writes, another reads)
   - Ordering requirements hidden in the task descriptions
   - Shared files that will cause merge conflicts

2. SCOPE (25%): Is each subtask right-sized?
   - Too big: Should be split further (>2 hours of work)
   - Too small: Trivial tasks that waste agent spawn overhead
   - Goldilocks: 30min-2hr of focused work

3. COMPLETENESS (25%): Does the sum equal the whole?
   - Missing pieces that would leave the task incomplete
   - Gaps between subtasks (who handles X?)
   - Implicit work not captured in any subtask

4. CLARITY (25%): Would an agent know what to do?
   - Vague descriptions that invite interpretation
   - Missing context needed to start work
   - Ambiguous boundaries between subtasks

Return ONLY valid JSON (no markdown, no explanation):
{"score": <0-100>, "issues": ["issue1", "issue2"], "strengths": ["strength1"]}`,
        maxOutputTokens: 512,
      });

      // Parse JSON response - handle potential markdown wrapping
      let jsonText = text.trim();
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.replace(/```json?\n?/g, "").replace(/```$/g, "");
      }

      const result = JSON.parse(jsonText) as {
        score: number;
        issues: string[];
        strengths?: string[];
      };

      const issueText =
        result.issues.length > 0 ? result.issues.join("; ") : "No issues";
      const strengthText =
        result.strengths && result.strengths.length > 0
          ? ` | Strengths: ${result.strengths.join("; ")}`
          : "";

      return {
        score: result.score / 100,
        message: `${issueText}${strengthText}`,
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