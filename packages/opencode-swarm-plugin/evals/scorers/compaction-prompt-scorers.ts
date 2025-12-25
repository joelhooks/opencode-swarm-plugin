/**
 * Compaction Prompt Quality Scorers - Evalite Wrappers
 *
 * These wrap the pure scoring functions from src/compaction-prompt-scoring.ts
 * for use with evalite's test runner.
 *
 * Weighted scoring:
 * - epicIdSpecificity (0.20) - real IDs not placeholders
 * - actionability (0.20) - swarm_status/inbox with real values
 * - coordinatorIdentity (0.25) - ASCII header + strong mandates
 * - forbiddenToolsPresent (0.15) - lists forbidden tools by name
 * - postCompactionDiscipline (0.20) - first tool correct, no edit/write
 */

import { createScorer } from "evalite";
import type { CompactionPrompt } from "../../src/compaction-prompt-scoring.js";
import {
	scoreActionability,
	scoreCoordinatorIdentity,
	scoreEpicIdSpecificity,
	scoreForbiddenToolsPresent,
	scorePostCompactionDiscipline,
} from "../../src/compaction-prompt-scoring.js";

// Re-export types for convenience
export type { CompactionPrompt, ScorerResult } from "../../src/compaction-prompt-scoring.js";

// Re-export pure functions for direct use
export {
	scoreActionability,
	scoreCoordinatorIdentity,
	scoreEpicIdSpecificity,
	scoreForbiddenToolsPresent,
	scorePostCompactionDiscipline,
} from "../../src/compaction-prompt-scoring.js";

/**
 * Epic ID Specificity Scorer
 *
 * Validates that epic IDs are REAL, not placeholders.
 * Score: 1.0 if real IDs, 0.0 if placeholders found
 */
export const epicIdSpecificity = createScorer({
	name: "Epic ID Specificity",
	description: "Prompt uses real epic IDs, not placeholders",
	scorer: ({ output }) => {
		try {
			const prompt = JSON.parse(String(output)) as CompactionPrompt;
			return scoreEpicIdSpecificity(prompt);
		} catch (error) {
			return {
				score: 0,
				message: `Failed to parse prompt: ${error}`,
			};
		}
	},
});

/**
 * Actionability Scorer
 *
 * Validates that the prompt includes SPECIFIC actionable tool calls.
 * Score: 1.0 if actionable tool calls with real values, 0.0 otherwise
 */
export const actionability = createScorer({
	name: "Actionability",
	description: "Prompt includes specific tool calls with real values",
	scorer: ({ output }) => {
		try {
			const prompt = JSON.parse(String(output)) as CompactionPrompt;
			return scoreActionability(prompt);
		} catch (error) {
			return {
				score: 0,
				message: `Failed to parse prompt: ${error}`,
			};
		}
	},
});

/**
 * Coordinator Identity Scorer
 *
 * Validates that the prompt has STRONG coordinator identity reinforcement.
 * Score: 1.0 for ASCII header + strong mandates, 0.5 for header only, 0.0 otherwise
 */
export const coordinatorIdentity = createScorer({
	name: "Coordinator Identity",
	description: "Prompt has ASCII header and strong mandates",
	scorer: ({ output }) => {
		try {
			const prompt = JSON.parse(String(output)) as CompactionPrompt;
			return scoreCoordinatorIdentity(prompt);
		} catch (error) {
			return {
				score: 0,
				message: `Failed to parse prompt: ${error}`,
			};
		}
	},
});

/**
 * Forbidden Tools Present Scorer
 *
 * Validates that the prompt LISTS forbidden tools by name.
 * Score: ratio of forbidden tools mentioned (0.0 to 1.0)
 */
export const forbiddenToolsPresent = createScorer({
	name: "Forbidden Tools Present",
	description: "Prompt lists forbidden tools by name",
	scorer: ({ output }) => {
		try {
			const prompt = JSON.parse(String(output)) as CompactionPrompt;
			return scoreForbiddenToolsPresent(prompt);
		} catch (error) {
			return {
				score: 0,
				message: `Failed to parse prompt: ${error}`,
			};
		}
	},
});

/**
 * Post-Compaction Discipline Scorer
 *
 * Validates that the FIRST suggested tool is correct.
 * Score: 1.0 if first tool is swarm_status or inbox, 0.0 otherwise
 */
export const postCompactionDiscipline = createScorer({
	name: "Post-Compaction Discipline",
	description: "First suggested tool is swarm_status or inbox",
	scorer: ({ output }) => {
		try {
			const prompt = JSON.parse(String(output)) as CompactionPrompt;
			return scorePostCompactionDiscipline(prompt);
		} catch (error) {
			return {
				score: 0,
				message: `Failed to parse prompt: ${error}`,
			};
		}
	},
});
