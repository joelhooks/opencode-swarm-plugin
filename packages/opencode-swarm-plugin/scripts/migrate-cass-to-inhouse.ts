#!/usr/bin/env bun
/**
 * CASS to Semantic Memory Migration Script
 *
 * One-time migration to import CASS SQLite database (4213 messages, 162 conversations)
 * into the swarm-mail semantic memory system.
 *
 * Source: ~/Library/Application Support/com.coding-agent-search.coding-agent-search/agent_search.db
 * Target: swarm-mail semantic-memory via createMemoryAdapter
 *
 * ## CASS Schema
 * - agents: id, slug, name, version, kind
 * - workspaces: id, path, display_name
 * - conversations: id, agent_id, workspace_id, external_id, title, source_path, started_at, ended_at
 * - messages: id, conversation_id, idx, role, author, created_at, content, extra_json
 *
 * ## Migration Flow
 * 1. Read messages with JOINs (conversations, agents, workspaces)
 * 2. Normalize to NormalizedMessage format
 * 3. Chunk with ChunkProcessor (1:1 for Phase 1)
 * 4. Embed with Ollama (graceful degradation)
 * 5. Store in semantic-memory
 * 6. Mark session as migrated (idempotency)
 *
 * Usage:
 *   bun run scripts/migrate-cass-to-inhouse.ts [--dry-run] [--cass-db <path>]
 *
 * @example
 * # Dry run to preview
 * bun run scripts/migrate-cass-to-inhouse.ts --dry-run
 *
 * # Run migration
 * bun run scripts/migrate-cass-to-inhouse.ts
 *
 * # Custom CASS database path
 * bun run scripts/migrate-cass-to-inhouse.ts --cass-db /path/to/agent_search.db
 */

import { createClient, type Client } from "@libsql/client";
import { parseArgs } from "node:util";
import * as os from "node:os";
import * as path from "node:path";
import { getSwarmMailLibSQL, createMemoryAdapter, ChunkProcessor } from "swarm-mail";
import { Effect } from "effect";

// ============================================================================
// CLI Arguments
// ============================================================================

const { values } = parseArgs({
	options: {
		"dry-run": { type: "boolean", default: false },
		"cass-db": {
			type: "string",
			default: path.join(
				os.homedir(),
				"Library/Application Support/com.coding-agent-search.coding-agent-search/agent_search.db",
			),
		},
	},
	strict: true,
	allowPositionals: false,
});

const DRY_RUN = values["dry-run"] ?? false;
const CASS_DB_PATH = values["cass-db"] as string;

// ============================================================================
// Types
// ============================================================================

interface CassMessage {
	id: number;
	conversation_id: number;
	idx: number;
	role: string;
	author: string | null;
	created_at: number;
	content: string;
	extra_json: string | null;
	agent_type: string;
	workspace_path: string | null;
	source_path: string;
	session_id: string;
}

interface NormalizedMessage {
	session_id: string;
	agent_type: string;
	message_idx: number;
	timestamp: string;
	role: "user" | "assistant" | "system";
	content: string;
	metadata?: Record<string, unknown>;
}

// ============================================================================
// CASS Database Reader
// ============================================================================

/**
 * Read all messages from CASS database with joined metadata
 */
export async function readCassMessages(db: Client): Promise<CassMessage[]> {
	const query = `
		SELECT 
			m.id,
			m.conversation_id,
			m.idx,
			m.role,
			m.author,
			m.created_at,
			m.content,
			m.extra_json,
			a.slug as agent_type,
			w.path as workspace_path,
			c.source_path,
			c.external_id as session_id
		FROM messages m
		JOIN conversations c ON m.conversation_id = c.id
		JOIN agents a ON c.agent_id = a.id
		LEFT JOIN workspaces w ON c.workspace_id = w.id
		ORDER BY c.id, m.idx
	`;

	const result = await db.execute(query);
	return result.rows as unknown as CassMessage[];
}

/**
 * Normalize CASS messages to NormalizedMessage format
 */
export function normalizeCassMessages(messages: CassMessage[]): NormalizedMessage[] {
	return messages.map((msg) => ({
		session_id: msg.session_id,
		agent_type: msg.agent_type,
		message_idx: msg.idx,
		timestamp: new Date(msg.created_at).toISOString(),
		role: msg.role as "user" | "assistant" | "system",
		content: msg.content,
		metadata: {
			workspace_path: msg.workspace_path,
			source_path: msg.source_path,
			author: msg.author,
			extra: msg.extra_json ? JSON.parse(msg.extra_json) : undefined,
		},
	}));
}

// ============================================================================
// Migration Logic
// ============================================================================

/**
 * Check if session has already been migrated
 */
export async function isSessionMigrated(
	memory: ReturnType<typeof createMemoryAdapter>,
	sessionId: string,
): Promise<boolean> {
	const results = await memory.find(`[CASS_SESSION:${sessionId}]`, {
		collection: "cass_migration",
		limit: 1,
		fts: true, // Use FTS for exact match
	});

	return results.length > 0;
}

/**
 * Migrate messages to semantic memory
 */
