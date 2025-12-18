/**
 * Tests for Legacy Memory Migration
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  migrateLegacyMemories,
  getMigrationStatus,
  legacyDatabaseExists,
} from "./migrate-legacy.js";
import { wrapPGlite } from "../pglite.js";
import { runMigrations } from "../streams/migrations.js";

describe("Legacy Memory Migration", () => {
  let legacyDb: PGlite;
  let targetDb: PGlite;
  let legacyPath: string;
  let targetPath: string;

  beforeEach(async () => {
    // Create temp directories for test databases
    legacyPath = mkdtempSync(join(tmpdir(), "legacy-memory-"));
    targetPath = mkdtempSync(join(tmpdir(), "target-memory-"));

    // Create legacy database with old schema
    legacyDb = await PGlite.create({
      dataDir: legacyPath,
      extensions: { vector },
    });

    // Initialize legacy schema
    await legacyDb.exec(`
      CREATE EXTENSION IF NOT EXISTS vector;
      
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        collection TEXT DEFAULT 'default',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_validated_at TIMESTAMPTZ
      );
      
      CREATE TABLE memory_embeddings (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        embedding vector(1024) NOT NULL
      );
    `);

    // Create target database with new schema
    targetDb = await PGlite.create({
      dataDir: targetPath,
      extensions: { vector },
    });
    await runMigrations(targetDb);
  });

  afterEach(async () => {
    await legacyDb.close();
    await targetDb.close();
    rmSync(legacyPath, { recursive: true, force: true });
    rmSync(targetPath, { recursive: true, force: true });
  });

  describe("legacyDatabaseExists", () => {
    test("returns true for existing database", () => {
      expect(legacyDatabaseExists(legacyPath)).toBe(true);
    });

    test("returns false for non-existent path", () => {
      expect(legacyDatabaseExists("/nonexistent/path")).toBe(false);
    });
  });

  describe("getMigrationStatus", () => {
    test("returns null for non-existent database", async () => {
      const status = await getMigrationStatus("/nonexistent/path");
      expect(status).toBeNull();
    });

    test("returns counts for existing database", async () => {
      // Insert test data
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory 1", "default"],
      );
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-2", "Test memory 2", "default"],
      );

      // Add embedding for one memory
      const embedding = new Array(1024).fill(0.1);
      await legacyDb.query(
        `INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)`,
        ["mem-1", `[${embedding.join(",")}]`],
      );

      const status = await getMigrationStatus(legacyPath);
      expect(status).not.toBeNull();
      expect(status?.total).toBe(2);
      expect(status?.withEmbeddings).toBe(1);
    });
  });

  describe("migrateLegacyMemories", () => {
    test("migrates memories without embeddings", async () => {
      // Insert test data in legacy database
      await legacyDb.query(
        `INSERT INTO memories (id, content, metadata, collection) VALUES ($1, $2, $3, $4)`,
        ["mem-1", "Test memory content", '{"key": "value"}', "test-collection"],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {}, // Suppress output
      });

      expect(result.migrated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);

      // Verify memory was migrated
      const migrated = await targetDb.query<{ id: string; content: string }>(
        `SELECT id, content FROM memories WHERE id = $1`,
        ["mem-1"],
      );
      expect(migrated.rows.length).toBe(1);
      expect(migrated.rows[0]?.content).toBe("Test memory content");
    });

    test("migrates memories with embeddings", async () => {
      // Insert test data with embedding
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory", "default"],
      );

      const embedding = new Array(1024).fill(0.5);
      await legacyDb.query(
        `INSERT INTO memory_embeddings (memory_id, embedding) VALUES ($1, $2::vector)`,
        ["mem-1", `[${embedding.join(",")}]`],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(1);

      // Verify embedding was migrated
      const embeddingResult = await targetDb.query<{ memory_id: string }>(
        `SELECT memory_id FROM memory_embeddings WHERE memory_id = $1`,
        ["mem-1"],
      );
      expect(embeddingResult.rows.length).toBe(1);
    });

    test("skips existing memories", async () => {
      // Insert memory in legacy
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Legacy content", "default"],
      );

      // Insert same ID in target with different content
      await targetDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Target content", "default"],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);

      // Verify target content was preserved
      const preserved = await targetDb.query<{ content: string }>(
        `SELECT content FROM memories WHERE id = $1`,
        ["mem-1"],
      );
      expect(preserved.rows[0]?.content).toBe("Target content");
    });

    test("dry run reports without making changes", async () => {
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory", "default"],
      );

      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        dryRun: true,
        onProgress: () => {},
      });

      expect(result.migrated).toBe(1);
      expect(result.dryRun).toBe(true);

      // Verify nothing was actually migrated
      const check = await targetDb.query<{ id: string }>(
        `SELECT id FROM memories WHERE id = $1`,
        ["mem-1"],
      );
      expect(check.rows.length).toBe(0);
    });

    test("handles empty legacy database", async () => {
      const result = await migrateLegacyMemories({
        legacyPath,
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    test("handles non-existent legacy path", async () => {
      const result = await migrateLegacyMemories({
        legacyPath: "/nonexistent/path",
        targetDb: wrapPGlite(targetDb),
        onProgress: () => {},
      });

      expect(result.migrated).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    test("requires DatabaseAdapter with query method", async () => {
      // Insert test data in legacy database
      await legacyDb.query(
        `INSERT INTO memories (id, content, collection) VALUES ($1, $2, $3)`,
        ["mem-1", "Test memory content", "default"],
      );

      // This simulates the bug: passing an object without query() method
      // (like SwarmMailAdapter instead of DatabaseAdapter)
      const invalidAdapter = {
        // SwarmMailAdapter has getDatabase() but not query()
        getDatabase: async () => wrapPGlite(targetDb),
        close: async () => {},
      };

      const result = await migrateLegacyMemories({
        legacyPath,
        // @ts-expect-error - intentionally passing wrong type to test runtime behavior
        targetDb: invalidAdapter,
        onProgress: () => {},
      });

      // Should fail gracefully with error, not crash
      expect(result.failed).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("query");
    });
  });
});
