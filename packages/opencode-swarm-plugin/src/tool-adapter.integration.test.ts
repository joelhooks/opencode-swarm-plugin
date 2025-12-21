/**
 * Tool Adapter Wiring Integration Tests
 *
 * **THE BUG WE'RE PREVENTING:**
 * ```
 * Error: [streams/store] dbOverride parameter is required for this function.
 * PGlite getDatabase() has been removed.
 * ```
 *
 * This happened because:
 * 1. Store functions required explicit `dbOverride` parameter
 * 2. Plugin tools called store functions without passing the adapter
 * 3. No integration test exercised the full tool → store → DB path
 *
 * **THESE TESTS VERIFY:**
 * - Tools call store functions correctly (with adapter passed through)
 * - No "dbOverride required" errors occur
 * - Full end-to-end path works: tool.execute() → store → DB
 * - Tests would have FAILED before the fix
 *
 * Run with: bun test src/tool-adapter.integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clearAdapterCache,
  createInMemorySwarmMailLibSQL,
  type SwarmMailAdapter,
} from "swarm-mail";

// Import tools to test
import {
  clearSessionState,
  swarmmail_inbox,
  swarmmail_init,
  swarmmail_read_message,
  swarmmail_release,
  swarmmail_reserve,
  swarmmail_send,
} from "./swarm-mail";

import {
  getHiveWorkingDirectory,
  hive_close,
  hive_create,
  hive_create_epic,
  hive_query,
  hive_ready,
  hive_start,
  hive_update,
  setHiveWorkingDirectory,
} from "./hive";

import {
  swarm_progress,
  swarm_status,
} from "./swarm-orchestrate";

import type { Bead, EpicCreateResult } from "./schemas";

// ============================================================================
// Test Configuration
// ============================================================================

/** Generate unique test database path per test run */
function testDbPath(prefix = "tool-adapter"): string {
  return join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** Track paths created during test for cleanup */
let testPaths: string[] = [];

function trackPath(path: string): string {
  testPaths.push(path);
  return path;
}

let TEST_DB_PATH: string;
let swarmMail: SwarmMailAdapter;

/**
 * Mock tool context
 */
interface MockToolContext {
  sessionID: string;
}

/**
 * Generate a unique test context to avoid state collisions between tests
 */
function createTestContext(): MockToolContext {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { sessionID: id };
}

/**
 * Helper to execute tool and parse JSON response
 */
async function executeTool<T>(
  tool: { execute: (args: unknown, ctx: unknown) => Promise<string> },
  args: unknown,
  ctx: MockToolContext,
): Promise<T> {
  const result = await tool.execute(args, ctx);
  return JSON.parse(result) as T;
}

/**
 * Helper to execute tool and return raw string
 */
async function executeToolRaw(
  tool: { execute: (args: unknown, ctx: unknown) => Promise<string> },
  args: unknown,
  ctx: MockToolContext,
): Promise<string> {
  return await tool.execute(args, ctx);
}

// ============================================================================
// Test Lifecycle Hooks
// ============================================================================

beforeEach(async () => {
  testPaths = [];
  TEST_DB_PATH = trackPath(testDbPath());
  
  // Create directory for test database (tools will create DB here)
  await mkdir(TEST_DB_PATH, { recursive: true });
  
  // Clear adapter cache to ensure clean state
  clearAdapterCache();
  
  // Don't create SwarmMail here - let tools create it
  // This ensures tests use the SAME DB adapter as tools
  swarmMail = null!;
});

afterEach(async () => {
  // Close SwarmMail adapter if created
  if (swarmMail) {
    await swarmMail.close();
  }
  
  // Clear all cached adapters
  clearAdapterCache();
  
  // Clean up all test database directories
  for (const path of testPaths) {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Ignore errors during cleanup
    }
  }
  testPaths = [];
});

// ============================================================================
// SWARM MAIL TOOLS - Adapter Wiring Tests
// ============================================================================

