#!/usr/bin/env bun
/**
 * PR Comments SDK - Context-efficient PR comment triage
 *
 * Fetches metadata first (~100 bytes/comment), bodies selectively.
 * Prevents context exhaustion from verbose PR reviews.
 *
 * @example
 * ```bash
 * # List metadata (compact)
 * bun run pr-comments.ts list owner/repo 42
 *
 * # Triage with severity detection
 * bun run pr-comments.ts triage owner/repo 42
 *
 * # Expand single comment body
 * bun run pr-comments.ts expand owner/repo 123456
 *
 * # Reply to comment
 * bun run pr-comments.ts reply owner/repo 42 123456 "✅ Fixed in abc123"
 *
 * # Summary by file
 * bun run pr-comments.ts summary owner/repo 42
 * ```
 */

import { z } from "zod";

// ============================================================================
// Schemas
// ============================================================================

/** Compact comment metadata (~100 bytes vs ~5KB with body) */
export const CommentMetadataSchema = z.object({
	id: z.number(),
	path: z.string(),
	line: z.number().nullable(),
	author: z.string(),
	created: z.string(),
	inReplyToId: z.number().nullable(),
});
export type CommentMetadata = z.infer<typeof CommentMetadataSchema>;

/** Full comment with body (fetch selectively) */
export const CommentFullSchema = CommentMetadataSchema.extend({
	body: z.string(),
	diffHunk: z.string().optional(),
});
export type CommentFull = z.infer<typeof CommentFullSchema>;

