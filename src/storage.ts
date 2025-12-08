/**
 * Storage Module - Pluggable persistence for learning data
 *
 * Provides a unified storage interface with multiple backends:
 * - semantic-memory (default) - Persistent with semantic search
 * - in-memory - For testing and ephemeral sessions
 *
 * The semantic-memory backend uses collections:
 * - `swarm-feedback` - Criterion feedback events
 * - `swarm-patterns` - Decomposition patterns and anti-patterns
 * - `swarm-maturity` - Pattern maturity tracking
 *
 * @example
 * ```typescript
 * // Use default semantic-memory storage
 * const storage = createStorage();
 *
 * // Or configure explicitly
 * const storage = createStorage({
 *   backend: "semantic-memory",
 *   collections: {
 *     feedback: "my-feedback",
 *     patterns: "my-patterns",
 *     maturity: "my-maturity",
 *   },
 * });
 *
 * // Or use in-memory for testing
 * const storage = createStorage({ backend: "memory" });
 * ```
 */

import type { FeedbackEvent } from "./learning";
import type { DecompositionPattern } from "./anti-patterns";
import type { PatternMaturity, MaturityFeedback } from "./pattern-maturity";
import { InMemoryFeedbackStorage } from "./learning";
import { InMemoryPatternStorage } from "./anti-patterns";
import { InMemoryMaturityStorage } from "./pattern-maturity";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Storage backend type
 */
export type StorageBackend = "semantic-memory" | "memory";

/**
 * Collection names for semantic-memory
 */
export interface StorageCollections {
  feedback: string;
  patterns: string;
  maturity: string;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Backend to use (default: "semantic-memory") */
  backend: StorageBackend;
  /** Collection names for semantic-memory backend */
  collections: StorageCollections;
  /** Whether to use semantic search for queries (default: true) */
  useSemanticSearch: boolean;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  backend: "semantic-memory",
  collections: {
    feedback: "swarm-feedback",
    patterns: "swarm-patterns",
    maturity: "swarm-maturity",
  },
  useSemanticSearch: true,
};

// ============================================================================
// Unified Storage Interface
// ============================================================================

/**
 * Unified storage interface for all learning data
 */
export interface LearningStorage {
  // Feedback operations
  storeFeedback(event: FeedbackEvent): Promise<void>;
  getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]>;
  getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]>;
  getAllFeedback(): Promise<FeedbackEvent[]>;
  findSimilarFeedback(query: string, limit?: number): Promise<FeedbackEvent[]>;

  // Pattern operations
  storePattern(pattern: DecompositionPattern): Promise<void>;
  getPattern(id: string): Promise<DecompositionPattern | null>;
  getAllPatterns(): Promise<DecompositionPattern[]>;
  getAntiPatterns(): Promise<DecompositionPattern[]>;
  getPatternsByTag(tag: string): Promise<DecompositionPattern[]>;
  findSimilarPatterns(
    query: string,
    limit?: number,
  ): Promise<DecompositionPattern[]>;

  // Maturity operations
  storeMaturity(maturity: PatternMaturity): Promise<void>;
  getMaturity(patternId: string): Promise<PatternMaturity | null>;
  getAllMaturity(): Promise<PatternMaturity[]>;
  getMaturityByState(state: string): Promise<PatternMaturity[]>;
  storeMaturityFeedback(feedback: MaturityFeedback): Promise<void>;
  getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]>;

  // Lifecycle
  close(): Promise<void>;
}

// ============================================================================
// Semantic Memory Storage Implementation
// ============================================================================

/**
 * Semantic-memory backed storage
 *
 * Uses the semantic-memory CLI for persistence with semantic search.
 * Data survives across sessions and can be searched by meaning.
 */
export class SemanticMemoryStorage implements LearningStorage {
  private config: StorageConfig;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async store(
    collection: string,
    data: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const content = typeof data === "string" ? data : JSON.stringify(data);
    const metaArg = metadata ? `--metadata '${JSON.stringify(metadata)}'` : "";

    await Bun.$`semantic-memory store ${content} --collection ${collection} ${metaArg}`
      .quiet()
      .nothrow();
  }

  private async find<T>(
    collection: string,
    query: string,
    limit: number = 10,
    useFts: boolean = false,
  ): Promise<T[]> {
    const ftsArg = useFts ? "--fts" : "";
    const result =
      await Bun.$`semantic-memory find ${query} --collection ${collection} --limit ${limit} ${ftsArg} --json`
        .quiet()
        .nothrow();

    if (result.exitCode !== 0) {
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
    } catch {
      return [];
    }
  }

