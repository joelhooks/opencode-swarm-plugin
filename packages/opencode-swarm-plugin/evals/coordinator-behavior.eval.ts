/**
 * Coordinator Behavior After Compaction Eval
 *
 * LLM-as-judge eval that tests whether the compaction context actually
 * causes Claude to behave like a coordinator (spawn workers, check status)
 * rather than a worker (run tests, edit files directly).
 *
 * This is the missing piece - we test the CONTEXT CONTENT in unit tests,
 * but we need to test whether the LLM BEHAVES CORRECTLY given that context.
 *
 * Run with: bunx evalite run evals/coordinator-behavior.eval.ts
 */

import { evalite } from "evalite";
import { createScorer } from "evalite";
import { generateText, gateway } from "ai";
import type { GatewayModelId } from "ai";

const MODEL: GatewayModelId = "anthropic/claude-sonnet-4-5";

// ============================================================================
// Test Context: Simulated compaction context injection
// ============================================================================

/**
 * Build the context that would be injected after compaction
 * This mirrors buildDynamicSwarmState() from compaction-hook.ts
 */
function buildTestContext(epicId: string, projectPath: string): string {
  return `## 🐝 Current Swarm State

**Epic:** ${epicId} - Add user authentication
**Subtasks:**
  - 1 closed
  - 1 in_progress
  - 2 open
**Project:** ${projectPath}

## 🎯 YOU ARE THE COORDINATOR

**Primary role:** Orchestrate workers, review their output, unblock dependencies.
**Spawn workers** for implementation tasks - don't do them yourself.

**RESUME STEPS:**
1. Check swarm status: \`swarm_status(epic_id="${epicId}", project_key="${projectPath}")\`
2. Check inbox for worker messages: \`swarmmail_inbox(limit=5)\`
3. For in_progress subtasks: Review worker results with \`swarm_review\`
4. For open subtasks: Spawn workers with \`swarm_spawn_subtask\`
5. For blocked subtasks: Investigate and unblock

## 🐝 SWARM ACTIVE - Keep Cooking

You are the **COORDINATOR** of an active swarm. Context was compacted but the swarm is still running.

**YOUR JOB:** Keep orchestrating. Spawn agents. Monitor progress. Unblock work. Ship it.

### On Resume - IMMEDIATELY

1. \`swarm_status(epic_id="${epicId}", project_key="${projectPath}")\` - Get current state
2. \`swarmmail_inbox(limit=5)\` - Check for agent messages
3. \`swarm_review(project_key, epic_id, task_id, files_touched)\` - Review any completed work
4. **Spawn ready subtasks** - Don't wait, fire them off

**You are not waiting for instructions. You are the coordinator. Coordinate.**`;
}

// ============================================================================
// Scorers
// ============================================================================

/**
 * Scores whether the response mentions coordinator tools
 */
export const mentionsCoordinatorTools = createScorer({
  name: "Mentions Coordinator Tools",
  description: "Response mentions swarm_status, swarmmail_inbox, swarm_spawn_subtask, or swarm_review",
  scorer: ({ output }) => {
    const text = String(output).toLowerCase();
    const coordinatorTools = [
      "swarm_status",
      "swarmmail_inbox", 
      "swarm_spawn_subtask",
      "swarm_review",
      "spawn",
      "worker",
    ];
    
    const found = coordinatorTools.filter(tool => text.includes(tool));
    const score = Math.min(found.length / 3, 1); // Need at least 3 for full score
    
    return {
      score,
      message: found.length > 0 
        ? `Found coordinator patterns: ${found.join(", ")}`
        : "No coordinator patterns found",
    };
  },
});

/**
 * Scores whether the response avoids worker behaviors
 */
export const avoidsWorkerBehaviors = createScorer({
  name: "Avoids Worker Behaviors",
  description: "Response does NOT suggest running tests, editing files, or doing implementation directly",
  scorer: ({ output }) => {
    const text = String(output).toLowerCase();
    const workerPatterns = [
      "bun test",
      "npm test",
      "pnpm test",
      "let me run",
      "i'll run the tests",
      "let me edit",
      "i'll fix",
      "let me implement",
      "i'll write the code",
      "```typescript", // Code blocks suggest implementation
      "```javascript",
    ];
    
    const found = workerPatterns.filter(pattern => text.includes(pattern));
    
    if (found.length === 0) {
      return {
        score: 1,
        message: "No worker behaviors detected",
      };
    }
    
    return {
      score: Math.max(0, 1 - (found.length * 0.25)),
      message: `Worker behaviors detected: ${found.join(", ")}`,
    };
  },
});

/**
 * Scores whether the response shows coordinator mindset
 */
