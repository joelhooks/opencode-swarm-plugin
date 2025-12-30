import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HIVEMIND_SECTION } from "./generate-agents-md";

/**
 * Test suite for AGENTS.md generator
 * Ensures hivemind tools are documented, not semantic-memory or cass tools
 */
describe("generate-agents-md", () => {
	it("should document hivemind_* tools, not semantic-memory_*", () => {
		const agentsMd = readFileSync(
			join(import.meta.dir, "../../../AGENTS.md"),
			"utf-8",
		);

		// Should have hivemind tools
		expect(agentsMd).toContain("hivemind_store");
		expect(agentsMd).toContain("hivemind_find");
		expect(agentsMd).toContain("hivemind_get");
		expect(agentsMd).toContain("hivemind_remove");
		expect(agentsMd).toContain("hivemind_validate");
		expect(agentsMd).toContain("hivemind_stats");
		expect(agentsMd).toContain("hivemind_index");
		expect(agentsMd).toContain("hivemind_sync");

		// Should NOT have old tools
		expect(agentsMd).not.toContain("semantic-memory_store");
		expect(agentsMd).not.toContain("semantic-memory_find");
		expect(agentsMd).not.toContain("cass_search");
		expect(agentsMd).not.toContain("cass_view");
	});

	it("should document hivemind unified memory concept", () => {
		const agentsMd = readFileSync(
			join(import.meta.dir, "../../../AGENTS.md"),
			"utf-8",
		);

		// Should explain unified memory
		expect(agentsMd).toContain("Hivemind");
		expect(agentsMd).toContain("The hive remembers everything");
		expect(agentsMd).toContain("all searchable");
	});

	it("should have usage examples for hivemind_find with collection filter", () => {
		const agentsMd = readFileSync(
			join(import.meta.dir, "../../../AGENTS.md"),
			"utf-8",
		);

		// Should show how to filter by collection (replaces cass agent filter)
		expect(agentsMd).toContain('collection: "claude"');
	});

	it("HIVEMIND_SECTION constant should include all required tools", () => {
		// Verify constant has all 8 hivemind tools
		expect(HIVEMIND_SECTION).toContain("hivemind_store");
		expect(HIVEMIND_SECTION).toContain("hivemind_find");
		expect(HIVEMIND_SECTION).toContain("hivemind_get");
		expect(HIVEMIND_SECTION).toContain("hivemind_remove");
		expect(HIVEMIND_SECTION).toContain("hivemind_validate");
		expect(HIVEMIND_SECTION).toContain("hivemind_stats");
		expect(HIVEMIND_SECTION).toContain("hivemind_index");
		expect(HIVEMIND_SECTION).toContain("hivemind_sync");
	});

	it("HIVEMIND_SECTION should not have old tool names", () => {
		// No semantic-memory or cass tools
		expect(HIVEMIND_SECTION).not.toContain("semantic-memory_");
		expect(HIVEMIND_SECTION).not.toContain("cass_");
	});
});
