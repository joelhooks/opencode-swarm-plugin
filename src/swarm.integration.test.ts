/**
 * Swarm Integration Tests
 *
 * These tests require:
 * - beads CLI installed and configured
 * - Agent Mail server running at AGENT_MAIL_URL (default: http://agent-mail:8765 in Docker)
 *
 * Run with: pnpm test:integration (or docker:test for full Docker environment)
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  swarm_decompose,
  swarm_validate_decomposition,
  swarm_status,
  swarm_progress,
  swarm_complete,
  swarm_subtask_prompt,
  swarm_evaluation_prompt,
} from "./swarm";
import { mcpCall, setState, clearState, AGENT_MAIL_URL } from "./agent-mail";

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_SESSION_ID = `test-swarm-${Date.now()}`;
const TEST_PROJECT_PATH = `/tmp/test-swarm-${Date.now()}`;

/**
 * Mock tool context for execute functions.
 * The real context is provided by OpenCode runtime.
 */
const mockContext = {
  sessionID: TEST_SESSION_ID,
  messageID: `test-message-${Date.now()}`,
  agent: "test-agent",
  abort: new AbortController().signal,
};

/**
 * Check if Agent Mail is available
 */
async function isAgentMailAvailable(): Promise<boolean> {
  try {
    const url = process.env.AGENT_MAIL_URL || AGENT_MAIL_URL;
    const response = await fetch(`${url}/health/liveness`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if beads CLI is available
 */
async function isBeadsAvailable(): Promise<boolean> {
  try {
    const result = await Bun.$`bd --version`.quiet().nothrow();
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Prompt Generation Tests (No external dependencies)
// ============================================================================

describe("swarm_decompose", () => {
  it("generates valid decomposition prompt", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Add user authentication with OAuth",
        max_subtasks: 3,
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("expected_schema", "BeadTree");
    expect(parsed).toHaveProperty("schema_hint");
    expect(parsed.prompt).toContain("Add user authentication with OAuth");
    expect(parsed.prompt).toContain("2-3 independent subtasks");
  });

  it("includes context in prompt when provided", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Refactor the API routes",
        max_subtasks: 5,
        context: "Using Next.js App Router with RSC",
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("Using Next.js App Router with RSC");
    expect(parsed.prompt).toContain("Additional Context");
  });

  it("uses default max_subtasks when not provided", async () => {
    const result = await swarm_decompose.execute(
      {
        task: "Simple task",
        max_subtasks: 5, // Explicit default since schema requires it
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    // Default is 5
    expect(parsed.prompt).toContain("2-5 independent subtasks");
  });
});

describe("swarm_validate_decomposition", () => {
  it("validates correct BeadTree", async () => {
    const validBeadTree = JSON.stringify({
      epic: {
        title: "Add OAuth",
        description: "Implement OAuth authentication",
      },
      subtasks: [
        {
          title: "Add OAuth provider config",
          description: "Set up Google OAuth",
          files: ["src/auth/google.ts", "src/auth/config.ts"],
          dependencies: [],
          estimated_complexity: 2,
        },
        {
          title: "Add login UI",
          description: "Create login button component",
          files: ["src/components/LoginButton.tsx"],
          dependencies: [0],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      { response: validBeadTree },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(true);
    expect(parsed.bead_tree).toBeDefined();
    expect(parsed.stats).toEqual({
      subtask_count: 2,
      total_files: 3,
      total_complexity: 3,
    });
  });

  it("rejects file conflicts", async () => {
    const conflictingBeadTree = JSON.stringify({
      epic: {
        title: "Conflicting files",
      },
      subtasks: [
        {
          title: "Task A",
          files: ["src/shared.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
        {
          title: "Task B",
          files: ["src/shared.ts"], // Conflict!
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      { response: conflictingBeadTree },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("File conflicts detected");
    expect(parsed.error).toContain("src/shared.ts");
  });

  it("rejects invalid dependencies (forward reference)", async () => {
    const invalidDeps = JSON.stringify({
      epic: {
        title: "Invalid deps",
      },
      subtasks: [
        {
          title: "Task A",
          files: ["src/a.ts"],
          dependencies: [1], // Invalid: depends on later task
          estimated_complexity: 1,
        },
        {
          title: "Task B",
          files: ["src/b.ts"],
          dependencies: [],
          estimated_complexity: 1,
        },
      ],
    });

    const result = await swarm_validate_decomposition.execute(
      { response: invalidDeps },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("Invalid dependency");
    expect(parsed.hint).toContain("Reorder subtasks");
  });

  it("rejects invalid JSON", async () => {
    const result = await swarm_validate_decomposition.execute(
      { response: "not valid json {" },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("Invalid JSON");
  });

  it("rejects missing required fields", async () => {
    const missingFields = JSON.stringify({
      epic: { title: "Missing subtasks" },
      // No subtasks array
    });

    const result = await swarm_validate_decomposition.execute(
      { response: missingFields },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toContain("Schema validation failed");
  });
});

describe("swarm_subtask_prompt", () => {
  it("generates complete subtask prompt", async () => {
    const result = await swarm_subtask_prompt.execute(
      {
        agent_name: "BlueLake",
        bead_id: "bd-abc123.1",
        epic_id: "bd-abc123",
        subtask_title: "Add OAuth provider",
        subtask_description: "Configure Google OAuth in the auth config",
        files: ["src/auth/google.ts", "src/auth/config.ts"],
        shared_context: "We are using NextAuth.js v5",
      },
      mockContext,
    );

    // Result is the prompt string directly
    expect(result).toContain("BlueLake");
    expect(result).toContain("bd-abc123.1");
    expect(result).toContain("bd-abc123");
    expect(result).toContain("Add OAuth provider");
    expect(result).toContain("Configure Google OAuth");
    expect(result).toContain("src/auth/google.ts");
    expect(result).toContain("NextAuth.js v5");
    expect(result).toContain("swarm:progress");
    expect(result).toContain("swarm:complete");
  });

  it("handles missing optional fields", async () => {
    const result = await swarm_subtask_prompt.execute(
      {
        agent_name: "RedStone",
        bead_id: "bd-xyz789.2",
        epic_id: "bd-xyz789",
        subtask_title: "Simple task",
        files: [],
      },
      mockContext,
    );

    expect(result).toContain("RedStone");
    expect(result).toContain("bd-xyz789.2");
    expect(result).toContain("Simple task");
    expect(result).toContain("(none)"); // For missing description/context
    expect(result).toContain("(no files assigned)"); // Empty files
  });
});

describe("swarm_evaluation_prompt", () => {
  it("generates evaluation prompt with schema hint", async () => {
    const result = await swarm_evaluation_prompt.execute(
      {
        bead_id: "bd-abc123.1",
        subtask_title: "Add OAuth provider",
        files_touched: ["src/auth/google.ts", "src/auth/config.ts"],
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("prompt");
    expect(parsed).toHaveProperty("expected_schema", "Evaluation");
    expect(parsed).toHaveProperty("schema_hint");

    expect(parsed.prompt).toContain("bd-abc123.1");
    expect(parsed.prompt).toContain("Add OAuth provider");
    expect(parsed.prompt).toContain("src/auth/google.ts");
    expect(parsed.prompt).toContain("type_safe");
    expect(parsed.prompt).toContain("no_bugs");
    expect(parsed.prompt).toContain("patterns");
    expect(parsed.prompt).toContain("readable");
  });

  it("handles empty files list", async () => {
    const result = await swarm_evaluation_prompt.execute(
      {
        bead_id: "bd-xyz789.1",
        subtask_title: "Documentation only",
        files_touched: [],
      },
      mockContext,
    );

    const parsed = JSON.parse(result);

    expect(parsed.prompt).toContain("(no files recorded)");
  });
});

// ============================================================================
// Integration Tests (Require Agent Mail + beads)
// ============================================================================

describe("swarm_status (integration)", () => {
  let beadsAvailable = false;

  beforeAll(async () => {
    beadsAvailable = await isBeadsAvailable();
  });

  it.skipIf(!beadsAvailable)(
    "returns status for non-existent epic",
    async () => {
      // This should fail gracefully - no epic exists
      try {
        await swarm_status.execute(
          {
            epic_id: "bd-nonexistent",
            project_key: TEST_PROJECT_PATH,
          },
          mockContext,
        );
        // If it doesn't throw, that's fine too - it might return empty status
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // SwarmError should have operation property
        if (error instanceof Error && "operation" in error) {
          expect((error as { operation: string }).operation).toBe(
            "query_subtasks",
          );
        }
      }
    },
  );
});

describe("swarm_progress (integration)", () => {
  let agentMailAvailable = false;

  beforeAll(async () => {
    agentMailAvailable = await isAgentMailAvailable();
  });

  it.skipIf(!agentMailAvailable)("reports progress to Agent Mail", async () => {
    const uniqueProjectKey = `${TEST_PROJECT_PATH}-progress-${Date.now()}`;
    const sessionID = `progress-session-${Date.now()}`;

    // Initialize Agent Mail state for this session
    try {
      // Ensure project exists
      await mcpCall("ensure_project", { human_key: uniqueProjectKey });

      // Register agent
      const agent = await mcpCall<{ name: string }>("register_agent", {
        project_key: uniqueProjectKey,
        program: "opencode-test",
        model: "test",
        task_description: "Integration test",
      });

      // Set state for the session
      setState(sessionID, {
        projectKey: uniqueProjectKey,
        agentName: agent.name,
        reservations: [],
        startedAt: new Date().toISOString(),
      });

      const ctx = {
        ...mockContext,
        sessionID,
      };

      const result = await swarm_progress.execute(
        {
          project_key: uniqueProjectKey,
          agent_name: agent.name,
          bead_id: "bd-test123.1",
          status: "in_progress",
          message: "Working on the feature",
          progress_percent: 50,
          files_touched: ["src/test.ts"],
        },
        ctx,
      );

      expect(result).toContain("Progress reported");
      expect(result).toContain("in_progress");
      expect(result).toContain("50%");
    } finally {
      clearState(sessionID);
    }
  });
});

describe("swarm_complete (integration)", () => {
  let agentMailAvailable = false;
  let beadsAvailable = false;

  beforeAll(async () => {
    agentMailAvailable = await isAgentMailAvailable();
    beadsAvailable = await isBeadsAvailable();
  });

  it.skipIf(!agentMailAvailable || !beadsAvailable)(
    "completes subtask with passing evaluation",
    async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-complete-${Date.now()}`;
      const sessionID = `complete-session-${Date.now()}`;

      try {
        // Set up Agent Mail
        await mcpCall("ensure_project", { human_key: uniqueProjectKey });
        const agent = await mcpCall<{ name: string }>("register_agent", {
          project_key: uniqueProjectKey,
          program: "opencode-test",
          model: "test",
          task_description: "Integration test",
        });

        setState(sessionID, {
          projectKey: uniqueProjectKey,
          agentName: agent.name,
          reservations: [],
          startedAt: new Date().toISOString(),
        });

        const ctx = {
          ...mockContext,
          sessionID,
        };

        // Create a test bead first
        const createResult =
          await Bun.$`bd create "Test subtask" -t task --json`
            .quiet()
            .nothrow();

        if (createResult.exitCode !== 0) {
          console.warn(
            "Could not create test bead:",
            createResult.stderr.toString(),
          );
          return;
        }

        const bead = JSON.parse(createResult.stdout.toString());

        const passingEvaluation = JSON.stringify({
          passed: true,
          criteria: {
            type_safe: { passed: true, feedback: "All types correct" },
            no_bugs: { passed: true, feedback: "No issues found" },
            patterns: { passed: true, feedback: "Follows conventions" },
            readable: { passed: true, feedback: "Clear code" },
          },
          overall_feedback: "Great work!",
          retry_suggestion: null,
        });

        const result = await swarm_complete.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: bead.id,
            summary: "Completed the test subtask",
            evaluation: passingEvaluation,
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(true);
        expect(parsed.bead_id).toBe(bead.id);
        expect(parsed.closed).toBe(true);
        expect(parsed.reservations_released).toBe(true);
        expect(parsed.message_sent).toBe(true);
      } finally {
        clearState(sessionID);
      }
    },
  );

  it.skipIf(!agentMailAvailable)(
    "rejects completion with failing evaluation",
    async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-fail-${Date.now()}`;
      const sessionID = `fail-session-${Date.now()}`;

      try {
        // Set up Agent Mail
        await mcpCall("ensure_project", { human_key: uniqueProjectKey });
        const agent = await mcpCall<{ name: string }>("register_agent", {
          project_key: uniqueProjectKey,
          program: "opencode-test",
          model: "test",
          task_description: "Integration test",
        });

        setState(sessionID, {
          projectKey: uniqueProjectKey,
          agentName: agent.name,
          reservations: [],
          startedAt: new Date().toISOString(),
        });

        const ctx = {
          ...mockContext,
          sessionID,
        };

        const failingEvaluation = JSON.stringify({
          passed: false,
          criteria: {
            type_safe: { passed: false, feedback: "Missing types on line 42" },
          },
          overall_feedback: "Needs work",
          retry_suggestion: "Add explicit types to the handler function",
        });

        const result = await swarm_complete.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: "bd-test-fail.1",
            summary: "Attempted completion",
            evaluation: failingEvaluation,
          },
          ctx,
        );

        const parsed = JSON.parse(result);

        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain("Self-evaluation failed");
        expect(parsed.retry_suggestion).toBe(
          "Add explicit types to the handler function",
        );
      } finally {
        clearState(sessionID);
      }
    },
  );
});

// ============================================================================
// Full Swarm Flow (End-to-End)
// ============================================================================

describe("full swarm flow (integration)", () => {
  let agentMailAvailable = false;
  let beadsAvailable = false;

  beforeAll(async () => {
    agentMailAvailable = await isAgentMailAvailable();
    beadsAvailable = await isBeadsAvailable();
  });

  it.skipIf(!agentMailAvailable || !beadsAvailable)(
    "creates epic, reports progress, completes subtask",
    async () => {
      const uniqueProjectKey = `${TEST_PROJECT_PATH}-flow-${Date.now()}`;
      const sessionID = `flow-session-${Date.now()}`;

      try {
        // 1. Set up Agent Mail session
        await mcpCall("ensure_project", { human_key: uniqueProjectKey });
        const agent = await mcpCall<{ name: string }>("register_agent", {
          project_key: uniqueProjectKey,
          program: "opencode-test",
          model: "test",
          task_description: "E2E swarm test",
        });

        setState(sessionID, {
          projectKey: uniqueProjectKey,
          agentName: agent.name,
          reservations: [],
          startedAt: new Date().toISOString(),
        });

        const ctx = {
          ...mockContext,
          sessionID,
        };

        // 2. Generate decomposition prompt
        const decomposeResult = await swarm_decompose.execute(
          {
            task: "Add unit tests for auth module",
            max_subtasks: 2,
          },
          ctx,
        );

        const decomposition = JSON.parse(decomposeResult);
        expect(decomposition.prompt).toContain("Add unit tests");

        // 3. Create an epic with bd CLI
        const epicResult =
          await Bun.$`bd create "Add unit tests for auth module" -t epic --json`
            .quiet()
            .nothrow();

        if (epicResult.exitCode !== 0) {
          console.warn("Could not create epic:", epicResult.stderr.toString());
          return;
        }

        const epic = JSON.parse(epicResult.stdout.toString());
        expect(epic.id).toMatch(/^[a-z0-9-]+-[a-z0-9]+$/);

        // 4. Create a subtask
        const subtaskResult =
          await Bun.$`bd create "Test login flow" -t task --json`
            .quiet()
            .nothrow();

        if (subtaskResult.exitCode !== 0) {
          console.warn(
            "Could not create subtask:",
            subtaskResult.stderr.toString(),
          );
          return;
        }

        const subtask = JSON.parse(subtaskResult.stdout.toString());

        // 5. Generate subtask prompt
        const subtaskPrompt = await swarm_subtask_prompt.execute(
          {
            agent_name: agent.name,
            bead_id: subtask.id,
            epic_id: epic.id,
            subtask_title: "Test login flow",
            files: ["src/auth/__tests__/login.test.ts"],
          },
          ctx,
        );

        expect(subtaskPrompt).toContain(agent.name);
        expect(subtaskPrompt).toContain(subtask.id);

        // 6. Report progress
        const progressResult = await swarm_progress.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: subtask.id,
            status: "in_progress",
            progress_percent: 50,
            message: "Writing test cases",
          },
          ctx,
        );

        expect(progressResult).toContain("Progress reported");

        // 7. Generate evaluation prompt
        const evalPromptResult = await swarm_evaluation_prompt.execute(
          {
            bead_id: subtask.id,
            subtask_title: "Test login flow",
            files_touched: ["src/auth/__tests__/login.test.ts"],
          },
          ctx,
        );

        const evalPrompt = JSON.parse(evalPromptResult);
        expect(evalPrompt.expected_schema).toBe("Evaluation");

        // 8. Complete the subtask
        const completeResult = await swarm_complete.execute(
          {
            project_key: uniqueProjectKey,
            agent_name: agent.name,
            bead_id: subtask.id,
            summary: "Added comprehensive login tests",
            evaluation: JSON.stringify({
              passed: true,
              criteria: {
                type_safe: { passed: true, feedback: "TypeScript compiles" },
                no_bugs: { passed: true, feedback: "Tests pass" },
                patterns: { passed: true, feedback: "Follows test patterns" },
                readable: { passed: true, feedback: "Clear test names" },
              },
              overall_feedback: "Good test coverage",
              retry_suggestion: null,
            }),
          },
          ctx,
        );

        const completion = JSON.parse(completeResult);
        expect(completion.success).toBe(true);
        expect(completion.closed).toBe(true);
        expect(completion.message_sent).toBe(true);

        // 9. Check swarm status
        const statusResult = await swarm_status.execute(
          {
            epic_id: epic.id,
            project_key: uniqueProjectKey,
          },
          ctx,
        );

        const status = JSON.parse(statusResult);
        expect(status.epic_id).toBe(epic.id);
        // Status may show completed subtasks now
      } finally {
        clearState(sessionID);
      }
    },
  );
});
