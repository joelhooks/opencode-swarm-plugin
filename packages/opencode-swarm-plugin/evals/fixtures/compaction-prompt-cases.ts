/**
 * Test cases for compaction prompt quality evaluation
 *
 * Each case represents a continuation prompt that should be generated
 * after context compaction. Tests validate that prompts have:
 * - Real epic IDs (not placeholders)
 * - Actionable tool calls with specific values
 * - Strong coordinator identity
 * - Explicit forbidden tools list
 * - Correct first tool suggestion
 */

import type { CompactionPrompt } from "../../src/compaction-prompt-scoring.js";

/**
 * Compaction prompt test case structure
 */
export interface CompactionPromptTestCase {
	name: string;
	description: string;
	/**
	 * The generated continuation prompt
	 */
	prompt: CompactionPrompt;
	/**
	 * Expected scoring outcomes
	 */
	expected: {
		/**
		 * Should have real epic IDs (not placeholders)
		 */
		hasRealEpicId: boolean;
		/**
		 * Should have actionable tool calls
		 */
		isActionable: boolean;
		/**
		 * Should have strong coordinator identity
		 */
		hasCoordinatorIdentity: boolean;
		/**
		 * Should list forbidden tools by name
		 */
		listsForbiddenTools: boolean;
		/**
		 * First suggested tool should be correct
		 */
		hasCorrectFirstTool: boolean;
	};
}

