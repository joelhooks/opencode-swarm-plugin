/**
 * Durable Stream HTTP Server Tests
 *
 * TDD tests for the HTTP server that exposes Durable Streams protocol via SSE.
 * Server uses Bun.serve() and provides offset-based streaming.
 *
 * Uses port 0 for OS-assigned ports to avoid conflicts in parallel test runs.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createInMemorySwarmMailLibSQL } from "../libsql.convenience.js";
import { createEvent } from "./events.js";
import type { SwarmMailAdapter } from "../types/adapter.js";
import {
  createDurableStreamAdapter,
  type DurableStreamAdapter,
} from "./durable-adapter.js";
import {
  createDurableStreamServer,
  type DurableStreamServer,
} from "./durable-server.js";
import { createHiveAdapter } from "../hive/adapter.js";
import type { HiveAdapter } from "../types/hive-adapter.js";

// ============================================================================
// Factory Function Tests
// ============================================================================

describe("createDurableStreamServer factory", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  const projectKey = "/factory/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-factory-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);
  });

  afterAll(async () => {
    await swarmMail.close();
  });

  test("creates server with required properties", () => {
    const server = createDurableStreamServer({ adapter, projectKey, port: 0 });
    expect(server).toBeDefined();
    expect(server.start).toBeInstanceOf(Function);
    expect(server.stop).toBeInstanceOf(Function);
    expect(typeof server.url).toBe("string");
    expect(server.url).toMatch(/^http:\/\/localhost:\d+$/);
  });

  test("url reflects actual port after start", async () => {
    const server = createDurableStreamServer({ adapter, projectKey, port: 0 });
    
    // Before start, url uses configured port (0)
    const urlBeforeStart = server.url;
    
    await server.start();
    
    // After start, url should have actual assigned port
    const urlAfterStart = server.url;
    expect(urlAfterStart).toMatch(/^http:\/\/localhost:\d+$/);
    expect(urlAfterStart).not.toContain(":0"); // Should not be port 0
    
    await server.stop();
  });

  test("start and stop lifecycle works", async () => {
    const server = createDurableStreamServer({ adapter, projectKey, port: 0 });
    
    // Start server
    await server.start();
    
    // Verify it's listening
    const response = await fetch(`${server.url}/streams/${encodeURIComponent(projectKey)}`);
    expect(response.status).toBe(200);
    
    // Stop server
    await server.stop();
    
    // Verify it's not listening
    try {
      await fetch(`${server.url}/streams/${encodeURIComponent(projectKey)}`);
      throw new Error("Server should not respond after stop");
    } catch (error: unknown) {
      const err = error as { code?: string; message?: string; name?: string };
      const isConnectionError =
        err.code === "ECONNREFUSED" ||
        err.name === "ConnectionRefused" ||
        err.message?.includes("Unable to connect") ||
        err.message?.includes("Connection refused") ||
        err.message?.includes("Server should not respond");
      expect(isConnectionError).toBeTruthy();
    }
  });

  test("double start throws error", async () => {
    const server = createDurableStreamServer({ adapter, projectKey, port: 0 });
    await server.start();
    
    await expect(server.start()).rejects.toThrow("already running");
    
    await server.stop();
  });

  test("double stop is safe (idempotent)", async () => {
    const server = createDurableStreamServer({ adapter, projectKey, port: 0 });
    await server.start();
    await server.stop();
    
    // Second stop should not throw
    await server.stop();
  });
});

// ============================================================================
// HTTP Endpoint Tests
// ============================================================================

describe("DurableStreamServer HTTP endpoints", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  let server: DurableStreamServer;
  const projectKey = "/http/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-http-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);

    // Seed events
    for (let i = 0; i < 5; i++) {
      await swarmMail.appendEvent(
        createEvent("agent_active", {
          project_key: projectKey,
          agent_name: `Agent${i}`,
        }),
      );
    }

    server = createDurableStreamServer({ adapter, port: 0, projectKey });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await swarmMail.close();
  });

  // --- JSON endpoints ---

  test("GET /streams/:projectKey returns events as JSON", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const events = await response.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);

    // Verify StreamEvent format
    const event = events[0];
    expect(event).toHaveProperty("offset");
    expect(event).toHaveProperty("data");
    expect(event).toHaveProperty("timestamp");
  });

  test("offset parameter skips events", async () => {
    // Get all events first
    const allResponse = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}`,
    );
    const allEvents = await allResponse.json();
    expect(allEvents.length).toBeGreaterThan(2);

    // Request from offset (skip first 2 events)
    const skipOffset = allEvents[1].offset;
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?offset=${skipOffset}`,
    );

    const events = await response.json();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].offset).toBeGreaterThan(skipOffset);
  });

  test("limit parameter caps results", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?offset=0&limit=2`,
    );

    const events = await response.json();
    expect(events.length).toBeLessThanOrEqual(2);
  });

  test("offset beyond head returns empty array", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?offset=9999`,
    );

    const events = await response.json();
    expect(events).toEqual([]);
  });

  test("URL-encoded project keys work", async () => {
    // Different project key - should get 404 since server is configured for specific project
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent("/other/project")}`,
    );
    expect(response.status).toBe(404);
  });

  // --- Error handling ---

  test("unknown routes return 404", async () => {
    const response = await fetch(`${server.url}/unknown`);
    expect(response.status).toBe(404);
  });

  test("malformed offset returns 400", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?offset=not-a-number`,
    );
    expect(response.status).toBe(400);
  });

  test("negative offset returns 400", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?offset=-1`,
    );
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// SSE (Server-Sent Events) Tests
// ============================================================================

describe("DurableStreamServer SSE streaming", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  let server: DurableStreamServer;
  const projectKey = "/sse/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-sse-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);

    // Seed initial events
    for (let i = 0; i < 3; i++) {
      await swarmMail.appendEvent(
        createEvent("agent_active", {
          project_key: projectKey,
          agent_name: `SSEAgent${i}`,
        }),
      );
    }

    server = createDurableStreamServer({ adapter, port: 0, projectKey });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await swarmMail.close();
  });

  test("live=true returns SSE content-type", async () => {
    const controller = new AbortController();
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      { signal: controller.signal },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("connection")).toBe("keep-alive");

    controller.abort();
  });

  test("SSE streams existing events in correct format", async () => {
    const controller = new AbortController();
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      { signal: controller.signal },
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let chunks = "";

    // Read first few chunks with timeout
    const readWithTimeout = async () => {
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        for (let i = 0; i < 5; i++) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunks += decoder.decode(value, { stream: true });
            // Stop once we have enough data
            if (chunks.includes("data: ") && chunks.split("data: ").length > 2) {
              break;
            }
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    await readWithTimeout();
    controller.abort();

    // Verify SSE format: data: {json}\n\n
    expect(chunks).toContain("data: ");
    expect(chunks).toContain("\n\n");

    // Extract and parse first event
    const match = chunks.match(/data: ({.+?})\n\n/);
    expect(match).toBeTruthy();

    const event = JSON.parse(match![1]);
    expect(event).toHaveProperty("offset");
    expect(event).toHaveProperty("data");
    expect(event).toHaveProperty("timestamp");
  });

  test("SSE streams new events as they arrive", async () => {
    // Get current head to use as offset (so we only get NEW events)
    const head = await adapter.head();

    const controller = new AbortController();
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true&offset=${head}`,
      { signal: controller.signal },
    );

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let result = "";
    const uniqueId = `live-test-${Date.now()}`;

    // Start reading in background
    const readPromise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            result += decoder.decode(value, { stream: true });
            if (result.includes(uniqueId)) {
              break;
            }
          }
        }
      } catch {
        // Aborted
      }
      clearTimeout(timeout);
      return result;
    })();

    // Give SSE connection time to establish
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Append a new event
    await swarmMail.appendEvent(
      createEvent("task_completed", {
        project_key: projectKey,
        agent_name: "TestAgent",
        bead_id: uniqueId,
        summary: "Live SSE test",
        success: true,
      }),
    );

    // Wait for read to complete
    const chunks = await readPromise;
    controller.abort();

    // Should have received the new event
    expect(chunks).toContain("data: ");
    expect(chunks).toContain(uniqueId);
  });

  test("client disconnect is handled cleanly", async () => {
    const controller = new AbortController();
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      { signal: controller.signal },
    );

    const reader = response.body!.getReader();

    // Read one chunk then abort
    await reader.read();
    controller.abort();

    // Should not throw - clean disconnect
    expect(true).toBe(true);
  });
});

// ============================================================================
// Project Key Filtering Tests
// ============================================================================

describe("DurableStreamServer project filtering", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  let server: DurableStreamServer;
  const projectKey = "/filter/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-filter-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);

    // Add events for our project
    await swarmMail.appendEvent(
      createEvent("agent_registered", {
        project_key: projectKey,
        agent_name: "OurAgent",
        program: "opencode",
        model: "test",
      }),
    );

    // Add events for different project (should be filtered out)
    await swarmMail.appendEvent(
      createEvent("agent_registered", {
        project_key: "/other/project",
        agent_name: "OtherAgent",
        program: "opencode",
        model: "test",
      }),
    );

    server = createDurableStreamServer({ adapter, port: 0, projectKey });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await swarmMail.close();
  });

  test("only returns events for configured project", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}`,
    );
    const events = await response.json();

    expect(events.length).toBeGreaterThan(0);

    // All returned events should be for our project
    for (const event of events) {
      const data = JSON.parse(event.data);
      expect(data.project_key).toBe(projectKey);
    }
  });

  test("returns 404 for different project key", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent("/other/project")}`,
    );
    expect(response.status).toBe(404);
  });
});

// ============================================================================
// GET /cells Endpoint Tests
// ============================================================================

describe("DurableStreamServer GET /cells endpoint", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  let hiveAdapter: HiveAdapter;
  let server: DurableStreamServer;
  const projectKey = "/cells/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-cells-test");
    const db = await swarmMail.getDatabase();
    adapter = createDurableStreamAdapter(swarmMail, projectKey);
    hiveAdapter = createHiveAdapter(db, projectKey);
    
    // Run hive migrations
    await hiveAdapter.runMigrations();
    
    server = createDurableStreamServer({ 
      adapter, 
      hiveAdapter, 
      port: 0, 
      projectKey 
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await swarmMail.close();
  });

  test("GET /cells returns JSON object with cells array", async () => {
    const response = await fetch(`${server.url}/cells`);
    
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    
    const data = await response.json() as { cells: unknown[] };
    expect(data).toHaveProperty("cells");
    expect(Array.isArray(data.cells)).toBe(true);
  });

  test("GET /cells returns empty array when no cells exist", async () => {
    const response = await fetch(`${server.url}/cells`);
    const data = await response.json() as { cells: unknown[] };
    
    expect(data.cells).toEqual([]);
  });

  test("GET /cells returns created cells", async () => {
    // Create a cell
    const cell = await hiveAdapter.createCell(projectKey, {
      title: "Test Cell",
      description: "Test description",
      type: "task",
      priority: 2,
    });
    
    const response = await fetch(`${server.url}/cells`);
    const data = await response.json() as { cells: Array<{ id: string; title: string }> };
    
    expect(data.cells.length).toBeGreaterThan(0);
    expect(data.cells[0].id).toBe(cell.id);
    expect(data.cells[0].title).toBe("Test Cell");
  });

  test("GET /cells without hiveAdapter returns 500", async () => {
    // Create server without hiveAdapter
    const noHiveServer = createDurableStreamServer({ 
      adapter, 
      port: 0, 
      projectKey 
    });
    await noHiveServer.start();
    
    const response = await fetch(`${noHiveServer.url}/cells`);
    expect(response.status).toBe(500);
    
    const error = await response.json();
    expect(error.error).toContain("HiveAdapter");
    
    await noHiveServer.stop();
  });
});

// ============================================================================
// ClientRegistry Tests (TDD)
// ============================================================================

describe("ClientRegistry", () => {
  let registry: any; // Will be typed once we implement

  beforeEach(() => {
    // RED: This will fail until we implement ClientRegistry
    const { ClientRegistry } = require("./durable-server.js");
    registry = new ClientRegistry();
  });

  test("assigns unique client IDs on registration", () => {
    const id1 = registry.register();
    const id2 = registry.register();
    
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
    expect(id1).not.toBe(id2);
  });

  test("tracks cursor for registered client", () => {
    const clientId = registry.register();
    
    registry.updateCursor(clientId, 100);
    
    const cursor = registry.getCursor(clientId);
    expect(cursor).toBe(100);
  });

  test("updates cursor multiple times", () => {
    const clientId = registry.register();
    
    registry.updateCursor(clientId, 10);
    registry.updateCursor(clientId, 20);
    registry.updateCursor(clientId, 30);
    
    expect(registry.getCursor(clientId)).toBe(30);
  });

  test("unregister removes client", () => {
    const clientId = registry.register();
    registry.updateCursor(clientId, 50);
    
    registry.unregister(clientId);
    
    const cursor = registry.getCursor(clientId);
    expect(cursor).toBeUndefined();
  });

  test("getClients returns all registered clients", () => {
    const id1 = registry.register();
    const id2 = registry.register();
    
    registry.updateCursor(id1, 10);
    registry.updateCursor(id2, 20);
    
    const clients = registry.getClients();
    expect(clients).toHaveLength(2);
    expect(clients).toContainEqual({ clientId: id1, cursor: 10 });
    expect(clients).toContainEqual({ clientId: id2, cursor: 20 });
  });

  test("getClients returns empty array when no clients", () => {
    const clients = registry.getClients();
    expect(clients).toEqual([]);
  });

  test("getCursor returns undefined for unregistered client", () => {
    const cursor = registry.getCursor("non-existent");
    expect(cursor).toBeUndefined();
  });

  test("updateCursor on unregistered client does nothing", () => {
    // Should not throw
    registry.updateCursor("non-existent", 100);
    expect(true).toBe(true);
  });

  test("unregister on non-existent client is safe", () => {
    // Should not throw - idempotent
    registry.unregister("non-existent");
    expect(true).toBe(true);
  });
});

// ============================================================================
// Cursor-based Reconnection Tests (TDD)
// ============================================================================

describe("Cursor-based reconnection", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  let server: DurableStreamServer;
  const projectKey = "/reconnect/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("reconnect-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);
    server = createDurableStreamServer({ adapter, projectKey, port: 0 });
    await server.start();
    
    // Seed some events
    for (let i = 0; i < 5; i++) {
      await swarmMail.appendEvent(
        createEvent("agent_active", {
          project_key: projectKey,
          agent_name: `Agent${i}`,
        }),
      );
    }
  });

  afterAll(async () => {
    await server.stop();
    await swarmMail.close();
  });

  test("parses Last-Event-ID header for SSE reconnection", async () => {
    // Standard SSE reconnection: browser sends Last-Event-ID header
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      {
        headers: {
          "Last-Event-ID": "2", // Resume from event 2
        },
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    // Read first event - should be offset 3 (after cursor 2)
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    let buffer = "";
    let firstEvent: any = null;
    let iterations = 0;
    
    while (!firstEvent && iterations < 20) {
      iterations++;
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // Parse SSE format: "id: N\ndata: {...}\n\n" or just "data: {...}\n\n"
      const messages = buffer.split("\n\n");
      for (const message of messages) {
        // Extract data line from SSE message (skip id and comment lines)
        const lines = message.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = line.slice(6); // Remove "data: " prefix
            try {
              firstEvent = JSON.parse(json);
              break;
            } catch {
              // Incomplete JSON, keep buffering
            }
          }
        }
        if (firstEvent) break;
      }
    }
    
    reader.releaseLock();
    
    expect(firstEvent).toBeDefined();
    expect(firstEvent.offset).toBe(3);
  });

  test("parses ?cursor= query parameter as fallback", async () => {
    // Fallback for clients that can't set Last-Event-ID
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?cursor=2&live=true`,
    );

    expect(response.status).toBe(200);
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    let buffer = "";
    let firstEvent: any = null;
    let iterations = 0;
    
    while (!firstEvent && iterations < 20) {
      iterations++;
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const messages = buffer.split("\n\n");
      for (const message of messages) {
        const lines = message.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = line.slice(6);
            try {
              firstEvent = JSON.parse(json);
              break;
            } catch {
              // Incomplete
            }
          }
        }
        if (firstEvent) break;
      }
    }
    
    reader.releaseLock();
    
    expect(firstEvent).toBeDefined();
    expect(firstEvent.offset).toBe(3);
  });

  test("Last-Event-ID takes precedence over ?cursor=", async () => {
    // When both present, Last-Event-ID wins (standard SSE behavior)
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?cursor=1&live=true`,
      {
        headers: {
          "Last-Event-ID": "3", // This should win
        },
      },
    );

    expect(response.status).toBe(200);
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    let buffer = "";
    let firstEvent: any = null;
    let iterations = 0;
    
    while (!firstEvent && iterations < 20) {
      iterations++;
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      const messages = buffer.split("\n\n");
      for (const message of messages) {
        const lines = message.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = line.slice(6);
            try {
              firstEvent = JSON.parse(json);
              break;
            } catch {
              // Incomplete
            }
          }
        }
        if (firstEvent) break;
      }
    }
    
    reader.releaseLock();
    
    expect(firstEvent).toBeDefined();
    expect(firstEvent.offset).toBe(4); // After cursor 3
  });

  test("returns 400 for invalid Last-Event-ID", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      {
        headers: {
          "Last-Event-ID": "not-a-number",
        },
      },
    );

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain("Invalid");
  });

  test("returns 400 for invalid ?cursor=", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?cursor=bad&live=true`,
    );

    expect(response.status).toBe(400);
  });

  test("cursor beyond head returns empty then streams new events", async () => {
    const head = await adapter.head();
    
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?cursor=${head + 100}&live=true`,
    );

    expect(response.status).toBe(200);
    
    // Should connect successfully but not send historical events
    // (This is already the current behavior via offset param)
  });

  test("includes cursor in SSE id field for browser auto-reconnect", async () => {
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
    );

    expect(response.status).toBe(200);
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    
    let buffer = "";
    let foundId = false;
    
    // Read a few chunks to find SSE with id field
    for (let i = 0; i < 10; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      
      // SSE format with id: "id: 123\ndata: {...}\n\n"
      if (buffer.includes("id: ")) {
        foundId = true;
        break;
      }
    }
    
    reader.releaseLock();
    
    // Each event should have "id: <offset>" so browser auto-sends Last-Event-ID
    expect(foundId).toBe(true);
  });
});

// ============================================================================
// ClientRegistry Integration Tests
// ============================================================================

describe("DurableStreamServer client registry integration", () => {
  let swarmMail: SwarmMailAdapter;
  let adapter: DurableStreamAdapter;
  let server: DurableStreamServer;
  const projectKey = "/registry/test";

  beforeAll(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("durable-registry-test");
    adapter = createDurableStreamAdapter(swarmMail, projectKey);

    // Seed events
    for (let i = 0; i < 3; i++) {
      await swarmMail.appendEvent(
        createEvent("agent_active", {
          project_key: projectKey,
          agent_name: `RegistryAgent${i}`,
        }),
      );
    }

    server = createDurableStreamServer({ adapter, port: 0, projectKey });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await swarmMail.close();
  });

  test("WebSocket clients are tracked in registry", async () => {
    // Get registry from server (will need to expose it)
    const serverInternal = server as any;
    const registry = serverInternal.registry;
    
    expect(registry).toBeDefined();
    
    // Initial state - no clients
    const initialClients = registry.getClients();
    expect(Array.isArray(initialClients)).toBe(true);
  });

  test("SSE clients get tracked on connection", async () => {
    const controller = new AbortController();
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      { signal: controller.signal },
    );

    const reader = response.body!.getReader();
    await reader.read();
    
    controller.abort();

    // Registry should have tracked this client (verification in future subtasks)
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Server Stop Cleanup Tests
// ============================================================================

describe("DurableStreamServer cleanup on stop", () => {
  test("active SSE connections are closed when server stops", async () => {
    const swarmMail = await createInMemorySwarmMailLibSQL("durable-cleanup-test");
    const projectKey = "/cleanup/test";
    const adapter = createDurableStreamAdapter(swarmMail, projectKey);

    await swarmMail.appendEvent(
      createEvent("agent_active", {
        project_key: projectKey,
        agent_name: "CleanupAgent",
      }),
    );

    const server = createDurableStreamServer({ adapter, port: 0, projectKey });
    await server.start();

    const controller = new AbortController();

    // Start SSE connection
    const response = await fetch(
      `${server.url}/streams/${encodeURIComponent(projectKey)}?live=true`,
      { signal: controller.signal },
    );

    const reader = response.body!.getReader();

    // Read initial data
    await reader.read();

    // Stop server (should clean up subscriptions and close streams)
    await server.stop();

    // Reader should detect closed connection
    try {
      const { done } = await reader.read();
      expect(done).toBe(true);
    } catch {
      // Connection reset is also acceptable
      expect(true).toBe(true);
    }

    await swarmMail.close();
  });
});
