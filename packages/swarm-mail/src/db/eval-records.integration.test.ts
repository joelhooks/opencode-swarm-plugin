/**
 * Integration test for eval_records table creation and usage
 * 
 * Verifies that:
 * 1. Database initialization creates eval_records table
 * 2. Table can be queried and written to
 * 3. swarm_contexts table also exists
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createInMemoryDb } from "./client.js";
import type { SwarmDb } from "./client.js";
import { evalRecordsTable, swarmContextsTable } from "./schema/streams.js";

describe("eval_records table integration", () => {
  let db: SwarmDb;

  beforeAll(async () => {
    db = await createInMemoryDb();
  });

  afterAll(async () => {
    // No explicit close needed for in-memory
  });

  test("database initialization creates eval_records table", async () => {
    // Query sqlite_master to verify table exists
    const result = await db.run(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='eval_records'`
    );
    
    const row = result.rows[0] as { name?: string };
    expect(row).toBeDefined();
    expect(row.name).toBe("eval_records");
  });

  test("can insert and query eval_records", async () => {
    const now = Date.now();
    
    // Insert a record
    await db.insert(evalRecordsTable).values({
      id: "epic-test-123",
      project_key: "/test/project",
      task: "Test task",
      context: "Test context",
      strategy: "test-based",
      epic_title: "Test Epic",
      subtasks: JSON.stringify([{ id: "sub-1", title: "Subtask 1" }]),
      created_at: now,
      updated_at: now,
    });

    // Query it back
    const records = await db
      .select()
      .from(evalRecordsTable)
      .where(eq(evalRecordsTable.id, "epic-test-123"));

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "epic-test-123",
      task: "Test task",
      strategy: "test-based",
      epic_title: "Test Epic",
    });
  });

  test("database initialization creates swarm_contexts table", async () => {
    // Query sqlite_master to verify table exists
    const result = await db.run(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='swarm_contexts'`
    );
    
    const row = result.rows[0] as { name?: string };
    expect(row).toBeDefined();
    expect(row.name).toBe("swarm_contexts");
  });

  test("can insert and query swarm_contexts", async () => {
    const now = Date.now();
    
    // Insert a checkpoint
    await db.insert(swarmContextsTable).values({
      id: "ctx-test-123",
      project_key: "/test/project",
      epic_id: "epic-123",
      bead_id: "bead-456",
      strategy: "test-based",
      files: JSON.stringify(["test.ts"]),
      dependencies: JSON.stringify([]),
      directives: JSON.stringify({}),
      recovery: JSON.stringify({}),
      created_at: now,
      checkpointed_at: now,
      updated_at: now,
    });

    // Query it back
    const contexts = await db
      .select()
      .from(swarmContextsTable)
      .where(eq(swarmContextsTable.id, "ctx-test-123"));

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      id: "ctx-test-123",
      epic_id: "epic-123",
      bead_id: "bead-456",
    });
  });
});
