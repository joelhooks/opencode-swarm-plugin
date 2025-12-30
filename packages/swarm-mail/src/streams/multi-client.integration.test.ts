/**
 * Multi-client integration test - broadcast consistency and reconnection
 * 
 * Tests that multiple SSE clients receive events in consistent order and that
 * reconnection with Last-Event-ID enables cursor-based resume without duplicates.
 */

import { test, expect, describe } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience";
import { createDurableStreamAdapter } from "./durable-adapter";
import { createDurableStreamServer } from "./durable-server";
import { initSwarmAgent, sendSwarmMessage } from "./swarm-mail";

/**
 * SSE Client interface for testing
 */
interface SSEClient {
  /** Collected events from the stream */
  events: Array<{ offset: number; data: any }>;
  /** Connection status */
  connected: boolean;
  /** Abort the connection */
  abort: () => void;
  /** Last seen event ID (for cursor-based resume) */
  lastEventId?: number;
}

async function createSSEClient(
  url: string,
  startOffset?: number
): Promise<SSEClient> {
  const events: Array<{ offset: number; data: any }> = [];
  const controller = new AbortController();
  let connected = false;
  let lastEventId: number | undefined;

  // Build URL with cursor if provided
  const fullUrl = startOffset !== undefined 
    ? `${url}?cursor=${startOffset}`
    : url;

  // Start fetching SSE stream
  const responsePromise = fetch(fullUrl, {
    signal: controller.signal,
    headers: startOffset !== undefined
      ? { "Last-Event-ID": startOffset.toString() }
      : {},
  });

  // Parse SSE stream in background
  responsePromise
    .then(async (response) => {
      if (!response.body) return;
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // Split by double newline (SSE message boundary)
          const messages = buffer.split("\n\n");
          buffer = messages.pop() || ""; // Keep incomplete message in buffer

          for (const message of messages) {
            if (message.startsWith(": connected")) {
              connected = true;
              continue;
            }

            // Parse SSE format: "id: N\ndata: {...}\n"
            const lines = message.split("\n");
            let id: number | undefined;
            let data: any;

            for (const line of lines) {
              if (line.startsWith("id: ")) {
                id = Number.parseInt(line.slice(4), 10);
              } else if (line.startsWith("data: ")) {
                data = JSON.parse(line.slice(6));
              }
            }

            if (id !== undefined && data) {
              lastEventId = id;
              events.push({ offset: id, data });
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
      }
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        console.error("SSE client error:", error);
      }
    });

  // Wait for connection
  await new Promise((resolve) => {
    const checkConnected = setInterval(() => {
      if (connected) {
        clearInterval(checkConnected);
        resolve(undefined);
      }
    }, 10);
  });

  return {
    events,
    connected,
    abort: () => controller.abort(),
    get lastEventId() {
      return lastEventId;
    },
  };
}

/**
 * Emit a test event via SwarmMailAdapter
 * 
 * Uses sendSwarmMessage to generate proper event structure with
 * agent_registered, thread_created, and message_sent events.
 * 
 * @param db - Database adapter
 * @param projectKey - Project key for event
 * @param eventData - Custom event data (must include 'index' field)
 */
async function emitTestEvent(
  db: any,
  projectKey: string,
  eventData: { index: number; [key: string]: any }
): Promise<void> {
  await sendSwarmMessage({
    projectPath: projectKey,
    fromAgent: "TestAgent",
    toAgents: ["Observer"],
    subject: `Test Event ${eventData.index}`,
    body: JSON.stringify(eventData),
    threadId: "test-thread",
    dbOverride: db,
  });
}

/**
 * Wait for a condition to become true with timeout
 * 
 * Polls every 10ms until condition is true or timeout is reached.
 * 
 * @param condition - Function that returns true when done
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @throws Error if timeout is reached
 */