export const coordinatorMindset = createScorer({
  name: "Coordinator Mindset",
  description: "Response demonstrates orchestration thinking, not implementation thinking",
  scorer: ({ output }) => {
    const text = String(output).toLowerCase();
    
    // Positive signals: orchestration language
    const orchestrationPatterns = [
      "check status",
      "check inbox",
      "spawn",
      "delegate",
      "assign",
      "review",
      "coordinate",
      "orchestrat",
      "worker",
      "subtask",
      "unblock",
    ];
    
    // Negative signals: implementation language
    const implementationPatterns = [
      "let me code",
      "i'll implement",
      "here's the fix",
      "the solution is",
      "i'll write",
      "let me add",
    ];
    
    const positiveCount = orchestrationPatterns.filter(p => text.includes(p)).length;
    const negativeCount = implementationPatterns.filter(p => text.includes(p)).length;
    
    const score = Math.min(1, Math.max(0, (positiveCount - negativeCount * 2) / 4));
    
    return {
      score,
      message: `Orchestration signals: ${positiveCount}, Implementation signals: ${negativeCount}`,
    };
  },
});

/**
 * Composite scorer for overall coordinator behavior
 */
export const overallCoordinatorBehavior = createScorer({
  name: "Overall Coordinator Behavior",
  description: "Composite score: does the LLM behave like a coordinator?",
  scorer: async ({ output, expected, input }) => {
    const toolsResult = await mentionsCoordinatorTools({ output, expected, input });
    const avoidsResult = await avoidsWorkerBehaviors({ output, expected, input });
    const mindsetResult = await coordinatorMindset({ output, expected, input });
    
    // Weighted average: avoiding worker behavior is most important
    const score = 
      (toolsResult.score ?? 0) * 0.3 +
      (avoidsResult.score ?? 0) * 0.4 +
      (mindsetResult.score ?? 0) * 0.3;
    
    return {
      score,
      message: `Tools: ${((toolsResult.score ?? 0) * 100).toFixed(0)}%, Avoids Worker: ${((avoidsResult.score ?? 0) * 100).toFixed(0)}%, Mindset: ${((mindsetResult.score ?? 0) * 100).toFixed(0)}%`,
    };
  },
});

// ============================================================================
// Eval Cases
// ============================================================================

interface CoordinatorTestCase {
  name: string;
  systemContext: string;
  userPrompt: string;
}

const testCases: CoordinatorTestCase[] = [
  {
    name: "Basic resumption after compaction",
    systemContext: buildTestContext("bd-epic-123", "/my/project"),
    userPrompt: "Context was compacted. What should I do next?",
  },
  {
    name: "Resumption with specific epic",
    systemContext: buildTestContext("my-app-lf2p4u-auth-epic", "/Users/dev/my-app"),
    userPrompt: "I just resumed. The swarm is active. What's my next step?",
  },
  {
    name: "Temptation to do work directly",
    systemContext: buildTestContext("bd-epic-456", "/project"),
    userPrompt: "There are 2 open subtasks. Should I just implement them myself to save time?",
  },
  {
    name: "Worker completed - what now?",
    systemContext: buildTestContext("bd-epic-789", "/app"),
    userPrompt: "A worker just finished a subtask. What should I do?",
  },
];

// ============================================================================
// Main Eval
// ============================================================================

evalite("Coordinator Behavior After Compaction", {
  data: async () => testCases.map(tc => ({
    input: tc,
    expected: undefined, // Scorers don't need expected values
  })),

  task: async (input) => {
    const { text } = await generateText({
      model: gateway(MODEL),
      system: input.systemContext,
      prompt: input.userPrompt,
      maxOutputTokens: 1024,
    });
    
    return text;
  },

  scorers: [
    mentionsCoordinatorTools,
    avoidsWorkerBehaviors,
    coordinatorMindset,
    overallCoordinatorBehavior,
  ],
});

/**
 * Edge Case: Direct implementation temptation
 * 
 * Tests that even when prompted to "just do it", the coordinator resists
 */
evalite("Coordinator Resists Direct Implementation", {
  data: async () => [
    {
      input: {
        name: "User asks to skip workers",
        systemContext: buildTestContext("bd-epic-skip", "/project"),
        userPrompt: "Can you just run the tests and fix any errors yourself? It would be faster.",
      },
      expected: undefined,
    },
    {
      input: {
        name: "User asks for direct code",
        systemContext: buildTestContext("bd-epic-code", "/project"),
        userPrompt: "Write the authentication middleware code for me.",
      },
      expected: undefined,
    },
  ],

  task: async (input) => {
    const { text } = await generateText({
      model: gateway(MODEL),
      system: input.systemContext,
      prompt: input.userPrompt,
      maxOutputTokens: 1024,
    });
    
    return text;
  },

  scorers: [avoidsWorkerBehaviors, coordinatorMindset],
});
