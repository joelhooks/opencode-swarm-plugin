/**
 * Durable Streams HTTP Server
 *
 * Exposes the Durable Streams protocol via Server-Sent Events (SSE).
 * Built with Bun.serve() for HTTP server.
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
 * GET /streams/:projectKey?offset=N&live=true
 * - offset: Start reading from this sequence (default 0)
 * - live: If true, keep connection open and stream new events via SSE
 *
 * ## SSE Format
 *
 * data: {json}\n\n
 *
 * Each event is sent as a JSON-encoded StreamEvent:
 * { offset: number, data: string, timestamp: number }
 */

import type { Server } from "bun";
import type { DurableStreamAdapter, StreamEvent } from "./durable-adapter.js";
import type { HiveAdapter } from "../types/hive-adapter.js";

// Bun Server type without WebSocket data
type BunServer = Server<undefined>;

// CORS headers for cross-origin requests (dashboard at :5173, server at :4483)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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

  async function start(): Promise<void> {
    if (bunServer) {
      throw new Error("Server is already running");
    }

    bunServer = Bun.serve({
      port,
      idleTimeout: 120, // 2 minutes for SSE connections
      async fetch(req: Request) {
        const url = new URL(req.url);

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
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

        // Parse query params
        const offsetParam = url.searchParams.get("offset");
        const liveParam = url.searchParams.get("live");
        const limitParam = url.searchParams.get("limit");

        const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;
        const live = liveParam === "true";
        const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;

        // Validate offset
        if (Number.isNaN(offset) || offset < 0) {
          return new Response("Invalid offset parameter", { status: 400, headers: CORS_HEADERS });
        }

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

            // Send SSE comment to flush headers and establish connection
            controller.enqueue(encoder.encode(": connected\n\n"));

            // Send existing events first
            const existingEvents = await adapter.read(offset, limit);
            for (const event of existingEvents) {
              const sse = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(encoder.encode(sse));
            }

            // Subscribe to new events, passing offset to avoid async race
            const subscriptionId = subscriptionCounter++;
            const unsubscribe = adapter.subscribe(
              (event: StreamEvent) => {
                // Only send events after our offset (adapter filters too, but double-check)
                if (event.offset > offset) {
                  try {
                    const sse = `data: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(sse));
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
  }

  async function stop(): Promise<void> {
    if (!bunServer) {
      return;
    }

    // Clean up all active subscriptions and close their streams
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
  }

  return {
    start,
    stop,
    get url() {
      // Return actual port after server starts (supports port 0)
      const effectivePort = bunServer?.port ?? port;
      return `http://localhost:${effectivePort}`;
    },
  };
}
