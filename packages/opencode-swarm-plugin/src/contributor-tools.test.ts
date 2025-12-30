/**
 * Contributor Tools Integration Tests
 *
 * Tests for contributor_lookup tool that fetches GitHub profiles
 * and generates changeset credits.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { closeAllSwarmMail } from "swarm-mail";
import { contributorTools, resetContributorCache } from "./contributor-tools";
import { resetHivemindCache } from "./hivemind-tools";

interface ToolContext {
	sessionID: string;
}

describe("contributor tools integration", () => {
	afterAll(async () => {
		resetContributorCache();
		resetHivemindCache();
		await closeAllSwarmMail();
	});

	test("contributor_lookup tool is registered", () => {
		expect(contributorTools).toHaveProperty("contributor_lookup");
		expect(typeof contributorTools.contributor_lookup.execute).toBe("function");
	});

	describe("contributor_lookup", () => {
		test("returns formatted credit with name + twitter", async () => {
			const tool = contributorTools.contributor_lookup;
			const result = await tool.execute(
				{
					login: "kentcdodds",
					issue: 42,
				},
				{ sessionID: "test-session" } as ToolContext,
			);

			expect(typeof result).toBe("string");
			const parsed = JSON.parse(result);
			
			expect(parsed.login).toBe("kentcdodds");
			expect(parsed.name).toBeDefined();
			expect(parsed.twitter).toBeDefined();
			expect(parsed.credit_line).toContain("Thanks to");
			expect(parsed.credit_line).toContain("reporting #42");
			expect(parsed.credit_line).toContain("@kentcdodds");
			expect(parsed.credit_line).toContain("https://x.com/");
			expect(parsed.memory_stored).toBe(true);
		});

		test("handles missing twitter gracefully", async () => {
			const tool = contributorTools.contributor_lookup;
			
			// Use a user that likely has name but no twitter
			// (we'll test the format logic mainly)
			const result = await tool.execute(
				{
					login: "torvalds", // Linus Torvalds - has name, might not have twitter
					issue: 123,
				},
				{ sessionID: "test-session" } as ToolContext,
			);

			const parsed = JSON.parse(result);
			
			expect(parsed.login).toBe("torvalds");
			expect(parsed.name).toBeDefined();
			expect(parsed.credit_line).toContain("Thanks to");
			expect(parsed.credit_line).toContain("reporting #123");
			// Should have GitHub mention if no Twitter
			if (!parsed.twitter) {
				expect(parsed.credit_line).toContain("on GitHub");
			}
		});

		test("works without issue number", async () => {
			const tool = contributorTools.contributor_lookup;
			const result = await tool.execute(
				{
					login: "kentcdodds",
				},
				{ sessionID: "test-session" } as ToolContext,
			);

			const parsed = JSON.parse(result);
			
			expect(parsed.login).toBe("kentcdodds");
			expect(parsed.credit_line).toContain("Thanks to");
			// Should NOT contain "reporting #"
			expect(parsed.credit_line).not.toContain("reporting #");
		});

		test("stores contributor info in semantic-memory", async () => {
			const tool = contributorTools.contributor_lookup;
			const result = await tool.execute(
				{
					login: "gaearon", // Dan Abramov
					issue: 99,
				},
				{ sessionID: "test-session" } as ToolContext,
			);

			const parsed = JSON.parse(result);
			
			// Just verify memory_stored flag - embedding search may be async
			expect(parsed.memory_stored).toBe(true);
		});

		test("returns all expected fields", async () => {
			const tool = contributorTools.contributor_lookup;
			const result = await tool.execute(
				{
					login: "kentcdodds",
				},
				{ sessionID: "test-session" } as ToolContext,
			);

			const parsed = JSON.parse(result);
			
			// Required fields
			expect(parsed).toHaveProperty("login");
			expect(parsed).toHaveProperty("credit_line");
			expect(parsed).toHaveProperty("memory_stored");
			
			// Optional fields (may be null but should be present)
			expect(parsed).toHaveProperty("name");
			expect(parsed).toHaveProperty("twitter");
			expect(parsed).toHaveProperty("bio");
		});
	});
});
