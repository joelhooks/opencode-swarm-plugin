/**
 * Swarm Strategies Module - Strategy selection and guidelines
 *
 * Handles decomposition strategy selection (file-based, feature-based, risk-based, research-based)
 * and provides strategy-specific guidelines for task decomposition.
 *
 * Key responsibilities:
 * - Strategy keyword matching and selection
 * - Strategy definition and description
 * - Anti-pattern warnings
 * - Guidelines formatting for prompts
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

// ============================================================================
// Strategy Definitions
// ============================================================================

/**
 * Decomposition strategy types
 */
export type DecompositionStrategy =
  | "file-based"
  | "feature-based"
  | "risk-based"
  | "research-based"
  | "auto";

/**
 * Zod schema for decomposition strategy validation
 */
export const DecompositionStrategySchema = z.enum([
  "file-based",
  "feature-based",
  "risk-based",
  "research-based",
  "auto",
]);

/**
 * Marker words that indicate positive directives
 */
export const POSITIVE_MARKERS = [
  "always",
  "must",
  "required",
  "ensure",
  "use",
  "prefer",
];

/**
 * Marker words that indicate negative directives
 */
export const NEGATIVE_MARKERS = [
  "never",
  "dont",
  "don't",
  "avoid",
  "forbid",
  "no ",
  "not ",
];

/**
 * Strategy definition with keywords, guidelines, and anti-patterns
 */
export interface StrategyDefinition {
  name: DecompositionStrategy;
  description: string;
  keywords: string[];
  guidelines: string[];
  antiPatterns: string[];
  examples: string[];
}

/**
 * Strategy definitions for task decomposition
 */
export const STRATEGIES: Record<
  Exclude<DecompositionStrategy, "auto">,
  StrategyDefinition
> = {
  "file-based": {
    name: "file-based",
    description:
      "Group by file type or directory. Best for refactoring, migrations, and pattern changes across codebase.",
    keywords: [
      "refactor",
      "migrate",
      "update all",
      "rename",
      "replace",
      "convert",
      "upgrade",
      "deprecate",
      "remove",
      "cleanup",
      "lint",
      "format",
    ],
    guidelines: [
      "Group files by directory or type (e.g., all components, all tests)",
      "Minimize cross-directory dependencies within a subtask",
      "Handle shared types/utilities first if they change",
      "Each subtask should be a complete transformation of its file set",
      "Consider import/export relationships when grouping",
    ],
    antiPatterns: [
      "Don't split tightly coupled files across subtasks",
      "Don't group files that have no relationship",
      "Don't forget to update imports when moving/renaming",
    ],
    examples: [
      "Migrate all components to new API → split by component directory",
      "Rename userId to accountId → split by module (types first, then consumers)",
      "Update all tests to use new matcher → split by test directory",
    ],
  },
  "feature-based": {
    name: "feature-based",
    description:
      "Vertical slices with UI + API + data. Best for new features and adding functionality.",
    keywords: [
      "add",
      "implement",
      "build",
      "create",
      "feature",
      "new",
      "integrate",
      "connect",
      "enable",
      "support",
    ],
    guidelines: [
      "Each subtask is a complete vertical slice (UI + logic + data)",
      "Start with data layer/types, then logic, then UI",
      "Keep related components together (form + validation + submission)",
      "Separate concerns that can be developed independently",
      "Consider user-facing features as natural boundaries",
    ],
    antiPatterns: [
      "Don't split a single feature across multiple subtasks",
      "Don't create subtasks that can't be tested independently",
      "Don't forget integration points between features",
    ],
    examples: [
      "Add user auth → [OAuth setup, Session management, Protected routes]",
      "Build dashboard → [Data fetching, Chart components, Layout/navigation]",
      "Add search → [Search API, Search UI, Results display]",
    ],
  },
  "risk-based": {
    name: "risk-based",
    description:
      "Isolate high-risk changes, add tests first. Best for bug fixes, security issues, and critical changes.",
    keywords: [
      "fix",
      "bug",
      "security",
      "vulnerability",
      "critical",
      "urgent",
      "hotfix",
      "patch",
      "audit",
      "review",
    ],
    guidelines: [
      "Write tests FIRST to capture expected behavior",
      "Isolate the risky change to minimize blast radius",
      "Add monitoring/logging around the change",
      "Create rollback plan as part of the task",
      "Audit similar code for the same issue",
    ],
    antiPatterns: [
      "Don't make multiple risky changes in one subtask",
      "Don't skip tests for 'simple' fixes",
      "Don't forget to check for similar issues elsewhere",
    ],
    examples: [
      "Fix auth bypass → [Add regression test, Fix vulnerability, Audit similar endpoints]",
      "Fix race condition → [Add test reproducing issue, Implement fix, Add concurrency tests]",
      "Security audit → [Scan for vulnerabilities, Fix critical issues, Document remaining risks]",
    ],
  },
  "research-based": {
    name: "research-based",
    description:
      "Parallel search across multiple sources, then synthesize. Best for investigation, learning, and discovery tasks.",
    keywords: [
      "research",
      "investigate",
      "explore",
      "find out",
      "discover",
      "understand",
      "learn about",
      "analyze",
      "what is",
      "what are",
      "how does",
      "how do",
      "why does",
      "why do",
      "compare",
      "evaluate",
      "study",
      "look up",
      "look into",
      "search for",
      "dig into",
      "figure out",
      "debug options",
      "debug levers",
      "configuration options",
      "environment variables",
      "available options",
      "documentation",
    ],
    guidelines: [
      "Split by information source (PDFs, repos, history, web)",
      "Each agent searches with different query angles",
      "Include a synthesis subtask that depends on all search subtasks",
      "Use pdf-brain for documentation/books if available",
      "Use repo-crawl for GitHub repos if URL provided",
      "Use cass for past agent session history",
      "Assign NO files to research subtasks (read-only)",
    ],
    antiPatterns: [
      "Don't have one agent search everything sequentially",
      "Don't skip synthesis - raw search results need consolidation",
      "Don't forget to check tool availability before assigning sources",
    ],
    examples: [
      "Research auth patterns → [Search PDFs, Search repos, Search history, Synthesize]",
      "Investigate error → [Search cass for similar errors, Search repo for error handling, Synthesize]",
      "Learn about library → [Search docs, Search examples, Search issues, Synthesize findings]",
    ],
  },
};

