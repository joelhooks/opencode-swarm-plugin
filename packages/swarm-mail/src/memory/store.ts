/**
 * Memory Store - Drizzle-based memory operations
 *
 * Provides CRUD operations and semantic search for memories using Drizzle ORM.
 * Replaces raw SQL adapter detection with Drizzle's unified query interface.
 *
 * ## Design Pattern
 * - Uses Drizzle query builder for all operations (except vector search)
 * - Vector similarity search uses sql`` template for vector_distance_cos()
 * - No adapter type detection needed - Drizzle handles PGlite/libSQL differences
 *
 * ## Key Operations
 * - store: Insert or update memory with embedding (UPSERT via onConflictDoUpdate)
 * - search: Vector similarity search with threshold/limit/collection filters
 * - ftsSearch: Full-text search (uses raw SQL - FTS5 not yet in Drizzle)
 * - list: List all memories, optionally filtered by collection
 * - get: Retrieve single memory by ID
 * - delete: Remove memory and its embedding
 * - getStats: Memory and embedding counts
 *
 * ## Migration Notes
 * - Removed detectAdapterType() - Drizzle abstracts this
 * - Removed PGlite-specific code (separate memory_embeddings table)
 * - libSQL schema has embedding inline in memories table
 * - JSON columns (metadata, tags) stored as TEXT, need JSON.parse/stringify
 * - Timestamps are TEXT (ISO strings)
 */

import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { SwarmDb } from "../db/client.js";
import { memories } from "../db/schema/memory.js";

// ============================================================================
// Types
// ============================================================================

/** Embedding dimension for mxbai-embed-large */
export const EMBEDDING_DIM = 1024;

/** Memory data structure */
export interface Memory {
  readonly id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly collection: string;
  readonly createdAt: Date;
  /** Confidence level (0.0-1.0) affecting decay rate. Higher = slower decay. Default 0.7 */
  readonly confidence?: number;
}

/** Search result with similarity score */
export interface SearchResult {
  readonly memory: Memory;
  readonly score: number;
  readonly matchType: "vector" | "fts";
}

