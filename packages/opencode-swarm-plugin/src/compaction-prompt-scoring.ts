/**
 * Compaction Prompt Quality Scoring - Pure Functions
 *
 * Evaluates the quality of continuation prompts generated after context compaction.
 * **Problem**: Post-compaction coordinators often "wake up" confused, forget their role,
 * and start editing files instead of checking worker status.
 *
 * **Solution**: Score prompts on 5 dimensions that predict coordinator success:
 *
 * 1. **Epic ID Specificity (0.20)**: Real IDs (`mjkw...`) not placeholders (`<epic-id>`, `bd-xxx`)
 *    - Placeholders = coordinator can't check actual swarm status
 *
 * 2. **Actionability (0.20)**: Tool calls with real values (e.g., `swarm_status(epic_id='mjkw81rkq4c')`)
 *    - Generic instructions like "check status" don't work
 *
 * 3. **Coordinator Identity (0.25)**: ASCII header + strong mandates (NEVER/ALWAYS)
 *    - Visual + semantic cues reinforce role post-compaction
 *
 * 4. **Forbidden Tools Listed (0.15)**: Explicitly lists Edit, Write, swarmmail_reserve, git commit
 *    - Naming forbidden tools reduces violations
 *
 * 5. **Post-Compaction Discipline (0.20)**: First suggested tool is swarm_status or inbox (not Edit)
 *    - First tool sets the pattern - "check status" vs "dive into code"
 *
 * **Pure functions**: These can be tested without evalite. The evalite wrappers are in
 * `evals/scorers/compaction-prompt-scorers.ts`.
 *
 * **Data source**: Captured from `captureCompactionEvent()` with `compaction_type: "prompt_generated"`.
 * The payload includes the FULL prompt content (not truncated) for scoring.
 *
 * **Integration**: `compaction-prompt.eval.ts` uses these scorers to track prompt quality over time.
 * Progressive gates enforce quality: bootstrap → stabilization → production.
 *
 * @module compaction-prompt-scoring
 */

/**
 * Compaction prompt structure (from LLM generation)
 */
export interface CompactionPrompt {
	content: string;
}

/**
 * Scorer result type
 */
export interface ScorerResult {
	score: number;
	message: string;
}

// ====== Shared Regex Patterns ======

/** Matches real epic/cell IDs (mjkw prefix + 7+ base36 chars) */
export const REAL_EPIC_ID = /mjkw[a-z0-9]{7,}/;

/** Matches common placeholder patterns */
export const PLACEHOLDERS = [
	/<epic-id>/i,
	/bd-xxx/,
	/<path>/i,
	/<project>/i,
];

/** Matches ASCII box-drawing characters (for headers) */
export const ASCII_BOX = /[┌┐└┘─│]{3,}/;

/** Matches strong mandate language */
export const STRONG_LANGUAGE = [/\bNEVER\b/, /\bALWAYS\b/, /\bNON-NEGOTIABLE\b/];

// ====== Pure Scoring Functions ======

/**
 * Score epic ID specificity
 *
 * Validates that epic IDs are REAL, not placeholders.
 * Placeholders like <epic-id>, bd-xxx, <path> indicate
 * the prompt generator failed to inject actual values.
 *
 * @returns 1.0 if real IDs, 0.0 if placeholders found
 */
export function scoreEpicIdSpecificity(prompt: CompactionPrompt): ScorerResult {
	// Check for placeholder patterns
	for (const pattern of PLACEHOLDERS) {
		if (pattern.test(prompt.content)) {
			return {
				score: 0.0,
				message: `Found placeholder: ${pattern.source}`,
			};
		}
	}

	// Check for real epic ID pattern
	if (REAL_EPIC_ID.test(prompt.content)) {
		return {
			score: 1.0,
			message: "Contains real epic ID",
		};
	}

	return {
		score: 0.0,
		message: "No epic ID found",
	};
}

/**
 * Score actionability of tool calls
 *
 * Validates that the prompt includes SPECIFIC actionable tool calls.
 * Generic instructions like "check status" are useless.
 * Good: swarm_status(epic_id='mjkw81rkq4c', project_key='/path')
 * Bad: "Check the status of workers"
 *
 * @returns 1.0 if actionable tool calls with real values, 0.0 otherwise
 */