/**
 * Analyze task description and select best decomposition strategy
 *
 * @param task - Task description
 * @param projectKey - Optional project path for precedent-aware selection
 * @returns Selected strategy with reasoning and optional precedent data
 */
export async function selectStrategy(
  task: string,
  projectKey?: string,
): Promise<{
  strategy: Exclude<DecompositionStrategy, "auto">;
  confidence: number;
  reasoning: string;
  alternatives: Array<{
    strategy: Exclude<DecompositionStrategy, "auto">;
    score: number;
  }>;
  precedent?: {
    similar_decisions: number;
    strategy_success_rate?: number;
    cited_epics?: string[];
  };
}> {
  const taskLower = task.toLowerCase();

  // Score each strategy based on keyword matches
  const scores: Record<Exclude<DecompositionStrategy, "auto">, number> = {
    "file-based": 0,
    "feature-based": 0,
    "risk-based": 0,
    "research-based": 0,
  };

  for (const [strategyName, definition] of Object.entries(STRATEGIES)) {
    const name = strategyName as Exclude<DecompositionStrategy, "auto">;
    for (const keyword of definition.keywords) {
      // Use word boundary matching to avoid "debug" matching "bug"
      // For multi-word keywords, just check includes (they're specific enough)
      if (keyword.includes(" ")) {
        if (taskLower.includes(keyword)) {
          scores[name] += 1;
        }
      } else {
        // Single word: use word boundary regex
        const regex = new RegExp(`\\b${keyword}\\b`, "i");
        if (regex.test(taskLower)) {
          scores[name] += 1;
        }
      }
    }
  }

  // Find the winner
  const entries = Object.entries(scores) as Array<
    [Exclude<DecompositionStrategy, "auto">, number]
  >;
  entries.sort((a, b) => b[1] - a[1]);

  const [winner, winnerScore] = entries[0];
  const [, runnerUpScore] = entries[1] || [null, 0];

  // Calculate base confidence based on margin
  const totalScore = entries.reduce((sum, [, score]) => sum + score, 0);
  let confidence =
    totalScore > 0
      ? Math.min(0.95, 0.5 + (winnerScore - runnerUpScore) / totalScore)
      : 0.5; // Default to 50% if no keywords matched

  // If no keywords matched, default to feature-based
  const finalStrategy = winnerScore === 0 ? "feature-based" : winner;

  // Build base reasoning
  let reasoning: string;
  if (winnerScore === 0) {
    reasoning = `No strong keyword signals. Defaulting to feature-based as it's most versatile.`;
  } else {
    const matchedKeywords = STRATEGIES[winner].keywords.filter((k) =>
      taskLower.includes(k),
    );
    reasoning = `Matched keywords: ${matchedKeywords.join(", ")}. ${STRATEGIES[winner].description}`;
  }

  // Query precedent if projectKey provided
  let precedent:
    | {
        similar_decisions: number;
        strategy_success_rate?: number;
        cited_epics?: string[];
      }
    | undefined;

  if (projectKey) {
    try {
      const {
        createLibSQLAdapter,
        getDatabasePath,
        findSimilarDecisions,
        getStrategySuccessRates,
      } = await import("swarm-mail");

      const dbPath = getDatabasePath(projectKey);
      const db = await createLibSQLAdapter({ url: `file:${dbPath}` });

      // Find similar past decisions
      const similarDecisions = await findSimilarDecisions(db, task, 5);

      // Get strategy success rates
      const successRates = await getStrategySuccessRates(db);

      // Build precedent object
      precedent = {
        similar_decisions: similarDecisions.length,
      };

      // Extract cited epic IDs from similar decisions
      if (similarDecisions.length > 0) {
        const epicIds: string[] = [];
        for (const decision of similarDecisions) {
          try {
            const decisionData =
              typeof decision.decision === "string"
                ? JSON.parse(decision.decision)
                : decision.decision;
            if (decisionData.epic_id) {
              epicIds.push(decisionData.epic_id);
            }
          } catch {
            // Ignore parse errors
          }
        }
        if (epicIds.length > 0) {
          precedent.cited_epics = epicIds;
        }

        // Check if precedent agrees with keyword selection
        const precedentStrategies = similarDecisions
          .map((d) => {
            try {
              const data =
                typeof d.decision === "string"
                  ? JSON.parse(d.decision)
                  : d.decision;
              return data.strategy;
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        const agreesWithKeywords = precedentStrategies.includes(finalStrategy);
        if (agreesWithKeywords) {
          confidence = Math.min(0.95, confidence + 0.1);
          reasoning += ` Precedent confirms: ${precedent.similar_decisions} similar decision(s) also chose ${finalStrategy}.`;
        }
      }

      // Adjust confidence based on strategy success rate
      const strategyRate = successRates.find(
        (r) => r.strategy === finalStrategy,
      );
      if (strategyRate) {
        precedent.strategy_success_rate = strategyRate.success_rate;

        if (strategyRate.success_rate >= 0.7) {
          confidence = Math.min(0.95, confidence + 0.05);
          reasoning += ` ${finalStrategy} has ${Math.round(strategyRate.success_rate * 100)}% success rate.`;
        } else if (strategyRate.success_rate < 0.3) {
          confidence = Math.max(0.1, confidence - 0.1);
          reasoning += ` Warning: ${finalStrategy} has low success rate (${Math.round(strategyRate.success_rate * 100)}%).`;
        }
      }

      if (db.close) {
        await db.close();
      }
    } catch (error) {
      // Graceful degradation - precedent query failed, continue without it
      console.warn("Failed to query precedent data:", error);
    }
  }

  return {
    strategy: finalStrategy,
    confidence,
    reasoning,
    alternatives: entries
      .filter(([s]) => s !== finalStrategy)
      .map(([strategy, score]) => ({ strategy, score })),
    precedent,
  };
}

/**
 * Format strategy-specific guidelines for the decomposition prompt
 */
export function formatStrategyGuidelines(
  strategy: Exclude<DecompositionStrategy, "auto">,
): string {
  const def = STRATEGIES[strategy];

  const guidelines = def.guidelines.map((g) => `- ${g}`).join("\n");
  const antiPatterns = def.antiPatterns.map((a) => `- ${a}`).join("\n");
  const examples = def.examples.map((e) => `- ${e}`).join("\n");

  return `## Strategy: ${strategy}

${def.description}

### Guidelines
${guidelines}

### Anti-Patterns (Avoid These)
${antiPatterns}

### Examples
${examples}`;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Select the best decomposition strategy for a task
 *
 * Analyzes task description and recommends a strategy with reasoning.
 * Use this before swarm_plan_prompt to understand the recommended approach.
 * 
 * When projectKey is provided, queries past strategy decisions and success rates
 * to provide precedent-aware recommendations with adjusted confidence.
 */
export const swarm_select_strategy = tool({
  description:
    "Analyze task and recommend decomposition strategy (file-based, feature-based, or risk-based) with optional precedent data",
  args: {
    task: tool.schema.string().min(1).describe("Task description to analyze"),
    codebase_context: tool.schema
      .string()
      .optional()
      .describe("Optional codebase context (file structure, tech stack, etc.)"),
    projectKey: tool.schema
      .string()
      .optional()
      .describe("Optional project path for precedent-aware strategy selection"),
  },
  async execute(args) {
    const result = await selectStrategy(args.task, args.projectKey);

    // Enhance reasoning with codebase context if provided
    let enhancedReasoning = result.reasoning;
    if (args.codebase_context) {
      enhancedReasoning += `\n\nCodebase context considered: ${args.codebase_context.slice(0, 200)}...`;
    }

    return JSON.stringify(
      {
        strategy: result.strategy,
        confidence: Math.round(result.confidence * 100) / 100,
        reasoning: enhancedReasoning,
        description: STRATEGIES[result.strategy].description,
        guidelines: STRATEGIES[result.strategy].guidelines,
        anti_patterns: STRATEGIES[result.strategy].antiPatterns,
        alternatives: result.alternatives.map((alt) => ({
          strategy: alt.strategy,
          description: STRATEGIES[alt.strategy].description,
          score: alt.score,
        })),
        precedent: result.precedent,
      },
      null,
      2,
    );
  },
});

export const strategyTools = {
  swarm_select_strategy,
};
