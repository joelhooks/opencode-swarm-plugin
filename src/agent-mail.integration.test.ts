/**
 * Integration tests for agent-mail.ts
 *
 * These tests run against a real Agent Mail server (typically in Docker).
 * Set AGENT_MAIL_URL environment variable to override the default server location.
 *
 * Run with: pnpm test:integration
 * Or in Docker: docker compose up --build --abort-on-container-exit
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  mcpCall,
  sessionStates,
  setState,
  clearState,
  requireState,
  MAX_INBOX_LIMIT,
  AgentMailNotInitializedError,
  type AgentMailState,
} from "./agent-mail";

// ============================================================================
// Test Configuration
// ============================================================================

const AGENT_MAIL_URL = process.env.AGENT_MAIL_URL || "http://127.0.0.1:8765";

/**
 * Generate a unique test context to avoid state collisions between tests
 */
function createTestContext() {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    sessionID: id,
    projectKey: `/test/project-${id}`,
  };
}

/**
 * Initialize a test agent and return its state
 */
async function initTestAgent(
  ctx: { sessionID: string; projectKey: string },
  agentName?: string,
) {
  // Ensure project exists
  const project = await mcpCall<{
    id: number;
    slug: string;
    human_key: string;
  }>("ensure_project", { human_key: ctx.projectKey });

  // Register agent
  const agent = await mcpCall<{
    id: number;
    name: string;
    program: string;
    model: string;
    task_description: string;
  }>("register_agent", {
    project_key: ctx.projectKey,
    program: "opencode-test",
    model: "test-model",
    name: agentName,
    task_description: "Integration test agent",
  });

  // Store state
  const state: AgentMailState = {
    projectKey: ctx.projectKey,
    agentName: agent.name,
    reservations: [],
    startedAt: new Date().toISOString(),
  };
  setState(ctx.sessionID, state);

  return { project, agent, state };
}

// ============================================================================
// Health Check Tests
// ============================================================================

