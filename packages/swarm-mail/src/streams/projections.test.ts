/**
 * Unit tests for Projections Layer (TDD - RED phase)
 *
 * Projections query materialized views to compute current state.
 * These are the read-side of CQRS - fast queries over denormalized data.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
// TODO: Update to use createSwarmMailAdapter() - PGlite infrastructure removed
// import { closeDatabase } from "./index";
import { registerAgent, sendMessage, reserveFiles, appendEvent } from "./store";
import { createEvent } from "./events";
import {
  getAgents,
  getAgent,
  getInbox,
  getMessage,
  getActiveReservations,
  checkConflicts,
  getThreadMessages,
} from "./projections";

let TEST_PROJECT_PATH: string;
const PROJECT_KEY = "test-project";

describe.skip("Projections", () => {
  beforeEach(async () => {
    TEST_PROJECT_PATH = join(
      tmpdir(),
      `projections-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await mkdir(TEST_PROJECT_PATH, { recursive: true });
  });

  afterEach(async () => {
    // TODO: Update to use createSwarmMailAdapter()
    // await closeDatabase(TEST_PROJECT_PATH);
    try {
      await rm(join(TEST_PROJECT_PATH, ".opencode"), { recursive: true });
    } catch {
      // Ignore
    }
  });

  // ==========================================================================
  // Agent Projections
  // ==========================================================================

  describe("getAgents", () => {
    it("returns empty array when no agents registered", async () => {
      const agents = await getAgents(PROJECT_KEY, TEST_PROJECT_PATH);
      expect(agents).toEqual([]);
    });

    it("returns all agents for a project", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "RedStone", {}, TEST_PROJECT_PATH);

      const agents = await getAgents(PROJECT_KEY, TEST_PROJECT_PATH);

      expect(agents.length).toBe(2);
      expect(agents.map((a) => a.name).sort()).toEqual([
        "BlueLake",
        "RedStone",
      ]);
    });

    it("only returns agents for specified project", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await registerAgent("other-project", "RedStone", {}, TEST_PROJECT_PATH);

      const agents = await getAgents(PROJECT_KEY, TEST_PROJECT_PATH);

      expect(agents.length).toBe(1);
      expect(agents[0]?.name).toBe("BlueLake");
    });
  });

  describe("getAgent", () => {
    it("returns null for non-existent agent", async () => {
      const agent = await getAgent(
        PROJECT_KEY,
        "NonExistent",
        TEST_PROJECT_PATH,
      );
      expect(agent).toBeNull();
    });

    it("returns agent details", async () => {
      await registerAgent(
        PROJECT_KEY,
        "BlueLake",
        {
          program: "opencode",
          model: "claude-sonnet-4",
          taskDescription: "Testing",
        },
        TEST_PROJECT_PATH,
      );

      const agent = await getAgent(PROJECT_KEY, "BlueLake", TEST_PROJECT_PATH);

      expect(agent).not.toBeNull();
      expect(agent?.name).toBe("BlueLake");
      expect(agent?.program).toBe("opencode");
      expect(agent?.model).toBe("claude-sonnet-4");
      expect(agent?.task_description).toBe("Testing");
    });

    it("returns updated last_active_at after activity", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);

      const before = await getAgent(PROJECT_KEY, "BlueLake", TEST_PROJECT_PATH);
      const beforeActive = before?.last_active_at;

      // Wait a bit and send activity
      await new Promise((r) => setTimeout(r, 10));
      await appendEvent(
        createEvent("agent_active", {
          project_key: PROJECT_KEY,
          agent_name: "BlueLake",
        }),
        TEST_PROJECT_PATH,
      );

      const after = await getAgent(PROJECT_KEY, "BlueLake", TEST_PROJECT_PATH);

      expect(after?.last_active_at).toBeGreaterThan(beforeActive ?? 0);
    });
  });

  // ==========================================================================
  // Message Projections
  // ==========================================================================

  describe("getInbox", () => {
    it("returns empty array when no messages", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);

      const inbox = await getInbox(
        PROJECT_KEY,
        "BlueLake",
        {},
        TEST_PROJECT_PATH,
      );

      expect(inbox).toEqual([]);
    });

    it("returns messages sent to agent", async () => {
      await registerAgent(PROJECT_KEY, "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Receiver", {}, TEST_PROJECT_PATH);

      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Hello",
        "World",
        {},
        TEST_PROJECT_PATH,
      );

      const inbox = await getInbox(
        PROJECT_KEY,
        "Receiver",
        {},
        TEST_PROJECT_PATH,
      );

      expect(inbox.length).toBe(1);
      expect(inbox[0]?.subject).toBe("Hello");
      expect(inbox[0]?.from_agent).toBe("Sender");
    });

    it("respects limit parameter", async () => {
      await registerAgent(PROJECT_KEY, "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Receiver", {}, TEST_PROJECT_PATH);

      for (let i = 0; i < 5; i++) {
        await sendMessage(
          PROJECT_KEY,
          "Sender",
          ["Receiver"],
          `Message ${i}`,
          "Body",
          {},
          TEST_PROJECT_PATH,
        );
      }

      const inbox = await getInbox(
        PROJECT_KEY,
        "Receiver",
        { limit: 2 },
        TEST_PROJECT_PATH,
      );

      expect(inbox.length).toBe(2);
    });

    it("filters by urgentOnly", async () => {
      await registerAgent(PROJECT_KEY, "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Receiver", {}, TEST_PROJECT_PATH);

      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Normal",
        "Body",
        { importance: "normal" },
        TEST_PROJECT_PATH,
      );
      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Urgent",
        "Body",
        { importance: "urgent" },
        TEST_PROJECT_PATH,
      );

      const inbox = await getInbox(
        PROJECT_KEY,
        "Receiver",
        { urgentOnly: true },
        TEST_PROJECT_PATH,
      );

      expect(inbox.length).toBe(1);
      expect(inbox[0]?.subject).toBe("Urgent");
    });

    it("filters by unreadOnly", async () => {
      await registerAgent(PROJECT_KEY, "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Receiver", {}, TEST_PROJECT_PATH);

      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Message 1",
        "Body",
        {},
        TEST_PROJECT_PATH,
      );
      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Message 2",
        "Body",
        {},
        TEST_PROJECT_PATH,
      );

      // Mark second message as read
      await appendEvent(
        createEvent("message_read", {
          project_key: PROJECT_KEY,
          message_id: 2, // Second message
          agent_name: "Receiver",
        }),
        TEST_PROJECT_PATH,
      );

      const inbox = await getInbox(
        PROJECT_KEY,
        "Receiver",
        { unreadOnly: true },
        TEST_PROJECT_PATH,
      );

      expect(inbox.length).toBe(1);
      expect(inbox[0]?.subject).toBe("Message 1");
    });

    it("excludes body when includeBodies is false", async () => {
      await registerAgent(PROJECT_KEY, "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Receiver", {}, TEST_PROJECT_PATH);

      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Hello",
        "This is the body",
        {},
        TEST_PROJECT_PATH,
      );

      const inbox = await getInbox(
        PROJECT_KEY,
        "Receiver",
        { includeBodies: false },
        TEST_PROJECT_PATH,
      );

      expect(inbox[0]?.body).toBeUndefined();
    });
  });

  describe("getMessage", () => {
    it("returns null for non-existent message", async () => {
      const msg = await getMessage(PROJECT_KEY, 999, TEST_PROJECT_PATH);
      expect(msg).toBeNull();
    });

    it("returns full message with body", async () => {
      await registerAgent(PROJECT_KEY, "Sender", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Receiver", {}, TEST_PROJECT_PATH);

      await sendMessage(
        PROJECT_KEY,
        "Sender",
        ["Receiver"],
        "Hello",
        "Full body content",
        { threadId: "bd-123" },
        TEST_PROJECT_PATH,
      );

      const msg = await getMessage(PROJECT_KEY, 1, TEST_PROJECT_PATH);

      expect(msg).not.toBeNull();
      expect(msg?.subject).toBe("Hello");
      expect(msg?.body).toBe("Full body content");
      expect(msg?.thread_id).toBe("bd-123");
    });
  });

  describe("getThreadMessages", () => {
    it("returns empty array for non-existent thread", async () => {
      const messages = await getThreadMessages(
        PROJECT_KEY,
        "non-existent",
        TEST_PROJECT_PATH,
      );
      expect(messages).toEqual([]);
    });

    it("returns all messages in a thread", async () => {
      await registerAgent(PROJECT_KEY, "Agent1", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "Agent2", {}, TEST_PROJECT_PATH);

      const threadId = "bd-epic-123";

      await sendMessage(
        PROJECT_KEY,
        "Agent1",
        ["Agent2"],
        "First",
        "Body 1",
        { threadId },
        TEST_PROJECT_PATH,
      );
      await sendMessage(
        PROJECT_KEY,
        "Agent2",
        ["Agent1"],
        "Reply",
        "Body 2",
        { threadId },
        TEST_PROJECT_PATH,
      );
      await sendMessage(
        PROJECT_KEY,
        "Agent1",
        ["Agent2"],
        "Unrelated",
        "Body 3",
        {}, // No thread
        TEST_PROJECT_PATH,
      );

      const messages = await getThreadMessages(
        PROJECT_KEY,
        threadId,
        TEST_PROJECT_PATH,
      );

      expect(messages.length).toBe(2);
      expect(messages[0]?.subject).toBe("First");
      expect(messages[1]?.subject).toBe("Reply");
    });
  });

  // ==========================================================================
  // Reservation Projections
  // ==========================================================================

  describe("getActiveReservations", () => {
    it("returns empty array when no reservations", async () => {
      const reservations = await getActiveReservations(
        PROJECT_KEY,
        TEST_PROJECT_PATH,
      );
      expect(reservations).toEqual([]);
    });

    it("returns active reservations", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);

      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/auth/**"],
        { reason: "Working on auth", ttlSeconds: 3600 },
        TEST_PROJECT_PATH,
      );

      const reservations = await getActiveReservations(
        PROJECT_KEY,
        TEST_PROJECT_PATH,
      );

      expect(reservations.length).toBe(1);
      expect(reservations[0]?.agent_name).toBe("BlueLake");
      expect(reservations[0]?.path_pattern).toBe("src/auth/**");
    });

    it("excludes released reservations", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);

      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/auth/**"],
        { ttlSeconds: 3600 },
        TEST_PROJECT_PATH,
      );

      // Release the reservation
      await appendEvent(
        createEvent("file_released", {
          project_key: PROJECT_KEY,
          agent_name: "BlueLake",
          paths: ["src/auth/**"],
        }),
        TEST_PROJECT_PATH,
      );

      const reservations = await getActiveReservations(
        PROJECT_KEY,
        TEST_PROJECT_PATH,
      );

      expect(reservations.length).toBe(0);
    });

    it("excludes expired reservations", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);

      // Create reservation that expires immediately
      await appendEvent(
        createEvent("file_reserved", {
          project_key: PROJECT_KEY,
          agent_name: "BlueLake",
          paths: ["src/expired/**"],
          exclusive: true,
          ttl_seconds: 0,
          expires_at: Date.now() - 1000, // Already expired
        }),
        TEST_PROJECT_PATH,
      );

      const reservations = await getActiveReservations(
        PROJECT_KEY,
        TEST_PROJECT_PATH,
      );

      expect(reservations.length).toBe(0);
    });

    it("filters by agent when specified", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await registerAgent(PROJECT_KEY, "RedStone", {}, TEST_PROJECT_PATH);

      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/a/**"],
        {},
        TEST_PROJECT_PATH,
      );
      await reserveFiles(
        PROJECT_KEY,
        "RedStone",
        ["src/b/**"],
        {},
        TEST_PROJECT_PATH,
      );

      const reservations = await getActiveReservations(
        PROJECT_KEY,
        TEST_PROJECT_PATH,
        "BlueLake",
      );

      expect(reservations.length).toBe(1);
      expect(reservations[0]?.agent_name).toBe("BlueLake");
    });
  });

  describe("checkConflicts", () => {
    it("returns empty array when no conflicts", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/a/**"],
        {},
        TEST_PROJECT_PATH,
      );

      const conflicts = await checkConflicts(
        PROJECT_KEY,
        "RedStone",
        ["src/b/**"], // Different path
        TEST_PROJECT_PATH,
      );

      expect(conflicts).toEqual([]);
    });

    it("detects exact path conflicts", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/auth.ts"],
        { exclusive: true },
        TEST_PROJECT_PATH,
      );

      const conflicts = await checkConflicts(
        PROJECT_KEY,
        "RedStone",
        ["src/auth.ts"],
        TEST_PROJECT_PATH,
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]?.path).toBe("src/auth.ts");
      expect(conflicts[0]?.holder).toBe("BlueLake");
    });

    it("detects glob pattern conflicts", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/auth/**"],
        { exclusive: true },
        TEST_PROJECT_PATH,
      );

      const conflicts = await checkConflicts(
        PROJECT_KEY,
        "RedStone",
        ["src/auth/oauth.ts"], // Matches glob
        TEST_PROJECT_PATH,
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]?.holder).toBe("BlueLake");
    });

    it("ignores own reservations", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/auth/**"],
        { exclusive: true },
        TEST_PROJECT_PATH,
      );

      const conflicts = await checkConflicts(
        PROJECT_KEY,
        "BlueLake", // Same agent
        ["src/auth/oauth.ts"],
        TEST_PROJECT_PATH,
      );

      expect(conflicts).toEqual([]);
    });

    it("ignores non-exclusive reservations", async () => {
      await registerAgent(PROJECT_KEY, "BlueLake", {}, TEST_PROJECT_PATH);
      await reserveFiles(
        PROJECT_KEY,
        "BlueLake",
        ["src/shared/**"],
        { exclusive: false }, // Non-exclusive
        TEST_PROJECT_PATH,
      );

      const conflicts = await checkConflicts(
        PROJECT_KEY,
        "RedStone",
        ["src/shared/utils.ts"],
        TEST_PROJECT_PATH,
      );

      expect(conflicts).toEqual([]);
    });
  });
});
