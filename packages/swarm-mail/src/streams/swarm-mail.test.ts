/**
 * Swarm Mail Tests
 * 
 * Tests that swarm-mail functions work without requiring explicit dbOverride.
 * The Drizzle convenience wrappers should auto-create adapters.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience";
import type { SwarmMailAdapter } from "../types";

// Import from the module under test
import {
  initSwarmAgent,
  sendSwarmMessage,
  getSwarmInbox,
  readSwarmMessage,
  reserveSwarmFiles,
  releaseSwarmFiles,
  acknowledgeSwarmMessage,
} from "./swarm-mail";

describe("swarm-mail", () => {
  let swarmMail: SwarmMailAdapter;
  const TEST_PROJECT = "/test/swarm-mail-test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("swarm-mail-test");
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  describe("initSwarmAgent", () => {
    test("should initialize agent without throwing dbOverride error", async () => {
      // This should NOT throw "dbOverride parameter is required"
      const result = await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "TestAgent",
        program: "test",
        model: "test-model",
        taskDescription: "Testing swarm-mail",
      });

      expect(result.projectKey).toBe(TEST_PROJECT);
      expect(result.agentName).toBe("TestAgent");
    });
  });

  describe("sendSwarmMessage", () => {
    test("should send message without throwing dbOverride error", async () => {
      // First init an agent
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "Sender",
      });

      // This should NOT throw "dbOverride parameter is required"
      const result = await sendSwarmMessage({
        projectPath: TEST_PROJECT,
        fromAgent: "Sender",
        toAgents: ["Receiver"],
        subject: "Test Subject",
        body: "Test Body",
      });

      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(1);
    });
  });

  describe("getSwarmInbox", () => {
    test("should get inbox without throwing dbOverride error", async () => {
      // Init receiver agent
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "Receiver",
      });

      // This should NOT throw "dbOverride parameter is required"
      const result = await getSwarmInbox({
        projectPath: TEST_PROJECT,
        agentName: "Receiver",
      });

      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
    });
  });

  describe("readSwarmMessage", () => {
    test("should read message without throwing dbOverride error", async () => {
      // Send a message first
      const sendResult = await sendSwarmMessage({
        projectPath: TEST_PROJECT,
        fromAgent: "Sender",
        toAgents: ["Reader"],
        subject: "Read Test",
        body: "Read Test Body",
      });

      // This should NOT throw "dbOverride parameter is required"
      const message = await readSwarmMessage({
        projectPath: TEST_PROJECT,
        messageId: sendResult.messageId,
      });

      // Message may or may not exist depending on timing, but should not throw
      if (message) {
        expect(message.subject).toBe("Read Test");
      }
    });
  });

  describe("reserveSwarmFiles", () => {
    test("should reserve files without throwing dbOverride error", async () => {
      await initSwarmAgent({
        projectPath: TEST_PROJECT,
        agentName: "FileAgent",
      });

      // This should NOT throw "dbOverride parameter is required"
      const result = await reserveSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "FileAgent",
        paths: ["src/test.ts"],
        reason: "Testing",
      });

      expect(result.granted).toBeDefined();
      expect(Array.isArray(result.granted)).toBe(true);
    });
  });

  describe("releaseSwarmFiles", () => {
    test("should release files without throwing dbOverride error", async () => {
      // This should NOT throw "dbOverride parameter is required"
      const result = await releaseSwarmFiles({
        projectPath: TEST_PROJECT,
        agentName: "FileAgent",
        paths: ["src/test.ts"],
      });

      expect(result.released).toBeDefined();
      expect(typeof result.releasedAt).toBe("number");
    });
  });

  describe("acknowledgeSwarmMessage", () => {
    test("should acknowledge message without throwing dbOverride error", async () => {
      // Send a message first
      const sendResult = await sendSwarmMessage({
        projectPath: TEST_PROJECT,
        fromAgent: "Sender",
        toAgents: ["AckAgent"],
        subject: "Ack Test",
        body: "Ack Test Body",
        ackRequired: true,
      });

      // This should NOT throw "dbOverride parameter is required"
      const result = await acknowledgeSwarmMessage({
        projectPath: TEST_PROJECT,
        messageId: sendResult.messageId,
        agentName: "AckAgent",
      });

      expect(result.acknowledged).toBe(true);
    });
  });
});
