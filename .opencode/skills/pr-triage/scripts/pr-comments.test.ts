import { describe, expect, test } from "bun:test";
import {
	type CommentMetadata,
	extractSeverity,
	hasProposedFix,
	extractProposedFix,
	triage,
	refineTriage,
	templates,
} from "./pr-comments";

describe("extractSeverity", () => {
	test("detects critical severity", () => {
		expect(extractSeverity("🛑 **Critical**: Security issue")).toBe("critical");
	});

	test("detects warning severity", () => {
		expect(extractSeverity("⚠️ **Warning**: Potential bug")).toBe("warning");
	});

	test("detects suggestion severity", () => {
		expect(extractSeverity("💡 **Suggestion**: Consider using")).toBe(
			"suggestion",
		);
	});

	test("defaults to info for unmarked comments", () => {
		expect(extractSeverity("This looks fine")).toBe("info");
	});
});

describe("hasProposedFix", () => {
	test("detects code block with suggestion", () => {
		const body = `💡 **Suggestion**: Use this instead

\`\`\`typescript
const x = 1;
\`\`\``;
		expect(hasProposedFix(body)).toBe(true);
	});

	test("returns false for code block without suggestion keyword", () => {
		const body = `Here's an example:

\`\`\`typescript
const x = 1;
\`\`\``;
		expect(hasProposedFix(body)).toBe(false);
	});

	test("returns false for no code block", () => {
		expect(hasProposedFix("💡 **Suggestion**: Just do it differently")).toBe(
			false,
		);
	});
});

describe("extractProposedFix", () => {
	test("extracts code from fenced block", () => {
		const body = `Some text

\`\`\`typescript
const x = 1;
const y = 2;
\`\`\`

More text`;
		expect(extractProposedFix(body)).toBe("const x = 1;\nconst y = 2;");
	});

	test("returns null when no code block", () => {
		expect(extractProposedFix("No code here")).toBe(null);
	});
});

describe("triage", () => {
	const mockComments: CommentMetadata[] = [
		{
			id: 1,
			path: "src/a.ts",
			line: 10,
			author: "human",
			created: "2025-01-01T00:00:00Z",
			inReplyToId: null,
		},
		{
			id: 2,
			path: "src/b.ts",
			line: 20,
			author: "coderabbitai",
			created: "2025-01-01T00:01:00Z",
			inReplyToId: null,
		},
		{
			id: 3,
			path: "src/b.ts",
			line: 20,
			author: "coderabbitai",
			created: "2025-01-01T00:02:00Z",
			inReplyToId: 2,
		},
	];

	test("marks human comments as needing body", () => {
		const result = triage(mockComments);
		const human = result.find((c) => c.author === "human");
		expect(human?.needsBody).toBe(true);
		expect(human?.isBot).toBe(false);
	});

	test("marks bot root comments as needing body", () => {
		const result = triage(mockComments);
		const botRoot = result.find(
			(c) => c.author === "coderabbitai" && c.inReplyToId === null,
		);
		expect(botRoot?.needsBody).toBe(true);
		expect(botRoot?.isRoot).toBe(true);
	});

	test("marks bot replies as not needing body", () => {
		const result = triage(mockComments);
		const botReply = result.find(
			(c) => c.author === "coderabbitai" && c.inReplyToId !== null,
		);
		expect(botReply?.needsBody).toBe(false);
		expect(botReply?.isRoot).toBe(false);
	});

	test("sorts human comments first", () => {
		const result = triage(mockComments);
		expect(result[0].author).toBe("human");
	});
});

describe("refineTriage", () => {
	const baseComment = {
		id: 1,
		path: "src/a.ts",
		line: 10,
		author: "coderabbitai",
		created: "2025-01-01T00:00:00Z",
		inReplyToId: null,
		severity: "suggestion" as const,
		needsBody: true,
		category: null,
		isBot: true,
		isRoot: true,
	};

	test("refines to fix-with-code for critical", () => {
		const body = "🛑 **Critical**: SQL injection vulnerability";
		const result = refineTriage(baseComment, body);
		expect(result.severity).toBe("critical");
		expect(result.category).toBe("fix-with-code");
	});

	test("refines to fix-with-code for warning with fix", () => {
		const body = `⚠️ **Warning**: Consider this

💡 **Suggestion**:
\`\`\`typescript
const safe = escape(input);
\`\`\``;
		const result = refineTriage(baseComment, body);
		expect(result.severity).toBe("warning");
		expect(result.category).toBe("fix-with-code");
	});

	test("refines to acknowledged for info", () => {
		const body = "📝 **Informational**: This is how it works";
		const result = refineTriage(baseComment, body);
		expect(result.severity).toBe("info");
		expect(result.category).toBe("acknowledged");
	});

	test("sets needsBody to false after refinement", () => {
		const result = refineTriage(baseComment, "Some body");
		expect(result.needsBody).toBe(false);
	});
});

describe("templates", () => {
	test("fixed template with commit", () => {
		expect(templates.fixed("abc123")).toBe("✅ Fixed in abc123");
	});

	test("fixed template with explanation", () => {
		expect(templates.fixed("abc123", "Added null check")).toBe(
			"✅ Fixed in abc123\n\nAdded null check",
		);
	});

	test("wontFix template", () => {
		expect(templates.wontFix("out of scope")).toBe(
			"Thanks for the suggestion! Not applying because out of scope.",
		);
	});

	test("wontFix template with alternative", () => {
		expect(templates.wontFix("style preference", "We use X instead")).toBe(
			"Thanks for the suggestion! Not applying because style preference.\n\nWe use X instead",
		);
	});

	test("tracked template", () => {
		expect(templates.tracked("bd-123")).toContain("bd-123");
		expect(templates.tracked("bd-123")).toContain("Out of scope");
	});

	test("batchAck template", () => {
		const items = [
			{ path: "src/a.ts", line: 10, brief: "Fixed" },
			{ path: "src/b.ts", line: null, brief: "Acknowledged" },
		];
		const result = templates.batchAck(items);
		expect(result).toContain("src/a.ts:10 - Fixed");
		expect(result).toContain("src/b.ts - Acknowledged");
	});
});
