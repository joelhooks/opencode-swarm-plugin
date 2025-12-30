/**
 * Durable Streams HTTP Server
 *
 * Exposes the Durable Streams protocol via WebSocket (primary) and SSE (fallback).
 * Built with Bun.serve() for HTTP server with native WebSocket support.
 *
 * Port 4483 = HIVE on phone keypad
 *
 * ## Endpoints
 *
 * GET /cells
 * - Returns all cells from the hive as JSON object: { cells: HiveCell[] }
 * - Requires hiveAdapter to be configured
 * - Returns tree structure with parent-child relationships
 *
 * WS /ws
 * - WebSocket endpoint for real-time event streaming (PREFERRED)
 * - Sends heartbeat every 30s to keep connection alive
 * - Client can send: { type: "subscribe", offset?: number }
 * - Server sends: { type: "event", ...StreamEvent } or { type: "heartbeat" }
 *
 * GET /events (SSE fallback)
 * - Server-Sent Events stream for browsers without WebSocket
 * - Supports cursor-based reconnection via Last-Event-ID header or ?cursor= param
 *
 * GET /streams/:projectKey?offset=N&live=true
 * - Cursor-based resume: Last-Event-ID header (standard SSE) or ?cursor= or ?offset=
 * - Priority: Last-Event-ID > cursor > offset (default 0)
 * - live: If true, keep connection open and stream new events via SSE
 * - Each event includes SSE id: field for browser auto-reconnect
 *
 * ## SSE Format
 *
 * id: <offset>\n
 * data: {json}\n\n
 *
 * Each event includes:
 * - id: Event offset (enables browser Last-Event-ID auto-reconnect)
 * - data: JSON-encoded StreamEvent { offset: number, data: string, timestamp: number }
 *
 * On reconnect, browser automatically sends Last-Event-ID header with last-seen offset.
 */

import type { Server, ServerWebSocket } from "bun";
import type { DurableStreamAdapter, StreamEvent } from "./durable-adapter.js";
import type { HiveAdapter } from "../types/hive-adapter.js";

// WebSocket client data
interface WSClientData {
  subscriptionId: number;
  clientId: string;
  unsubscribe?: () => void;
}

/**
 * Client registry for tracking WebSocket/SSE connections and their cursors.
 * 
 * Each connected client (WebSocket or SSE) gets a unique ID and has their
 * last-seen event cursor tracked. This enables cursor-based resume for
 * reconnecting clients.
 * 
 * @example
 * ```typescript
 * const registry = new ClientRegistry();
 * 
 * // On client connect
 * const clientId = registry.register();
 * 
 * // On event sent to client
 * registry.updateCursor(clientId, event.offset);
 * 
 * // On client disconnect
 * registry.unregister(clientId);
 * 
 * // Monitor active clients
 * const clients = registry.getClients();
 * console.log(`${clients.length} active clients`);
 * ```
 */
export class ClientRegistry {
  private clients = new Map<string, { cursor: number }>();
  private idCounter = 0;

  /**
   * Register a new client and return unique client ID.
   * 
   * Client IDs are generated as: `client-{timestamp}-{counter}`
   * Initial cursor is set to 0.
   * 
   * @returns Unique client ID string
   */
  register(): string {
    const clientId = `client-${Date.now()}-${this.idCounter++}`;
    this.clients.set(clientId, { cursor: 0 });
    return clientId;
  }

  /**
   * Update the last-seen cursor for a client.
   * 
   * Should be called after successfully sending an event to the client.
   * If the client doesn't exist, this is a no-op (safe to call).
   * 
   * @param clientId - The client's unique ID
   * @param cursor - The event offset/cursor that was sent
   */
  updateCursor(clientId: string, cursor: number): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.cursor = cursor;
    }
  }

  /**
   * Get the current cursor for a client.
   * 
   * @param clientId - The client's unique ID
   * @returns The client's last-seen cursor, or undefined if client not found
   */
  getCursor(clientId: string): number | undefined {
    return this.clients.get(clientId)?.cursor;
  }

  /**
   * Unregister a client and clean up their data.
   * 
   * Should be called when a client disconnects (WebSocket close, SSE abort).
   * Idempotent - safe to call multiple times or with non-existent client ID.
   * 
   * @param clientId - The client's unique ID
   */
  unregister(clientId: string): void {
    this.clients.delete(clientId);
  }

  /**
   * Get all registered clients with their cursors.
   * 
   * Useful for monitoring active connections and debugging.
   * 
   * @returns Array of client info objects (clientId + cursor)
   */
  getClients(): Array<{ clientId: string; cursor: number }> {
    return Array.from(this.clients.entries()).map(([clientId, { cursor }]) => ({
      clientId,
      cursor,
    }));
  }
}

