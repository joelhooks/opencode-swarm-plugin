/**
 * Integration tests for swarm-orchestrate.ts runtime
 * 
 * Tests that plugin tools work end-to-end without "dbOverride required" errors.
 * These tests verify Worker 1's fix (auto-adapter creation) works in plugin context.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type SwarmMailAdapter,
	clearAdapterCache,
	createInMemorySwarmMailLibSQL,
} from "swarm-mail";
import { swarm_complete } from "./swarm-orchestrate";

describe("swarm_complete integration", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		// Create temp project directory
		testProjectPath = join(tmpdir(), `swarm-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });

		// Initialize swarm-mail for this project
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
		
		// Register a test agent
		await swarmMail.registerAgent(testProjectPath, "TestWorker", {
			program: "test",
			model: "test-model",
		});
	});

	afterEach(async () => {
		// Clean up
		await swarmMail.close();
		clearAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("swarm_complete accesses database without dbOverride error", async () => {
		const beadId = "test-bead-123";
		
		// Call swarm_complete - the key test is that it doesn't throw "dbOverride required"
		// when trying to access the database for deferred resolution
		// The deferred won't exist (table not in schema yet), but that's expected and non-fatal
		const result = await swarm_complete.execute({
			project_key: testProjectPath,
			agent_name: "TestWorker",
			bead_id: beadId,
			summary: "Test task completed",
			files_touched: ["test.ts"],
			skip_verification: true,
		});

		// Should complete successfully (even without deferred table)
		expect(result).toBeDefined();
		expect(result).toContain("Task completed");
	});

	test("swarm_complete handles missing deferred gracefully", async () => {
		// Call swarm_complete without creating deferred first
		// Should NOT throw "dbOverride required" - should complete normally
		const result = await swarm_complete.execute({
			project_key: testProjectPath,
			agent_name: "TestWorker",
			bead_id: "no-deferred-bead",
			summary: "Task without deferred",
			files_touched: ["test.ts"],
			skip_verification: true,
		});

		// Should complete successfully even without deferred
		expect(result).toBeDefined();
		expect(result).toContain("Task completed");
	});
});

describe("swarm_recover integration", () => {
	let testProjectPath: string;
	let swarmMail: SwarmMailAdapter;

	beforeEach(async () => {
		testProjectPath = join(tmpdir(), `swarm-test-${Date.now()}`);
		mkdirSync(testProjectPath, { recursive: true });
		swarmMail = await createInMemorySwarmMailLibSQL(testProjectPath);
	});

	afterEach(async () => {
		await swarmMail.close();
		clearAdapterCache();
		rmSync(testProjectPath, { recursive: true, force: true });
	});

	test("swarm_recover accesses database without dbOverride error", async () => {
		const { swarm_recover } = await import("./swarm-orchestrate");
		
		const epicId = "epic-123";
		
		// Call swarm_recover - the key test is that it doesn't throw "dbOverride required"
		// when trying to query swarm_contexts table
		// The table doesn't exist yet (not in schema), so it should return { found: false }
		const result = await swarm_recover.execute({
			project_key: testProjectPath,
			epic_id: epicId,
		});

		// Should return graceful fallback (not throw error)
		const parsed = JSON.parse(result);
		expect(parsed.found).toBe(false);
	});

	test("checkpoint recovery returns not found for missing checkpoint", async () => {
		const { swarm_recover } = await import("./swarm-orchestrate");
		
		// Query non-existent epic - should return { found: false }, not error
		const result = await swarm_recover.execute({
			project_key: testProjectPath,
			epic_id: "non-existent-epic",
		});

		const parsed = JSON.parse(result);
		expect(parsed.found).toBe(false);
	});
});
