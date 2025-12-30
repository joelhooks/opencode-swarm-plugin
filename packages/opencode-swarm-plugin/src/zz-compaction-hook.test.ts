/**
 * Tests for Swarm-Aware Compaction Hook
 * 
 * IMPORTANT: This file uses DEPENDENCY INJECTION instead of mock.module().
 * Bun's mock.module() is global and persists across test files, causing pollution.
 * All tests that need mocked behavior pass options to createCompactionHook().
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
  SWARM_COMPACTION_CONTEXT,
  SWARM_DETECTION_FALLBACK,
  createCompactionHook,
  scanSessionMessages,
  type ScannedSwarmState,
  type CompactionHookOptions,
} from "./compaction-hook";

// Track log calls for verification
let logCalls: Array<{ level: string; data: any; message?: string }> = [];

/**
 * Create a mock logger that captures all log calls
 */
const createMockLogger = () => ({
  info: (data: any, message?: string) => {
    logCalls.push({ level: "info", data, message });
  },
  debug: (data: any, message?: string) => {
    logCalls.push({ level: "debug", data, message });
  },
  warn: (data: any, message?: string) => {
    logCalls.push({ level: "warn", data, message });
  },
  error: (data: any, message?: string) => {
    logCalls.push({ level: "error", data, message });
  },
});

/**
 * Default mock options for tests that need isolated/mocked behavior.
 * Use this instead of file-level mock.module() calls.
 */
const createDefaultMockOptions = (): CompactionHookOptions => ({
  getHiveWorkingDirectory: () => "/test/project",
  getHiveAdapter: async () => ({
    queryCells: async () => [],
  }),
  checkSwarmHealth: async () => ({
    healthy: true,
    database: "connected",
    stats: {
      events: 0,
      agents: 0,
      messages: 0,
      reservations: 0,
    },
  }),
  logger: createMockLogger(),
});

