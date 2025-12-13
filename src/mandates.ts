/**
 * Mandates Module - Agent voting system for collaborative knowledge curation
 *
 * Agents file and vote on ideas, tips, lore, snippets, and feature requests.
 * High-consensus items become "mandates" that influence future behavior.
 *
 * Voting patterns:
 * - Each agent votes once per entry (upvote/downvote)
 * - Votes decay with 90-day half-life (matches learning.ts patterns)
 * - Status transitions:
 *   - candidate → established: net_votes >= 2
 *   - established → mandate: net_votes >= 5 AND vote_ratio >= 0.7
 *   - any → rejected: net_votes <= -3
 *
 * Key responsibilities:
 * - Submit new mandate entries (ideas, tips, lore, snippets, feature requests)
 * - Cast votes on existing entries
 * - Query mandates with semantic search
 * - Calculate scores with decay
 * - Track voting statistics
 */
import { tool } from "@opencode-ai/plugin";
import {
  CreateMandateArgsSchema,
  MandateEntrySchema,
  VoteSchema,
  CastVoteArgsSchema,
  type MandateEntry,
  type Vote,
  type MandateContentType,
  type MandateStatus,
} from "./schemas/mandate";
import { getMandateStorage, updateMandateStatus } from "./mandate-storage";
import { evaluatePromotion, formatPromotionResult } from "./mandate-promotion";

// ============================================================================
// Errors
// ============================================================================

export class MandateError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "MandateError";
  }
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique mandate ID
 *
 * Format: mandate-<timestamp>-<random>
 */
function generateMandateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `mandate-${timestamp}-${random}`;
}

/**
 * Generate a unique vote ID
 *
 * Format: vote-<timestamp>-<random>
 */
function generateVoteId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `vote-${timestamp}-${random}`;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Submit a new mandate entry
 *
 * Creates a new entry in the mandate system for voting.
 * Entries start in "candidate" status and can be promoted based on votes.
 */
