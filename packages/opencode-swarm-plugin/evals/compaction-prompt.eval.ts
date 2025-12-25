/**
 * Compaction Prompt Quality Evaluation
 *
 * Tests that continuation prompts generated after context compaction meet
 * quality criteria for coordinator resumption:
 *
 * 1. Epic ID Specificity (20%) - Real IDs not placeholders
 * 2. Actionability (20%) - Specific tool calls with real values
 * 3. Coordinator Identity (25%) - ASCII header + strong mandates
 * 4. Forbidden Tools (15%) - Lists forbidden tools by name
 * 5. Post-Compaction Discipline (20%) - First tool is correct
 *
 * ## Why This Matters
 *
 * After compaction, coordinators lose context. The continuation prompt is
 * their ONLY guide to resume. Bad prompts cause:
 * - Coordinators editing files (should delegate to workers)
 * - Generic "check status" instead of actual tool calls
 * - Lost epic IDs (can't resume coordination)
 *
 * ## Test Strategy
 *
 * - 6 synthetic fixtures covering perfect/bad prompts
 * - Each fixture tests specific failure modes
 * - Composite scorer validates overall quality
 *
 * Run with: bun run eval:compaction
 */

import { evalite } from "evalite";
import { compactionPromptCases } from "./fixtures/compaction-prompt-cases.js";
import {
	actionability,
	coordinatorIdentity,
	epicIdSpecificity,
	forbiddenToolsPresent,
	postCompactionDiscipline,
} from "./scorers/compaction-prompt-scorers.js";

/**
 * Main eval: Compaction Prompt Quality
 *
 * Tests all cases from fixtures/compaction-prompt-cases.ts
 */
evalite("Compaction Prompt Quality", {
	data: async () =>
		compactionPromptCases.map((testCase) => ({
			input: testCase.prompt,
			expected: testCase.expected,
		})),

	task: async (input) => {
		// Identity task - fixture already has the prompt
		// In real usage, this would call the LLM to generate the prompt
		return JSON.stringify(input);
	},

	scorers: [
		epicIdSpecificity,
		actionability,
		coordinatorIdentity,
		forbiddenToolsPresent,
		postCompactionDiscipline,
	],
});

/**
 * Perfect Prompt Verification
 *
 * Ensures our "perfect" fixture actually scores 100%
 */
evalite("Perfect Prompt Scores 100%", {
	data: async () => [
		{
			input: compactionPromptCases[0].prompt, // First case is "perfect"
			expected: {
				hasRealEpicId: true,
				isActionable: true,
				hasCoordinatorIdentity: true,
				listsForbiddenTools: true,
				hasCorrectFirstTool: true,
			},
		},
	],

	task: async (input) => JSON.stringify(input),

	scorers: [
		epicIdSpecificity,
		actionability,
		coordinatorIdentity,
		forbiddenToolsPresent,
		postCompactionDiscipline,
	],
});

/**
 * Placeholder Detection
 *
 * Ensures we catch common placeholder patterns
 */
evalite("Placeholder Detection", {
	data: async () => [
		{
			input: compactionPromptCases[1].prompt, // Placeholder case
			expected: { hasRealEpicId: false },
		},
	],

	task: async (input) => JSON.stringify(input),

	scorers: [epicIdSpecificity],
});

/**
 * Generic Instructions Detection
 *
 * Ensures we fail prompts with vague language instead of tool calls
 */
evalite("Generic Instructions Fail", {
	data: async () => [
		{
			input: compactionPromptCases[2].prompt, // Generic case
			expected: { isActionable: false },
		},
	],

	task: async (input) => JSON.stringify(input),

	scorers: [actionability],
});

/**
 * First Tool Discipline
 *
 * Ensures first suggested tool is correct (swarm_status/inbox, not edit)
 */
evalite("First Tool Discipline", {
	data: async () => [
		{
			input: compactionPromptCases[5].prompt, // Wrong first tool
			expected: { hasCorrectFirstTool: false },
		},
	],

	task: async (input) => JSON.stringify(input),

	scorers: [postCompactionDiscipline],
});
