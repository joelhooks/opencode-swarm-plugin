/**
 * Mandate Storage Module - Persistent storage for agent voting system
 *
 * Provides unified storage interface for mandate entries and votes:
 * - semantic-memory (default) - Persistent with semantic search
 * - in-memory - For testing and ephemeral sessions
 *
 * Collections:
 * - `swarm-mandates` - Mandate entry storage
 * - `swarm-votes` - Vote storage
 *
 * Score calculation uses 90-day half-life decay matching learning.ts patterns.
 *
 * @example
 * ```typescript
 * // Use default semantic-memory storage
 * const storage = createMandateStorage();
 *
 * // Or in-memory for testing
 * const storage = createMandateStorage({ backend: "memory" });
 *
 * // Store a mandate
 * await storage.store({
 *   id: "mandate-123",
 *   content: "Always use Effect for async operations",
 *   content_type: "tip",
 *   author_agent: "BlueLake",
 *   created_at: new Date().toISOString(),
 *   status: "candidate",
 *   tags: ["async", "effect"]
 * });
 *
 * // Cast a vote
 * await storage.vote({
 *   id: "vote-456",
 *   mandate_id: "mandate-123",
 *   agent_name: "BlueLake",
 *   vote_type: "upvote",
 *   timestamp: new Date().toISOString(),
 *   weight: 1.0
 * });
 *
 * // Calculate score with decay
 * const score = await storage.calculateScore("mandate-123");
 * ```
 */

import type {
  MandateEntry,
  Vote,
  MandateScore,
  MandateStatus,
  MandateContentType,
  MandateDecayConfig,
  ScoreCalculationResult,
} from "./schemas/mandate";
import { DEFAULT_MANDATE_DECAY_CONFIG } from "./schemas/mandate";
import { calculateDecayedValue } from "./learning";

// ============================================================================
// Command Resolution (copied from storage.ts pattern)
// ============================================================================

/**
 * Cached semantic-memory command (native or bunx fallback)
 */
let cachedCommand: string[] | null = null;

/**
 * Resolve the semantic-memory command
 *
 * Checks for native install first, falls back to bunx.
 * Result is cached for the session.
 */
async function resolveSemanticMemoryCommand(): Promise<string[]> {
  if (cachedCommand) return cachedCommand;

  // Try native install first
  const nativeResult = await Bun.$`which semantic-memory`.quiet().nothrow();
  if (nativeResult.exitCode === 0) {
    cachedCommand = ["semantic-memory"];
    return cachedCommand;
  }

  // Fall back to bunx
  cachedCommand = ["bunx", "semantic-memory"];
  return cachedCommand;
}

/**
 * Execute semantic-memory command with args
 */
async function execSemanticMemory(
  args: string[],
): Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> {
  try {
    const cmd = await resolveSemanticMemoryCommand();
    const fullCmd = [...cmd, ...args];

    // Use Bun.spawn for dynamic command arrays
    const proc = Bun.spawn(fullCmd, {
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const stdout = Buffer.from(await new Response(proc.stdout).arrayBuffer());
      const stderr = Buffer.from(await new Response(proc.stderr).arrayBuffer());
      const exitCode = await proc.exited;

      return { exitCode, stdout, stderr };
    } finally {
      // Ensure process cleanup
      proc.kill();
    }
  } catch (error) {
    // Return structured error result on exceptions
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from(`Error executing semantic-memory: ${errorMessage}`),
    };
  }
}

/**
 * Reset the cached command (for testing)
 */
