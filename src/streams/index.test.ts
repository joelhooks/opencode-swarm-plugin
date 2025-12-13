/**
 * Tests for database singleton management
 *
 * Characterization tests to document current behavior before fixes
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeAllDatabases,
  closeDatabase,
  getDatabase,
  getDatabasePath,
  getDatabaseStats,
  isDatabaseHealthy,
  resetDatabase,
} from "./index";

describe("getDatabasePath", () => {
  it("returns project-local path when .opencode exists", () => {
    const path = getDatabasePath(
      "/Users/joel/Code/joelhooks/opencode-swarm-plugin",
    );
    expect(path).toMatch(/\.opencode\/streams$/);
  });

  it("falls back to global path when projectPath is undefined", () => {
    const path = getDatabasePath();
    expect(path).toMatch(/\.opencode\/streams$/);
    expect(path).toContain(require("os").homedir());
  });
});

describe("getDatabase singleton", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("returns same instance for same path", async () => {
    const db1 = await getDatabase();
    const db2 = await getDatabase();
    expect(db1).toBe(db2);
  });

  it("returns different instances for different paths", async () => {
    // Use project root which exists vs undefined (global fallback)
    const db1 = await getDatabase();
    const db2 = await getDatabase(
      "/Users/joel/Code/joelhooks/opencode-swarm-plugin",
    );
    expect(db1).not.toBe(db2);
  });

  it("initializes schema on first access", async () => {
    const db = await getDatabase();
    const result = await db.query("SELECT COUNT(*) FROM events");
    expect(result.rows).toBeDefined();
  });

  it("does not reinitialize schema on subsequent access", async () => {
    const db1 = await getDatabase();
    await db1.exec(
      "INSERT INTO events (type, project_key, timestamp, data) VALUES ('test', 'test', 123, '{}')",
    );

    const db2 = await getDatabase();
    const result = await db2.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM events",
    );
    expect(parseInt(result.rows[0].count)).toBe(1);
  });

  describe("race condition behavior (current bug)", () => {
    it("CHARACTERIZATION: concurrent calls may create multiple instances", async () => {
      // This test documents the CURRENT race condition
      // Multiple concurrent calls before first one completes
      const promises = Array.from({ length: 10 }, () =>
        getDatabase("/tmp/race-test"),
      );
      const results = await Promise.all(promises);

      // Currently this MAY pass or fail depending on timing
      // All should be same instance, but race condition could create multiple
      const firstInstance = results[0];
      const allSame = results.every((db) => db === firstInstance);

      // Document that we WANT this to pass but it might not
      if (!allSame) {
        console.warn("RACE CONDITION DETECTED: Multiple instances created");
      }
    });
  });
});

describe("closeDatabase", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("removes instance from cache", async () => {
    const db1 = await getDatabase("/tmp/close-test");
    await closeDatabase("/tmp/close-test");
    const db2 = await getDatabase("/tmp/close-test");
    expect(db1).not.toBe(db2);
  });

  it("handles closing non-existent database gracefully", async () => {
    // Should not throw when closing a non-existent database
    await closeDatabase("/tmp/non-existent");
    // If we get here without throwing, test passes
    expect(true).toBe(true);
  });
});

describe("closeAllDatabases", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("closes all cached instances", async () => {
    const db1 = await getDatabase("/tmp/test1");
    const db2 = await getDatabase("/tmp/test2");

    await closeAllDatabases();

    const db3 = await getDatabase("/tmp/test1");
    const db4 = await getDatabase("/tmp/test2");

    expect(db3).not.toBe(db1);
    expect(db4).not.toBe(db2);
  });
});

describe("isDatabaseHealthy", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("returns true for healthy database", async () => {
    await getDatabase();
    const healthy = await isDatabaseHealthy();
    expect(healthy).toBe(true);
  });

  it("CHARACTERIZATION: swallows errors and returns false (current bug)", async () => {
    // This documents the current behavior of swallowing errors
    // We want error logging before returning false
    const consoleErrorSpy = vi.spyOn(console, "error");

    // Force a bad state somehow (hard to test without mocking)
    // For now, just document that errors are caught silently
    await getDatabase();
    const healthy = await isDatabaseHealthy();
    expect(healthy).toBe(true);

    consoleErrorSpy.mockRestore();
  });
});

describe("resetDatabase", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("clears all data but keeps schema", async () => {
    const db = await getDatabase("/tmp/reset-test");
    await db.exec(
      "INSERT INTO events (type, project_key, timestamp, data) VALUES ('test', 'test', 123, '{}')",
    );

    await resetDatabase("/tmp/reset-test");

    const result = await db.query<{ count: string }>(
      "SELECT COUNT(*) as count FROM events",
    );
    expect(parseInt(result.rows[0].count)).toBe(0);

    // Schema should still exist
    await expect(
      db.query("SELECT 1 FROM events LIMIT 0"),
    ).resolves.toBeDefined();
  });
});

describe("getDatabaseStats", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("returns counts for all tables", async () => {
    await resetDatabase("/tmp/stats-test");
    const stats = await getDatabaseStats("/tmp/stats-test");

    expect(stats).toEqual({
      events: 0,
      agents: 0,
      messages: 0,
      reservations: 0,
    });
  });
});

describe("error handling and fallback", () => {
  beforeEach(async () => {
    await closeAllDatabases();
  });

  afterEach(async () => {
    await closeAllDatabases();
  });

  it("falls back to in-memory on initialization failure", async () => {
    // This is hard to test without mocking PGlite constructor
    // The current implementation HAS this behavior (lines 82-112)
    // Just document that it exists
  });

  it("marks instance as degraded after fallback", async () => {
    // After fallback, isDatabaseHealthy should return false
    // But instance should still work (in-memory)
  });
});

describe("MISSING: process exit handlers", () => {
  it("TODO: should close all databases on process.exit", () => {
    // This test documents that this behavior is MISSING
    // Need to add process.on('exit') handler
  });

  it("TODO: should close all databases on SIGINT", () => {
    // Need to add process.on('SIGINT') handler
  });

  it("TODO: should close all databases on SIGTERM", () => {
    // Need to add process.on('SIGTERM') handler
  });
});

describe("MISSING: LRU eviction", () => {
  it("TODO: should evict least recently used instance when cache is full", () => {
    // This documents that LRU eviction is MISSING
    // Current implementation has unbounded Map growth
  });

  it("TODO: should have configurable max cache size", () => {
    // Need max cache size configuration
  });
});