export const mandate_file = tool({
  description:
    "Submit a new idea, tip, lore, snippet, or feature request to the mandate system",
  args: {
    content: tool.schema.string().min(1).describe("The content to submit"),
    content_type: tool.schema
      .enum(["idea", "tip", "lore", "snippet", "feature_request"])
      .describe("Type of content"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Optional tags for categorization"),
    metadata: tool.schema
      .record(tool.schema.string(), tool.schema.unknown())
      .optional()
      .describe("Optional metadata (e.g., code language for snippets)"),
  },
  async execute(args) {
    // Validate args
    const validated = CreateMandateArgsSchema.parse(args);

    // Get agent name from args or use default
    const agentName = "system";

    // Generate entry
    const entry: MandateEntry = {
      id: generateMandateId(),
      content: validated.content,
      content_type: validated.content_type,
      author_agent: agentName,
      created_at: new Date().toISOString(),
      status: "candidate",
      tags: validated.tags || [],
      metadata: validated.metadata,
    };

    // Validate schema
    const validatedEntry = MandateEntrySchema.parse(entry);

    // Store
    const storage = getMandateStorage();
    try {
      await storage.store(validatedEntry);
    } catch (error) {
      throw new MandateError(
        `Failed to store mandate: ${error instanceof Error ? error.message : String(error)}`,
        "mandate_file",
        error,
      );
    }

    return JSON.stringify(
      {
        success: true,
        mandate: validatedEntry,
        message: `Mandate ${validatedEntry.id} filed successfully`,
      },
      null,
      2,
    );
  },
});

/**
 * Cast a vote on an existing mandate
 *
 * Each agent can vote once per mandate. Duplicate votes are rejected.
 * Votes influence mandate status through consensus scoring.
 */
export const mandate_vote = tool({
  description: "Cast a vote (upvote or downvote) on an existing mandate",
  args: {
    mandate_id: tool.schema.string().describe("Mandate ID to vote on"),
    vote_type: tool.schema
      .enum(["upvote", "downvote"])
      .describe("Type of vote"),
    agent_name: tool.schema.string().describe("Agent name casting the vote"),
  },
  async execute(args) {
    // Validate args
    const validated = CastVoteArgsSchema.parse({
      mandate_id: args.mandate_id,
      vote_type: args.vote_type,
      weight: 1.0,
    });

    // Get storage
    const storage = getMandateStorage();

    // Check if mandate exists
    const mandate = await storage.get(validated.mandate_id);
    if (!mandate) {
      throw new MandateError(
        `Mandate '${validated.mandate_id}' not found. Use mandate_list() to see available mandates, or check the ID is correct.`,
        "mandate_vote",
      );
    }

    // Check if agent already voted
    const hasVoted = await storage.hasVoted(
      validated.mandate_id,
      args.agent_name,
    );
    if (hasVoted) {
      throw new MandateError(
        `Agent '${args.agent_name}' has already voted on mandate '${validated.mandate_id}'. Each agent can vote once per mandate. This is expected behavior to prevent vote manipulation.`,
        "mandate_vote",
      );
    }

    // Create vote
    const vote: Vote = {
      id: generateVoteId(),
      mandate_id: validated.mandate_id,
      agent_name: args.agent_name,
      vote_type: validated.vote_type,
      timestamp: new Date().toISOString(),
      weight: validated.weight,
    };

    // Validate schema
    const validatedVote = VoteSchema.parse(vote);

    // Store vote
    try {
      await storage.vote(validatedVote);
    } catch (error) {
      throw new MandateError(
        `Failed to cast vote: ${error instanceof Error ? error.message : String(error)}`,
        "mandate_vote",
        error,
      );
    }

    // Recalculate score and update status
    const promotion = await updateMandateStatus(validated.mandate_id, storage);

    return JSON.stringify(
      {
        success: true,
        vote: validatedVote,
        promotion: {
          previous_status: promotion.previous_status,
          new_status: promotion.new_status,
          status_changed: promotion.status_changed,
          score: promotion.score,
        },
        message: formatPromotionResult({
          mandate_id: promotion.mandate_id,
          previous_status: promotion.previous_status,
          new_status: promotion.new_status,
          score: promotion.score,
          promoted: promotion.status_changed,
          reason:
            evaluatePromotion(mandate, promotion.score).reason ||
            "Vote recorded",
        }),
      },
      null,
      2,
    );
  },
});

/**
 * Search for relevant mandates using semantic search
 *
 * Queries the mandate system by meaning, not just keywords.
 * Useful for finding past decisions or patterns related to a topic.
 */
export const mandate_query = tool({
  description:
    "Search for relevant mandates using semantic search (by meaning, not keywords)",
  args: {
    query: tool.schema.string().min(1).describe("Natural language query"),
    limit: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max results to return (default: 5)"),
    status: tool.schema
      .enum(["candidate", "established", "mandate", "rejected"])
      .optional()
      .describe("Filter by status"),
    content_type: tool.schema
      .enum(["idea", "tip", "lore", "snippet", "feature_request"])
      .optional()
      .describe("Filter by content type"),
  },
  async execute(args) {
    const storage = getMandateStorage();
    const limit = args.limit ?? 5;

    try {
      // Semantic search for mandates
      let results = await storage.find(args.query, limit * 2); // Get extra for filtering

      // Apply filters
      if (args.status) {
        results = results.filter((m) => m.status === args.status);
      }
      if (args.content_type) {
        results = results.filter((m) => m.content_type === args.content_type);
      }

      // Limit results
      results = results.slice(0, limit);

      // Calculate scores for results
      const resultsWithScores = await Promise.all(
        results.map(async (mandate) => {
          const score = await storage.calculateScore(mandate.id);
          return { mandate, score };
        }),
      );

      // Sort by decayed score (highest first)
      resultsWithScores.sort(
        (a, b) => b.score.decayed_score - a.score.decayed_score,
      );

      return JSON.stringify(
        {
          query: args.query,
          count: resultsWithScores.length,
          results: resultsWithScores.map(({ mandate, score }) => ({
            id: mandate.id,
            content: mandate.content,
            content_type: mandate.content_type,
            status: mandate.status,
            author: mandate.author_agent,
            created_at: mandate.created_at,
            tags: mandate.tags,
            score: {
              net_votes: score.net_votes,
              vote_ratio: score.vote_ratio,
              decayed_score: score.decayed_score,
            },
          })),
        },
        null,
        2,
      );
    } catch (error) {
      throw new MandateError(
        `Failed to query mandates: ${error instanceof Error ? error.message : String(error)}`,
        "mandate_query",
        error,
      );
    }
  },
});

/**
 * List mandates with optional filters
 *
 * Retrieves mandates by status, content type, or both.
 * Does not use semantic search - returns all matching mandates.
 */
export const mandate_list = tool({
  description: "List mandates with optional filters (status, content type)",
  args: {
    status: tool.schema
      .enum(["candidate", "established", "mandate", "rejected"])
      .optional()
      .describe("Filter by status"),
    content_type: tool.schema
      .enum(["idea", "tip", "lore", "snippet", "feature_request"])
      .optional()
      .describe("Filter by content type"),
    limit: tool.schema
      .number()
      .int()
      .positive()
      .optional()
      .describe("Max results to return (default: 20)"),
  },
  async execute(args) {
    const storage = getMandateStorage();
    const limit = args.limit ?? 20;

    try {
      // List with filters
      let results = await storage.list({
        status: args.status as MandateStatus | undefined,
        content_type: args.content_type as MandateContentType | undefined,
      });

      // Limit results
      results = results.slice(0, limit);

      // Calculate scores for results
      const resultsWithScores = await Promise.all(
        results.map(async (mandate) => {
          const score = await storage.calculateScore(mandate.id);
          return { mandate, score };
        }),
      );

      // Sort by decayed score (highest first)
      resultsWithScores.sort(
        (a, b) => b.score.decayed_score - a.score.decayed_score,
      );

      return JSON.stringify(
        {
          filters: {
            status: args.status || "all",
            content_type: args.content_type || "all",
          },
          count: resultsWithScores.length,
          results: resultsWithScores.map(({ mandate, score }) => ({
            id: mandate.id,
            content: mandate.content.slice(0, 200), // Truncate for list view
            content_type: mandate.content_type,
            status: mandate.status,
            author: mandate.author_agent,
            created_at: mandate.created_at,
            tags: mandate.tags,
            score: {
              net_votes: score.net_votes,
              vote_ratio: score.vote_ratio,
              decayed_score: score.decayed_score,
            },
          })),
        },
        null,
        2,
      );
    } catch (error) {
      throw new MandateError(
        `Failed to list mandates: ${error instanceof Error ? error.message : String(error)}`,
        "mandate_list",
        error,
      );
    }
  },
});

/**
 * Get voting statistics for a mandate or overall system
 *
 * If mandate_id is provided, returns detailed stats for that mandate.
 * Otherwise, returns aggregate stats across all mandates.
 */
export const mandate_stats = tool({
  description: "Get voting statistics for a specific mandate or overall system",
  args: {
    mandate_id: tool.schema
      .string()
      .optional()
      .describe("Mandate ID (omit for overall stats)"),
  },
  async execute(args) {
    const storage = getMandateStorage();

    try {
      if (args.mandate_id) {
        // Stats for specific mandate
        const mandate = await storage.get(args.mandate_id);
        if (!mandate) {
          throw new MandateError(
            `Mandate '${args.mandate_id}' not found. Use mandate_list() to see available mandates, or check the ID is correct.`,
            "mandate_stats",
          );
        }

        const score = await storage.calculateScore(args.mandate_id);
        const votes = await storage.getVotes(args.mandate_id);

        return JSON.stringify(
          {
            mandate_id: args.mandate_id,
            status: mandate.status,
            content_type: mandate.content_type,
            author: mandate.author_agent,
            created_at: mandate.created_at,
            votes: {
              total: votes.length,
              raw_upvotes: score.raw_upvotes,
              raw_downvotes: score.raw_downvotes,
              decayed_upvotes: score.decayed_upvotes,
              decayed_downvotes: score.decayed_downvotes,
              net_votes: score.net_votes,
              vote_ratio: score.vote_ratio,
              decayed_score: score.decayed_score,
            },
            voters: votes.map((v) => ({
              agent: v.agent_name,
              vote_type: v.vote_type,
              timestamp: v.timestamp,
            })),
          },
          null,
          2,
        );
      } else {
        // Overall system stats
        const allMandates = await storage.list();

        // Calculate aggregate stats
        const stats = {
          total_mandates: allMandates.length,
          by_status: {
            candidate: 0,
            established: 0,
            mandate: 0,
            rejected: 0,
          },
          by_content_type: {
            idea: 0,
            tip: 0,
            lore: 0,
            snippet: 0,
            feature_request: 0,
          },
          total_votes: 0,
        };

        for (const mandate of allMandates) {
          stats.by_status[mandate.status]++;
          stats.by_content_type[mandate.content_type]++;

          const votes = await storage.getVotes(mandate.id);
          stats.total_votes += votes.length;
        }

        return JSON.stringify(stats, null, 2);
      }
    } catch (error) {
      if (error instanceof MandateError) {
        throw error;
      }
      throw new MandateError(
        `Failed to get mandate stats: ${error instanceof Error ? error.message : String(error)}`,
        "mandate_stats",
        error,
      );
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const mandateTools = {
  mandate_file,
  mandate_vote,
  mandate_query,
  mandate_list,
  mandate_stats,
};