describe("swarmmail tools adapter wiring", () => {
  /**
   * TEST: swarmmail_init creates adapter and registers agent
   * 
   * This was the FIRST thing that broke when DB adapter wiring was wrong.
   * The error manifested as:
   * "Error: [streams/store] dbOverride parameter is required"
   * 
   * KEY: We're NOT testing DB state - we're testing NO ERRORS.
   * If adapter wiring is broken, this throws before returning.
   */
  it("swarmmail_init works without explicit dbOverride", async () => {
    const ctx = createTestContext();

    const result = await executeTool<{
      agent_name: string;
      project_key: string;
      message: string;
    }>(swarmmail_init, { project_path: TEST_DB_PATH }, ctx);

    // Should succeed (no "dbOverride required" error)
    expect(result.agent_name).toBeTruthy();
    expect(result.project_key).toBe(TEST_DB_PATH);
    expect(result.message).toContain(result.agent_name);
    
    // If we got here, adapter wiring works!
    // (The bug would have thrown "dbOverride required" before returning)

    clearSessionState(ctx.sessionID);
  });

  /**
   * TEST: swarmmail_send works after init
   * 
   * Full flow: init → send → verify no errors
   * KEY: We're testing adapter wiring, not DB state.
   * The bug manifested as "dbOverride required" error during send.
   */
  it("swarmmail_send works without explicit dbOverride", async () => {
    const senderCtx = createTestContext();
    const recipientCtx = createTestContext();

    // Initialize both agents
    await executeTool<{ agent_name: string }>(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "Sender" },
      senderCtx,
    );

    const recipient = await executeTool<{ agent_name: string }>(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "Recipient" },
      recipientCtx,
    );

    // Send message (this calls store functions)
    const result = await executeTool<{
      success: boolean;
      message_id: number;
      thread_id?: string;
      recipient_count: number;
    }>(
      swarmmail_send,
      {
        to: [recipient.agent_name],
        subject: "Test message",
        body: "This is a test message body",
        thread_id: "bd-test-123",
        importance: "normal",
      },
      senderCtx,
    );

    // Should succeed (no "dbOverride required" error)
    expect(result.success).toBe(true);
    expect(result.message_id).toBeGreaterThan(0);
    expect(result.thread_id).toBe("bd-test-123");
    
    // If we got here, adapter wiring works!

    clearSessionState(senderCtx.sessionID);
    clearSessionState(recipientCtx.sessionID);
  });

  /**
   * TEST: swarmmail_inbox returns messages
   * 
   * Full flow: init → send → inbox → verify
   * Tests that message queries go through DB adapter correctly
   */
  it("swarmmail_inbox works without explicit dbOverride", async () => {
    const senderCtx = createTestContext();
    const recipientCtx = createTestContext();

    await executeTool<{ agent_name: string }>(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "InboxSender" },
      senderCtx,
    );

    const recipient = await executeTool<{ agent_name: string }>(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "InboxRecipient" },
      recipientCtx,
    );

    // Send a message
    await executeTool(
      swarmmail_send,
      {
        to: [recipient.agent_name],
        subject: "Inbox test message",
        body: "This body should NOT be included by default",
      },
      senderCtx,
    );

    // Fetch inbox (this calls store functions to query messages)
    const result = await executeTool<{
      messages: Array<{
        id: number;
        from: string;
        subject: string;
        body?: string;
      }>;
      total: number;
      note: string;
    }>(swarmmail_inbox, {}, recipientCtx);

    // Should succeed
    expect(result.messages.length).toBeGreaterThan(0);
    const testMsg = result.messages.find(
      (m) => m.subject === "Inbox test message",
    );
    expect(testMsg).toBeDefined();
    expect(testMsg?.from).toBe("InboxSender");
    // Body should NOT be included (context-safe)
    expect(testMsg?.body).toBeUndefined();

    clearSessionState(senderCtx.sessionID);
    clearSessionState(recipientCtx.sessionID);
  });

  /**
   * TEST: swarmmail_read_message returns full message
   * 
   * Tests that fetching individual message bodies works through DB adapter
   */
  it("swarmmail_read_message works without explicit dbOverride", async () => {
    const senderCtx = createTestContext();
    const recipientCtx = createTestContext();

    await executeTool<{ agent_name: string }>(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "ReadSender" },
      senderCtx,
    );

    const recipient = await executeTool<{ agent_name: string }>(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "ReadRecipient" },
      recipientCtx,
    );

    // Send a message
    const sent = await executeTool<{ message_id: number }>(
      swarmmail_send,
      {
        to: [recipient.agent_name],
        subject: "Read test message",
        body: "This message body should be returned",
      },
      senderCtx,
    );

    // Read the message (this calls store functions)
    const result = await executeTool<{
      id: number;
      from: string;
      subject: string;
      body: string;
    }>(swarmmail_read_message, { message_id: sent.message_id }, recipientCtx);

    // Should succeed
    expect(result.id).toBe(sent.message_id);
    expect(result.from).toBe("ReadSender");
    expect(result.subject).toBe("Read test message");
    expect(result.body).toBe("This message body should be returned");

    clearSessionState(senderCtx.sessionID);
    clearSessionState(recipientCtx.sessionID);
  });

  /**
   * TEST: swarmmail_reserve creates reservations
   * 
   * Full flow: init → reserve → verify no errors
   * KEY: We're testing adapter wiring, not DB state.
   */
  it("swarmmail_reserve works without explicit dbOverride", async () => {
    const ctx = createTestContext();

    await executeTool(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "ReserveAgent" },
      ctx,
    );

    // Reserve files (this calls store functions)
    const result = await executeTool<{
      granted: Array<{
        id: number;
        path_pattern: string;
        exclusive: boolean;
      }>;
      conflicts?: Array<{ path: string; holders: string[] }>;
    }>(
      swarmmail_reserve,
      {
        paths: ["src/auth/**", "src/config.ts"],
        reason: "bd-test-123: Working on auth",
        exclusive: true,
        ttl_seconds: 3600,
      },
      ctx,
    );

    // Should succeed (no "dbOverride required" error)
    expect(result.granted.length).toBe(2);
    expect(result.conflicts).toBeUndefined();
    expect(result.granted[0].exclusive).toBe(true);
    
    // If we got here, adapter wiring works!

    clearSessionState(ctx.sessionID);
  });

  /**
   * TEST: swarmmail_release releases reservations
   * 
   * Tests that releasing file reservations works through DB adapter
   */
  it("swarmmail_release works without explicit dbOverride", async () => {
    const ctx = createTestContext();

    await executeTool(
      swarmmail_init,
      { project_path: TEST_DB_PATH, agent_name: "ReleaseAgent" },
      ctx,
    );

    // Create reservations
    await executeTool(
      swarmmail_reserve,
      {
        paths: ["src/release-test-1.ts", "src/release-test-2.ts"],
        exclusive: true,
      },
      ctx,
    );

    // Release all (this calls store functions)
    const result = await executeTool<{
      released: number;
      released_at: string;
    }>(swarmmail_release, {}, ctx);

    // Should succeed
    expect(result.released).toBe(2);
    expect(result.released_at).toBeTruthy();

    clearSessionState(ctx.sessionID);
  });
});

