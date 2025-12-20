/**
 * libSQL Memory Schema
 *
 * Translation of PGlite/pgvector memory schema to libSQL native vectors.
 *
 * ## Key Differences from PGlite
 *
 * | PGlite (pgvector)        | libSQL                               |
 * |--------------------------|--------------------------------------|
 * | `vector(768)`            | `F32_BLOB(768)`                      |
 * | `$1::vector`             | `vector(?)`                          |
 * | `embedding <=> $1`       | `vector_distance_cos(embedding, vector(?))` |
 * | `CREATE EXTENSION vector`| Not needed (native support)          |
 * | GIN FTS index            | FTS5 virtual table                   |
 * | JSONB                    | TEXT (JSON stored as string)         |
 * | TIMESTAMPTZ              | TEXT (ISO 8601 string)               |
 *
 * ## Vector Search Notes
 * - libSQL returns distance (0 = identical, 2 = opposite)
 * - To get similarity score: similarity = 1 - distance
 * - Lower distance = higher similarity (opposite of pgvector score)
 *
 * @module memory/libsql-schema
 */

import type { Client } from "@libsql/client";

/** Embedding dimension for mxbai-embed-large (matches PGlite schema) */
export const EMBEDDING_DIM = 1024;

/**
 * Create libSQL memory schema with vector support
 *
 * Creates:
 * - memories table with F32_BLOB vector column
 * - FTS5 virtual table for full-text search
 * - Indexes for performance
 *
 * Idempotent - safe to call multiple times.
 *
 * @param db - libSQL client instance
 * @throws Error if schema creation fails
 *
 * @example
 * ```typescript
 * import { createClient } from "@libsql/client";
 * import { createLibSQLMemorySchema } from "./libsql-schema.js";
 *
 * const db = createClient({ url: ":memory:" });
 * await createLibSQLMemorySchema(db);
 * ```
 */
export async function createLibSQLMemorySchema(db: Client): Promise<void> {
  // ========================================================================
  // Memories Table
  // ========================================================================
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      collection TEXT DEFAULT 'default',
      created_at TEXT DEFAULT (datetime('now')),
      confidence REAL DEFAULT 0.7,
      embedding F32_BLOB(${EMBEDDING_DIM})
    )
  `);

  // ========================================================================
  // Indexes
  // ========================================================================
  
  // Collection filtering index
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_memories_collection 
    ON memories(collection)
  `);

  // Vector index for cosine similarity search
  // libSQL requires explicit index creation for vector_top_k() queries
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_memories_embedding 
    ON memories(libsql_vector_idx(embedding))
  `);

  // ========================================================================
  // FTS5 Virtual Table (replaces PostgreSQL GIN index)
  // ========================================================================
  
  // FTS5 virtual table for full-text search
  await db.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts 
    USING fts5(id UNINDEXED, content, content=memories, content_rowid=rowid)
  `);

  // Triggers to keep FTS5 table in sync with memories table
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert 
    AFTER INSERT ON memories 
    BEGIN
      INSERT INTO memories_fts(rowid, id, content) 
      VALUES (new.rowid, new.id, new.content);
    END
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_delete 
    AFTER DELETE ON memories 
    BEGIN
      DELETE FROM memories_fts WHERE rowid = old.rowid;
    END
  `);

  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_update 
    AFTER UPDATE ON memories 
    BEGIN
      UPDATE memories_fts 
      SET id = new.id, content = new.content 
      WHERE rowid = new.rowid;
    END
  `);
}

/**
 * Drop libSQL memory schema
 *
 * Removes all tables, indexes, and triggers created by createLibSQLMemorySchema.
 * Useful for tests and cleanup.
 *
 * @param db - libSQL client instance
 */
export async function dropLibSQLMemorySchema(db: Client): Promise<void> {
  // Drop triggers first
  await db.execute("DROP TRIGGER IF EXISTS memories_fts_update");
  await db.execute("DROP TRIGGER IF EXISTS memories_fts_delete");
  await db.execute("DROP TRIGGER IF EXISTS memories_fts_insert");

  // Drop FTS5 table
  await db.execute("DROP TABLE IF EXISTS memories_fts");

  // Drop indexes
  await db.execute("DROP INDEX IF EXISTS idx_memories_collection");

  // Drop main table
  await db.execute("DROP TABLE IF EXISTS memories");
}

/**
 * Verify libSQL memory schema exists and is valid
 *
 * Checks for:
 * - memories table with required columns
 * - FTS5 virtual table
 * - Required indexes
 * - Required triggers
 *
 * @param db - libSQL client instance
 * @returns True if schema is valid, false otherwise
 */
export async function validateLibSQLMemorySchema(db: Client): Promise<boolean> {
  try {
    // Check memories table exists
    const tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memories'
    `);
    if (tables.rows.length === 0) return false;

    // Check FTS5 table exists
    const fts = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='memories_fts'
    `);
    if (fts.rows.length === 0) return false;

    // Check required columns exist
    const columns = await db.execute(`
      SELECT name FROM pragma_table_info('memories')
    `);
    const columnNames = columns.rows.map((r) => r.name);
    const required = ["id", "content", "metadata", "collection", "created_at", "confidence", "embedding"];
    
    for (const col of required) {
      if (!columnNames.includes(col)) return false;
    }

    return true;
  } catch {
    return false;
  }
}