export function scoreActionability(prompt: CompactionPrompt): ScorerResult {
	// Check for actionable tool patterns
	const actionableTools = [
		/swarm_status\([^)]*epic_id\s*=\s*['"]mjkw[a-z0-9]{7,}['"]/,
		/swarmmail_inbox\(\)/,
	];

	for (const pattern of actionableTools) {
		if (pattern.test(prompt.content)) {
			return {
				score: 1.0,
				message: "Contains actionable tool call with real values",
			};
		}
	}

	// Check if tool is mentioned but with placeholders
	if (
		/swarm_status\([^)]*<epic-id>/.test(prompt.content) ||
		/swarm_status\([^)]*<path>/.test(prompt.content)
	) {
		return {
			score: 0.0,
			message: "Tool call has placeholders",
		};
	}

	return {
		score: 0.0,
		message: "No actionable tool calls found",
	};
}

/**
 * Score coordinator identity reinforcement
 *
 * Validates that the prompt has STRONG coordinator identity reinforcement.
 * Post-compaction coordinators lose their identity without visual+semantic cues.
 *
 * Checks:
 * 1. ASCII box header (visual anchor)
 * 2. Strong language (NEVER/ALWAYS, not "should"/"consider")
 *
 * @returns 1.0 for ASCII header + strong mandates, 0.5 for header only, 0.0 otherwise
 */
export function scoreCoordinatorIdentity(
	prompt: CompactionPrompt,
): ScorerResult {
	// Check for ASCII box header (uses box-drawing characters)
	const hasAsciiHeader =
		ASCII_BOX.test(prompt.content) &&
		/(YOU ARE THE COORDINATOR|COORDINATOR MODE)/i.test(prompt.content);

	if (!hasAsciiHeader) {
		return {
			score: 0.0,
			message: "No ASCII header found",
		};
	}

	// Check for strong mandate language
	const hasStrongLanguage = STRONG_LANGUAGE.some((pattern) =>
		pattern.test(prompt.content),
	);

	if (!hasStrongLanguage) {
		return {
			score: 0.5,
			message: "ASCII header present but weak language",
		};
	}

	return {
		score: 1.0,
		message: "ASCII header + strong mandates present",
	};
}

/**
 * Score forbidden tools listing
 *
 * Validates that the prompt LISTS forbidden tools by name.
 * Coordinators must know exactly which tools to avoid.
 *
 * Required forbidden tools:
 * 1. Edit
 * 2. Write
 * 3. swarmmail_reserve (only workers reserve)
 * 4. git commit (workers commit)
 *
 * @returns ratio of forbidden tools mentioned (0.0 to 1.0)
 */
export function scoreForbiddenToolsPresent(
	prompt: CompactionPrompt,
): ScorerResult {
	// Check for forbidden tool mentions
	const forbiddenTools = [
		/\bEdit\b/,
		/\bWrite\b/,
		/swarmmail_reserve/,
		/git commit/,
	];

	const foundTools = forbiddenTools.filter((pattern) =>
		pattern.test(prompt.content),
	);

	const score = foundTools.length / forbiddenTools.length;

	if (score === 1.0) {
		return {
			score: 1.0,
			message: "All 4 forbidden tools listed",
		};
	}

	if (score === 0) {
		return {
			score: 0.0,
			message: "No forbidden tools listed (0/4)",
		};
	}

	return {
		score,
		message: `${foundTools.length}/4 forbidden tools listed`,
	};
}

/**
 * Score post-compaction discipline (first tool correctness)
 *
 * Validates that the FIRST suggested tool is correct.
 * Coordinators should check status FIRST, not edit files.
 *
 * Good first tools:
 * - swarm_status
 * - swarmmail_inbox
 *
 * Bad first tools:
 * - Edit
 * - Write
 * - Read (should check status first)
 *
 * @returns 1.0 if first tool is swarm_status or inbox, 0.0 otherwise
 */
export function scorePostCompactionDiscipline(
	prompt: CompactionPrompt,
): ScorerResult {
	// Extract first tool call (look for function-like patterns)
	const toolCallPattern =
		/\b(swarm_status|swarmmail_inbox|Edit|Write|Read)\b/i;
	const match = prompt.content.match(toolCallPattern);

	if (!match) {
		return {
			score: 0.0,
			message: "No tool calls found",
		};
	}

	const firstTool = match[1].toLowerCase();

	if (firstTool === "swarm_status") {
		return {
			score: 1.0,
			message: "First tool is swarm_status (correct)",
		};
	}

	if (firstTool === "swarmmail_inbox") {
		return {
			score: 1.0,
			message: "First tool is inbox (correct)",
		};
	}

	return {
		score: 0.0,
		message: `First tool is ${match[1]} (should be swarm_status or inbox)`,
	};
}
