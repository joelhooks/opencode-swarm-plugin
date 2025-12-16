/**
 * PGLite Convenience Layer - Simple API for PGLite users
 *
 * This file provides a simplified interface for users who just want to use
 * PGLite without manually setting up adapters. For advanced use cases (custom
 * database, connection pooling, etc.), use createSwarmMailAdapter directly.
 *
 * ## Simple API (this file)
 * ```typescript
 * import { getSwarmMail } from '@opencode/swarm-mail';
 *
 * const swarmMail = await getSwarmMail('/path/to/project');
 * await swarmMail.registerAgent(projectKey, 'agent-name');
 * ```
 *
 * ## Advanced API (adapter pattern)
 * ```typescript
 * import { createSwarmMailAdapter } from '@opencode/swarm-mail';
 * import { createCustomDbAdapter } from './my-adapter';
 *
 * const db = createCustomDbAdapter({ path: './custom.db' });
 * const swarmMail = createSwarmMailAdapter(db, '/path/to/project');
 * ```
 */

import { PGlite } from "@electric-sql/pglite";
import { createSwarmMailAdapter } from "./adapter";
import type { DatabaseAdapter, SwarmMailAdapter } from "./types";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Wrap PGLite to match DatabaseAdapter interface
 *
 * PGLite has query() and exec() methods that match DatabaseAdapter,
 * but TypeScript needs the explicit wrapper for type safety.
 * PGLite's exec() returns Results[] but DatabaseAdapter expects void.
 */
export function wrapPGlite(pglite: PGlite): DatabaseAdapter {
  return {
    query: <T>(sql: string, params?: unknown[]) => pglite.query<T>(sql, params),
    exec: async (sql: string) => {
      await pglite.exec(sql);
    },
    close: () => pglite.close(),
  };
}

/**
 * Get database path (project-local or global fallback)
 *
 * Prefers project-local .opencode/streams
 * Falls back to global ~/.opencode/streams
 *
 * @param projectPath - Optional project root path
 * @returns Absolute path to database directory
 */
export function getDatabasePath(projectPath?: string): string {
  if (projectPath) {
    const localDir = join(projectPath, ".opencode");
    if (!existsSync(localDir)) {
      mkdirSync(localDir, { recursive: true });
    }
    return join(localDir, "streams");
  }
  const globalDir = join(homedir(), ".opencode");
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }
  return join(globalDir, "streams");
}

/**
 * Singleton cache for SwarmMail instances
 *
 * Key is database path, value is the adapter + PGLite instance
 */
const instances = new Map<
  string,
  { adapter: SwarmMailAdapter; pglite: PGlite }
>();

/**
 * Get or create SwarmMail instance for a project
 *
 * Uses singleton pattern - one instance per database path.
 * Safe to call multiple times for the same project.
 *
 * @param projectPath - Optional project root path (defaults to global)
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * // Project-local database
 * const swarmMail = await getSwarmMail('/path/to/project');
 *
 * // Global database (shared across all projects)
 * const swarmMail = await getSwarmMail();
 * ```
 */
export async function getSwarmMail(
  projectPath?: string,
): Promise<SwarmMailAdapter> {
  const dbPath = getDatabasePath(projectPath);
  const projectKey = projectPath || dbPath;

  if (!instances.has(dbPath)) {
    const pglite = new PGlite(dbPath);
    const db = wrapPGlite(pglite);
    const adapter = createSwarmMailAdapter(db, projectKey);
    await adapter.runMigrations();
    instances.set(dbPath, { adapter, pglite });
  }

  return instances.get(dbPath)!.adapter;
}

/**
 * Create in-memory SwarmMail instance (for testing)
 *
 * Not cached - each call creates a new instance.
 * Data is lost when instance is closed or process exits.
 *
 * @param projectKey - Project identifier (defaults to 'test')
 * @returns SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * const swarmMail = await createInMemorySwarmMail('test-project');
 * await swarmMail.registerAgent('test-project', 'test-agent');
 * // ... test code ...
 * await swarmMail.close();
 * ```
 */
export async function createInMemorySwarmMail(
  projectKey = "test",
): Promise<SwarmMailAdapter> {
  const pglite = new PGlite(); // in-memory
  const db = wrapPGlite(pglite);
  const adapter = createSwarmMailAdapter(db, projectKey);
  await adapter.runMigrations();
  return adapter;
}

/**
 * Close specific SwarmMail instance
 *
 * Closes the database connection and removes from cache.
 *
 * @param projectPath - Optional project root path (defaults to global)
 *
 * @example
 * ```typescript
 * await closeSwarmMail('/path/to/project');
 * ```
 */
export async function closeSwarmMail(projectPath?: string): Promise<void> {
  const dbPath = getDatabasePath(projectPath);
  const instance = instances.get(dbPath);
  if (instance) {
    await instance.pglite.close();
    instances.delete(dbPath);
  }
}

/**
 * Close all SwarmMail instances
 *
 * Closes all cached database connections.
 * Useful for cleanup in test teardown or process shutdown.
 *
 * @example
 * ```typescript
 * // Test teardown
 * afterAll(async () => {
 *   await closeAllSwarmMail();
 * });
 * ```
 */
export async function closeAllSwarmMail(): Promise<void> {
  for (const [path, instance] of instances) {
    await instance.pglite.close();
    instances.delete(path);
  }
}

// Re-export PGlite for consumers who need it
export { PGlite };