// Bun Server type with WebSocket data
type BunServer = Server<WSClientData>;

// CORS headers for cross-origin requests (dashboard at :5173, server at :4483)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Heartbeat interval (30 seconds)
const HEARTBEAT_INTERVAL = 30000;

/**
 * Parse cursor from request (Last-Event-ID header, cursor param, or offset param)
 * 
 * Priority: Last-Event-ID > cursor > offset > 0
 * 
 * @param req - Request object
 * @param url - URL object with parsed query params
 * @returns Parsed cursor value or error response
 */
function parseCursor(req: Request, url: URL): number | Response {
  const lastEventId = req.headers.get("Last-Event-ID");
  const cursorParam = url.searchParams.get("cursor");
  const offsetParam = url.searchParams.get("offset");

  // Priority: Last-Event-ID > cursor > offset
  if (lastEventId) {
    const cursor = Number.parseInt(lastEventId, 10);
    if (Number.isNaN(cursor) || cursor < 0) {
      return new Response("Invalid Last-Event-ID header", { status: 400, headers: CORS_HEADERS });
    }
    return cursor;
  }
  
  if (cursorParam) {
    const cursor = Number.parseInt(cursorParam, 10);
    if (Number.isNaN(cursor) || cursor < 0) {
      return new Response("Invalid cursor parameter", { status: 400, headers: CORS_HEADERS });
    }
    return cursor;
  }
  
  if (offsetParam) {
    const cursor = Number.parseInt(offsetParam, 10);
    if (Number.isNaN(cursor) || cursor < 0) {
      return new Response("Invalid offset parameter", { status: 400, headers: CORS_HEADERS });
    }
    return cursor;
  }

  return 0; // Default: start from beginning
}

/**
 * Configuration for the Durable Stream HTTP server
 */
export interface DurableStreamServerConfig {
  /** Adapter for reading events (single project) */
  adapter: DurableStreamAdapter;
  /** Hive adapter for querying cells */
  hiveAdapter?: HiveAdapter;
  /** Port to listen on (default 4483 - HIVE on phone keypad) */
  port?: number;
  /** Optional project key (for URL matching, defaults to "*" = any) */
  projectKey?: string;
}

/**
 * Durable Stream HTTP server interface
 */
export interface DurableStreamServer {
  /** Start the HTTP server */
  start(): Promise<void>;
  /** Stop the HTTP server and clean up subscriptions */
  stop(): Promise<void>;
  /** Base URL of the server */
  url: string;
  /** Client registry (for testing/monitoring) */
  registry: ClientRegistry;
}

/**
 * Creates a Durable Streams HTTP server exposing events via SSE
 *
 * @example
 * ```typescript
 * const swarmMail = await createInMemorySwarmMailLibSQL("my-project");
 * const adapter = createDurableStreamAdapter(swarmMail, "/my/project");
 * const db = await swarmMail.getDatabase();
 * const hiveAdapter = createHiveAdapter(db, "/my/project");
 * 
 * const server = createDurableStreamServer({ 
 *   adapter, 
 *   hiveAdapter, 
 *   projectKey: "/my/project" 
 * });
 * await server.start();
 * 
 * console.log(`Streaming at ${server.url}/streams/my-project`);
 * console.log(`Cells API at ${server.url}/cells`);
 * ```
 */