/** Search options for queries */
export interface SearchOptions {
  readonly limit?: number;
  readonly threshold?: number;
  readonly collection?: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a memory store using Drizzle ORM
 *
 * Uses Drizzle query builder for all operations except vector search
 * (vector_distance_cos requires raw SQL template).
 *
 * @param db - Drizzle database instance (libSQL)
 * @returns Memory store operations
 *
 * @example
 * ```typescript
 * import { createInMemoryDb } from '../db/client.js';
 * const db = await createInMemoryDb();
 * const store = createMemoryStore(db);
 *
 * await store.store(memory, embedding);
 * const results = await store.search(queryEmbedding);
 * ```
 */
export function createMemoryStore(db: SwarmDb) {
  /**
   * Helper to parse memory row from database
   * Handles TEXT storage of JSON (metadata) and timestamps
   */
  const parseMemoryRow = (row: typeof memories.$inferSelect): Memory => {
    // libSQL stores metadata as TEXT (JSON string)
    const metadata =
      typeof row.metadata === "string"
        ? JSON.parse(row.metadata)
        : row.metadata ?? {};

    return {
      id: row.id,
      content: row.content,
      metadata,
      collection: row.collection ?? "default",
      createdAt: new Date(row.created_at ?? Date.now()),
      confidence: row.decay_factor ?? 0.7,
    };
  };

  return {
    /**
     * Store a memory with its embedding
     *
     * Uses Drizzle's onConflictDoUpdate for UPSERT behavior.
     * Vector embedding stored via sql`` template with vector() function.
     *
     * @param memory - Memory to store
     * @param embedding - 1024-dimensional vector
     * @throws Error if database operation fails
     */
    async store(memory: Memory, embedding: number[]): Promise<void> {
      const vectorStr = JSON.stringify(embedding);

      await db
        .insert(memories)
        .values({
          id: memory.id,
          content: memory.content,
          metadata: JSON.stringify(memory.metadata),
          collection: memory.collection,
          created_at: memory.createdAt.toISOString(),
          decay_factor: memory.confidence ?? 0.7,
          embedding: sql`vector(${vectorStr})`,
        })
        .onConflictDoUpdate({
          target: memories.id,
          set: {
            content: memory.content,
            metadata: JSON.stringify(memory.metadata),
            collection: memory.collection,
            decay_factor: memory.confidence ?? 0.7,
            embedding: sql`vector(${vectorStr})`,
          },
        });
    },

    /**
     * Vector similarity search
     *
     * Uses vector_distance_cos() function for cosine similarity.
     * Returns results sorted by similarity (highest first).
     *
     * @param queryEmbedding - 1024-dimensional query vector
     * @param options - Search options (limit, threshold, collection)
     * @returns Array of search results sorted by similarity (highest first)
     */
    async search(
      queryEmbedding: number[],
      options: SearchOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, threshold = 0.3, collection } = options;
      const vectorStr = JSON.stringify(queryEmbedding);

      // Build WHERE conditions
      const conditions = [
        sql`embedding IS NOT NULL`,
        sql`1 - vector_distance_cos(embedding, vector(${vectorStr})) >= ${threshold}`,
      ];

      if (collection) {
        conditions.push(eq(memories.collection, collection));
      }

      // Build query with Drizzle + raw SQL for vector operations
      const results = await db
        .select({
          ...getTableColumns(memories),
          score: sql<number>`1 - vector_distance_cos(embedding, vector(${vectorStr}))`,
        })
        .from(memories)
        .where(and(...conditions))
        .orderBy(sql`vector_distance_cos(embedding, vector(${vectorStr})) ASC`)
        .limit(limit);

      return results.map((row) => ({
        memory: parseMemoryRow(row),
        score: row.score,
        matchType: "vector" as const,
      }));
    },

    /**
     * Full-text search
     *
     * Uses FTS5 virtual table (memories_fts) for text search.
     * Falls back to raw SQL since FTS5 isn't yet in Drizzle.
     *
     * @param searchQuery - Text query string
     * @param options - Search options (limit, collection)
     * @returns Array of search results ranked by relevance
     */
    async ftsSearch(
      searchQuery: string,
      options: SearchOptions = {}
    ): Promise<SearchResult[]> {
      const { limit = 10, collection } = options;

      // FTS5 requires raw SQL - not yet in Drizzle's type-safe API
      // Build query dynamically based on collection filter
      const conditions = collection
        ? sql`fts.content MATCH ${searchQuery} AND m.collection = ${collection}`
        : sql`fts.content MATCH ${searchQuery}`;

      const results = await db.all<{
        id: string;
        content: string;
        metadata: string;
        collection: string;
        created_at: string;
        decay_factor: number;
        score: number;
      }>(sql`
        SELECT 
          m.id,
          m.content,
          m.metadata,
          m.collection,
          m.created_at,
          m.decay_factor,
          fts.rank as score
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.id
        WHERE ${conditions}
        ORDER BY fts.rank
        LIMIT ${limit}
      `);

      return results.map((row) => ({
        memory: parseMemoryRow(row as unknown as typeof memories.$inferSelect),
        score: Math.abs(row.score), // FTS5 rank is negative, normalize
        matchType: "fts" as const,
      }));
    },

    /**
     * List memories
     *
     * @param collection - Optional collection filter
     * @returns Array of memories sorted by created_at DESC
     */
    async list(collection?: string): Promise<Memory[]> {
      const results = collection
        ? await db
            .select()
            .from(memories)
            .where(eq(memories.collection, collection))
            .orderBy(desc(memories.created_at))
        : await db.select().from(memories).orderBy(desc(memories.created_at));

      return results.map(parseMemoryRow);
    },

    /**
     * Get a single memory by ID
     *
     * @param id - Memory ID
     * @returns Memory or null if not found
     */
    async get(id: string): Promise<Memory | null> {
      const results = await db
        .select()
        .from(memories)
        .where(eq(memories.id, id));

      return results.length > 0 ? parseMemoryRow(results[0]) : null;
    },

    /**
     * Delete a memory
     *
     * Embedding stored inline in same table, single DELETE works.
     *
     * @param id - Memory ID
     */
    async delete(id: string): Promise<void> {
      await db.delete(memories).where(eq(memories.id, id));
    },

    /**
     * Get database statistics
     *
     * Counts memories and embeddings (embeddings in same table).
     *
     * @returns Memory and embedding counts
     */
    async getStats(): Promise<{ memories: number; embeddings: number }> {
      const memoryCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(memories);

      const embeddingCount = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(memories)
        .where(sql`embedding IS NOT NULL`);

      return {
        memories: Number(memoryCount[0].count),
        embeddings: Number(embeddingCount[0].count),
      };
    },
  };
}