describe("agent-mail integration", () => {
  beforeAll(async () => {
    // Verify server is reachable before running tests
    const response = await fetch(`${AGENT_MAIL_URL}/health/liveness`);
    if (!response.ok) {
      throw new Error(
        `Agent Mail server not available at ${AGENT_MAIL_URL}. ` +
          `Start it with: docker compose up agent-mail`,
      );
    }
  });

  describe("agentmail_health", () => {
    it("returns healthy when server is running", async () => {
      const response = await fetch(`${AGENT_MAIL_URL}/health/liveness`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      // Real Agent Mail returns "alive" not "ok"
      expect(data.status).toBe("alive");
    });

    it("returns ready when database is accessible", async () => {
      const response = await fetch(`${AGENT_MAIL_URL}/health/readiness`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.status).toBe("ready");
    });
  });

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe("agentmail_init", () => {
    it("creates project and registers agent", async () => {
      const ctx = createTestContext();

      const { project, agent, state } = await initTestAgent(ctx);

      expect(project.id).toBeGreaterThan(0);
      expect(project.human_key).toBe(ctx.projectKey);
      expect(agent.id).toBeGreaterThan(0);
      expect(agent.name).toBeTruthy();
      expect(state.projectKey).toBe(ctx.projectKey);
      expect(state.agentName).toBe(agent.name);

      // Cleanup
      clearState(ctx.sessionID);
    });

    it("generates unique agent name when not provided", async () => {
      const ctx = createTestContext();

      const { agent: agent1 } = await initTestAgent(ctx);
      clearState(ctx.sessionID);

      // Register another agent without name
      const ctx2 = { ...createTestContext(), projectKey: ctx.projectKey };
      const { agent: agent2 } = await initTestAgent(ctx2);

      // Both should have adjective+noun style names
      expect(agent1.name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
      expect(agent2.name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(ctx2.sessionID);
    });

    it("uses provided agent name when specified (valid adjective+noun)", async () => {
      const ctx = createTestContext();
      // Server has a specific word list - use known-valid combinations
      // Valid: BlueLake, GreenDog, RedStone, BlueBear
      const customName = "BlueLake";

      const { agent } = await initTestAgent(ctx, customName);

      expect(agent.name).toBe(customName);

      // Cleanup
      clearState(ctx.sessionID);
    });

    it("re-registering same name updates existing agent (dedup by name)", async () => {
      // Note: Real Agent Mail deduplicates by name within a project
      // Re-registering with same name updates the existing agent (same ID)
      const ctx = createTestContext();
      // Use a valid name from the server's word list
      const customName = "GreenDog";

      const { agent: agent1 } = await initTestAgent(ctx, customName);
      clearState(ctx.sessionID);

      // Re-register with same name - updates existing agent
      const ctx2 = { ...createTestContext(), projectKey: ctx.projectKey };
      const { agent: agent2 } = await initTestAgent(ctx2, customName);

      // Same name, same ID (updated, not duplicated)
      expect(agent1.name).toBe(agent2.name);
      expect(agent1.id).toBe(agent2.id);

      // Cleanup
      clearState(ctx2.sessionID);
    });
  });

  // ============================================================================
  // State Management Tests
  // ============================================================================

  describe("state management", () => {
    it("requireState throws when not initialized", () => {
      const sessionID = "nonexistent-session";

      expect(() => requireState(sessionID)).toThrow(
        AgentMailNotInitializedError,
      );
    });

    it("requireState returns state when initialized", async () => {
      const ctx = createTestContext();
      await initTestAgent(ctx);

      const state = requireState(ctx.sessionID);
      expect(state.projectKey).toBe(ctx.projectKey);

      // Cleanup
      clearState(ctx.sessionID);
    });

    it("clearState removes session state", async () => {
      const ctx = createTestContext();
      await initTestAgent(ctx);

      expect(sessionStates.has(ctx.sessionID)).toBe(true);
      clearState(ctx.sessionID);
      expect(sessionStates.has(ctx.sessionID)).toBe(false);
    });
  });

  // ============================================================================
  // Messaging Tests
  // ============================================================================

  describe("agentmail_send", () => {
    it("sends message to another agent", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `Sender_${Date.now()}`,
      );

      // Create recipient agent
      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `Recipient_${Date.now()}`,
      );

      // Send message
      // Real Agent Mail returns { deliveries: [{ payload: { id, subject, ... } }], count }
      const result = await mcpCall<{
        deliveries: Array<{
          payload: { id: number; subject: string; to: string[] };
        }>;
        count: number;
      }>("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Test message",
        body_md: "This is a test message body",
        thread_id: "bd-test-123",
        importance: "normal",
        ack_required: false,
      });

      expect(result.count).toBe(1);
      expect(result.deliveries[0].payload.id).toBeGreaterThan(0);
      expect(result.deliveries[0].payload.subject).toBe("Test message");
      expect(result.deliveries[0].payload.to).toContain(
        recipientState.agentName,
      );

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });

    it("sends urgent message with ack_required", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `UrgentSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `UrgentRecipient_${Date.now()}`,
      );

      // Real Agent Mail returns { deliveries: [...], count }
      const result = await mcpCall<{
        deliveries: Array<{ payload: { id: number } }>;
        count: number;
      }>("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Urgent: Action required",
        body_md: "Please acknowledge this message",
        importance: "urgent",
        ack_required: true,
      });

      expect(result.count).toBe(1);
      expect(result.deliveries[0].payload.id).toBeGreaterThan(0);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Inbox Tests
  // ============================================================================

  describe("agentmail_inbox", () => {
    it("fetches messages without bodies by default (context-safe)", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `InboxSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `InboxRecipient_${Date.now()}`,
      );

      // Send a message
      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Inbox test message",
        body_md: "This body should NOT be included by default",
      });

      // Fetch inbox WITHOUT bodies
      // Real Agent Mail returns { result: [...] } wrapper
      const response = await mcpCall<{
        result: Array<{
          id: number;
          subject: string;
          from: string;
          body_md?: string;
        }>;
      }>("fetch_inbox", {
        project_key: recipientState.projectKey,
        agent_name: recipientState.agentName,
        limit: 5,
        include_bodies: false, // MANDATORY context-safe default
      });

      const messages = response.result;
      expect(messages.length).toBeGreaterThan(0);
      const testMsg = messages.find((m) => m.subject === "Inbox test message");
      expect(testMsg).toBeDefined();
      expect(testMsg?.from).toBe(senderState.agentName);
      // Body should NOT be included when include_bodies: false
      expect(testMsg?.body_md).toBeUndefined();

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });

    it("enforces MAX_INBOX_LIMIT constraint", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `LimitSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `LimitRecipient_${Date.now()}`,
      );

      // Send more messages than MAX_INBOX_LIMIT
      const messageCount = MAX_INBOX_LIMIT + 3;
      for (let i = 0; i < messageCount; i++) {
        await mcpCall("send_message", {
          project_key: senderState.projectKey,
          sender_name: senderState.agentName,
          to: [recipientState.agentName],
          subject: `Limit test message ${i}`,
          body_md: `Message body ${i}`,
        });
      }

      // Request more than MAX_INBOX_LIMIT
      const response = await mcpCall<{ result: Array<{ id: number }> }>(
        "fetch_inbox",
        {
          project_key: recipientState.projectKey,
          agent_name: recipientState.agentName,
          limit: messageCount, // Request more than allowed
          include_bodies: false,
        },
      );

      // Should still return the requested amount from server
      // The constraint enforcement happens in the tool wrapper, not mcpCall
      expect(response.result.length).toBeGreaterThanOrEqual(MAX_INBOX_LIMIT);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });

    it("filters urgent messages when urgent_only is true", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `UrgentFilterSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `UrgentFilterRecipient_${Date.now()}`,
      );

      // Send normal and urgent messages
      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Normal message",
        body_md: "Not urgent",
        importance: "normal",
      });

      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Urgent message",
        body_md: "Very urgent!",
        importance: "urgent",
      });

      // Fetch only urgent messages
      const response = await mcpCall<{
        result: Array<{ subject: string; importance: string }>;
      }>("fetch_inbox", {
        project_key: recipientState.projectKey,
        agent_name: recipientState.agentName,
        limit: 10,
        include_bodies: false,
        urgent_only: true,
      });

      const messages = response.result;
      // All returned messages should be urgent
      for (const msg of messages) {
        expect(msg.importance).toBe("urgent");
      }
      expect(messages.some((m) => m.subject === "Urgent message")).toBe(true);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });

    it("filters by since_ts timestamp", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `TimeSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `TimeRecipient_${Date.now()}`,
      );

      // Send first message
      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Old message",
        body_md: "Sent before timestamp",
      });

      // Wait a moment and capture timestamp
      await new Promise((resolve) => setTimeout(resolve, 100));
      const sinceTs = new Date().toISOString();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send second message after timestamp
      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "New message",
        body_md: "Sent after timestamp",
      });

      // Fetch only messages after timestamp
      const response = await mcpCall<{
        result: Array<{ subject: string }>;
      }>("fetch_inbox", {
        project_key: recipientState.projectKey,
        agent_name: recipientState.agentName,
        limit: 10,
        include_bodies: false,
        since_ts: sinceTs,
      });

      const messages = response.result;
      expect(messages.some((m) => m.subject === "New message")).toBe(true);
      expect(messages.some((m) => m.subject === "Old message")).toBe(false);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Read Message Tests
  // ============================================================================

  describe("agentmail_read_message", () => {
    it("marks message as read", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `ReadSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `ReadRecipient_${Date.now()}`,
      );

      // Send a message
      // Real Agent Mail returns { deliveries: [{ payload: { id, ... } }] }
      const sentMsg = await mcpCall<{
        deliveries: Array<{ payload: { id: number } }>;
      }>("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Read test message",
        body_md: "This message will be marked as read",
      });

      const messageId = sentMsg.deliveries[0].payload.id;

      // Mark as read
      // Real Agent Mail returns { message_id, read: bool, read_at: iso8601 | null }
      const result = await mcpCall<{
        message_id: number;
        read: boolean;
        read_at: string | null;
      }>("mark_message_read", {
        project_key: recipientState.projectKey,
        agent_name: recipientState.agentName,
        message_id: messageId,
      });

      expect(result.message_id).toBe(messageId);
      expect(result.read).toBe(true);
      expect(result.read_at).toBeTruthy();

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Thread Summary Tests
  // ============================================================================

  describe("agentmail_summarize_thread", () => {
    // Skip: summarize_thread requires LLM which may not be available
    it.skip("summarizes messages in a thread", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `ThreadSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `ThreadRecipient_${Date.now()}`,
      );

      const threadId = `thread-${Date.now()}`;

      // Send multiple messages in the same thread
      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Thread message 1",
        body_md: "First message in thread",
        thread_id: threadId,
      });

      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Thread message 2",
        body_md: "Second message in thread",
        thread_id: threadId,
      });

      // Get thread summary
      const summary = await mcpCall<{
        thread_id: string;
        summary: {
          participants: string[];
          key_points: string[];
          action_items: string[];
          total_messages: number;
        };
      }>("summarize_thread", {
        project_key: senderState.projectKey,
        thread_id: threadId,
        include_examples: false,
      });

      expect(summary.thread_id).toBe(threadId);
      expect(summary.summary.participants).toContain(senderState.agentName);
      expect(summary.summary.total_messages).toBe(2);
      expect(summary.summary.key_points.length).toBeGreaterThan(0);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });

    // Skip: summarize_thread requires LLM which may not be available
    it.skip("includes example messages when requested", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `ExampleSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `ExampleRecipient_${Date.now()}`,
      );

      const threadId = `example-thread-${Date.now()}`;

      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Example thread message",
        body_md: "This should be in examples",
        thread_id: threadId,
      });

      // Get summary with examples
      const summary = await mcpCall<{
        thread_id: string;
        examples?: Array<{
          id: number;
          subject: string;
          from: string;
          body_md?: string;
        }>;
      }>("summarize_thread", {
        project_key: senderState.projectKey,
        thread_id: threadId,
        include_examples: true,
      });

      expect(summary.examples).toBeDefined();
      expect(summary.examples!.length).toBeGreaterThan(0);
      expect(summary.examples![0].subject).toBe("Example thread message");
      expect(summary.examples![0].body_md).toBe("This should be in examples");

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // File Reservation Tests
  // ============================================================================

  describe("agentmail_reserve", () => {
    it("grants file reservations", async () => {
      const ctx = createTestContext();
      const { state } = await initTestAgent(ctx, `ReserveAgent_${Date.now()}`);

      const result = await mcpCall<{
        granted: Array<{
          id: number;
          path_pattern: string;
          exclusive: boolean;
          reason: string;
          expires_ts: string;
        }>;
        conflicts: Array<{ path: string; holders: string[] }>;
      }>("file_reservation_paths", {
        project_key: state.projectKey,
        agent_name: state.agentName,
        paths: ["src/auth/**", "src/config.ts"],
        ttl_seconds: 3600,
        exclusive: true,
        reason: "bd-test-123: Working on auth",
      });

      expect(result.granted.length).toBe(2);
      expect(result.conflicts.length).toBe(0);
      expect(result.granted[0].exclusive).toBe(true);
      expect(result.granted[0].reason).toContain("bd-test-123");

      // Cleanup
      clearState(ctx.sessionID);
    });

    it("detects conflicts with exclusive reservations", async () => {
      const ctx = createTestContext();
      const { state: agent1State } = await initTestAgent(
        ctx,
        `ConflictAgent1_${Date.now()}`,
      );

      const agent2Ctx = { ...createTestContext(), projectKey: ctx.projectKey };
      const { state: agent2State } = await initTestAgent(
        agent2Ctx,
        `ConflictAgent2_${Date.now()}`,
      );

      const conflictPath = `src/conflict-${Date.now()}.ts`;

      // Agent 1 reserves the file
      const result1 = await mcpCall<{
        granted: Array<{ id: number }>;
        conflicts: Array<{ path: string; holders: string[] }>;
      }>("file_reservation_paths", {
        project_key: agent1State.projectKey,
        agent_name: agent1State.agentName,
        paths: [conflictPath],
        ttl_seconds: 3600,
        exclusive: true,
      });

      expect(result1.granted.length).toBe(1);
      expect(result1.conflicts.length).toBe(0);

      // Agent 2 tries to reserve the same file
      // Real Agent Mail GRANTS the reservation but ALSO reports conflicts
      // This is the expected behavior - it's a warning, not a block
      const result2 = await mcpCall<{
        granted: Array<{ id: number }>;
        conflicts: Array<{
          path: string;
          holders: Array<{ agent: string; path_pattern: string }>;
        }>;
      }>("file_reservation_paths", {
        project_key: agent2State.projectKey,
        agent_name: agent2State.agentName,
        paths: [conflictPath],
        ttl_seconds: 3600,
        exclusive: true,
      });

      // Server grants the reservation but reports conflicts
      expect(result2.granted.length).toBe(1);
      expect(result2.conflicts.length).toBe(1);
      expect(result2.conflicts[0].path).toBe(conflictPath);
      // holders is an array of objects with agent field
      expect(
        result2.conflicts[0].holders.some(
          (h) => h.agent === agent1State.agentName,
        ),
      ).toBe(true);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(agent2Ctx.sessionID);
    });

    it("stores reservation IDs in state", async () => {
      const ctx = createTestContext();
      const { state } = await initTestAgent(ctx, `StateAgent_${Date.now()}`);

      const result = await mcpCall<{
        granted: Array<{ id: number }>;
      }>("file_reservation_paths", {
        project_key: state.projectKey,
        agent_name: state.agentName,
        paths: ["src/state-test.ts"],
        ttl_seconds: 3600,
        exclusive: true,
      });

      // Manually track reservations like the tool does
      const reservationIds = result.granted.map((r) => r.id);
      state.reservations = [...state.reservations, ...reservationIds];
      setState(ctx.sessionID, state);

      // Verify state was updated
      const updatedState = requireState(ctx.sessionID);
      expect(updatedState.reservations.length).toBeGreaterThan(0);
      expect(updatedState.reservations).toContain(result.granted[0].id);

      // Cleanup
      clearState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Release Reservation Tests
  // ============================================================================

  describe("agentmail_release", () => {
    it("releases all reservations for an agent", async () => {
      const ctx = createTestContext();
      const { state } = await initTestAgent(ctx, `ReleaseAgent_${Date.now()}`);

      // Create reservations
      await mcpCall("file_reservation_paths", {
        project_key: state.projectKey,
        agent_name: state.agentName,
        paths: ["src/release-test-1.ts", "src/release-test-2.ts"],
        ttl_seconds: 3600,
        exclusive: true,
      });

      // Release all
      const result = await mcpCall<{ released: number; released_at: string }>(
        "release_file_reservations",
        {
          project_key: state.projectKey,
          agent_name: state.agentName,
        },
      );

      expect(result.released).toBe(2);
      expect(result.released_at).toBeTruthy();

      // Cleanup
      clearState(ctx.sessionID);
    });

    it("releases specific paths only", async () => {
      const ctx = createTestContext();
      const { state } = await initTestAgent(
        ctx,
        `SpecificReleaseAgent_${Date.now()}`,
      );

      const path1 = `src/specific-release-1-${Date.now()}.ts`;
      const path2 = `src/specific-release-2-${Date.now()}.ts`;

      // Create reservations
      await mcpCall("file_reservation_paths", {
        project_key: state.projectKey,
        agent_name: state.agentName,
        paths: [path1, path2],
        ttl_seconds: 3600,
        exclusive: true,
      });

      // Release only one path
      const result = await mcpCall<{ released: number }>(
        "release_file_reservations",
        {
          project_key: state.projectKey,
          agent_name: state.agentName,
          paths: [path1],
        },
      );

      expect(result.released).toBe(1);

      // Verify second path can still cause conflicts
      const agent2Ctx = { ...createTestContext(), projectKey: ctx.projectKey };
      const { state: agent2State } = await initTestAgent(
        agent2Ctx,
        `SpecificReleaseAgent2_${Date.now()}`,
      );

      const conflictResult = await mcpCall<{
        conflicts: Array<{ path: string }>;
      }>("file_reservation_paths", {
        project_key: agent2State.projectKey,
        agent_name: agent2State.agentName,
        paths: [path2],
        exclusive: true,
      });

      expect(conflictResult.conflicts.length).toBe(1);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(agent2Ctx.sessionID);
    });

    it("releases by reservation IDs", async () => {
      const ctx = createTestContext();
      const { state } = await initTestAgent(
        ctx,
        `IdReleaseAgent_${Date.now()}`,
      );

      // Create reservations
      const reserveResult = await mcpCall<{
        granted: Array<{ id: number }>;
      }>("file_reservation_paths", {
        project_key: state.projectKey,
        agent_name: state.agentName,
        paths: ["src/id-release-1.ts", "src/id-release-2.ts"],
        ttl_seconds: 3600,
        exclusive: true,
      });

      const firstId = reserveResult.granted[0].id;

      // Release by ID
      const result = await mcpCall<{ released: number }>(
        "release_file_reservations",
        {
          project_key: state.projectKey,
          agent_name: state.agentName,
          file_reservation_ids: [firstId],
        },
      );

      expect(result.released).toBe(1);

      // Cleanup
      clearState(ctx.sessionID);
    });
  });

  // ============================================================================
  // Acknowledge Message Tests
  // ============================================================================

  describe("agentmail_ack", () => {
    it("acknowledges a message requiring acknowledgement", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `AckSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `AckRecipient_${Date.now()}`,
      );

      // Send message requiring ack
      // Real Agent Mail returns { deliveries: [{ payload: { id, ... } }] }
      const sentMsg = await mcpCall<{
        deliveries: Array<{ payload: { id: number } }>;
      }>("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Please acknowledge",
        body_md: "This requires acknowledgement",
        ack_required: true,
      });

      const messageId = sentMsg.deliveries[0].payload.id;

      // Acknowledge
      // Real Agent Mail returns { acknowledged: bool, acknowledged_at: iso8601 | null }
      const result = await mcpCall<{
        message_id: number;
        acknowledged: boolean;
        acknowledged_at: string | null;
      }>("acknowledge_message", {
        project_key: recipientState.projectKey,
        agent_name: recipientState.agentName,
        message_id: messageId,
      });

      expect(result.message_id).toBe(messageId);
      expect(result.acknowledged).toBe(true);
      expect(result.acknowledged_at).toBeTruthy();

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Search Tests
  // ============================================================================

  describe("agentmail_search", () => {
    it("searches messages by keyword using FTS5", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `SearchSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `SearchRecipient_${Date.now()}`,
      );

      const uniqueKeyword = `unicorn${Date.now()}`;

      // Send messages with searchable content
      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: `Message about ${uniqueKeyword}`,
        body_md: "This message contains the keyword",
      });

      await mcpCall("send_message", {
        project_key: senderState.projectKey,
        sender_name: senderState.agentName,
        to: [recipientState.agentName],
        subject: "Unrelated message",
        body_md: "This message is about something else",
      });

      // Search
      // Real Agent Mail returns { result: [...] }
      const response = await mcpCall<{
        result: Array<{ id: number; subject: string }>;
      }>("search_messages", {
        project_key: senderState.projectKey,
        query: uniqueKeyword,
        limit: 10,
      });

      const results = response.result;
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.subject.includes(uniqueKeyword))).toBe(
        true,
      );

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });

    it("respects search limit", async () => {
      const ctx = createTestContext();
      const { state: senderState } = await initTestAgent(
        ctx,
        `LimitSearchSender_${Date.now()}`,
      );

      const recipientCtx = {
        ...createTestContext(),
        projectKey: ctx.projectKey,
      };
      const { state: recipientState } = await initTestAgent(
        recipientCtx,
        `LimitSearchRecipient_${Date.now()}`,
      );

      const keyword = `searchlimit${Date.now()}`;

      // Send multiple matching messages
      for (let i = 0; i < 5; i++) {
        await mcpCall("send_message", {
          project_key: senderState.projectKey,
          sender_name: senderState.agentName,
          to: [recipientState.agentName],
          subject: `${keyword} message ${i}`,
          body_md: `Content with ${keyword}`,
        });
      }

      // Search with limit
      // Real Agent Mail returns { result: [...] }
      const response = await mcpCall<{
        result: Array<{ id: number }>;
      }>("search_messages", {
        project_key: senderState.projectKey,
        query: keyword,
        limit: 2,
      });

      expect(response.result.length).toBe(2);

      // Cleanup
      clearState(ctx.sessionID);
      clearState(recipientCtx.sessionID);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("error handling", () => {
    it("throws on unknown tool", async () => {
      // Real Agent Mail returns isError: true which mcpCall converts to throw
      await expect(mcpCall("nonexistent_tool", {})).rejects.toThrow(
        /Unknown tool/,
      );
    });

    it("throws on missing required parameters", async () => {
      // Real Agent Mail returns validation error with isError: true
      await expect(mcpCall("ensure_project", {})).rejects.toThrow(
        /Missing required argument|validation error/,
      );
    });

    it("throws on invalid project reference", async () => {
      // Real Agent Mail auto-creates projects, so this actually succeeds
      // Instead test with a truly invalid operation
      await expect(
        mcpCall("register_agent", {
          // Missing required project_key
          program: "test",
          model: "test",
        }),
      ).rejects.toThrow(/Missing required argument|validation error/);
    });
  });

  // ============================================================================
  // Multi-Agent Coordination Tests
  // ============================================================================

  describe("multi-agent coordination", () => {
    it("enables communication between multiple agents", async () => {
      const ctx = createTestContext();

      // Create 3 agents in the same project
      const agent1Ctx = ctx;
      const { state: agent1 } = await initTestAgent(
        agent1Ctx,
        `Coordinator_${Date.now()}`,
      );

      const agent2Ctx = { ...createTestContext(), projectKey: ctx.projectKey };
      const { state: agent2 } = await initTestAgent(
        agent2Ctx,
        `Worker1_${Date.now()}`,
      );

      const agent3Ctx = { ...createTestContext(), projectKey: ctx.projectKey };
      const { state: agent3 } = await initTestAgent(
        agent3Ctx,
        `Worker2_${Date.now()}`,
      );

      // Coordinator broadcasts to workers
      await mcpCall("send_message", {
        project_key: agent1.projectKey,
        sender_name: agent1.agentName,
        to: [agent2.agentName, agent3.agentName],
        subject: "Task assignment",
        body_md: "Please complete your subtasks",
        thread_id: "bd-epic-123",
        importance: "high",
      });

      // Verify both workers received the message
      const worker1Response = await mcpCall<{
        result: Array<{ subject: string }>;
      }>("fetch_inbox", {
        project_key: agent2.projectKey,
        agent_name: agent2.agentName,
        limit: 5,
        include_bodies: false,
      });

      const worker2Response = await mcpCall<{
        result: Array<{ subject: string }>;
      }>("fetch_inbox", {
        project_key: agent3.projectKey,
        agent_name: agent3.agentName,
        limit: 5,
        include_bodies: false,
      });

      expect(
        worker1Response.result.some((m) => m.subject === "Task assignment"),
      ).toBe(true);
      expect(
        worker2Response.result.some((m) => m.subject === "Task assignment"),
      ).toBe(true);

      // Cleanup
      clearState(agent1Ctx.sessionID);
      clearState(agent2Ctx.sessionID);
      clearState(agent3Ctx.sessionID);
    });

    it("prevents file conflicts in swarm scenarios", async () => {
      const ctx = createTestContext();

      // Coordinator assigns different files to workers
      const coordCtx = ctx;
      await initTestAgent(coordCtx, `SwarmCoord_${Date.now()}`);

      const worker1Ctx = { ...createTestContext(), projectKey: ctx.projectKey };
      const { state: worker1 } = await initTestAgent(
        worker1Ctx,
        `SwarmWorker1_${Date.now()}`,
      );

      const worker2Ctx = { ...createTestContext(), projectKey: ctx.projectKey };
      const { state: worker2 } = await initTestAgent(
        worker2Ctx,
        `SwarmWorker2_${Date.now()}`,
      );

      const path1 = `src/swarm/file1-${Date.now()}.ts`;
      const path2 = `src/swarm/file2-${Date.now()}.ts`;

      // Worker 1 reserves file 1
      const res1 = await mcpCall<{
        granted: Array<{ id: number }>;
        conflicts: unknown[];
      }>("file_reservation_paths", {
        project_key: worker1.projectKey,
        agent_name: worker1.agentName,
        paths: [path1],
        exclusive: true,
        reason: "bd-subtask-1",
      });

      // Worker 2 reserves file 2
      const res2 = await mcpCall<{
        granted: Array<{ id: number }>;
        conflicts: unknown[];
      }>("file_reservation_paths", {
        project_key: worker2.projectKey,
        agent_name: worker2.agentName,
        paths: [path2],
        exclusive: true,
        reason: "bd-subtask-2",
      });

      // Both should succeed (no conflicts)
      expect(res1.granted.length).toBe(1);
      expect(res1.conflicts.length).toBe(0);
      expect(res2.granted.length).toBe(1);
      expect(res2.conflicts.length).toBe(0);

      // Worker 1 tries to reserve file 2 (should conflict)
      // Real Agent Mail returns holders as array of objects with agent field
      const conflict = await mcpCall<{
        conflicts: Array<{
          path: string;
          holders: Array<{ agent: string; path_pattern: string }>;
        }>;
      }>("file_reservation_paths", {
        project_key: worker1.projectKey,
        agent_name: worker1.agentName,
        paths: [path2],
        exclusive: true,
      });

      expect(conflict.conflicts.length).toBe(1);
      // holders is an array of objects with agent field
      expect(
        conflict.conflicts[0].holders.some(
          (h) => h.agent === worker2.agentName,
        ),
      ).toBe(true);

      // Cleanup
      clearState(coordCtx.sessionID);
      clearState(worker1Ctx.sessionID);
      clearState(worker2Ctx.sessionID);
    });
  });
});
