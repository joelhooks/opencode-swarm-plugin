/**
 * LibSQL Streams Schema Tests
 *
 * Tests for libSQL-compatible event store schema (events, agents, messages, etc.)
 * Parallel to migrations.ts but using libSQL syntax instead of PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createLibSQLAdapter } from "../libsql.js";
import type { DatabaseAdapter } from "../types/database.js";
import {
  createLibSQLStreamsSchema,
  dropLibSQLStreamsSchema,
  validateLibSQLStreamsSchema,
} from "./libsql-schema.js";

describe("libSQL streams schema", () => {
  let db: DatabaseAdapter;

  beforeAll(async () => {
    db = await createLibSQLAdapter({ url: ":memory:" });
  });

  afterAll(async () => {
    await db.close?.();
  });

  describe("createLibSQLStreamsSchema", () => {
    test("creates all required tables", async () => {
      await createLibSQLStreamsSchema(db);

      // Check tables exist
      const tables = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        ORDER BY name
      `);

      const tableNames = tables.rows.map((r) => r.name);
      
      expect(tableNames).toContain("events");
      expect(tableNames).toContain("agents");
      expect(tableNames).toContain("messages");
      expect(tableNames).toContain("message_recipients");
      expect(tableNames).toContain("reservations");
      expect(tableNames).toContain("locks");
      expect(tableNames).toContain("cursors");
      expect(tableNames).toContain("eval_records");
      expect(tableNames).toContain("swarm_contexts");
    });

    test("creates indexes", async () => {
      await createLibSQLStreamsSchema(db);

      const indexes = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type='index' AND sql IS NOT NULL
        ORDER BY name
      `);

      const indexNames = indexes.rows.map((r) => r.name);
      
      // Events indexes
      expect(indexNames).toContain("idx_events_project_key");
      expect(indexNames).toContain("idx_events_type");
      
      // Messages indexes
      expect(indexNames).toContain("idx_messages_project");
      expect(indexNames).toContain("idx_messages_thread");
    });

    test("events table has correct columns", async () => {
      await createLibSQLStreamsSchema(db);

      // Use table_xinfo to include generated columns (hidden: 3)
      const columns = await db.query<{ name: string; type: string; hidden: number }>(`
        PRAGMA table_xinfo('events')
      `);

      const columnMap = Object.fromEntries(
        columns.rows.map((r) => [r.name, r.type])
      );

      expect(columnMap).toMatchObject({
        id: "INTEGER",
        type: "TEXT",
        project_key: "TEXT",
        timestamp: "INTEGER",
        sequence: "INTEGER", // Generated column (hidden: 3)
        data: "TEXT", // JSON stored as TEXT
        created_at: "TEXT", // ISO timestamp
      });
    });

    test("agents table has UNIQUE constraint", async () => {
      await createLibSQLStreamsSchema(db);

      // Insert first agent
      await db.query(
        `INSERT INTO agents (project_key, name, registered_at, last_active_at) 
         VALUES (?, ?, ?, ?)`,
        ["proj-1", "agent-1", 1000, 1000]
      );

      // Try to insert duplicate - should fail
      await expect(async () => {
        await db.query(
          `INSERT INTO agents (project_key, name, registered_at, last_active_at) 
           VALUES (?, ?, ?, ?)`,
          ["proj-1", "agent-1", 2000, 2000]
        );
      }).toThrow();
    });

    test("message_recipients has CASCADE delete", async () => {
      await createLibSQLStreamsSchema(db);

      // Insert message
      const msgResult = await db.query<{ id: number }>(
        `INSERT INTO messages (project_key, from_agent, subject, body, created_at) 
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        ["proj-1", "agent-1", "Test", "Body", 1000]
      );
      
      const messageId = msgResult.rows[0].id;

      // Insert recipient
      await db.query(
        `INSERT INTO message_recipients (message_id, agent_name) 
         VALUES (?, ?)`,
        [messageId, "agent-2"]
      );

      // Delete message
      await db.query(
        `DELETE FROM messages WHERE id = ?`,
        [messageId]
      );

      // Recipient should be auto-deleted
      const recipients = await db.query(
        `SELECT * FROM message_recipients WHERE message_id = ?`,
        [messageId]
      );

      expect(recipients.rows).toHaveLength(0);
    });

    test("is idempotent", async () => {
      await createLibSQLStreamsSchema(db);
      
      // Call again - should not error
      await expect(async () => {
        await createLibSQLStreamsSchema(db);
      }).not.toThrow();
    });

    test("eval_records table can store decomposition data", async () => {
      await createLibSQLStreamsSchema(db);

      const now = Date.now();
      const evalRecord = {
        id: "epic-123",
        project_key: "/path/to/project",
        task: "Add authentication",
        context: "User story context",
        strategy: "feature-based",
        epic_title: "Authentication Epic",
        subtasks: JSON.stringify([
          { id: "sub-1", title: "Add login", files: ["auth.ts"] }
        ]),
        created_at: now,
        updated_at: now,
      };

      // Insert eval record
      await db.query(
        `INSERT INTO eval_records (id, project_key, task, context, strategy, epic_title, subtasks, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          evalRecord.id,
          evalRecord.project_key,
          evalRecord.task,
          evalRecord.context,
          evalRecord.strategy,
          evalRecord.epic_title,
          evalRecord.subtasks,
          evalRecord.created_at,
          evalRecord.updated_at,
        ]
      );

      // Query it back
      const result = await db.query<{
        id: string;
        task: string;
        strategy: string;
        epic_title: string;
      }>(
        `SELECT id, task, strategy, epic_title FROM eval_records WHERE id = ?`,
        [evalRecord.id]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        id: "epic-123",
        task: "Add authentication",
        strategy: "feature-based",
        epic_title: "Authentication Epic",
      });
    });

    test("swarm_contexts table can store checkpoint data", async () => {
      await createLibSQLStreamsSchema(db);

      const now = Date.now();
      const checkpoint = {
        id: "ctx-123",
        project_key: "/path/to/project",
        epic_id: "epic-123",
        bead_id: "bead-456",
        strategy: "feature-based",
        files: JSON.stringify(["src/auth.ts"]),
        dependencies: JSON.stringify(["bead-455"]),
        directives: JSON.stringify({ shared_context: "auth flow" }),
        recovery: JSON.stringify({ last_checkpoint: now }),
        created_at: now,
        checkpointed_at: now,
        updated_at: now,
      };

      // Insert checkpoint
      await db.query(
        `INSERT INTO swarm_contexts (id, project_key, epic_id, bead_id, strategy, files, dependencies, directives, recovery, created_at, checkpointed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          checkpoint.id,
          checkpoint.project_key,
          checkpoint.epic_id,
          checkpoint.bead_id,
          checkpoint.strategy,
          checkpoint.files,
          checkpoint.dependencies,
          checkpoint.directives,
          checkpoint.recovery,
          checkpoint.created_at,
          checkpoint.checkpointed_at,
          checkpoint.updated_at,
        ]
      );

      // Query it back
      const result = await db.query<{
        id: string;
        epic_id: string;
        bead_id: string;
      }>(
        `SELECT id, epic_id, bead_id FROM swarm_contexts WHERE id = ?`,
        [checkpoint.id]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        id: "ctx-123",
        epic_id: "epic-123",
        bead_id: "bead-456",
      });
    });
  });

  describe("dropLibSQLStreamsSchema", () => {
    test("removes all tables", async () => {
      await createLibSQLStreamsSchema(db);
      await dropLibSQLStreamsSchema(db);

      const tables = await db.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('events', 'agents', 'messages', 'reservations', 'locks', 'cursors', 'eval_records', 'swarm_contexts')
      `);

      expect(tables.rows).toHaveLength(0);
    });

    test("is idempotent", async () => {
      await dropLibSQLStreamsSchema(db);
      
      // Call again - should not error
      await expect(async () => {
        await dropLibSQLStreamsSchema(db);
      }).not.toThrow();
    });
  });

  describe("validateLibSQLStreamsSchema", () => {
    test("returns true when schema exists", async () => {
      await createLibSQLStreamsSchema(db);
      
      const isValid = await validateLibSQLStreamsSchema(db);
      expect(isValid).toBe(true);
    });

    test("returns false when schema missing", async () => {
      await dropLibSQLStreamsSchema(db);
      
      const isValid = await validateLibSQLStreamsSchema(db);
      expect(isValid).toBe(false);
    });

    test("returns false when tables incomplete", async () => {
      await dropLibSQLStreamsSchema(db);
      
      // Create only events table
      await db.exec(`
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL
        )
      `);

      const isValid = await validateLibSQLStreamsSchema(db);
      expect(isValid).toBe(false);
    });
  });
});