export function resetCommandCache(): void {
  cachedCommand = null;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Storage backend type
 */
export type MandateStorageBackend = "semantic-memory" | "memory";

/**
 * Collection names for semantic-memory
 */
export interface MandateStorageCollections {
  mandates: string;
  votes: string;
}

/**
 * Storage configuration
 */
export interface MandateStorageConfig {
  /** Backend to use (default: "semantic-memory") */
  backend: MandateStorageBackend;
  /** Collection names for semantic-memory backend */
  collections: MandateStorageCollections;
  /** Decay configuration */
  decay: MandateDecayConfig;
  /** Whether to use semantic search for queries (default: true) */
  useSemanticSearch: boolean;
}

export const DEFAULT_MANDATE_STORAGE_CONFIG: MandateStorageConfig = {
  backend: "semantic-memory",
  collections: {
    mandates: "swarm-mandates",
    votes: "swarm-votes",
  },
  decay: DEFAULT_MANDATE_DECAY_CONFIG,
  useSemanticSearch: true,
};

// ============================================================================
// Unified Storage Interface
// ============================================================================

/**
 * Unified storage interface for mandate data
 */
export interface MandateStorage {
  // Entry operations
  store(entry: MandateEntry): Promise<void>;
  get(id: string): Promise<MandateEntry | null>;
  find(query: string, limit?: number): Promise<MandateEntry[]>;
  list(filter?: {
    status?: MandateStatus;
    content_type?: MandateContentType;
  }): Promise<MandateEntry[]>;
  update(id: string, updates: Partial<MandateEntry>): Promise<void>;

  // Vote operations
  vote(vote: Vote): Promise<void>;
  getVotes(mandateId: string): Promise<Vote[]>;
  hasVoted(mandateId: string, agentName: string): Promise<boolean>;

  // Score calculation
  calculateScore(mandateId: string): Promise<MandateScore>;

  // Lifecycle
  close(): Promise<void>;
}

// ============================================================================
// Semantic Memory Storage Implementation
// ============================================================================

/**
 * Semantic-memory backed mandate storage
 *
 * Uses the semantic-memory CLI for persistence with semantic search.
 * Data survives across sessions and can be searched by meaning.
 */
export class SemanticMemoryMandateStorage implements MandateStorage {
  private config: MandateStorageConfig;

  constructor(config: Partial<MandateStorageConfig> = {}) {
    this.config = { ...DEFAULT_MANDATE_STORAGE_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async storeInternal(
    collection: string,
    data: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const content = typeof data === "string" ? data : JSON.stringify(data);
    const args = ["store", content, "--collection", collection];

    if (metadata) {
      args.push("--metadata", JSON.stringify(metadata));
    }

    await execSemanticMemory(args);
  }

  private async findInternal<T>(
    collection: string,
    query: string,
    limit: number = 10,
    useFts: boolean = false,
  ): Promise<T[]> {
    const args = [
      "find",
      query,
      "--collection",
      collection,
      "--limit",
      String(limit),
      "--json",
    ];

    if (useFts) {
      args.push("--fts");
    }

    const result = await execSemanticMemory(args);

    if (result.exitCode !== 0) {
      console.warn(
        `[mandate-storage] semantic-memory find() failed with exit code ${result.exitCode}: ${result.stderr.toString().trim()}`,
      );
      return [];
    }

    try {
      const output = result.stdout.toString().trim();
      if (!output) return [];

      const parsed = JSON.parse(output);
      // semantic-memory returns { results: [...] } or just [...]
      const results = Array.isArray(parsed) ? parsed : parsed.results || [];

      // Extract the stored content from each result
      return results.map((r: { content?: string; information?: string }) => {
        const content = r.content || r.information || "";
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      });
    } catch (error) {
      console.warn(
        `[mandate-storage] Failed to parse semantic-memory find() output: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private async listInternal<T>(collection: string): Promise<T[]> {
    const result = await execSemanticMemory([
      "list",
      "--collection",
      collection,
      "--json",
    ]);

    if (result.exitCode !== 0) {
      console.warn(
        `[mandate-storage] semantic-memory list() failed with exit code ${result.exitCode}: ${result.stderr.toString().trim()}`,
      );
      return [];
    }

    try {
      const output = result.stdout.toString().trim();
      if (!output) return [];

      const parsed = JSON.parse(output);
      const items = Array.isArray(parsed) ? parsed : parsed.items || [];

      return items.map((item: { content?: string; information?: string }) => {
        const content = item.content || item.information || "";
        try {
          return JSON.parse(content);
        } catch {
          return content;
        }
      });
    } catch (error) {
      console.warn(
        `[mandate-storage] Failed to parse semantic-memory list() output: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Entry Operations
  // -------------------------------------------------------------------------

  async store(entry: MandateEntry): Promise<void> {
    await this.storeInternal(this.config.collections.mandates, entry, {
      id: entry.id,
      content_type: entry.content_type,
      author_agent: entry.author_agent,
      status: entry.status,
      tags: entry.tags.join(","),
      created_at: entry.created_at,
    });
  }

  async get(id: string): Promise<MandateEntry | null> {
    // List all and filter by ID - FTS search by ID is unreliable
    const all = await this.listInternal<MandateEntry>(
      this.config.collections.mandates,
    );
    return all.find((entry) => entry.id === id) || null;
  }

  async find(query: string, limit: number = 10): Promise<MandateEntry[]> {
    return this.findInternal<MandateEntry>(
      this.config.collections.mandates,
      query,
      limit,
      !this.config.useSemanticSearch,
    );
  }

  async list(filter?: {
    status?: MandateStatus;
    content_type?: MandateContentType;
  }): Promise<MandateEntry[]> {
    const all = await this.listInternal<MandateEntry>(
      this.config.collections.mandates,
    );

    if (!filter) return all;

    return all.filter((entry) => {
      if (filter.status && entry.status !== filter.status) return false;
      if (filter.content_type && entry.content_type !== filter.content_type)
        return false;
      return true;
    });
  }

  async update(id: string, updates: Partial<MandateEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(
        `Mandate '${id}' not found. Use list() to see available mandates.`,
      );
    }

    const updated = { ...existing, ...updates };
    await this.store(updated);
  }

  // -------------------------------------------------------------------------
  // Vote Operations
  // -------------------------------------------------------------------------

  async vote(vote: Vote): Promise<void> {
    // Check for duplicate votes
    const existing = await this.hasVoted(vote.mandate_id, vote.agent_name);
    if (existing) {
      throw new Error(
        `Agent '${vote.agent_name}' has already voted on mandate '${vote.mandate_id}'. Each agent can vote once per mandate to ensure fair consensus.`,
      );
    }

    await this.storeInternal(this.config.collections.votes, vote, {
      id: vote.id,
      mandate_id: vote.mandate_id,
      agent_name: vote.agent_name,
      vote_type: vote.vote_type,
      timestamp: vote.timestamp,
      weight: vote.weight,
    });
  }

  async getVotes(mandateId: string): Promise<Vote[]> {
    // List all votes and filter by mandate_id
    const all = await this.listInternal<Vote>(this.config.collections.votes);
    return all.filter((vote) => vote.mandate_id === mandateId);
  }

  async hasVoted(mandateId: string, agentName: string): Promise<boolean> {
    const votes = await this.getVotes(mandateId);
    return votes.some((vote) => vote.agent_name === agentName);
  }

  // -------------------------------------------------------------------------
  // Score Calculation
  // -------------------------------------------------------------------------

  async calculateScore(mandateId: string): Promise<MandateScore> {
    const votes = await this.getVotes(mandateId);
    const now = new Date();

    let rawUpvotes = 0;
    let rawDownvotes = 0;
    let decayedUpvotes = 0;
    let decayedDownvotes = 0;

    for (const vote of votes) {
      const decayed = calculateDecayedValue(
        vote.timestamp,
        now,
        this.config.decay.halfLifeDays,
      );
      const value = vote.weight * decayed;

      if (vote.vote_type === "upvote") {
        rawUpvotes++;
        decayedUpvotes += value;
      } else {
        rawDownvotes++;
        decayedDownvotes += value;
      }
    }

    const totalDecayed = decayedUpvotes + decayedDownvotes;
    const voteRatio = totalDecayed > 0 ? decayedUpvotes / totalDecayed : 0;
    const netVotes = decayedUpvotes - decayedDownvotes;

    // Score combines net votes with vote ratio
    // Higher ratio = more consensus, net votes = strength
    const decayedScore = netVotes * voteRatio;

    return {
      mandate_id: mandateId,
      net_votes: netVotes,
      vote_ratio: voteRatio,
      decayed_score: decayedScore,
      last_calculated: now.toISOString(),
      raw_upvotes: rawUpvotes,
      raw_downvotes: rawDownvotes,
      decayed_upvotes: decayedUpvotes,
      decayed_downvotes: decayedDownvotes,
    };
  }

  async close(): Promise<void> {
    // No cleanup needed for CLI-based storage
  }
}

// ============================================================================
// In-Memory Storage Implementation
// ============================================================================

/**
 * In-memory mandate storage
 *
 * Useful for testing and ephemeral sessions.
 */
export class InMemoryMandateStorage implements MandateStorage {
  private entries: Map<string, MandateEntry> = new Map();
  private votes: Map<string, Vote> = new Map();
  private config: MandateDecayConfig;

  constructor(config: Partial<MandateStorageConfig> = {}) {
    const fullConfig = { ...DEFAULT_MANDATE_STORAGE_CONFIG, ...config };
    this.config = fullConfig.decay;
  }

  // Entry operations
  async store(entry: MandateEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async get(id: string): Promise<MandateEntry | null> {
    return this.entries.get(id) || null;
  }

  async find(query: string, limit: number = 10): Promise<MandateEntry[]> {
    // Simple text search for in-memory (no semantic search)
    const lowerQuery = query.toLowerCase();
    const results = Array.from(this.entries.values()).filter(
      (entry) =>
        entry.content.toLowerCase().includes(lowerQuery) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(lowerQuery)),
    );
    return results.slice(0, limit);
  }

  async list(filter?: {
    status?: MandateStatus;
    content_type?: MandateContentType;
  }): Promise<MandateEntry[]> {
    let results = Array.from(this.entries.values());

    if (filter) {
      results = results.filter((entry) => {
        if (filter.status && entry.status !== filter.status) return false;
        if (filter.content_type && entry.content_type !== filter.content_type)
          return false;
        return true;
      });
    }

    return results;
  }

  async update(id: string, updates: Partial<MandateEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(
        `Mandate '${id}' not found. Use list() to see available mandates.`,
      );
    }

    const updated = { ...existing, ...updates };
    this.entries.set(id, updated);
  }

  // Vote operations
  async vote(vote: Vote): Promise<void> {
    // Check for duplicate votes
    const existing = await this.hasVoted(vote.mandate_id, vote.agent_name);
    if (existing) {
      throw new Error(
        `Agent '${vote.agent_name}' has already voted on mandate '${vote.mandate_id}'. Each agent can vote once per mandate to ensure fair consensus.`,
      );
    }

    this.votes.set(vote.id, vote);
  }

  async getVotes(mandateId: string): Promise<Vote[]> {
    return Array.from(this.votes.values()).filter(
      (vote) => vote.mandate_id === mandateId,
    );
  }

  async hasVoted(mandateId: string, agentName: string): Promise<boolean> {
    const votes = await this.getVotes(mandateId);
    return votes.some((vote) => vote.agent_name === agentName);
  }

  // Score calculation
  async calculateScore(mandateId: string): Promise<MandateScore> {
    const votes = await this.getVotes(mandateId);
    const now = new Date();

    let rawUpvotes = 0;
    let rawDownvotes = 0;
    let decayedUpvotes = 0;
    let decayedDownvotes = 0;

    for (const vote of votes) {
      const decayed = calculateDecayedValue(
        vote.timestamp,
        now,
        this.config.halfLifeDays,
      );
      const value = vote.weight * decayed;

      if (vote.vote_type === "upvote") {
        rawUpvotes++;
        decayedUpvotes += value;
      } else {
        rawDownvotes++;
        decayedDownvotes += value;
      }
    }

    const totalDecayed = decayedUpvotes + decayedDownvotes;
    const voteRatio = totalDecayed > 0 ? decayedUpvotes / totalDecayed : 0;
    const netVotes = decayedUpvotes - decayedDownvotes;

    // Score combines net votes with vote ratio
    const decayedScore = netVotes * voteRatio;

    return {
      mandate_id: mandateId,
      net_votes: netVotes,
      vote_ratio: voteRatio,
      decayed_score: decayedScore,
      last_calculated: now.toISOString(),
      raw_upvotes: rawUpvotes,
      raw_downvotes: rawDownvotes,
      decayed_upvotes: decayedUpvotes,
      decayed_downvotes: decayedDownvotes,
    };
  }

  async close(): Promise<void> {
    // No cleanup needed
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mandate storage instance
 *
 * @param config - Storage configuration (default: semantic-memory)
 * @returns Configured storage instance
 *
 * @example
 * ```typescript
 * // Default semantic-memory storage
 * const storage = createMandateStorage();
 *
 * // In-memory for testing
 * const storage = createMandateStorage({ backend: "memory" });
 *
 * // Custom collections
 * const storage = createMandateStorage({
 *   backend: "semantic-memory",
 *   collections: {
 *     mandates: "my-mandates",
 *     votes: "my-votes",
 *   },
 * });
 * ```
 */
export function createMandateStorage(
  config: Partial<MandateStorageConfig> = {},
): MandateStorage {
  const fullConfig = { ...DEFAULT_MANDATE_STORAGE_CONFIG, ...config };

  switch (fullConfig.backend) {
    case "semantic-memory":
      return new SemanticMemoryMandateStorage(fullConfig);
    case "memory":
      return new InMemoryMandateStorage(fullConfig);
    default:
      throw new Error(
        `Unknown storage backend: '${fullConfig.backend}'. Valid backends are 'semantic-memory' or 'memory'.`,
      );
  }
}

// ============================================================================
// Status Update Helpers
// ============================================================================

/**
 * Update mandate status based on calculated score
 *
 * Applies thresholds from decay config to determine status transitions:
 * - mandate: net_votes >= 5 AND vote_ratio >= 0.7
 * - established: net_votes >= 2
 * - rejected: net_votes <= -3
 * - candidate: otherwise
 *
 * @param mandateId - Mandate ID
 * @param storage - Storage instance
 * @returns Score calculation result with status update
 */
export async function updateMandateStatus(
  mandateId: string,
  storage: MandateStorage,
): Promise<ScoreCalculationResult> {
  const entry = await storage.get(mandateId);
  if (!entry) {
    throw new Error(
      `Mandate '${mandateId}' not found when calculating score. Use storage.list() to verify the mandate exists.`,
    );
  }

  const score = await storage.calculateScore(mandateId);
  const previousStatus = entry.status;

  // Determine new status based on thresholds
  let newStatus: MandateStatus;
  const config = DEFAULT_MANDATE_DECAY_CONFIG;

  if (
    score.net_votes >= config.mandateNetVotesThreshold &&
    score.vote_ratio >= config.mandateVoteRatioThreshold
  ) {
    newStatus = "mandate";
  } else if (score.net_votes <= config.rejectedNetVotesThreshold) {
    newStatus = "rejected";
  } else if (score.net_votes >= config.establishedNetVotesThreshold) {
    newStatus = "established";
  } else {
    newStatus = "candidate";
  }

  // Update status if changed
  if (newStatus !== previousStatus) {
    await storage.update(mandateId, { status: newStatus });
  }

  return {
    mandate_id: mandateId,
    previous_status: previousStatus,
    new_status: newStatus,
    score,
    status_changed: newStatus !== previousStatus,
  };
}

/**
 * Batch update all mandate statuses
 *
 * Useful for periodic recalculation of scores/status across all mandates.
 *
 * @param storage - Storage instance
 * @returns Array of score calculation results
 */
export async function updateAllMandateStatuses(
  storage: MandateStorage,
): Promise<ScoreCalculationResult[]> {
  const allEntries = await storage.list();
  const results: ScoreCalculationResult[] = [];

  for (const entry of allEntries) {
    const result = await updateMandateStatus(entry.id, storage);
    results.push(result);
  }

  return results;
}

// ============================================================================
// Global Storage Instance
// ============================================================================

let globalMandateStorage: MandateStorage | null = null;

/**
 * Get or create the global mandate storage instance
 *
 * Uses semantic-memory by default.
 */
export function getMandateStorage(): MandateStorage {
  if (!globalMandateStorage) {
    globalMandateStorage = createMandateStorage();
  }
  return globalMandateStorage;
}

/**
 * Set the global mandate storage instance
 *
 * Useful for testing or custom configurations.
 */
export function setMandateStorage(storage: MandateStorage): void {
  globalMandateStorage = storage;
}

/**
 * Reset the global mandate storage instance
 */
export async function resetMandateStorage(): Promise<void> {
  if (globalMandateStorage) {
    await globalMandateStorage.close();
    globalMandateStorage = null;
  }
}
