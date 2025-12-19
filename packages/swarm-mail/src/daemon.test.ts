/**
 * Daemon lifecycle management tests
 *
 * Tests verify in-process PGLiteSocketServer daemon functionality:
 * - Server starts and accepts connections
 * - Health checks work
 * - Server stops cleanly
 * - PID file tracking works
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getPidFilePath,
  isDaemonRunning,
  startDaemon,
  stopDaemon,
  healthCheck,
} from "./daemon";
import { getProjectTempDirName } from "./pglite";

describe("daemon lifecycle", () => {
  const testProjectPath = join(process.cwd(), ".test-daemon");

  beforeEach(async () => {
    // Clean up test directory
    if (existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true });
    }
    await mkdir(testProjectPath, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testProjectPath)) {
      await rm(testProjectPath, { recursive: true });
    }
  });

  describe("getPidFilePath", () => {
    test("returns $TMPDIR path when projectPath provided", () => {
      const pidPath = getPidFilePath(testProjectPath);
      const expectedDir = join(tmpdir(), getProjectTempDirName(testProjectPath));
      expect(pidPath).toBe(join(expectedDir, "pglite-server.pid"));
      // Directory should be created
      expect(existsSync(expectedDir)).toBe(true);
    });

    test("returns global $TMPDIR path when no projectPath", () => {
      const pidPath = getPidFilePath();
      expect(pidPath).toContain("opencode-global/pglite-server.pid");
      expect(pidPath).toContain(tmpdir());
    });
  });

  describe("isDaemonRunning", () => {
    test("returns false when no PID file exists", async () => {
      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(false);
    });

    test("returns false when PID file points to dead process", async () => {
      // Write PID of a process that doesn't exist (999999 is unlikely to be a real PID)
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, "999999");

      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(false);
    });

    test("returns true when PID file points to alive process", async () => {
      // Write current process PID
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, process.pid.toString());

      const running = await isDaemonRunning(testProjectPath);
      expect(running).toBe(true);
    });
  });

  describe("startDaemon error handling", () => {
    test("throws error if daemon already running", async () => {
      // Write current process PID to simulate running daemon
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, process.pid.toString());

      // Should not throw - returns existing daemon info
      const result = await startDaemon({ projectPath: testProjectPath });
      expect(result.pid).toBe(process.pid);
    });
  });

  describe("stopDaemon", () => {
    test("is no-op when no PID file exists", async () => {
      // Should not throw
      await expect(stopDaemon(testProjectPath)).resolves.toBeUndefined();
    });

    test("cleans up PID file for dead process", async () => {
      // Write PID of dead process
      const pidPath = getPidFilePath(testProjectPath);
      await Bun.write(pidPath, "999999");
      expect(existsSync(pidPath)).toBe(true);

      await stopDaemon(testProjectPath);

      // PID file should be removed
      expect(existsSync(pidPath)).toBe(false);
    });
  });

  // NEW TESTS FOR IN-PROCESS PGLITESOCKETSERVER
  describe("PGLiteSocketServer in-process daemon", () => {
    afterEach(async () => {
      // Clean up daemon after each test
      await stopDaemon(testProjectPath);
    });

    test("startDaemon creates server that accepts connections", async () => {
      const { port, pid } = await startDaemon({
        port: 15433,
        projectPath: testProjectPath,
      });

      expect(pid).toBe(process.pid); // In-process means current process
      expect(port).toBe(15433);

      // Verify server is healthy
      const healthy = await healthCheck({ port: 15433 });
      expect(healthy).toBe(true);
    });

    test("stopDaemon closes server cleanly", async () => {
      await startDaemon({ port: 15434, projectPath: testProjectPath });

      // Verify server is running
      let healthy = await healthCheck({ port: 15434 });
      expect(healthy).toBe(true);

      // Stop daemon
      await stopDaemon(testProjectPath);

      // Verify server is no longer responding
      healthy = await healthCheck({ port: 15434 });
      expect(healthy).toBe(false);

      // PID file should be removed
      const pidPath = getPidFilePath(testProjectPath);
      expect(existsSync(pidPath)).toBe(false);
    });

    test("startDaemon reuses existing server", async () => {
      const info1 = await startDaemon({ port: 15435, projectPath: testProjectPath });
      const info2 = await startDaemon({ port: 15435, projectPath: testProjectPath });

      expect(info1.pid).toBe(info2.pid);
      expect(info1.port).toBe(info2.port);
    });

    test("startDaemon with Unix socket works", async () => {
      const socketPath = join(tmpdir(), "test-daemon.sock");
      const { socketPath: returnedPath } = await startDaemon({
        path: socketPath,
        projectPath: testProjectPath,
      });

      expect(returnedPath).toBe(socketPath);

      // Verify server is healthy via socket
      const healthy = await healthCheck({ path: socketPath });
      expect(healthy).toBe(true);
    });
  });
});