// ============================================================================
// HIVE TOOLS - Adapter Wiring Tests
// ============================================================================

describe("hive tools adapter wiring", () => {
  const createdCellIds: string[] = [];

  afterEach(async () => {
    // Close all created cells
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);
    
    for (const id of createdCellIds) {
      try {
        await hive_close.execute({ id, reason: "Test cleanup" }, createTestContext());
      } catch {
        // Ignore cleanup errors
      }
    }
    createdCellIds.length = 0;
    
    setHiveWorkingDirectory(originalDir);
  });

  /**
   * TEST: hive_create works end-to-end
   * 
   * Create cell, verify in DB
   * Tests that cell creation goes through DB adapter correctly
   */
  it("hive_create works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      const result = await executeTool<Bead>(
        hive_create,
        { title: "Test cell minimal" },
        ctx,
      );

      createdCellIds.push(result.id);

      // Should succeed
      expect(result.title).toBe("Test cell minimal");
      expect(result.status).toBe("open");
      expect(result.issue_type).toBe("task");
      expect(result.id).toMatch(/^[a-z0-9-]+-[a-z0-9]+$/);

      // Get the Hive adapter that tools are using
      const { getHiveAdapter } = await import("./hive");
      const hiveAdapter = await getHiveAdapter(TEST_DB_PATH);
      
      // Verify cell was created via adapter
      const cell = await hiveAdapter.getCell(TEST_DB_PATH, result.id);
      expect(cell).toBeDefined();
      expect(cell!.title).toBe("Test cell minimal");
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: hive_query returns cells
   * 
   * Create cells, query, verify results
   * Tests that cell queries go through DB adapter correctly
   */
  it("hive_query works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create a test cell
      const created = await executeTool<Bead>(
        hive_create,
        { title: "Query test cell", type: "task" },
        ctx,
      );
      createdCellIds.push(created.id);

      // Query cells (this calls store functions)
      const result = await executeTool<Bead[]>(
        hive_query,
        { status: "open" },
        ctx,
      );

      // Should succeed
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((b) => b.status === "open")).toBe(true);

      // Find our test cell
      const found = result.find((b) => b.id === created.id);
      expect(found).toBeDefined();
      expect(found?.title).toBe("Query test cell");
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: hive_update updates cell
   * 
   * Tests that cell updates go through DB adapter correctly
   */
  it("hive_update works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create a test cell
      const created = await executeTool<Bead>(
        hive_create,
        { title: "Update test cell", description: "Original description" },
        ctx,
      );
      createdCellIds.push(created.id);

      // Update cell (this calls store functions)
      const result = await executeTool<Bead>(
        hive_update,
        { id: created.id, description: "Updated description" },
        ctx,
      );

      // Should succeed
      expect(result.description).toContain("Updated description");

      // Verify update via adapter
      const { getHiveAdapter } = await import("./hive");
      const hiveAdapter = await getHiveAdapter(TEST_DB_PATH);
      const cell = await hiveAdapter.getCell(TEST_DB_PATH, created.id);
      expect(cell!.description).toContain("Updated description");
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: hive_close closes cell
   * 
   * Tests that closing cells goes through DB adapter correctly
   */
  it("hive_close works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create a test cell
      const created = await executeTool<Bead>(
        hive_create,
        { title: "Close test cell" },
        ctx,
      );

      // Close cell (this calls store functions)
      const result = await executeToolRaw(
        hive_close,
        { id: created.id, reason: "Task completed" },
        ctx,
      );

      // Should succeed
      expect(result).toContain("Closed");
      expect(result).toContain(created.id);

      // Verify cell is closed via adapter
      const { getHiveAdapter } = await import("./hive");
      const hiveAdapter = await getHiveAdapter(TEST_DB_PATH);
      const cell = await hiveAdapter.getCell(TEST_DB_PATH, created.id);
      expect(cell!.status).toBe("closed");
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: hive_start marks cell as in_progress
   * 
   * Tests that starting cells goes through DB adapter correctly
   */
  it("hive_start works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create a test cell
      const created = await executeTool<Bead>(
        hive_create,
        { title: "Start test cell" },
        ctx,
      );
      createdCellIds.push(created.id);

      expect(created.status).toBe("open");

      // Start cell (this calls store functions)
      const result = await executeToolRaw(
        hive_start,
        { id: created.id },
        ctx,
      );

      // Should succeed
      expect(result).toContain("Started");
      expect(result).toContain(created.id);

      // Verify status changed via adapter
      const { getHiveAdapter } = await import("./hive");
      const hiveAdapter = await getHiveAdapter(TEST_DB_PATH);
      const cell = await hiveAdapter.getCell(TEST_DB_PATH, created.id);
      expect(cell!.status).toBe("in_progress");
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: hive_ready returns next unblocked cell
   * 
   * Tests that querying ready cells goes through DB adapter correctly
   */
  it("hive_ready works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create a high priority cell
      const created = await executeTool<Bead>(
        hive_create,
        { title: "Ready test cell", priority: 0 },
        ctx,
      );
      createdCellIds.push(created.id);

      // Get ready cell (this calls store functions)
      const result = await executeToolRaw(hive_ready, {}, ctx);

      // Should succeed (either returns a cell or "No ready beads")
      if (result !== "No ready beads") {
        const cell = JSON.parse(result) as Bead;
        expect(cell.id).toBeDefined();
        expect(cell.status).not.toBe("closed");
        expect(cell.status).not.toBe("blocked");
      } else {
        expect(result).toBe("No ready beads");
      }
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: hive_create_epic creates epic + subtasks atomically
   * 
   * Tests that epic creation goes through DB adapter correctly
   */
  it("hive_create_epic works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create epic (this calls store functions)
      const result = await executeTool<EpicCreateResult>(
        hive_create_epic,
        {
          epic_title: "Integration test epic",
          epic_description: "Testing epic creation",
          subtasks: [
            { title: "Subtask 1", priority: 2 },
            { title: "Subtask 2", priority: 3 },
          ],
        },
        ctx,
      );

      createdCellIds.push(result.epic.id);
      for (const subtask of result.subtasks) {
        createdCellIds.push(subtask.id);
      }

      // Should succeed
      expect(result.success).toBe(true);
      expect(result.epic.title).toBe("Integration test epic");
      expect(result.epic.issue_type).toBe("epic");
      expect(result.subtasks).toHaveLength(2);

      // Verify epic and subtasks via adapter
      const { getHiveAdapter } = await import("./hive");
      const hiveAdapter = await getHiveAdapter(TEST_DB_PATH);
      
      const epic = await hiveAdapter.getCell(TEST_DB_PATH, result.epic.id);
      expect(epic).toBeDefined();
      expect(epic!.title).toBe("Integration test epic");

      for (const subtask of result.subtasks) {
        const sub = await hiveAdapter.getCell(TEST_DB_PATH, subtask.id);
        expect(sub).toBeDefined();
        expect(sub!.parent_id).toBe(result.epic.id);
      }
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });
});

// ============================================================================
// SWARM ORCHESTRATE TOOLS - Adapter Wiring Tests
// ============================================================================

describe("swarm tools adapter wiring", () => {
  /**
   * TEST: swarm_progress works without explicit dbOverride
   * 
   * Tests that progress reporting goes through DB adapter correctly
   */
  it("swarm_progress works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create a test cell first
      const created = await executeTool<Bead>(
        hive_create,
        { title: "Progress test cell" },
        ctx,
      );

      // Initialize swarm mail
      await executeTool(
        swarmmail_init,
        { project_path: TEST_DB_PATH, agent_name: "ProgressAgent" },
        ctx,
      );

      // Report progress (this calls store functions)
      const result = await executeToolRaw(
        swarm_progress,
        {
          project_key: TEST_DB_PATH,
          agent_name: "ProgressAgent",
          bead_id: created.id,
          status: "in_progress",
          message: "50% complete",
          progress_percent: 50,
        },
        ctx,
      );

      // Should succeed (no "dbOverride required" error)
      expect(result).toContain("Progress");
      expect(result).toContain("50%");

      // Just verify no error thrown (progress is logged, not necessarily stored in events table)
      // The key test is that swarm_progress didn't throw "dbOverride required"
      
      clearSessionState(ctx.sessionID);
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });

  /**
   * TEST: swarm_status queries work without explicit dbOverride
   * 
   * Tests that status queries go through DB adapter correctly
   */
  it("swarm_status works without explicit dbOverride", async () => {
    const ctx = createTestContext();
    const originalDir = getHiveWorkingDirectory();
    setHiveWorkingDirectory(TEST_DB_PATH);

    try {
      // Create an epic with subtasks
      const epic = await executeTool<EpicCreateResult>(
        hive_create_epic,
        {
          epic_title: "Status test epic",
          subtasks: [
            { title: "Status subtask 1", priority: 2 },
            { title: "Status subtask 2", priority: 2 },
          ],
        },
        ctx,
      );

      // Get status (this calls store functions)
      const result = await executeTool<{
        epic_id: string;
        total_agents: number;
        agents: Array<{ bead_id: string; status: string }>;
        progress_percent: number;
      }>(
        swarm_status,
        {
          project_key: TEST_DB_PATH,
          epic_id: epic.epic.id,
        },
        ctx,
      );

      // Should succeed (no "dbOverride required" error)
      expect(result.epic_id).toBe(epic.epic.id);
      expect(result.total_agents).toBe(2);
      expect(result.agents).toHaveLength(2);
      expect(result.progress_percent).toBeGreaterThanOrEqual(0);
      
      // If we got here, adapter wiring works!
    } finally {
      setHiveWorkingDirectory(originalDir);
    }
  });
});

/**
 * SUMMARY OF BUGS THESE TESTS PREVENT:
 * 
 * 1. **DB Adapter Not Passed Through**
 *    - Tools call store functions without dbOverride
 *    - Store functions require explicit adapter
 *    - Error: "dbOverride parameter is required"
 * 
 * 2. **Store Function Signature Changes**
 *    - Store functions change to require adapter
 *    - Tools not updated to pass adapter
 *    - Silent breakage until runtime
 * 
 * 3. **Initialization Order Issues**
 *    - Adapter not created before tools use it
 *    - Tools assume adapter exists globally
 *    - Error: "Cannot read property of undefined"
 * 
 * 4. **Context Loss Across Layers**
 *    - Tool → store → DB path breaks
 *    - Each layer assumes next has context
 *    - Integration gap not caught by unit tests
 * 
 * **HOW THESE TESTS CATCH THEM:**
 * - Exercise FULL path: tool.execute() → store → DB
 * - No mocking of store functions
 * - Verify actual DB operations succeed
 * - Would have FAILED before the fix
 */
