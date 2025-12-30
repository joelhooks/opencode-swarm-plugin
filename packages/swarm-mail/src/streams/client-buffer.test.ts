/**
 * ClientBuffer Test Suite
 * 
 * Tests for client backpressure handling - buffers events when client is slow,
 * drops oldest events when buffer fills, emits backpressure warnings.
 * 
 * TDD RED phase - these tests define the behavior we want.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { ClientBuffer } from "./client-buffer.js";

describe("ClientBuffer", () => {
  describe("creation and basic properties", () => {
    it("creates with default buffer size of 1000", () => {
      const buffer = new ClientBuffer();
      expect(buffer.maxSize).toBe(1000);
      expect(buffer.size).toBe(0);
      expect(buffer.droppedCount).toBe(0);
    });

    it("creates with custom buffer size", () => {
      const buffer = new ClientBuffer({ maxSize: 500 });
      expect(buffer.maxSize).toBe(500);
    });

    it("requires positive buffer size", () => {
      expect(() => new ClientBuffer({ maxSize: 0 })).toThrow();
      expect(() => new ClientBuffer({ maxSize: -1 })).toThrow();
    });
  });

  describe("buffering when write is pending", () => {
    it("buffers events when writes are pending", () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const send = mock(() => Promise.resolve());

      // Enqueue some events
      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send);

      // All should be buffered until flush
      expect(buffer.size).toBe(3);
      expect(send).not.toHaveBeenCalled();
    });

    it("flushes buffered events when client catches up", async () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const sent: any[] = [];
      const send = mock((data: any) => {
        sent.push(data);
        return Promise.resolve();
      });

      // Enqueue events
      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send);

      // Flush
      await buffer.flush();

      expect(sent).toEqual([
        { data: "event1" },
        { data: "event2" },
        { data: "event3" },
      ]);
      expect(buffer.size).toBe(0);
    });

    it("handles async sends correctly", async () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const sent: any[] = [];

      const send = mock((data: any) => {
        sent.push(data);
        // Simulate async send with small delay
        return new Promise<void>((resolve) => setTimeout(resolve, 1));
      });

      // Enqueue events
      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send);

      // Flush should wait for all async sends
      await buffer.flush();

      expect(sent).toEqual([
        { data: "event1" },
        { data: "event2" },
        { data: "event3" },
      ]);
      expect(buffer.size).toBe(0);
    });
  });

  describe("ring buffer behavior - drop oldest when full", () => {
    it("drops oldest events when buffer fills", () => {
      const buffer = new ClientBuffer({ maxSize: 3 });
      const send = mock(() => Promise.resolve());

      // Fill buffer
      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send);

      expect(buffer.size).toBe(3);
      expect(buffer.droppedCount).toBe(0);

      // Overflow - should drop event1
      buffer.enqueue({ data: "event4" }, send);

      expect(buffer.size).toBe(3);
      expect(buffer.droppedCount).toBe(1);
    });

    it("flushes only non-dropped events", async () => {
      const buffer = new ClientBuffer({ maxSize: 3 });
      const sent: any[] = [];
      const send = mock((data: any) => {
        sent.push(data);
        return Promise.resolve();
      });

      // Overflow scenario
      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send);
      buffer.enqueue({ data: "event4" }, send); // Drops event1
      buffer.enqueue({ data: "event5" }, send); // Drops event2

      await buffer.flush();

      // Only event3, event4, event5 should be sent
      expect(sent).toEqual([
        { data: "event3" },
        { data: "event4" },
        { data: "event5" },
      ]);
      expect(buffer.droppedCount).toBe(2);
    });
  });

  describe("backpressure events", () => {
    it("emits 'backpressure' event when buffer starts filling", () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const send = mock(() => Promise.resolve());
      const backpressureEvents: any[] = [];

      buffer.on("backpressure", (stats) => {
        backpressureEvents.push(stats);
      });

      // Fill buffer to trigger backpressure (> 50% = backpressure warning)
      for (let i = 0; i < 6; i++) {
        buffer.enqueue({ data: `event${i}` }, send);
      }

      expect(backpressureEvents.length).toBeGreaterThan(0);
      expect(backpressureEvents[0]).toMatchObject({
        buffered: expect.any(Number),
        dropped: 0,
        maxSize: 10,
      });
    });

    it("includes dropped count in backpressure events", () => {
      const buffer = new ClientBuffer({ maxSize: 3 });
      const send = mock(() => Promise.resolve());
      const backpressureEvents: any[] = [];

      buffer.on("backpressure", (stats) => {
        backpressureEvents.push(stats);
      });

      // Overflow
      for (let i = 0; i < 5; i++) {
        buffer.enqueue({ data: `event${i}` }, send);
      }

      const lastEvent = backpressureEvents[backpressureEvents.length - 1];
      expect(lastEvent.dropped).toBe(2);
    });
  });

  describe("metrics", () => {
    it("tracks flush latency", async () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const send = mock(() => {
        return new Promise<void>((resolve) => setTimeout(resolve, 10));
      });

      buffer.enqueue({ data: "event1" }, send);
      await buffer.flush();

      const metrics = buffer.getMetrics();
      expect(metrics.lastFlushLatencyMs).toBeGreaterThan(0);
    });

    it("returns current metrics", () => {
      const buffer = new ClientBuffer({ maxSize: 100 });
      const send = mock(() => Promise.resolve());

      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);

      const metrics = buffer.getMetrics();
      expect(metrics).toMatchObject({
        buffered: 2,
        dropped: 0,
        maxSize: 100,
        lastFlushLatencyMs: 0,
      });
    });

    it("updates dropped count in metrics", () => {
      const buffer = new ClientBuffer({ maxSize: 2 });
      const send = mock(() => Promise.resolve());

      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send); // Drops event1

      const metrics = buffer.getMetrics();
      expect(metrics.dropped).toBe(1);
    });
  });

  describe("health check", () => {
    it("reports healthy when buffer is below threshold", () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const send = mock(() => Promise.resolve());

      expect(buffer.isHealthy()).toBe(true);

      // Add events below threshold (50% = 5)
      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);
      buffer.enqueue({ data: "event3" }, send);

      expect(buffer.isHealthy()).toBe(true);
    });

    it("reports unhealthy when buffer crosses threshold", () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const send = mock(() => Promise.resolve());

      // Fill past threshold (> 5)
      for (let i = 0; i < 7; i++) {
        buffer.enqueue({ data: `event${i}` }, send);
      }

      expect(buffer.isHealthy()).toBe(false);
    });

    it("uses custom backpressure threshold", () => {
      const buffer = new ClientBuffer({ maxSize: 10, backpressureThreshold: 0.8 });
      const send = mock(() => Promise.resolve());

      // Fill to 7 events (70% - below 80% threshold)
      for (let i = 0; i < 7; i++) {
        buffer.enqueue({ data: `event${i}` }, send);
      }

      expect(buffer.isHealthy()).toBe(true);

      // Add 2 more (90% - above 80% threshold)
      buffer.enqueue({ data: "event7" }, send);
      buffer.enqueue({ data: "event8" }, send);

      expect(buffer.isHealthy()).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears buffer and metrics", () => {
      const buffer = new ClientBuffer({ maxSize: 5 });
      const send = mock(() => Promise.resolve());

      // Add events and overflow
      for (let i = 0; i < 7; i++) {
        buffer.enqueue({ data: `event${i}` }, send);
      }

      expect(buffer.size).toBeGreaterThan(0);
      expect(buffer.droppedCount).toBeGreaterThan(0);

      buffer.reset();

      expect(buffer.size).toBe(0);
      expect(buffer.droppedCount).toBe(0);
      expect(buffer.getMetrics()).toMatchObject({
        buffered: 0,
        dropped: 0,
        lastFlushLatencyMs: 0,
      });
    });
  });

  describe("edge cases", () => {
    it("handles flush when buffer is empty", async () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      await buffer.flush(); // Should not throw
      expect(buffer.size).toBe(0);
    });

    it("handles send errors gracefully", async () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const send = mock(() => Promise.reject(new Error("Send failed")));

      buffer.enqueue({ data: "event1" }, send);

      // Flush should reject but not crash
      await expect(buffer.flush()).rejects.toThrow("Send failed");
    });

    it("allows multiple flushes in parallel", async () => {
      const buffer = new ClientBuffer({ maxSize: 10 });
      const sent: any[] = [];
      const send = mock((data: any) => {
        sent.push(data);
        return new Promise<void>((resolve) => setTimeout(resolve, 5));
      });

      buffer.enqueue({ data: "event1" }, send);
      buffer.enqueue({ data: "event2" }, send);

      // Start two flushes
      await Promise.all([buffer.flush(), buffer.flush()]);

      // Should not duplicate sends
      expect(sent.length).toBe(2);
    });
  });
});
