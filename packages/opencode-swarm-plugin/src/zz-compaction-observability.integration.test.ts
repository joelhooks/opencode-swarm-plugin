/**
 * Integration tests for compaction hook observability
 * 
 * Tests the full integration of metrics collection with the compaction hook.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createCompactionHook } from "./compaction-hook";

// Track log calls
let logCalls: Array<{ level: string; data: unknown; message?: string }> = [];

const createMockLogger = () => ({
  info: (data: unknown, message?: string) => {
    logCalls.push({ level: "info", data, message });
  },
  debug: (data: unknown, message?: string) => {
    logCalls.push({ level: "debug", data, message });
  },
  warn: (data: unknown, message?: string) => {
    logCalls.push({ level: "warn", data, message });
  },
  error: (data: unknown, message?: string) => {
    logCalls.push({ level: "error", data, message });
  },
});

describe("Compaction Hook with Observability", () => {
  // Create hook with DI - no mock.module() pollution
  const createTestHook = () =>
    createCompactionHook({
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
      getHiveWorkingDirectory: () => "/test/project",
      logger: createMockLogger(),
    });

  beforeEach(() => {
    logCalls = [];
  });

  afterEach(() => {
    logCalls = [];
  });

  it("logs structured metrics on compaction run", async () => {
    const hook = createTestHook();
    const input = { sessionID: "test-session-123" };
    const output = { context: [] as string[] };

    await hook(input, output);

    // Should have START log
    const startLog = logCalls.find(
      (log) => log.level === "info" && log.message === "compaction started",
    );
    expect(startLog).toBeDefined();
    expect((startLog?.data as { session_id?: string })?.session_id).toBe("test-session-123");

    // Should have COMPLETE log
    const completeLog = logCalls.find(
      (log) => log.level === "info" && log.message === "compaction complete",
    );
    expect(completeLog).toBeDefined();
    expect((completeLog?.data as { duration_ms?: number })?.duration_ms).toBeGreaterThanOrEqual(0);
    expect((completeLog?.data as { success?: boolean })?.success).toBe(true);
  });

  it("logs timing breakdown for each phase", async () => {
    const hook = createTestHook();
    await hook({ sessionID: "test" }, { context: [] });

    // Should have debug logs for swarm-mail and hive checks
    const swarmMailLog = logCalls.find(
      (log) => log.level === "debug" && (log.data as { source?: string })?.source === "swarm-mail",
    );
    expect(swarmMailLog).toBeDefined();
    expect((swarmMailLog?.data as { duration_ms?: number })?.duration_ms).toBeGreaterThanOrEqual(0);

    const hiveLog = logCalls.find(
      (log) => log.level === "debug" && (log.data as { source?: string })?.source === "hive",
    );
    expect(hiveLog).toBeDefined();
    expect((hiveLog?.data as { duration_ms?: number })?.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("logs pattern extraction/skipping decisions", async () => {
    const hook = createTestHook();
    await hook({ sessionID: "test" }, { context: [] });

    // Should have detection complete log
    const detectionLog = logCalls.find(
      (log) => log.level === "debug" && log.message === "swarm detection complete",
    );
    expect(detectionLog).toBeDefined();
    expect((detectionLog?.data as { confidence?: string })?.confidence).toBeDefined();
  });

  it("captures metrics summary in completion log", async () => {
    const hook = createTestHook();
    await hook({ sessionID: "test-metrics" }, { context: [] });

    const completeLog = logCalls.find(
      (log) => log.level === "info" && log.message === "compaction complete",
    );
    expect(completeLog).toBeDefined();

    const data = completeLog?.data as {
      duration_ms?: number;
      success?: boolean;
      detected?: boolean;
      confidence?: string;
      context_injected?: boolean;
    };

    // Should have complete metrics
    expect(data.duration_ms).toBeGreaterThanOrEqual(0);
    expect(data.success).toBe(true);
    expect(data.detected).toBeDefined();
    expect(data.confidence).toBeDefined();
    expect(data.context_injected).toBeDefined();
  });
});