/** CodeRabbit severity levels */
export const SeveritySchema = z.enum([
	"critical",
	"warning",
	"suggestion",
	"info",
]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Triage categories */
export const TriageCategorySchema = z.enum([
	"fix-with-code",
	"wont-fix",
	"tracked-in-cell",
	"acknowledged",
]);
export type TriageCategory = z.infer<typeof TriageCategorySchema>;

/** Comment with triage info */
export const TriagedCommentSchema = CommentMetadataSchema.extend({
	severity: SeveritySchema,
	needsBody: z.boolean(),
	category: TriageCategorySchema.nullable(),
	isBot: z.boolean(),
	isRoot: z.boolean(),
});
export type TriagedComment = z.infer<typeof TriagedCommentSchema>;

/** Per-file summary */
export const FileSummarySchema = z.object({
	file: z.string(),
	count: z.number(),
	authors: z.array(z.string()),
	hasHuman: z.boolean(),
});
export type FileSummary = z.infer<typeof FileSummarySchema>;

// ============================================================================
// gh CLI wrapper
// ============================================================================

async function gh<T>(
	args: string[],
	schema?: z.ZodSchema<T>,
): Promise<T | string> {
	const proc = Bun.spawn(["gh", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`gh failed: ${stderr}`);
	}

	if (!schema) return stdout.trim();

	try {
		const parsed = JSON.parse(stdout);
		return schema.parse(parsed);
	} catch {
		throw new Error(`Failed to parse gh output: ${stdout.slice(0, 200)}`);
	}
}

function parseRepo(repo: string): { owner: string; name: string } {
	const [owner, name] = repo.split("/");
	if (!owner || !name) throw new Error(`Invalid repo format: ${repo}`);
	return { owner, name };
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch comment metadata only (compact, ~100 bytes/comment)
 * Use this for initial triage - avoids loading full bodies
 */
export async function fetchMetadata(
	repo: string,
	pr: number,
): Promise<CommentMetadata[]> {
	const { owner, name } = parseRepo(repo);

	const jq = `.[] | {
    id,
    path,
    line: (.line // .original_line),
    author: .user.login,
    created: .created_at,
    inReplyToId: .in_reply_to_id
  }`;

	const result = await gh([
		"api",
		`repos/${owner}/${name}/pulls/${pr}/comments`,
		"--jq",
		`[${jq}]`,
	]);

	const parsed = JSON.parse(result as string);
	return z.array(CommentMetadataSchema).parse(parsed);
}

/**
 * Fetch single comment with full body
 * Use selectively after triage identifies actionable comments
 */
export async function fetchBody(
	repo: string,
	commentId: number,
): Promise<CommentFull> {
	const { owner, name } = parseRepo(repo);

	const jq = `{
    id,
    path,
    line: (.line // .original_line),
    author: .user.login,
    created: .created_at,
    inReplyToId: .in_reply_to_id,
    body,
    diffHunk: .diff_hunk
  }`;

	const result = await gh([
		"api",
		`repos/${owner}/${name}/pulls/comments/${commentId}`,
		"--jq",
		jq,
	]);

	const parsed = JSON.parse(result as string);
	return CommentFullSchema.parse(parsed);
}

/**
 * Reply to a comment
 * Uses in_reply_to (not in_reply_to_id) per gh API quirk
 */
export async function reply(
	repo: string,
	pr: number,
	commentId: number,
	body: string,
): Promise<{ id: number; url: string }> {
	const { owner, name } = parseRepo(repo);

	const result = await gh([
		"api",
		`repos/${owner}/${name}/pulls/${pr}/comments`,
		"--method",
		"POST",
		"-F",
		`body=${body}`,
		"-F",
		`in_reply_to=${commentId}`,
		"--jq",
		"{id, url: .html_url}",
	]);

	const parsed = JSON.parse(result as string);
	return z.object({ id: z.number(), url: z.string() }).parse(parsed);
}

/**
 * Get file-level summary of comments
 */
export async function summarizeByFile(
	repo: string,
	pr: number,
): Promise<FileSummary[]> {
	const { owner, name } = parseRepo(repo);

	const jq = `group_by(.path) | map({
    file: .[0].path,
    count: length,
    authors: [.[].user.login] | unique,
    hasHuman: ([.[].user.login] | map(select(. != "coderabbitai" and . != "github-actions[bot]")) | length > 0)
  })`;

	const result = await gh([
		"api",
		`repos/${owner}/${name}/pulls/${pr}/comments`,
		"--jq",
		jq,
	]);

	const parsed = JSON.parse(result as string);
	return z.array(FileSummarySchema).parse(parsed);
}

// ============================================================================
// Triage Helpers
// ============================================================================

const BOT_AUTHORS = ["coderabbitai", "github-actions[bot]", "dependabot[bot]"];

/**
 * Extract CodeRabbit severity from comment body
 */
export function extractSeverity(body: string): Severity {
	if (/🛑\s*\*\*Critical\*\*/i.test(body)) return "critical";
	if (/⚠️\s*\*\*Warning\*\*/i.test(body)) return "warning";
	if (/💡\s*\*\*Suggestion\*\*/i.test(body)) return "suggestion";
	return "info";
}

/**
 * Check if comment has a proposed code fix
 */
export function hasProposedFix(body: string): boolean {
	return /```\w+\n[\s\S]+?\n```/.test(body) && /suggestion/i.test(body);
}

/**
 * Extract proposed code from fenced block
 */
export function extractProposedFix(body: string): string | null {
	const match = body.match(/```\w+\n([\s\S]+?)\n```/);
	return match?.[1] ?? null;
}

/**
 * Smart triage of comments without fetching bodies
 * Returns comments sorted by priority with needsBody flag
 */
export function triage(comments: CommentMetadata[]): TriagedComment[] {
	return comments
		.map((c) => {
			const isBot = BOT_AUTHORS.includes(c.author);
			const isRoot = c.inReplyToId === null;

			// Heuristic: human comments always need body, bot root comments maybe
			const needsBody = !isBot || isRoot;

			// Default severity (refined after body fetch)
			const severity: Severity = isBot ? "suggestion" : "warning";

			return {
				...c,
				severity,
				needsBody,
				category: null,
				isBot,
				isRoot,
			};
		})
		.sort((a, b) => {
			// Priority: human > bot root > bot reply
			if (!a.isBot && b.isBot) return -1;
			if (a.isBot && !b.isBot) return 1;
			if (a.isRoot && !b.isRoot) return -1;
			if (!a.isRoot && b.isRoot) return 1;
			return 0;
		});
}

/**
 * Refine triage after fetching body
 */
export function refineTriage(
	comment: TriagedComment,
	body: string,
): TriagedComment {
	const severity = extractSeverity(body);
	const hasFix = hasProposedFix(body);

	// Determine category based on severity and content
	let category: TriageCategory | null = null;
	if (severity === "critical" || (severity === "warning" && hasFix)) {
		category = "fix-with-code";
	} else if (severity === "info") {
		category = "acknowledged";
	}

	return {
		...comment,
		severity,
		category,
		needsBody: false, // Already fetched
	};
}

// ============================================================================
// Response Templates
// ============================================================================

export const templates = {
	fixed: (commitSha: string, explanation?: string) =>
		`✅ Fixed in ${commitSha}${explanation ? `\n\n${explanation}` : ""}`,

	wontFix: (reason: string, alternative?: string) =>
		`Thanks for the suggestion! Not applying because ${reason}.${alternative ? `\n\n${alternative}` : ""}`,

	tracked: (cellId: string) =>
		`Good catch! Tracked in ${cellId}.\n\nOut of scope for this PR but we'll address it separately.`,

	batchAck: (items: Array<{ path: string; line: number | null; brief: string }>) =>
		`🙏 Thanks for the review! Addressed:\n${items.map((i) => `- ✅ ${i.path}${i.line ? `:${i.line}` : ""} - ${i.brief}`).join("\n")}`,
};

// ============================================================================
// CLI
// ============================================================================

async function main() {
	const [command, ...args] = process.argv.slice(2);

	switch (command) {
		case "list": {
			const [repo, pr] = args;
			if (!repo || !pr) {
				console.error("Usage: pr-comments.ts list <owner/repo> <pr>");
				process.exit(1);
			}
			const comments = await fetchMetadata(repo, Number(pr));
			console.log(JSON.stringify(comments, null, 2));
			break;
		}

		case "triage": {
			const [repo, pr] = args;
			if (!repo || !pr) {
				console.error("Usage: pr-comments.ts triage <owner/repo> <pr>");
				process.exit(1);
			}
			const comments = await fetchMetadata(repo, Number(pr));
			const triaged = triage(comments);
			console.log(JSON.stringify(triaged, null, 2));
			break;
		}

		case "expand": {
			const [repo, commentId] = args;
			if (!repo || !commentId) {
				console.error("Usage: pr-comments.ts expand <owner/repo> <comment_id>");
				process.exit(1);
			}
			const comment = await fetchBody(repo, Number(commentId));
			console.log(JSON.stringify(comment, null, 2));
			break;
		}

		case "reply": {
			const [repo, pr, commentId, body] = args;
			if (!repo || !pr || !commentId || !body) {
				console.error(
					'Usage: pr-comments.ts reply <owner/repo> <pr> <comment_id> "<body>"',
				);
				process.exit(1);
			}
			const result = await reply(repo, Number(pr), Number(commentId), body);
			console.log(JSON.stringify(result, null, 2));
			break;
		}

		case "summary": {
			const [repo, pr] = args;
			if (!repo || !pr) {
				console.error("Usage: pr-comments.ts summary <owner/repo> <pr>");
				process.exit(1);
			}
			const summary = await summarizeByFile(repo, Number(pr));
			console.log(JSON.stringify(summary, null, 2));
			break;
		}

		default:
			console.log(`PR Comments SDK - Context-efficient PR comment triage

Commands:
  list <owner/repo> <pr>              List comment metadata (compact)
  triage <owner/repo> <pr>            Smart triage with priority sorting
  expand <owner/repo> <comment_id>    Fetch single comment body
  reply <owner/repo> <pr> <id> <body> Reply to a comment
  summary <owner/repo> <pr>           File-level summary

Examples:
  bun run pr-comments.ts list joelhooks/opencode-swarm-plugin 54
  bun run pr-comments.ts triage joelhooks/opencode-swarm-plugin 54
  bun run pr-comments.ts expand joelhooks/opencode-swarm-plugin 123456
  bun run pr-comments.ts reply joelhooks/opencode-swarm-plugin 54 123456 "✅ Fixed"
`);
	}
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
