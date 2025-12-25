/**
 * Tests for compaction prompt quality scorers
 *
 * TDD approach - tests written FIRST to define scorer behavior
 * Tests the PURE scoring functions (not evalite wrappers)
 */

import { describe, expect, test } from "bun:test";
import type { CompactionPrompt } from "./compaction-prompt-scoring.js";
import {
	scoreActionability,
	scoreCoordinatorIdentity,
	scoreEpicIdSpecificity,
	scoreForbiddenToolsPresent,
	scorePostCompactionDiscipline,
} from "./compaction-prompt-scoring.js";

describe("epicIdSpecificity scorer", () => {
	test("scores 1.0 for real epic IDs", () => {
		const prompt: CompactionPrompt = {
			content: "Continue coordinating epic mjkw81rkq4c",
		};

		const result = scoreEpicIdSpecificity(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("real epic ID");
	});

	test("scores 0.0 for placeholder IDs like <epic-id>", () => {
		const prompt: CompactionPrompt = {
			content: "Continue coordinating epic <epic-id>",
		};

		const result = scoreEpicIdSpecificity(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("placeholder");
	});

	test("scores 0.0 for bd-xxx placeholders", () => {
		const prompt: CompactionPrompt = {
			content: "Check status of bd-xxx",
		};

		const result = scoreEpicIdSpecificity(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("placeholder");
	});

	test("scores 0.0 for generic <path> placeholders", () => {
		const prompt: CompactionPrompt = {
			content: "Project at <path>",
		};

		const result = scoreEpicIdSpecificity(prompt);

		expect(result.score).toBe(0.0);
	});

	test("scores 0.0 when no epic ID found", () => {
		const prompt: CompactionPrompt = {
			content: "Continue working on the task",
		};

		const result = scoreEpicIdSpecificity(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("No epic ID");
	});
});

describe("actionability scorer", () => {
	test("scores 1.0 when swarm_status has real epic ID", () => {
		const prompt: CompactionPrompt = {
			content: `First action:
swarm_status(epic_id='mjkw81rkq4c', project_key='/path/to/project')`,
		};

		const result = scoreActionability(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("actionable tool call");
	});

	test("scores 1.0 when swarmmail_inbox is present", () => {
		const prompt: CompactionPrompt = {
			content: `Check messages:
swarmmail_inbox()`,
		};

		const result = scoreActionability(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("actionable tool call");
	});

	test("scores 0.0 for generic instructions without tool calls", () => {
		const prompt: CompactionPrompt = {
			content: "Check the status of workers and review progress",
		};

		const result = scoreActionability(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("No actionable");
	});

	test("scores 0.0 for swarm_status with placeholders", () => {
		const prompt: CompactionPrompt = {
			content: `swarm_status(epic_id='<epic-id>', project_key='<path>')`,
		};

		const result = scoreActionability(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("placeholder");
	});
});

describe("coordinatorIdentity scorer", () => {
	test("scores 1.0 with ASCII header and strong mandates", () => {
		const prompt: CompactionPrompt = {
			content: `┌─────────────────────────────────────────┐
│     YOU ARE THE COORDINATOR             │
│                                         │
│  NEVER spawn workers yourself           │
│  ALWAYS review worker output            │
└─────────────────────────────────────────┘

Continue coordinating the swarm.`,
		};

		const result = scoreCoordinatorIdentity(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("ASCII header");
		expect(result.message).toContain("strong mandates");
	});

	test("scores 0.5 with ASCII header but weak language", () => {
		const prompt: CompactionPrompt = {
			content: `┌─────────────────────────────────────────┐
│     COORDINATOR MODE                    │
└─────────────────────────────────────────┘

You should consider delegating work.`,
		};

		const result = scoreCoordinatorIdentity(prompt);

		expect(result.score).toBe(0.5);
		expect(result.message).toContain("weak language");
	});

	test("scores 0.0 without ASCII header", () => {
		const prompt: CompactionPrompt = {
			content: `You are the coordinator. NEVER do work directly. ALWAYS delegate.`,
		};

		const result = scoreCoordinatorIdentity(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("No ASCII header");
	});
});

describe("forbiddenToolsPresent scorer", () => {
	test("scores 1.0 when all forbidden tools listed", () => {
		const prompt: CompactionPrompt = {
			content: `🚫 FORBIDDEN TOOLS - NEVER call these:
- Edit (use swarm_spawn_subtask)
- Write (use swarm_spawn_subtask)
- swarmmail_reserve (only workers reserve)
- bash with git commit (workers commit)`,
		};

		const result = scoreForbiddenToolsPresent(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("All 4 forbidden tools");
	});

	test("scores 0.75 when 3 out of 4 tools listed", () => {
		const prompt: CompactionPrompt = {
			content: `🚫 FORBIDDEN TOOLS:
- Edit
- Write
- swarmmail_reserve`,
		};

		const result = scoreForbiddenToolsPresent(prompt);

		expect(result.score).toBe(0.75);
		expect(result.message).toContain("3/4");
	});

	test("scores 0.5 when 2 out of 4 tools listed", () => {
		const prompt: CompactionPrompt = {
			content: `Don't use Edit or Write directly.`,
		};

		const result = scoreForbiddenToolsPresent(prompt);

		expect(result.score).toBe(0.5);
		expect(result.message).toContain("2/4");
	});

	test("scores 0.0 when no forbidden tools listed", () => {
		const prompt: CompactionPrompt = {
			content: "Continue coordinating the epic",
		};

		const result = scoreForbiddenToolsPresent(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("0/4");
	});
});

describe("postCompactionDiscipline scorer", () => {
	test("scores 1.0 when first tool is swarm_status", () => {
		const prompt: CompactionPrompt = {
			content: `Resume coordination:

1. swarm_status(epic_id='mjkw81rkq4c')
2. Check inbox
3. Review progress`,
		};

		const result = scorePostCompactionDiscipline(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("swarm_status");
		expect(result.message).toContain("correct");
	});

	test("scores 1.0 when first tool is swarmmail_inbox", () => {
		const prompt: CompactionPrompt = {
			content: `Next steps:
1. swarmmail_inbox()
2. Review messages`,
		};

		const result = scorePostCompactionDiscipline(prompt);

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("inbox");
		expect(result.message).toContain("correct");
	});

	test("scores 0.0 when first tool is Edit", () => {
		const prompt: CompactionPrompt = {
			content: `Resume:
1. Edit(file='src/auth.ts', ...)
2. Check status`,
		};

		const result = scorePostCompactionDiscipline(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("Edit");
	});

	test("scores 0.0 when first tool is Write", () => {
		const prompt: CompactionPrompt = {
			content: `1. Write(file='README.md', ...)`,
		};

		const result = scorePostCompactionDiscipline(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("Write");
	});

	test("scores 0.0 when first tool is Read", () => {
		const prompt: CompactionPrompt = {
			content: `1. Read(file='src/index.ts')
2. swarm_status()`,
		};

		const result = scorePostCompactionDiscipline(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("Read");
	});

	test("scores 0.0 when no tool calls mentioned", () => {
		const prompt: CompactionPrompt = {
			content: "Continue coordinating the epic",
		};

		const result = scorePostCompactionDiscipline(prompt);

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("No tool");
	});
});
