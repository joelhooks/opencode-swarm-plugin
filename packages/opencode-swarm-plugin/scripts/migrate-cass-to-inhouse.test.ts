import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { createDrizzleClient, createMemoryAdapter } from "swarm-mail";
import type { SwarmDb } from "swarm-mail";

/**
 * Test suite for CASS migration script
 *
 * Strategy: Create in-memory CASS database, populate with test data,
 * run migration to in-memory semantic-memory, verify results.
 */

describe("CASS to Semantic Memory Migration", () => {
	let cassDb: Client;
	let libsqlClient: Client;
	let db: SwarmDb;
	let memory: ReturnType<typeof createMemoryAdapter>;
	let originalFetch: typeof fetch;

	beforeAll(async () => {
		// Mock Ollama for embeddings
		originalFetch = global.fetch;
		const mockFetch = mock((url: string) => {
			if (url.includes("/api/embeddings")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({ embedding: Array(1024).fill(0.5) }),
				} as Response);
			}
			return Promise.resolve({
				ok: true,
				json: async () => ({ models: [{ name: "mxbai-embed-large" }] }),
			} as Response);
		});
		global.fetch = mockFetch as typeof fetch;

		// Create in-memory CASS database with test data (using libSQL client)
		cassDb = createClient({ url: ":memory:" });

		// Create CASS schema (execute one by one, batch doesn't work for mixed DDL/DML)
		await cassDb.execute(`CREATE TABLE agents (
			id INTEGER PRIMARY KEY,
			slug TEXT NOT NULL,
			name TEXT NOT NULL,
			version TEXT,
			kind TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		)`);

		await cassDb.execute(`CREATE TABLE workspaces (
			id INTEGER PRIMARY KEY,
			path TEXT NOT NULL,
			display_name TEXT
		)`);

		await cassDb.execute(`CREATE TABLE conversations (
			id INTEGER PRIMARY KEY,
			agent_id INTEGER NOT NULL,
			workspace_id INTEGER,
			external_id TEXT,
			title TEXT,
			source_path TEXT NOT NULL,
			started_at INTEGER,
			ended_at INTEGER,
			approx_tokens INTEGER,
			metadata_json TEXT,
			FOREIGN KEY (agent_id) REFERENCES agents(id),
			FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
		)`);

		await cassDb.execute(`CREATE TABLE messages (
			id INTEGER PRIMARY KEY,
			conversation_id INTEGER NOT NULL,
			idx INTEGER NOT NULL,
			role TEXT NOT NULL,
			author TEXT,
			created_at INTEGER,
			content TEXT NOT NULL,
			extra_json TEXT,
			FOREIGN KEY (conversation_id) REFERENCES conversations(id)
		)`);

		// Insert test data
		await cassDb.execute(`INSERT INTO agents (id, slug, name, version, kind, created_at, updated_at)
			VALUES (1, 'claude_code', 'claude_code', NULL, 'cli', 1765207109502, 1765207109768)`);

		await cassDb.execute(`INSERT INTO workspaces (id, path, display_name)
			VALUES (1, '/Users/test/project', NULL)`);

		await cassDb.execute(`INSERT INTO conversations (id, agent_id, workspace_id, external_id, title, source_path, started_at, ended_at)
			VALUES (1, 1, 1, 'test-session-1', 'Test Session', '/Users/test/.claude/sessions/test.jsonl', 1757960441273, 1757963086294)`);

		await cassDb.execute(`INSERT INTO messages (id, conversation_id, idx, role, author, created_at, content, extra_json)
			VALUES (1, 1, 0, 'user', NULL, 1757960441273, 'Test user message', NULL)`);

		await cassDb.execute(`INSERT INTO messages (id, conversation_id, idx, role, author, created_at, content, extra_json)
			VALUES (2, 1, 1, 'assistant', NULL, 1757960484308, 'Test assistant message', NULL)`);

		await cassDb.execute(`INSERT INTO messages (id, conversation_id, idx, role, author, created_at, content, extra_json)
			VALUES (3, 1, 2, 'user', NULL, 1757960500000, 'Another user message', NULL)`);

		// Create in-memory libSQL database with memory schema
		libsqlClient = createClient({ url: ":memory:" });

		// Create memories table (from memory/adapter.integration.test.ts pattern)
		await libsqlClient.execute(`
			CREATE TABLE memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				metadata TEXT DEFAULT '{}',
				collection TEXT DEFAULT 'default',
				tags TEXT DEFAULT '[]',
				created_at TEXT DEFAULT (datetime('now')),
				updated_at TEXT DEFAULT (datetime('now')),
				decay_factor REAL DEFAULT 0.7,
				embedding F32_BLOB(1024),
				valid_from TEXT,
				valid_until TEXT,
				superseded_by TEXT REFERENCES memories(id),
				auto_tags TEXT,
				keywords TEXT
			)
		`);

		// Create FTS5 virtual table
		await libsqlClient.execute(`
			CREATE VIRTUAL TABLE memories_fts USING fts5(
				content,
				content='memories',
				content_rowid='rowid'
			)
		`);

		// Create triggers
		await libsqlClient.execute(`
			CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
				INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
			END
		`);

		// Create vector index
		await libsqlClient.execute(`
			CREATE INDEX idx_memories_embedding ON memories(libsql_vector_idx(embedding))
		`);

		// Create Drizzle client
		db = createDrizzleClient(libsqlClient);

		// Create memory adapter
		memory = createMemoryAdapter(db, {
			ollamaHost: "http://localhost:11434",
			ollamaModel: "mxbai-embed-large",
		});
	});

	afterAll(async () => {
		global.fetch = originalFetch;
		cassDb.close();
		libsqlClient.close();
	});

	test("should read CASS messages with joined metadata", async () => {
		const messages = await readCassMessages(cassDb);

		expect(messages).toBeArrayOfSize(3);
		expect(messages[0]).toMatchObject({
			role: "user",
			content: "Test user message",
			agent_type: "claude_code",
			workspace_path: "/Users/test/project",
			source_path: "/Users/test/.claude/sessions/test.jsonl",
		});
	});

	test("should normalize CASS messages to NormalizedMessage format", async () => {
		const cassMessages = await readCassMessages(cassDb);
		const normalized = normalizeCassMessages(cassMessages);

		expect(normalized).toBeArrayOfSize(3);
		expect(normalized[0]).toMatchObject({
			session_id: "test-session-1",
			agent_type: "claude_code",
			message_idx: 0,
			role: "user",
			content: "Test user message",
		});
		// Check timestamp is valid ISO string
		expect(normalized[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
		expect(normalized[0].metadata).toBeDefined();
	});

	test("should detect already-migrated sessions (idempotency)", async () => {
		// Use unique session ID for this test
		// Store a marker for session "test-session-idempotency"
		await memory.store(`[CASS_SESSION:test-session-idempotency] Migrated`, {
			collection: "cass_migration",
			metadata: JSON.stringify({ session_id: "test-session-idempotency" }),
		});

		const alreadyMigrated = await isSessionMigrated(
			memory,
			"test-session-idempotency",
		);
		expect(alreadyMigrated).toBe(true);

		const notMigrated = await isSessionMigrated(memory, "test-session-never-migrated");
		expect(notMigrated).toBe(false);
	});

	test("should migrate CASS messages to semantic memory", async () => {
		// Use different session ID to avoid collision with idempotency test
		const cassMessages = await readCassMessages(cassDb);
		const normalized = normalizeCassMessages(cassMessages);

		// Migration should chunk, embed, and store
		const migrated = await migrateMessagesToMemory(memory, normalized, {
			sessionId: "test-session-migration",
			dryRun: false,
		});

		expect(migrated.stored).toBe(3);
		expect(migrated.skipped).toBe(0);

		// Verify stored in semantic memory (search is fuzzy, just verify we got results)
		const searchResults = await memory.find("Test user message", { limit: 3 });
		expect(searchResults.length).toBeGreaterThan(0);
		// At least one should contain "Test" and "message"
		const hasMatch = searchResults.some(r => 
			r.memory.content.includes("Test") && r.memory.content.includes("message")
		);
		expect(hasMatch).toBe(true);
	});

	test("should respect dry-run mode", async () => {
		const cassMessages = await readCassMessages(cassDb);
		const normalized = normalizeCassMessages(cassMessages);

		const dryRunResult = await migrateMessagesToMemory(memory, normalized, {
			sessionId: "test-session-dryrun",
			dryRun: true,
		});

		expect(dryRunResult.stored).toBe(0);
		expect(dryRunResult.wouldStore).toBe(3);

		// Should NOT find the dry-run session marker (wasn't actually migrated)
		const markerResults = await memory.find("[CASS_SESSION:test-session-dryrun]", {
			collection: "cass_migration",
			limit: 1,
			fts: true, // Use FTS for exact match
		});
		// Filter to only test-session-dryrun (not other test sessions)
		const dryrunOnly = markerResults.filter(r => 
			r.memory.metadata && 
			typeof r.memory.metadata === 'object' &&
			'session_id' in r.memory.metadata &&
			r.memory.metadata.session_id === "test-session-dryrun"
		);
		expect(dryrunOnly).toBeArrayOfSize(0);
	});
});

// ============================================================================
// Import functions from migration script
// ============================================================================

import {
	readCassMessages,
	normalizeCassMessages,
	isSessionMigrated,
	migrateMessagesToMemory,
} from "./migrate-cass-to-inhouse";