export function createDurableStreamServer(
  config: DurableStreamServerConfig,
): DurableStreamServer {
  const { adapter, hiveAdapter, port = 4483, projectKey: configProjectKey } = config;

  let bunServer: BunServer | null = null;
  const subscriptions = new Map<
    number,
    { unsubscribe: () => void; controller: ReadableStreamDefaultController }
  >();
  let subscriptionCounter = 0;
  
  // WebSocket clients for heartbeat
  const wsClients = new Set<ServerWebSocket<WSClientData>>();
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  
  // Client registry for cursor tracking
  const registry = new ClientRegistry();

  async function start(): Promise<void> {
    if (bunServer) {
      throw new Error("Server is already running");
    }

    bunServer = Bun.serve<WSClientData>({
      port,
      idleTimeout: 120, // 2 minutes for SSE connections
      
      // WebSocket handlers
      websocket: {
        open(ws) {
          wsClients.add(ws);
          
          // Register client and track in data
          const clientId = registry.register();
          ws.data.clientId = clientId;
          
          console.log(`[WS] Client ${clientId} connected (${wsClients.size} total)`);
          
          // Send initial connection confirmation with client ID
          ws.send(JSON.stringify({ 
            type: "connected", 
            clientId, 
            timestamp: Date.now() 
          }));
        },
        
        async message(ws, message) {
          try {
            const data = JSON.parse(message.toString());
            
            if (data.type === "subscribe") {
              const offset = data.offset ?? 0;
              
              // Send existing events first
              const existingEvents = await adapter.read(offset, 1000);
              for (const event of existingEvents) {
                ws.send(JSON.stringify({ type: "event", ...event }));
              }
              
              // Subscribe to new events
              const unsubscribe = adapter.subscribe(
                (event: StreamEvent) => {
                  if (event.offset > offset) {
                    try {
                      ws.send(JSON.stringify({ type: "event", ...event }));
                      // Update cursor after successfully sending event
                      registry.updateCursor(ws.data.clientId, event.offset);
                    } catch (error) {
                      console.error("[WS] Error sending event:", error);
                    }
                  }
                },
                offset,
              );
              
              // Store unsubscribe function
              ws.data.unsubscribe = unsubscribe;
              
              console.log(`[WS] Client subscribed from offset ${offset}`);
            }
            
            if (data.type === "ping") {
              ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
            }
          } catch (error) {
            console.error("[WS] Error parsing message:", error);
          }
        },
        
        close(ws) {
          wsClients.delete(ws);
          if (ws.data.unsubscribe) {
            ws.data.unsubscribe();
          }
          
          // Unregister client from registry
          registry.unregister(ws.data.clientId);
          
          console.log(`[WS] Client ${ws.data.clientId} disconnected (${wsClients.size} remaining)`);
        },
      },
      
      async fetch(req: Request, server) {
        const url = new URL(req.url);

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        
        // WebSocket upgrade: GET /ws
        if (url.pathname === "/ws") {
          const upgraded = server.upgrade(req, {
            data: { 
              subscriptionId: subscriptionCounter++,
              clientId: "" // Will be set in open handler
            },
          });
          if (upgraded) {
            return undefined; // Bun handles the response
          }
          return new Response("WebSocket upgrade failed", { status: 500, headers: CORS_HEADERS });
        }

        // Route: GET /cells
        if (url.pathname === "/cells") {
          if (!hiveAdapter) {
            return new Response(
              JSON.stringify({ error: "HiveAdapter not configured" }),
              { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
            );
          }

          try {
            const cells = await hiveAdapter.queryCells(
              configProjectKey || "",
              { include_children: true },
            );
            return new Response(JSON.stringify({ cells }), {
              status: 200,
              headers: { "Content-Type": "application/json", ...CORS_HEADERS },
            });
          } catch (error) {
            return new Response(
              JSON.stringify({ error: "Failed to query cells" }),
              { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
            );
          }
        }

        // Route: GET /events - SSE stream for all events (dashboard convenience endpoint)
        // This is an alias for /streams/:projectKey?live=true using the configured projectKey
        if (url.pathname === "/events") {
          // Use configured projectKey or default to "*" for all
          const projectKeyForEvents = configProjectKey || "*";
          
          // Parse cursor from Last-Event-ID header (standard SSE) or query params
          const cursorOrError = parseCursor(req, url);
          if (cursorOrError instanceof Response) {
            return cursorOrError;
          }
          const offset = cursorOrError;
          
          const limitParam = url.searchParams.get("limit");
          const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;

          // Always live mode for /events endpoint
          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              
              // Register SSE client
              const clientId = registry.register();

              // Send SSE comment to flush headers and establish connection
              controller.enqueue(encoder.encode(`: connected client=${clientId}\n\n`));

              // Send existing events first
              const existingEvents = await adapter.read(offset, limit);
              for (const event of existingEvents) {
                const sse = `id: ${event.offset}\ndata: ${JSON.stringify(event)}\n\n`;
                controller.enqueue(encoder.encode(sse));
                // Update cursor after sending
                registry.updateCursor(clientId, event.offset);
              }

              // Subscribe to new events
              const subscriptionId = subscriptionCounter++;
              const unsubscribe = adapter.subscribe(
                (event: StreamEvent) => {
                  if (event.offset > offset) {
                    try {
                      const sse = `id: ${event.offset}\ndata: ${JSON.stringify(event)}\n\n`;
                      controller.enqueue(encoder.encode(sse));
                      // Update cursor after successfully sending event
                      registry.updateCursor(clientId, event.offset);
                    } catch (error) {
                      console.error("Error sending event:", error);
                    }
                  }
                },
                offset,
              );

              subscriptions.set(subscriptionId, { unsubscribe, controller });

              req.signal.addEventListener("abort", () => {
                const sub = subscriptions.get(subscriptionId);
                if (sub) {
                  sub.unsubscribe();
                  subscriptions.delete(subscriptionId);
                }
                // Unregister SSE client
                registry.unregister(clientId);
                try {
                  controller.close();
                } catch {
                  // Already closed
                }
              });
            },
            cancel() {
              // Client cancelled - cleanup via abort signal
            },
          });

          return new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              ...CORS_HEADERS,
            },
          });
        }

        // Parse route: /streams/:projectKey
        const match = url.pathname.match(/^\/streams\/(.+)$/);
        if (!match) {
          return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
        }

        const requestedProjectKey = decodeURIComponent(match[1]);

        // If server was configured with a specific projectKey, verify it matches
        if (configProjectKey && configProjectKey !== requestedProjectKey) {
          return new Response("Project not found", { status: 404, headers: CORS_HEADERS });
        }

        // Parse cursor from Last-Event-ID header (standard SSE) or query params
        const cursorOrError = parseCursor(req, url);
        if (cursorOrError instanceof Response) {
          return cursorOrError;
        }
        const offset = cursorOrError;

        // Parse other query params
        const liveParam = url.searchParams.get("live");
        const limitParam = url.searchParams.get("limit");
        const live = liveParam === "true";
        const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;

        // ONE-SHOT MODE: Return events as JSON array
        if (!live) {
          const events = await adapter.read(offset, limit);
          return new Response(JSON.stringify(events), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              ...CORS_HEADERS,
            },
          });
        }

        // LIVE MODE: SSE stream
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            
            // Register SSE client
            const clientId = registry.register();

            // Send SSE comment to flush headers and establish connection
            controller.enqueue(encoder.encode(`: connected client=${clientId}\n\n`));

            // Send existing events first
            const existingEvents = await adapter.read(offset, limit);
            for (const event of existingEvents) {
              const sse = `id: ${event.offset}\ndata: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(sse));
              // Update cursor after sending
              registry.updateCursor(clientId, event.offset);
            }

            // Subscribe to new events, passing offset to avoid async race
            const subscriptionId = subscriptionCounter++;
            const unsubscribe = adapter.subscribe(
              (event: StreamEvent) => {
                // Only send events after our offset (adapter filters too, but double-check)
                if (event.offset > offset) {
                  try {
                    const sse = `id: ${event.offset}\ndata: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(sse));
                    // Update cursor after successfully sending event
                    registry.updateCursor(clientId, event.offset);
                  } catch (error) {
                    // Client disconnected, will be cleaned up in cancel()
                    console.error("Error sending event:", error);
                  }
                }
              },
              offset, // Pass offset to avoid async initialization race
            );

            subscriptions.set(subscriptionId, { unsubscribe, controller });

            // Clean up on disconnect
            const cleanup = () => {
              const sub = subscriptions.get(subscriptionId);
              if (sub) {
                sub.unsubscribe();
                subscriptions.delete(subscriptionId);
              }
              // Unregister SSE client
              registry.unregister(clientId);
            };

            // Handle client disconnect
            req.signal.addEventListener("abort", () => {
              cleanup();
              try {
                controller.close();
              } catch {
                // Already closed
              }
            });
          },

          cancel() {
            // Client cancelled - cleanup will happen via abort signal
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...CORS_HEADERS,
          },
        });
      },
    });
    
    // Start heartbeat for WebSocket clients
    heartbeatInterval = setInterval(() => {
      const heartbeat = JSON.stringify({ type: "heartbeat", timestamp: Date.now() });
      for (const ws of wsClients) {
        try {
          ws.send(heartbeat);
        } catch {
          // Client disconnected, will be cleaned up in close handler
        }
      }
    }, HEARTBEAT_INTERVAL);
    
    console.log(`[Server] Started on port ${bunServer.port} (WS: /ws, SSE: /events)`);
  }

  async function stop(): Promise<void> {
    if (!bunServer) {
      return;
    }
    
    // Stop heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    
    // Close all WebSocket connections
    for (const ws of wsClients) {
      try {
        if (ws.data.unsubscribe) {
          ws.data.unsubscribe();
        }
        ws.close(1000, "Server shutting down");
      } catch {
        // Already closed
      }
    }
    wsClients.clear();

    // Clean up all active SSE subscriptions and close their streams
    for (const { unsubscribe, controller } of subscriptions.values()) {
      unsubscribe();
      try {
        controller.close();
      } catch {
        // Already closed
      }
    }
    subscriptions.clear();

    // Stop the server
    bunServer.stop();
    bunServer = null;
    
    console.log("[Server] Stopped");
  }

  return {
    start,
    stop,
    get url() {
      // Return actual port after server starts (supports port 0)
      const effectivePort = bunServer?.port ?? port;
      return `http://localhost:${effectivePort}`;
    },
    registry,
  };
}