  private async list<T>(collection: string): Promise<T[]> {
    const result =
      await Bun.$`semantic-memory list --collection ${collection} --json`
        .quiet()
        .nothrow();

    if (result.exitCode !== 0) {
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
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Feedback Operations
  // -------------------------------------------------------------------------

  async storeFeedback(event: FeedbackEvent): Promise<void> {
    await this.store(this.config.collections.feedback, event, {
      criterion: event.criterion,
      type: event.type,
      bead_id: event.bead_id || "",
      timestamp: event.timestamp,
    });
  }

  async getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    // Use FTS for exact criterion match
    return this.find<FeedbackEvent>(
      this.config.collections.feedback,
      criterion,
      100,
      true, // FTS for exact match
    );
  }

  async getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]> {
    return this.find<FeedbackEvent>(
      this.config.collections.feedback,
      beadId,
      100,
      true,
    );
  }

  async getAllFeedback(): Promise<FeedbackEvent[]> {
    return this.list<FeedbackEvent>(this.config.collections.feedback);
  }

  async findSimilarFeedback(
    query: string,
    limit: number = 10,
  ): Promise<FeedbackEvent[]> {
    return this.find<FeedbackEvent>(
      this.config.collections.feedback,
      query,
      limit,
      !this.config.useSemanticSearch,
    );
  }

  // -------------------------------------------------------------------------
  // Pattern Operations
  // -------------------------------------------------------------------------

  async storePattern(pattern: DecompositionPattern): Promise<void> {
    await this.store(this.config.collections.patterns, pattern, {
      id: pattern.id,
      kind: pattern.kind,
      is_negative: pattern.is_negative,
      tags: pattern.tags.join(","),
    });
  }

  async getPattern(id: string): Promise<DecompositionPattern | null> {
    const results = await this.find<DecompositionPattern>(
      this.config.collections.patterns,
      id,
      1,
      true,
    );
    return results[0] || null;
  }

  async getAllPatterns(): Promise<DecompositionPattern[]> {
    return this.list<DecompositionPattern>(this.config.collections.patterns);
  }

  async getAntiPatterns(): Promise<DecompositionPattern[]> {
    const all = await this.getAllPatterns();
    return all.filter((p) => p.kind === "anti_pattern");
  }

  async getPatternsByTag(tag: string): Promise<DecompositionPattern[]> {
    const results = await this.find<DecompositionPattern>(
      this.config.collections.patterns,
      tag,
      100,
      true,
    );
    return results.filter((p) => p.tags.includes(tag));
  }

  async findSimilarPatterns(
    query: string,
    limit: number = 10,
  ): Promise<DecompositionPattern[]> {
    return this.find<DecompositionPattern>(
      this.config.collections.patterns,
      query,
      limit,
      !this.config.useSemanticSearch,
    );
  }

  // -------------------------------------------------------------------------
  // Maturity Operations
  // -------------------------------------------------------------------------

  async storeMaturity(maturity: PatternMaturity): Promise<void> {
    await this.store(this.config.collections.maturity, maturity, {
      pattern_id: maturity.pattern_id,
      state: maturity.state,
    });
  }

  async getMaturity(patternId: string): Promise<PatternMaturity | null> {
    const results = await this.find<PatternMaturity>(
      this.config.collections.maturity,
      patternId,
      1,
      true,
    );
    return results[0] || null;
  }

  async getAllMaturity(): Promise<PatternMaturity[]> {
    return this.list<PatternMaturity>(this.config.collections.maturity);
  }

  async getMaturityByState(state: string): Promise<PatternMaturity[]> {
    const all = await this.getAllMaturity();
    return all.filter((m) => m.state === state);
  }

  async storeMaturityFeedback(feedback: MaturityFeedback): Promise<void> {
    await this.store(this.config.collections.maturity + "-feedback", feedback, {
      pattern_id: feedback.pattern_id,
      type: feedback.type,
      timestamp: feedback.timestamp,
    });
  }

  async getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]> {
    return this.find<MaturityFeedback>(
      this.config.collections.maturity + "-feedback",
      patternId,
      100,
      true,
    );
  }

  async close(): Promise<void> {
    // No cleanup needed for CLI-based storage
  }
}

// ============================================================================
// In-Memory Storage Implementation
// ============================================================================

/**
 * In-memory storage adapter
 *
 * Wraps the existing in-memory implementations into the unified interface.
 * Useful for testing and ephemeral sessions.
 */
export class InMemoryStorage implements LearningStorage {
  private feedback: InMemoryFeedbackStorage;
  private patterns: InMemoryPatternStorage;
  private maturity: InMemoryMaturityStorage;

  constructor() {
    this.feedback = new InMemoryFeedbackStorage();
    this.patterns = new InMemoryPatternStorage();
    this.maturity = new InMemoryMaturityStorage();
  }

  // Feedback
  async storeFeedback(event: FeedbackEvent): Promise<void> {
    return this.feedback.store(event);
  }