export const compactionPromptCases: CompactionPromptTestCase[] = [
	// ============================================================================
	// PERFECT PROMPT: All criteria met
	// ============================================================================
	{
		name: "Perfect coordinator resumption prompt",
		description:
			"Ideal continuation prompt with all quality criteria met: real IDs, actionable tools, strong identity, forbidden list, correct first tool",
		prompt: {
			content: `
┌─────────────────────────────────────────────────────────────┐
│                 🐝 COORDINATOR RESUMPTION                   │
│                   Context Compacted                         │
└─────────────────────────────────────────────────────────────┘

You are the COORDINATOR of swarm epic mjkweh2p4u5.

## IMMEDIATE ACTIONS (Do These FIRST)

1. swarm_status(epic_id="mjkweh2p4u5", project_key="/Users/joel/Code/myapp")
2. swarmmail_inbox(limit=5)
3. Review any completed work

## FORBIDDEN TOOLS (NEVER Use These)

Coordinators do NOT edit code directly. These tools are FORBIDDEN:
- edit
- write
- bash (for file modifications)

Use swarm_spawn_subtask to delegate work to workers.

## Your Role

You orchestrate. You do NOT implement. Spawn workers, monitor progress, unblock, ship.

ALWAYS spawn workers for file modifications.
NEVER edit files yourself.
NON-NEGOTIABLE: Check status and inbox before making decisions.
`,
		},
		expected: {
			hasRealEpicId: true,
			isActionable: true,
			hasCoordinatorIdentity: true,
			listsForbiddenTools: true,
			hasCorrectFirstTool: true,
		},
	},

	// ============================================================================
	// BAD PROMPT: Placeholder epic ID
	// ============================================================================
	{
		name: "Prompt with placeholder epic ID",
		description:
			"Contains placeholder <epic-id> instead of real ID - fails specificity check",
		prompt: {
			content: `
## Coordinator Resumption

You are coordinating epic <epic-id>.

Check the status with:
1. swarm_status(epic_id="<epic-id>", project_key="<path>")
2. swarmmail_inbox()

Continue orchestrating the swarm.
`,
		},
		expected: {
			hasRealEpicId: false, // <epic-id> is a placeholder
			isActionable: false, // Has placeholders in tool calls
			hasCoordinatorIdentity: false, // No ASCII header or strong language
			listsForbiddenTools: false, // Doesn't list forbidden tools
			hasCorrectFirstTool: true, // First tool is swarm_status (correct)
		},
	},

	// ============================================================================
	// BAD PROMPT: Generic instructions, no actionable tools
	// ============================================================================
	{
		name: "Generic instructions without specific tools",
		description:
			"Vague language like 'check status' without actual tool calls - fails actionability",
		prompt: {
			content: `
You were coordinating a swarm before compaction.

To resume:
- Check the status of workers
- Read your messages
- Continue where you left off

Remember, you're the coordinator. Keep the work moving forward.
`,
		},
		expected: {
			hasRealEpicId: false, // No epic ID at all
			isActionable: false, // No specific tool calls
			hasCoordinatorIdentity: false, // No strong identity reinforcement
			listsForbiddenTools: false, // No forbidden tools list
			hasCorrectFirstTool: false, // No first tool specified
		},
	},

	// ============================================================================
	// BAD PROMPT: Weak coordinator identity
	// ============================================================================
	{
		name: "Weak coordinator identity",
		description:
			"Has real ID and tools but lacks strong identity reinforcement - fails coordinator identity check",
		prompt: {
			content: `
## Swarm Resumption

Epic ID: mjkweh9x2a1
Project: /Users/joel/Code/myapp

You can check status with:
swarm_status(epic_id="mjkweh9x2a1", project_key="/Users/joel/Code/myapp")

And read messages:
swarmmail_inbox(limit=5)

Please continue coordinating.
`,
		},
		expected: {
			hasRealEpicId: true, // Has real ID
			isActionable: true, // Has specific tool calls
			hasCoordinatorIdentity: false, // No ASCII header, no NEVER/ALWAYS/NON-NEGOTIABLE
			listsForbiddenTools: false, // No forbidden tools list
			hasCorrectFirstTool: true, // First tool is swarm_status
		},
	},

	// ============================================================================
	// BAD PROMPT: Missing forbidden tools list
	// ============================================================================
	{
		name: "Missing forbidden tools list",
		description:
			"Good prompt but doesn't explicitly list forbidden tools - coordinators need this reminder",
		prompt: {
			content: `
┌─────────────────────────────────────────────────────────────┐
│                 🐝 COORDINATOR RESUMPTION                   │
└─────────────────────────────────────────────────────────────┘

You are the COORDINATOR of epic mjkweh3k8p2.

## IMMEDIATE ACTIONS

1. swarm_status(epic_id="mjkweh3k8p2", project_key="/Users/joel/Code/myapp")
2. swarmmail_inbox(limit=5)

## Your Role

ALWAYS delegate to workers.
NEVER edit files directly.

Coordinators orchestrate, workers implement.
`,
		},
		expected: {
			hasRealEpicId: true,
			isActionable: true,
			hasCoordinatorIdentity: true, // Has ASCII + NEVER/ALWAYS
			listsForbiddenTools: false, // Doesn't list "edit", "write", "bash" by name
			hasCorrectFirstTool: true,
		},
	},

	// ============================================================================
	// BAD PROMPT: Wrong first tool (edit instead of swarm_status)
	// ============================================================================
	{
		name: "Wrong first tool suggestion",
		description:
			"Suggests edit/write as first action - coordinator discipline failure",
		prompt: {
			content: `
┌─────────────────────────────────────────────────────────────┐
│                 🐝 COORDINATOR RESUMPTION                   │
└─────────────────────────────────────────────────────────────┘

You are the COORDINATOR of epic mjkweh7q9n4.

## IMMEDIATE ACTIONS

1. edit(filePath="/src/app.ts", oldString="...", newString="...")
2. swarm_status(epic_id="mjkweh7q9n4", project_key="/Users/joel/Code/myapp")

## FORBIDDEN TOOLS
- edit
- write
- bash (for file mods)

NEVER edit files yourself.
ALWAYS delegate to workers.
`,
		},
		expected: {
			hasRealEpicId: true,
			isActionable: true,
			hasCoordinatorIdentity: true,
			listsForbiddenTools: true,
			hasCorrectFirstTool: false, // First tool is edit, should be swarm_status/inbox
		},
	},

	// ============================================================================
	// EDGE CASE: Multiple epics mentioned
	// ============================================================================
	{
		name: "Multiple epic IDs in prompt",
		description:
			"Prompt references multiple epics - should still pass if at least one is real",
		prompt: {
			content: `
┌─────────────────────────────────────────────────────────────┐
│                 🐝 COORDINATOR RESUMPTION                   │
└─────────────────────────────────────────────────────────────┘

You are coordinating epics:
- mjkweh5t2x8 (in progress)
- mjkweh6u3y9 (blocked)

## IMMEDIATE ACTIONS

1. swarm_status(epic_id="mjkweh5t2x8", project_key="/Users/joel/Code/myapp")
2. swarmmail_inbox(limit=5)

## FORBIDDEN TOOLS
- edit
- write  
- bash

ALWAYS check status first.
NEVER edit files directly.
`,
		},
		expected: {
			hasRealEpicId: true, // Has real IDs
			isActionable: true,
			hasCoordinatorIdentity: true,
			listsForbiddenTools: true,
			hasCorrectFirstTool: true,
		},
	},
];
