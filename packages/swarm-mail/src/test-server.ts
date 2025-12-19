/**
 * Shared Test Database
 *
 * Provides a single shared PGlite instance for the entire test suite.
 * Dramatically speeds up tests by avoiding WASM initialization per test.
 *
 * ## Performance Impact
 * - Before: 50+ tests × 500ms init = 25+ seconds just for PGlite startup
 * - After: 1 init (~500ms) + TRUNCATE between tests (~10ms each)
 * - Expected: ~20x speedup
 *
 * ## Usage
 * ```typescript
 * import { startTestServer, resetTestDatabase, getTestDb } from './test-server';
 *
 * beforeAll(async () => {
 *   await startTestServer();
 * });
 *
 * beforeEach(async () => {
 *   await resetTestDatabase();
 * });
 *
 * afterAll(async () => {
 *   await stopTestServer();
 * });
 *
 * test("my test", async () => {
 *   const db = getTestDb();
 *   await db.query("SELECT 1");
 * });
 * ```
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { runMigrations } from "./streams/migrations";

/**
 * Module-level state - one database per process
 */
let db: PGlite | null = null;

/**
 * Start the shared test database.
 * Safe to call multiple times - returns existing database if already initialized.
 *
 * @returns PGlite instance
 */
export async function startTestServer(): Promise<{ db: PGlite }> {
  if (db) {
    return { db };
  }

  // Create in-memory PGlite with vector extension
  db = await PGlite.create({ extensions: { vector } });

  // Run all migrations to set up schema
  await runMigrations(db);

  return { db };
}

/**
 * Stop the test database.
 * Safe to call multiple times.
 */
export async function stopTestServer(): Promise<void> {
  if (db) {
    // CRITICAL: CHECKPOINT before close to flush WAL
    await db.exec("CHECKPOINT");
    await db.close();
    db = null;
  }
}

/**
 * Reset test database by truncating all tables.
 * Much faster than recreating the entire database.
 *
 * @throws If test server not started
 */
export async function resetTestDatabase(): Promise<void> {
  if (!db) {
    throw new Error("Test server not started. Call startTestServer() first.");
  }

  // Truncate all tables in dependency order
  // CASCADE handles foreign key constraints
  await db.exec(`
    TRUNCATE 
      agents,
      messages,
      reservations,
      events,
      cursors,
      deferred,
      beads,
      bead_dependencies,
      bead_labels,
      bead_comments,
      memories,
      memory_embeddings
    CASCADE
  `);
}

/**
 * Get the PGlite instance for direct access.
 * Useful for tests that need raw database access.
 *
 * @returns PGlite instance
 * @throws If test server not started
 */
export function getTestDb(): PGlite {
  if (!db) {
    throw new Error("Test server not started. Call startTestServer() first.");
  }
  return db;
}