  async getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    return this.feedback.getByCriterion(criterion);
  }

  async getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]> {
    return this.feedback.getByBead(beadId);
  }

  async getAllFeedback(): Promise<FeedbackEvent[]> {
    return this.feedback.getAll();
  }

  async findSimilarFeedback(
    query: string,
    limit: number = 10,
  ): Promise<FeedbackEvent[]> {
    // In-memory doesn't support semantic search, filter by query string match
    const all = await this.feedback.getAll();
    const lowerQuery = query.toLowerCase();
    const filtered = all.filter(
      (event) =>
        event.criterion.toLowerCase().includes(lowerQuery) ||
        (event.bead_id && event.bead_id.toLowerCase().includes(lowerQuery)) ||
        (event.context && event.context.toLowerCase().includes(lowerQuery)),
    );
    return filtered.slice(0, limit);
  }

  // Patterns
  async storePattern(pattern: DecompositionPattern): Promise<void> {
    return this.patterns.store(pattern);
  }

  async getPattern(id: string): Promise<DecompositionPattern | null> {
    return this.patterns.get(id);
  }

  async getAllPatterns(): Promise<DecompositionPattern[]> {
    return this.patterns.getAll();
  }

  async getAntiPatterns(): Promise<DecompositionPattern[]> {
    return this.patterns.getAntiPatterns();
  }

  async getPatternsByTag(tag: string): Promise<DecompositionPattern[]> {
    return this.patterns.getByTag(tag);
  }

  async findSimilarPatterns(
    query: string,
    limit: number = 10,
  ): Promise<DecompositionPattern[]> {
    const results = await this.patterns.findByContent(query);
    return results.slice(0, limit);
  }

  // Maturity
  async storeMaturity(maturity: PatternMaturity): Promise<void> {
    return this.maturity.store(maturity);
  }

  async getMaturity(patternId: string): Promise<PatternMaturity | null> {
    return this.maturity.get(patternId);
  }

  async getAllMaturity(): Promise<PatternMaturity[]> {
    return this.maturity.getAll();
  }

  async getMaturityByState(state: string): Promise<PatternMaturity[]> {
    return this.maturity.getByState(state as any);
  }

  async storeMaturityFeedback(feedback: MaturityFeedback): Promise<void> {
    return this.maturity.storeFeedback(feedback);
  }

  async getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]> {
    return this.maturity.getFeedback(patternId);
  }

  async close(): Promise<void> {
    // No cleanup needed
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a storage instance
 *
 * @param config - Storage configuration (default: semantic-memory)
 * @returns Configured storage instance
 *
 * @example
 * ```typescript
 * // Default semantic-memory storage
 * const storage = createStorage();
 *
 * // In-memory for testing
 * const storage = createStorage({ backend: "memory" });
 *
 * // Custom collections
 * const storage = createStorage({
 *   backend: "semantic-memory",
 *   collections: {
 *     feedback: "my-project-feedback",
 *     patterns: "my-project-patterns",
 *     maturity: "my-project-maturity",
 *   },
 * });
 * ```
 */
export function createStorage(
  config: Partial<StorageConfig> = {},
): LearningStorage {
  const fullConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };

  switch (fullConfig.backend) {
    case "semantic-memory":
      return new SemanticMemoryStorage(fullConfig);
    case "memory":
      return new InMemoryStorage();
    default:
      throw new Error(`Unknown storage backend: ${fullConfig.backend}`);
  }
}

/**
 * Check if semantic-memory is available
 */
export async function isSemanticMemoryAvailable(): Promise<boolean> {
  try {
    const result = await Bun.$`semantic-memory stats`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Create storage with automatic fallback
 *
 * Uses semantic-memory if available, otherwise falls back to in-memory.
 *
 * @param config - Storage configuration
 * @returns Storage instance
 */
export async function createStorageWithFallback(
  config: Partial<StorageConfig> = {},
): Promise<LearningStorage> {
  if (config.backend === "memory") {
    return new InMemoryStorage();
  }

  const available = await isSemanticMemoryAvailable();
  if (available) {
    return new SemanticMemoryStorage(config);
  }

  console.warn(
    "semantic-memory not available, falling back to in-memory storage",
  );
  return new InMemoryStorage();
}

// ============================================================================
// Global Storage Instance
// ============================================================================

let globalStorage: LearningStorage | null = null;

/**
 * Get or create the global storage instance
 *
 * Uses semantic-memory by default, with automatic fallback to in-memory.
 */
export async function getStorage(): Promise<LearningStorage> {
  if (!globalStorage) {
    globalStorage = await createStorageWithFallback();
  }
  return globalStorage;
}

/**
 * Set the global storage instance
 *
 * Useful for testing or custom configurations.
 */
export function setStorage(storage: LearningStorage): void {
  globalStorage = storage;
}

/**
 * Reset the global storage instance
 */
export async function resetStorage(): Promise<void> {
  if (globalStorage) {
    await globalStorage.close();
    globalStorage = null;
  }
}