export async function migrateMessagesToMemory(
	memory: ReturnType<typeof createMemoryAdapter>,
	messages: NormalizedMessage[],
	options: { sessionId: string; dryRun: boolean },
): Promise<{ stored: number; skipped: number; wouldStore?: number }> {
	if (options.dryRun) {
		return {
			stored: 0,
			skipped: 0,
			wouldStore: messages.length,
		};
	}

	// Check if already migrated
	const alreadyMigrated = await isSessionMigrated(memory, options.sessionId);
	if (alreadyMigrated) {
		return {
			stored: 0,
			skipped: messages.length,
		};
	}

	let stored = 0;

	// Store each message as a memory
	for (const msg of messages) {
		const content = `[${msg.agent_type}] ${msg.role}: ${msg.content}`;
		await memory.store(content, {
			collection: "cass_sessions",
			metadata: JSON.stringify({
				session_id: msg.session_id,
				agent_type: msg.agent_type,
				message_idx: msg.message_idx,
				timestamp: msg.timestamp,
				role: msg.role,
				...msg.metadata,
			}),
			tags: `cass,${msg.agent_type},${msg.role}`,
		});
		stored++;
	}

	// Mark session as migrated
	await memory.store(`[CASS_SESSION:${options.sessionId}] Migrated`, {
		collection: "cass_migration",
		metadata: JSON.stringify({
			session_id: options.sessionId,
			migrated_at: new Date().toISOString(),
			message_count: stored,
		}),
	});

	return {
		stored,
		skipped: 0,
	};
}

// ============================================================================
// Main Migration
// ============================================================================

async function migrate() {
	console.log("═══════════════════════════════════════════════════════════");
	console.log("  CASS → Semantic Memory Migration");
	console.log("═══════════════════════════════════════════════════════════");
	console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
	console.log(`CASS database: ${CASS_DB_PATH}`);
	console.log("");

	// Step 1: Open CASS database
	console.log("Step 1: Opening CASS database...");
	const cassDb = createClient({
		url: `file:${CASS_DB_PATH}`,
	});
	console.log("✓ CASS database opened");
	console.log("");

	// Step 2: Read messages
	console.log("Step 2: Reading messages...");
	const cassMessages = await readCassMessages(cassDb);
	console.log(`✓ Found ${cassMessages.length} messages`);
	
	// Get session distribution
	const sessionIds = new Set(cassMessages.map((m) => m.session_id));
	console.log(`  Across ${sessionIds.size} sessions`);
	console.log("");

	// Step 3: Normalize
	console.log("Step 3: Normalizing messages...");
	const normalized = normalizeCassMessages(cassMessages);
	console.log(`✓ Normalized ${normalized.length} messages`);
	console.log("");

	if (DRY_RUN) {
		console.log("DRY RUN: Would migrate these messages to semantic memory");
		console.log("Run without --dry-run to execute migration");
		cassDb.close();
		return;
	}

	// Step 4: Connect to semantic memory
	console.log("Step 4: Connecting to semantic memory...");
	const swarmMail = await getSwarmMailLibSQL(process.cwd());
	const db = await swarmMail.getDatabase();
	const memory = createMemoryAdapter(db, {
		ollamaHost: "http://localhost:11434",
		ollamaModel: "mxbai-embed-large",
	});
	console.log("✓ Connected to semantic memory");
	console.log("");

	// Step 5: Migrate by session
	console.log("Step 5: Migrating sessions...");
	let totalStored = 0;
	let totalSkipped = 0;

	// Group messages by session
	const messagesBySession = new Map<string, NormalizedMessage[]>();
	for (const msg of normalized) {
		if (!messagesBySession.has(msg.session_id)) {
			messagesBySession.set(msg.session_id, []);
		}
		messagesBySession.get(msg.session_id)!.push(msg);
	}

	let sessionCount = 0;
	for (const [sessionId, messages] of messagesBySession) {
		sessionCount++;
		process.stdout.write(`  [${sessionCount}/${messagesBySession.size}] ${sessionId.substring(0, 30)}...`);

		const result = await migrateMessagesToMemory(memory, messages, {
			sessionId,
			dryRun: false,
		});

		totalStored += result.stored;
		totalSkipped += result.skipped;

		if (result.skipped > 0) {
			console.log(` SKIPPED (already migrated)`);
		} else {
			console.log(` ✓ ${result.stored} messages`);
		}
	}

	console.log("");
	console.log(`✓ Migration complete`);
	console.log(`  Stored: ${totalStored} messages`);
	console.log(`  Skipped: ${totalSkipped} messages (already migrated)`);
	console.log("");

	// Cleanup
	cassDb.close();
	db.$client.close();

	console.log("═══════════════════════════════════════════════════════════");
	console.log("  Migration Complete");
	console.log("═══════════════════════════════════════════════════════════");
	console.log(`Total messages: ${cassMessages.length}`);
	console.log(`Total sessions: ${messagesBySession.size}`);
	console.log(`Successfully stored: ${totalStored}`);
	console.log(`Skipped (duplicate): ${totalSkipped}`);
}

// ============================================================================
// Run (only when executed directly, not when imported)
// ============================================================================

if (import.meta.main) {
	migrate().catch((error) => {
		console.error("Migration failed:");
		console.error(error);
		process.exit(1);
	});
}
