/**
 * Test Server Tests
 * 
 * Tests for shared PGlite database used across test suite.
 * 
 * ## TDD Approach
 * This test file drives the implementation of test-server.ts
 * 
 * ## Test Strategy
 * 1. Database lifecycle - start, stop, reuse
 * 2. Database operations - query, reset
 * 3. State isolation via TRUNCATE
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  getTestDb,
  resetTestDatabase,
  startTestServer,
  stopTestServer,
} from "./test-server";

describe("Database Lifecycle", () => {
  afterAll(async () => {
    await stopTestServer();
  });

  test("startTestServer - starts database and returns PGlite instance", async () => {
    const { db } = await startTestServer();
    
    expect(db).toBeDefined();
    expect(typeof db.query).toBe("function");
  });

  test("startTestServer - reuses existing database on subsequent calls", async () => {
    const first = await startTestServer();
    const second = await startTestServer();
    
    expect(first.db).toBe(second.db); // Same instance
  });

  test("getTestDb - returns PGlite instance", async () => {
    await startTestServer();
    const db = getTestDb();
    
    expect(db).toBeDefined();
    expect(typeof db.query).toBe("function");
  });

  test("getTestDb - throws if database not started", async () => {
    // Stop database if running
    await stopTestServer();
    
    expect(() => getTestDb()).toThrow("Test server not started");
  });
});

describe("Database Operations", () => {
  beforeAll(async () => {
    await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer();
  });

  test("resetTestDatabase - truncates all tables", async () => {
    const db = getTestDb();
    
    const now = Date.now();
    // Insert test data
    await db.exec(`
      INSERT INTO agents (name, project_key, registered_at, last_active_at) 
      VALUES ('TestAgent', '/test/project', ${now}, ${now});
    `);
    
    // Verify data exists
    const before = await db.query("SELECT COUNT(*) as count FROM agents");
    expect(before.rows[0]?.count).toBe(1);
    
    // Reset
    await resetTestDatabase();
    
    // Verify tables are empty
    const after = await db.query("SELECT COUNT(*) as count FROM agents");
    expect(after.rows[0]?.count).toBe(0);
  });

  test("resetTestDatabase - preserves table structure", async () => {
    await resetTestDatabase();
    
    const db = getTestDb();
    const now = Date.now();
    
    // Should be able to insert after reset
    await db.exec(`
      INSERT INTO agents (name, project_key, registered_at, last_active_at) 
      VALUES ('NewAgent', '/test/project', ${now}, ${now});
    `);
    
    const result = await db.query<{ name: string }>("SELECT name FROM agents");
    expect(result.rows[0]?.name).toBe("NewAgent");
  });
});

describe("Direct Database Usage", () => {
  beforeAll(async () => {
    await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer();
  });

  test("can query database directly", async () => {
    const db = getTestDb();
    const result = await db.query<{ result: number }>("SELECT 1 as result");
    expect(result.rows[0]?.result).toBe(1);
  });

  test("database persists across function calls", async () => {
    const db1 = getTestDb();
    const db2 = getTestDb();
    
    // Same instance
    expect(db1).toBe(db2);
  });
});

describe("State Isolation", () => {
  beforeAll(async () => {
    await startTestServer();
  });

  afterAll(async () => {
    await stopTestServer();
  });

  test("TRUNCATE provides clean slate between tests", async () => {
    const db = getTestDb();
    const now = Date.now();
    
    // Test 1: Insert data
    await db.exec(`
      INSERT INTO agents (name, project_key, registered_at, last_active_at) 
      VALUES ('Agent1', '/project1', ${now}, ${now});
    `);
    let count = await db.query<{ count: number }>("SELECT COUNT(*) as count FROM agents");
    expect(count.rows[0]?.count).toBe(1);
    
    // Reset
    await resetTestDatabase();
    
    // Test 2: Should see empty table
    count = await db.query<{ count: number }>("SELECT COUNT(*) as count FROM agents");
    expect(count.rows[0]?.count).toBe(0);
    
    // Test 2: Insert different data
    await db.exec(`
      INSERT INTO agents (name, project_key, registered_at, last_active_at) 
      VALUES ('Agent2', '/project2', ${now}, ${now});
    `);
    const result = await db.query<{ name: string }>("SELECT name FROM agents");
    expect(result.rows[0]?.name).toBe("Agent2");
  });
});
