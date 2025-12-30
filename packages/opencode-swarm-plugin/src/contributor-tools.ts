/**
 * Contributor Tools - GitHub profile extraction for changeset credits
 *
 * Provides contributor_lookup tool for fetching GitHub profiles and
 * generating formatted changeset credit lines. Automatically stores
 * contributor info in semantic-memory for future reference.
 *
 * Based on patterns from gh-issue-triage skill.
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { getHivemindAdapter } from "./hivemind-tools";

// ============================================================================
// Types
// ============================================================================

const GitHubUserSchema = z.object({
	login: z.string(),
	name: z.string().nullable(),
	twitter_username: z.string().nullable(),
	blog: z.string().nullable(),
	bio: z.string().nullable(),
	avatar_url: z.string(),
	html_url: z.string(),
	public_repos: z.number().optional(),
	followers: z.number().optional(),
});

type GitHubUser = z.infer<typeof GitHubUserSchema>;

interface ContributorResult {
	login: string;
	name: string | null;
	twitter: string | null;
	bio: string | null;
	credit_line: string;
	memory_stored: boolean;
}

interface ToolContext {
	sessionID: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch GitHub user profile via gh CLI
 */
async function fetchGitHubUser(login: string): Promise<GitHubUser> {
	const result = await Bun.$`gh api users/${login}`.json();
	return GitHubUserSchema.parse(result);
}

/**
 * Format changeset credit line based on available data
 *
 * Hierarchy:
 * 1. Name + Twitter: "Thanks to {Name} ([@twitter](...)) for reporting #{issue}!"
 * 2. Name only: "Thanks to {Name} (@{login} on GitHub) for reporting #{issue}!"
 * 3. Twitter only: "Thanks to [@twitter](...) for reporting #{issue}!"
 * 4. Fallback: "Thanks to @{login} for reporting #{issue}!"
 */
function formatCreditLine(user: GitHubUser, issueNumber?: number): string {
	const issueText = issueNumber ? `reporting #${issueNumber}` : "the report";

	// PREFERRED: Full name + Twitter (best for engagement)
	if (user.name && user.twitter_username) {
		return `Thanks to ${user.name} ([@${user.twitter_username}](https://x.com/${user.twitter_username})) for ${issueText}!`;
	}

	// Twitter only (no name available)
	if (user.twitter_username) {
		return `Thanks to [@${user.twitter_username}](https://x.com/${user.twitter_username}) for ${issueText}!`;
	}

	// Name only (no Twitter)
	if (user.name) {
		return `Thanks to ${user.name} (@${user.login} on GitHub) for ${issueText}!`;
	}

	// Fallback: GitHub username only
	return `Thanks to @${user.login} for ${issueText}!`;
}

/**
 * Store contributor info in semantic-memory
 */
async function storeContributorMemory(
	user: GitHubUser,
	issueNumber?: number,
): Promise<boolean> {
	try {
		const adapter = await getHivemindAdapter();

		const twitterPart = user.twitter_username
			? ` (@${user.twitter_username} on Twitter)`
			: "";
		const issuePart = issueNumber ? `. Filed issue #${issueNumber}` : "";
		const bioPart = user.bio ? `. Bio: '${user.bio}'` : "";

		const tags = [
			"contributor",
			user.login,
			issueNumber ? `issue-${issueNumber}` : null,
		]
			.filter(Boolean)
			.join(",");

		const information = `Contributor @${user.login}: ${user.name || user.login}${twitterPart}${issuePart}${bioPart}`;

		await adapter.store({
			information,
			tags,
		});

		return true;
	} catch (error) {
		console.error("Failed to store contributor memory:", error);
		return false;
	}
}

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Reset cache for testing
 */
export function resetContributorCache(): void {
	// Currently no cache, but keeping this for consistency with other tools
}

// ============================================================================
// Plugin Tools
// ============================================================================

/**
 * Look up GitHub contributor and generate changeset credit
 */
export const contributor_lookup = tool({
	description:
		"Fetch GitHub contributor profile and generate formatted changeset credit. Automatically stores contributor info in semantic-memory. Returns login, name, twitter, bio, and ready-to-paste credit_line.",
	args: {
		login: tool.schema.string().describe("GitHub username (required)"),
		issue: tool.schema
			.number()
			.optional()
			.describe("Issue number for context (optional)"),
	},
	async execute(
		args: { login: string; issue?: number },
		_ctx: ToolContext,
	): Promise<string> {
		try {
			// Fetch GitHub profile
			const user = await fetchGitHubUser(args.login);

			// Format credit line
			const creditLine = formatCreditLine(user, args.issue);

			// Store in semantic-memory
			const memoryStored = await storeContributorMemory(user, args.issue);

			// Build result
			const result: ContributorResult = {
				login: user.login,
				name: user.name,
				twitter: user.twitter_username,
				bio: user.bio,
				credit_line: creditLine,
				memory_stored: memoryStored,
			};

			return JSON.stringify(result, null, 2);
		} catch (error) {
			if (error instanceof Error) {
				return JSON.stringify({
					error: error.message,
					login: args.login,
				});
			}
			return JSON.stringify({
				error: "Unknown error fetching contributor",
				login: args.login,
			});
		}
	},
});

// ============================================================================
// Exports
// ============================================================================

export const contributorTools = {
	contributor_lookup,
} as const;