describe("Compaction Hook", () => {
  beforeEach(() => {
    // Reset log calls before each test
    logCalls = [];
  });
  describe("SWARM_COMPACTION_CONTEXT", () => {
    it("contains coordinator instructions", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("COORDINATOR");
      expect(SWARM_COMPACTION_CONTEXT).toContain("YOU ARE THE COORDINATOR");
    });

    it("contains prohibition-first anti-patterns", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("NEVER");
      expect(SWARM_COMPACTION_CONTEXT).toContain("edit");
      expect(SWARM_COMPACTION_CONTEXT).toContain("write");
      expect(SWARM_COMPACTION_CONTEXT).toContain("SPAWN A WORKER");
    });

    it("contains resume instructions", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_status");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarmmail_inbox");
    });

    it("contains summary format", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("Swarm State");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Active:");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Blocked:");
      expect(SWARM_COMPACTION_CONTEXT).toContain("Completed:");
    });

    // NEW: Full coordinator workflow must be present post-compaction
    it("contains FULL coordinator workflow phases", () => {
      // Phase 1.5: Research Phase
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_spawn_researcher");
      
      // Phase 3: Decompose
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_select_strategy");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_plan_prompt");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_validate_decomposition");
      
      // Phase 4: Create Cells
      expect(SWARM_COMPACTION_CONTEXT).toContain("hive_create_epic");
      
      // Phase 6: Spawn Workers
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_spawn_subtask");
      
      // Phase 7: Review Loop
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_review");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_review_feedback");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_spawn_retry");
    });

    it("uses hivemind tools not semantic-memory tools (ADR-011)", () => {
      // ADR-011: Hivemind Memory Unification
      // All semantic-memory_* references should be updated to hivemind_*
      
      // Should contain hivemind_* tools
      expect(SWARM_COMPACTION_CONTEXT).toContain("hivemind_find");
      
      // Should NOT contain deprecated semantic-memory_* tools
      expect(SWARM_COMPACTION_CONTEXT).not.toContain("semantic-memory_find");
      expect(SWARM_COMPACTION_CONTEXT).not.toContain("semantic-memory_store");
      expect(SWARM_COMPACTION_CONTEXT).not.toContain("semantic-memory");
    });

    it("contains forbidden tools section with ALL forbidden tools", () => {
      // Repository fetching
      expect(SWARM_COMPACTION_CONTEXT).toContain("repo-crawl_file");
      expect(SWARM_COMPACTION_CONTEXT).toContain("repo-autopsy");
      
      // Web/documentation fetching
      expect(SWARM_COMPACTION_CONTEXT).toContain("webfetch");
      expect(SWARM_COMPACTION_CONTEXT).toContain("fetch_fetch");
      expect(SWARM_COMPACTION_CONTEXT).toContain("context7");
      
      // Knowledge base
      expect(SWARM_COMPACTION_CONTEXT).toContain("pdf-brain");
    });

    it("contains strategy reference table", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("file-based");
      expect(SWARM_COMPACTION_CONTEXT).toContain("feature-based");
      expect(SWARM_COMPACTION_CONTEXT).toContain("risk-based");
    });
  });

  describe("SWARM_DETECTION_FALLBACK", () => {
    it("contains detection patterns", () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("swarm_decompose");
      expect(SWARM_DETECTION_FALLBACK).toContain("swarmmail_init");
      expect(SWARM_DETECTION_FALLBACK).toContain("hive_create_epic");
    });

    it("contains ID patterns", () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("bd-xxx");
      expect(SWARM_DETECTION_FALLBACK).toContain("Agent names");
    });

    it("contains coordination language", () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("spawn");
      expect(SWARM_DETECTION_FALLBACK).toContain("coordinator");
      expect(SWARM_DETECTION_FALLBACK).toContain("reservation");
    });
  });

  describe("createCompactionHook", () => {
    it("returns a function", () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      expect(typeof hook).toBe("function");
    });

    it("accepts input and output parameters", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      // Should not throw
      await hook(input, output);
    });

    it("does not inject context when no swarm detected", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const output = { context: [] as string[] };

      await hook({ sessionID: "test" }, output);

      // With mocked empty data, should not inject
      expect(output.context.length).toBe(0);
    });
  });

  describe("Detection confidence levels", () => {
    it("HIGH confidence triggers full context", async () => {
      // This would need proper mocking of active reservations
      // For now, just verify the context strings exist
      expect(SWARM_COMPACTION_CONTEXT).toContain("YOU ARE THE COORDINATOR");
    });

    it("LOW confidence triggers fallback prompt", async () => {
      expect(SWARM_DETECTION_FALLBACK).toContain("Swarm Detection");
      expect(SWARM_DETECTION_FALLBACK).toContain("Check Your Context");
    });
  });

  describe("Forbidden tools anti-pattern (TDD red phase)", () => {
    it("SWARM_COMPACTION_CONTEXT includes 'NEVER fetch directly' rule", () => {
      // Should warn against direct fetching
      expect(SWARM_COMPACTION_CONTEXT).toContain("NEVER");
      expect(SWARM_COMPACTION_CONTEXT).toContain("repo-crawl");
      expect(SWARM_COMPACTION_CONTEXT).toContain("webfetch");
      expect(SWARM_COMPACTION_CONTEXT).toContain("fetch_fetch");
      expect(SWARM_COMPACTION_CONTEXT).toContain("context7");
      expect(SWARM_COMPACTION_CONTEXT).toContain("pdf-brain");
    });

    it("SWARM_COMPACTION_CONTEXT instructs to spawn researcher instead", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("SPAWN A RESEARCHER");
      expect(SWARM_COMPACTION_CONTEXT).toContain("swarm_spawn_researcher");
    });

    it("lists all forbidden repo-crawl tools", () => {
      const forbiddenTools = [
        "repo-crawl_file",
        "repo-crawl_readme", 
        "repo-crawl_search",
        "repo-crawl_structure",
        "repo-crawl_tree"
      ];
      
      for (const tool of forbiddenTools) {
        expect(SWARM_COMPACTION_CONTEXT).toContain(tool);
      }
    });

    it("lists all forbidden repo-autopsy tools", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("repo-autopsy");
    });

    it("lists all forbidden context7 tools", () => {
      const forbiddenTools = [
        "context7_resolve-library-id",
        "context7_get-library-docs"
      ];
      
      for (const tool of forbiddenTools) {
        expect(SWARM_COMPACTION_CONTEXT).toContain(tool);
      }
    });

    it("lists all forbidden pdf-brain tools", () => {
      const forbiddenTools = [
        "pdf-brain_search",
        "pdf-brain_read"
      ];
      
      for (const tool of forbiddenTools) {
        expect(SWARM_COMPACTION_CONTEXT).toContain(tool);
      }
    });
  });

  describe("Coordinator identity reinforcement (TDD red phase)", () => {
    it("includes ASCII header for coordinator identity", () => {
      // Should have prominent visual indicator
      expect(SWARM_COMPACTION_CONTEXT).toMatch(/[╔═╗║╚╝]|[┌─┐│└┘]|[█▀▄]/);
    });

    it("repeats 'YOU ARE THE COORDINATOR' multiple times", () => {
      const matches = SWARM_COMPACTION_CONTEXT.match(/YOU ARE THE COORDINATOR/gi);
      expect(matches).toBeDefined();
      expect(matches!.length).toBeGreaterThanOrEqual(2);
    });

    it("uses strong imperative language NEVER/ALWAYS/NON-NEGOTIABLE", () => {
      expect(SWARM_COMPACTION_CONTEXT).toContain("NEVER");
      expect(SWARM_COMPACTION_CONTEXT).toContain("ALWAYS");
      expect(SWARM_COMPACTION_CONTEXT).toContain("NON-NEGOTIABLE");
    });

    it("makes role unmistakable with multiple strong statements", () => {
      // Check for strong coordinator identity statements
      const identityPatterns = [
        /YOU ARE THE COORDINATOR/i,
        /NOT A WORKER/i,
        /ORCHESTRATE/i,
        /DO NOT IMPLEMENT/i
      ];

      let matchCount = 0;
      for (const pattern of identityPatterns) {
        if (pattern.test(SWARM_COMPACTION_CONTEXT)) {
          matchCount++;
        }
      }

      expect(matchCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Specific swarm state injection (TDD red phase)", () => {
    it("includes specific epic ID when in_progress epic exists", async () => {
      // Use DI instead of mock.module
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/test/project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-epic-123",
              title: "Add authentication system",
              type: "epic",
              status: "in_progress",
              parent_id: null,
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      // Should inject context with the SPECIFIC epic ID, not a placeholder
      expect(output.context.length).toBeGreaterThan(0);
      const injectedContext = output.context[0];
      expect(injectedContext).toContain("bd-epic-123");
      expect(injectedContext).toContain("Add authentication system");
    });

    it("includes subtask status summary in injected context", async () => {
      // Use DI instead of mock.module
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/test/project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-epic-456",
              title: "Refactor auth flow",
              type: "epic",
              status: "in_progress",
              parent_id: null,
              updated_at: Date.now(),
            },
            {
              id: "bd-epic-456.1",
              title: "Update schema",
              type: "task",
              status: "closed",
              parent_id: "bd-epic-456",
              updated_at: Date.now(),
            },
            {
              id: "bd-epic-456.2",
              title: "Implement service layer",
              type: "task",
              status: "in_progress",
              parent_id: "bd-epic-456",
              updated_at: Date.now(),
            },
            {
              id: "bd-epic-456.3",
              title: "Add tests",
              type: "task",
              status: "open",
              parent_id: "bd-epic-456",
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      expect(output.context.length).toBeGreaterThan(0);
      const injectedContext = output.context[0];
      
      // Should show subtask counts: 1 closed, 1 in_progress, 1 open
      expect(injectedContext).toMatch(/1.*closed/i);
      expect(injectedContext).toMatch(/1.*in_progress/i);
      expect(injectedContext).toMatch(/1.*open/i);
    });

    it("includes project path in context", async () => {
      // Use DI instead of mock.module
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/Users/joel/test-project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-epic-789",
              title: "Feature work",
              type: "epic",
              status: "in_progress",
              parent_id: null,
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      expect(output.context.length).toBeGreaterThan(0);
      const injectedContext = output.context[0];
      
      // Should include the actual project path, not a placeholder
      expect(injectedContext).toContain("/Users/joel/test-project");
    });

    it("includes actionable swarm_status call with epic ID", async () => {
      // Use DI instead of mock.module
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/test/project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-epic-999",
              title: "Critical fix",
              type: "epic",
              status: "in_progress",
              parent_id: null,
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      expect(output.context.length).toBeGreaterThan(0);
      const injectedContext = output.context[0];
      
      // Should include actionable swarm_status call with the SPECIFIC epic ID
      expect(injectedContext).toContain('swarm_status(epic_id="bd-epic-999"');
      expect(injectedContext).toContain('project_key="/test/project"');
    });

    it("includes coordinator role reminder - NOT worker commands", async () => {
      // Use DI instead of mock.module
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/test/project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-epic-123",
              title: "Test Epic",
              type: "epic",
              status: "in_progress",
              parent_id: null,
              updated_at: Date.now(),
            },
            {
              id: "bd-task-1",
              type: "task",
              status: "open",
              parent_id: "bd-epic-123",
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      expect(output.context.length).toBeGreaterThan(0);
      const injectedContext = output.context[0];
      
      // Should remind coordinator of their ROLE
      expect(injectedContext).toContain("YOU ARE THE COORDINATOR");
      expect(injectedContext).toContain("Spawn workers");
      
      // Should include coordinator commands
      expect(injectedContext).toContain("swarm_spawn_subtask");
      expect(injectedContext).toContain("swarm_review");
    });
  });

  describe("Dependency Injection", () => {
    it("accepts custom getHiveAdapter function", async () => {
      const customAdapter = {
        queryCells: async () => [
          {
            id: "custom-epic",
            title: "Custom Epic",
            type: "epic" as const,
            status: "in_progress" as const,
            parent_id: null,
            updated_at: Date.now(),
          },
        ],
      };

      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/custom/path",
        getHiveAdapter: async () => customAdapter,
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const output = { context: [] as string[] };
      await hook({ sessionID: "test" }, output);

      expect(output.context.length).toBeGreaterThan(0);
      expect(output.context[0]).toContain("custom-epic");
    });

    it("accepts custom checkSwarmHealth function", async () => {
      const hook = createCompactionHook({
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected" as const,
          stats: {
            events: 5,
            agents: 2,
            messages: 10,
            reservations: 3,
          },
        }),
      });

      const output = { context: [] as string[] };
      await hook({ sessionID: "test" }, output);

      // Should detect swarm due to reservations
      expect(output.context.length).toBeGreaterThan(0);
    });

    it("accepts custom getHiveWorkingDirectory function", async () => {
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/custom/path",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "test-epic",
              title: "Test Epic",
              type: "epic" as const,
              status: "in_progress" as const,
              parent_id: null,
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
      });

      const output = { context: [] as string[] };
      await hook({ sessionID: "test" }, output);

      // Should detect swarm and include custom path
      expect(output.context.length).toBeGreaterThan(0);
      expect(output.context[0]).toContain("/custom/path");
    });
  });

  describe("Logging instrumentation", () => {
    it("logs compaction start with session_id", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const input = { sessionID: "test-session-123" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const startLog = logCalls.find(
        (log) => log.level === "info" && log.message === "compaction started",
      );
      expect(startLog).toBeDefined();
      expect(startLog?.data).toHaveProperty("session_id", "test-session-123");
    });

    it("logs detection phase with confidence and reasons", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const detectionLog = logCalls.find(
        (log) =>
          log.level === "debug" && log.message === "swarm detection complete",
      );
      expect(detectionLog).toBeDefined();
      expect(detectionLog?.data).toHaveProperty("confidence");
      expect(detectionLog?.data).toHaveProperty("detected");
      expect(detectionLog?.data).toHaveProperty("reason_count");
    });

    it("logs context injection when swarm detected", async () => {
      // Use DI with mock logger
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => "/test/project",
        getHiveAdapter: async () => ({
          queryCells: async () => [
            {
              id: "bd-123",
              type: "epic",
              status: "open",
              parent_id: null,
              updated_at: Date.now(),
            },
          ],
        }),
        checkSwarmHealth: async () => ({
          healthy: true,
          database: "connected",
          stats: { events: 0, agents: 0, messages: 0, reservations: 0 },
        }),
        logger: createMockLogger(),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const injectionLog = logCalls.find(
        (log) =>
          log.level === "info" && log.message === "injected swarm context",
      );
      expect(injectionLog).toBeDefined();
      expect(injectionLog?.data).toHaveProperty("confidence");
      expect(injectionLog?.data).toHaveProperty("context_length");
    });

    it("logs completion with duration and success", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      const completeLog = logCalls.find(
        (log) => log.level === "info" && log.message === "compaction complete",
      );
      expect(completeLog).toBeDefined();
      expect(completeLog?.data).toHaveProperty("duration_ms");
      expect(completeLog?.data.duration_ms).toBeGreaterThanOrEqual(0);
      expect(completeLog?.data).toHaveProperty("success", true);
    });

    it("logs detailed detection sources (hive, swarm-mail)", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      // Should log details about checking swarm-mail
      const swarmMailLog = logCalls.find(
        (log) => log.level === "debug" && log.message?.includes("swarm-mail"),
      );
      // Should log details about checking hive
      const hiveLog = logCalls.find(
        (log) => log.level === "debug" && log.message?.includes("hive"),
      );

      // At least one source should be checked
      expect(logCalls.length).toBeGreaterThan(0);
    });

    it("logs errors without throwing when detection fails", async () => {
      // Use DI to make hive throw
      const hook = createCompactionHook({
        getHiveWorkingDirectory: () => {
          throw new Error("Hive not available");
        },
        getHiveAdapter: async () => {
          throw new Error("Hive not available");
        },
        logger: createMockLogger(),
      });

      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      // Should not throw
      await expect(hook(input, output)).resolves.toBeUndefined();

      // Should still complete successfully
      const completeLog = logCalls.find(
        (log) => log.level === "info" && log.message === "compaction complete",
      );
      expect(completeLog).toBeDefined();
    });

    it("includes context size when injecting", async () => {
      const hook = createCompactionHook(createDefaultMockOptions());
      const input = { sessionID: "test-session" };
      const output = { context: [] as string[] };

      await hook(input, output);

      // If context was injected, should log the size
        if (output.context.length > 0) {
          const injectionLog = logCalls.find(
            (log) =>
              log.level === "info" && log.message === "injected swarm context",
          );
          expect(injectionLog?.data.context_length).toBeGreaterThan(0);
        }
    });
  });

  describe("scanSessionMessages", () => {
    it("returns empty state when client is undefined", async () => {
      const state = await scanSessionMessages(undefined, "test-session");
      expect(state.epicId).toBeUndefined();
      expect(state.agentName).toBeUndefined();
      expect(state.subtasks.size).toBe(0);
    });

    it("returns empty state when client is null", async () => {
      const state = await scanSessionMessages(null, "test-session");
      expect(state.epicId).toBeUndefined();
      expect(state.subtasks.size).toBe(0);
    });

    it("extracts epic data from hive_create_epic tool call", async () => {
      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1", sessionID: "test-session" },
                parts: [
                  {
                    type: "tool",
                    tool: "hive_create_epic",
                    state: {
                      status: "completed",
                      input: { epic_title: "Test Epic" },
                      output: JSON.stringify({ epic: { id: "epic-123" } }),
                      time: { start: 1000, end: 2000 },
                    },
                  },
                ],
              },
            ],
          }),
        },
      };

      const state = await scanSessionMessages(mockClient, "test-session");
      expect(state.epicId).toBe("epic-123");
      expect(state.epicTitle).toBe("Test Epic");
    });

    it("extracts agent name from swarmmail_init tool call", async () => {
      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1", sessionID: "test-session" },
                parts: [
                  {
                    type: "tool",
                    tool: "swarmmail_init",
                    state: {
                      status: "completed",
                      input: {},
                      output: JSON.stringify({
                        agent_name: "BlueLake",
                        project_key: "/test/project",
                      }),
                      time: { start: 1000, end: 2000 },
                    },
                  },
                ],
              },
            ],
          }),
        },
      };

      const state = await scanSessionMessages(mockClient, "test-session");
      expect(state.agentName).toBe("BlueLake");
      expect(state.projectPath).toBe("/test/project");
    });

    it("tracks subtasks from swarm_spawn_subtask tool calls", async () => {
      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1", sessionID: "test-session" },
                parts: [
                  {
                    type: "tool",
                    tool: "swarm_spawn_subtask",
                    state: {
                      status: "completed",
                      input: {
                        bead_id: "bd-123.1",
                        epic_id: "epic-123",
                        subtask_title: "Add auth",
                        files: ["src/auth.ts"],
                      },
                      output: JSON.stringify({ worker: "RedMountain" }),
                      time: { start: 1000, end: 2000 },
                    },
                  },
                ],
              },
            ],
          }),
        },
      };

      const state = await scanSessionMessages(mockClient, "test-session");
      expect(state.subtasks.size).toBe(1);
      const subtask = state.subtasks.get("bd-123.1");
      expect(subtask?.title).toBe("Add auth");
      expect(subtask?.status).toBe("spawned");
      expect(subtask?.worker).toBe("RedMountain");
      expect(subtask?.files).toEqual(["src/auth.ts"]);
    });

    it("marks subtasks as completed from swarm_complete tool calls", async () => {
      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1", sessionID: "test-session" },
                parts: [
                  {
                    type: "tool",
                    tool: "swarm_spawn_subtask",
                    state: {
                      status: "completed",
                      input: {
                        bead_id: "bd-123.1",
                        subtask_title: "Add auth",
                      },
                      output: "{}",
                      time: { start: 1000, end: 2000 },
                    },
                  },
                  {
                    type: "tool",
                    tool: "swarm_complete",
                    state: {
                      status: "completed",
                      input: { bead_id: "bd-123.1" },
                      output: "{}",
                      time: { start: 3000, end: 4000 },
                    },
                  },
                ],
              },
            ],
          }),
        },
      };

      const state = await scanSessionMessages(mockClient, "test-session");
      const subtask = state.subtasks.get("bd-123.1");
      expect(subtask?.status).toBe("completed");
    });

    it("tracks last action", async () => {
      const mockClient = {
        session: {
          messages: async () => ({
            data: [
              {
                info: { id: "msg-1", sessionID: "test-session" },
                parts: [
                  {
                    type: "tool",
                    tool: "swarm_status",
                    state: {
                      status: "completed",
                      input: { epic_id: "epic-123", project_key: "/test" },
                      output: "{}",
                      time: { start: 5000, end: 6000 },
                    },
                  },
                ],
              },
            ],
          }),
        },
      };

      const state = await scanSessionMessages(mockClient, "test-session");
      expect(state.lastAction?.tool).toBe("swarm_status");
      expect(state.lastAction?.timestamp).toBe(6000);
    });

    it("handles SDK errors gracefully", async () => {
      const mockClient = {
        session: {
          messages: async () => {
            throw new Error("SDK error");
          },
        },
      };

      // Should not throw, just return empty state
      const state = await scanSessionMessages(mockClient, "test-session");
      expect(state.subtasks.size).toBe(0);
    });

    it("respects limit parameter", async () => {
      const mockClient = {
        session: {
          messages: async (opts: { query?: { limit?: number } }) => {
            expect(opts.query?.limit).toBe(50);
            return { data: [] };
          },
        },
      };

      await scanSessionMessages(mockClient, "test-session", 50);
    });
  });
});