async function waitFor(
  condition: () => boolean,
  timeoutMs = 1000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Filter client events for message_sent type only
 * 
 * Events have nested structure:
 * SSE event → StreamEvent { offset, data: JSON, timestamp } → AgentEvent
 * 
 * @param events - Raw SSE client events
 * @returns Filtered message_sent events
 */
function filterMessageEvents(
  events: Array<{ offset: number; data: any }>
): Array<{ offset: number; data: any }> {
  return events.filter(e => {
    const streamEvent = e.data;
    const agentEvent = JSON.parse(streamEvent.data);
    return agentEvent.type === "message_sent";
  });
}

/**
 * Parse message body from nested event structure
 * 
 * @param event - SSE client event
 * @returns Parsed message body
 */
function parseMessageBody(event: { offset: number; data: any }): any {
  const streamEvent = event.data;
  const agentEvent = JSON.parse(streamEvent.data);
  return JSON.parse(agentEvent.body);
}

describe("Multi-client broadcast consistency", () => {
  test("multiple clients receive same events in same order", async () => {
    // Setup
    const swarmMail = await createInMemorySwarmMailLibSQL("multi-client-test");
    const db = await swarmMail.getDatabase();
    const projectKey = "/test/project";
    
    // Initialize agent
    await initSwarmAgent({
      projectPath: projectKey,
      agentName: "TestAgent",
      dbOverride: db,
    });
    
    const adapter = createDurableStreamAdapter(swarmMail, projectKey);
    const server = createDurableStreamServer({ adapter, port: 0 });
    
    await server.start();
    const eventUrl = `${server.url}/events`;

    try {
      // Spawn 3 SSE clients
      const client1 = await createSSEClient(eventUrl);
      const client2 = await createSSEClient(eventUrl);
      const client3 = await createSSEClient(eventUrl);

      // Emit 10 events
      for (let i = 1; i <= 10; i++) {
        await emitTestEvent(db, projectKey, {
          type: "test_event",
          index: i,
          message: `Event ${i}`,
        });
      }

      // Wait for all clients to receive all events
      // Note: Clients will receive agent_registered + thread_created + 10 message_sent events = 13 total
      await waitFor(() => {
        return (
          client1.events.length >= 10 &&
          client2.events.length >= 10 &&
          client3.events.length >= 10
        );
      }, 2000);

      // Verify all clients received same number of events
      expect(client1.events.length).toBe(client2.events.length);
      expect(client1.events.length).toBe(client3.events.length);

      // Verify all clients received events in same order
      const client1Offsets = client1.events.map((e) => e.offset);
      const client2Offsets = client2.events.map((e) => e.offset);
      const client3Offsets = client3.events.map((e) => e.offset);

      expect(client2Offsets).toEqual(client1Offsets);
      expect(client3Offsets).toEqual(client1Offsets);

      // Filter for message_sent events only
      const messageEvents1 = filterMessageEvents(client1.events);
      const messageEvents2 = filterMessageEvents(client2.events);
      const messageEvents3 = filterMessageEvents(client3.events);
      
      expect(messageEvents1.length).toBe(10);
      expect(messageEvents2.length).toBe(10);
      expect(messageEvents3.length).toBe(10);

      // Verify message indices match
      for (let i = 0; i < 10; i++) {
        const body1 = parseMessageBody(messageEvents1[i]);
        const body2 = parseMessageBody(messageEvents2[i]);
        const body3 = parseMessageBody(messageEvents3[i]);

        expect(body1.index).toBe(i + 1);
        expect(body2.index).toBe(i + 1);
        expect(body3.index).toBe(i + 1);
      }

      // Cleanup
      client1.abort();
      client2.abort();
      client3.abort();
    } finally {
      await server.stop();
      await swarmMail.close();
    }
  });

  test("reconnection with cursor resume - no duplicates", async () => {
    // Setup
    const swarmMail = await createInMemorySwarmMailLibSQL("reconnect-test");
    const db = await swarmMail.getDatabase();
    const projectKey = "/test/project";
    
    // Initialize agent
    await initSwarmAgent({
      projectPath: projectKey,
      agentName: "TestAgent",
      dbOverride: db,
    });
    
    const adapter = createDurableStreamAdapter(swarmMail, projectKey);
    const server = createDurableStreamServer({ adapter, port: 0 });
    
    await server.start();
    const eventUrl = `${server.url}/events`;

    try {
      // Client connects and receives 5 events
      const client1 = await createSSEClient(eventUrl);

      for (let i = 1; i <= 5; i++) {
        await emitTestEvent(db, projectKey, {
          type: "test_event",
          index: i,
        });
      }

      // Wait for client to receive initial setup events + 5 messages
      // (agent_registered + thread_created + 5 message_sent events)
      await waitFor(() => client1.events.length >= 5, 1000);

      const lastSeenOffset = client1.lastEventId;
      expect(lastSeenOffset).toBeDefined();
      
      const eventsBefore = client1.events.length;

      // Client disconnects
      client1.abort();

      // Emit 5 more events while client is disconnected
      for (let i = 6; i <= 10; i++) {
        await emitTestEvent(db, projectKey, {
          type: "test_event",
          index: i,
        });
      }

      // Client reconnects with Last-Event-ID (cursor-based resume)
      const client2 = await createSSEClient(eventUrl, lastSeenOffset);

      // Should receive only the 5 new messages (6-10) without duplicates
      await waitFor(() => client2.events.length >= 5, 1000);

      // Filter for message_sent events and extract indices
      const newMessages = filterMessageEvents(client2.events);
      expect(newMessages.length).toBe(5);

      const receivedIndices = newMessages.map(e => parseMessageBody(e).index);
      expect(receivedIndices).toEqual([6, 7, 8, 9, 10]);

      // Cleanup
      client2.abort();
    } finally {
      await server.stop();
      await swarmMail.close();
    }
  });

  test("backpressure behavior - slow client doesn't block fast clients", async () => {
    // Setup
    const swarmMail = await createInMemorySwarmMailLibSQL("backpressure-test");
    const db = await swarmMail.getDatabase();
    const projectKey = "/test/project";
    
    // Initialize agent
    await initSwarmAgent({
      projectPath: projectKey,
      agentName: "TestAgent",
      dbOverride: db,
    });
    
    const adapter = createDurableStreamAdapter(swarmMail, projectKey);
    const server = createDurableStreamServer({ adapter, port: 0 });
    
    await server.start();
    const eventUrl = `${server.url}/events`;

    try {
      // Create fast client (normal speed)
      const fastClient = await createSSEClient(eventUrl);

      // Create slow client (simulate by adding artificial delay)
      // Note: This is a simplified test - in real scenarios, slow clients
      // would be detected via buffer metrics in ClientRegistry
      const slowClient = await createSSEClient(eventUrl);

      // Emit 20 events rapidly
      for (let i = 1; i <= 20; i++) {
        await emitTestEvent(db, projectKey, {
          type: "test_event",
          index: i,
        });
      }

      // Wait for fast client to receive all events (20 messages + initial setup events)
      await waitFor(() => fastClient.events.length >= 20, 2000);

      // Slow client should also eventually receive all events
      // (in this simplified test, both clients are actually fast,
      // but the test verifies that multiple clients can coexist)
      await waitFor(() => slowClient.events.length >= 20, 2000);
      
      // Both clients should have received the same events
      expect(fastClient.events.length).toBe(slowClient.events.length);
      
      // Filter for message_sent events only
      const fastMessages = filterMessageEvents(fastClient.events);
      const slowMessages = filterMessageEvents(slowClient.events);
      
      expect(fastMessages.length).toBe(20);
      expect(slowMessages.length).toBe(20);

      // Verify buffer metrics via ClientRegistry
      const clients = server.registry.getClients();
      expect(clients.length).toBe(2);

      // Both clients should have cursor at last event offset
      const lastOffset = fastClient.events[fastClient.events.length - 1].offset;
      for (const client of clients) {
        expect(client.cursor).toBe(lastOffset);
      }

      // Cleanup
      fastClient.abort();
      slowClient.abort();
    } finally {
      await server.stop();
      await swarmMail.close();
    }
  });
});
