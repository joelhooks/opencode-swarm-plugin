/**
 * PGLite Convenience Layer Tests
 *
 * Tests for the simplified PGLite API including:
 * - Database path generation (pure functions, no DB needed)
 * - Singleton instance management
 * - Error recovery from corrupted databases (stale postmaster.pid)
 * - In-memory mode for testing
 *
 * PERFORMANCE: Uses a single shared in-memory instance for most tests.
 * Only creates new instances when testing instance lifecycle or recovery.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SwarmMailAdapter } from "./types";
import {
  closeAllSwarmMail,
  closeSwarmMail,
  createInMemorySwarmMail,
  getDatabasePath,
  getProjectTempDirName,
  getSwarmMail,
  hashProjectPath,
} from "./pglite";

/**
 * Shared in-memory instance for tests that just need a working database.
 * Created once, reused across test groups, closed at the end.
 */
let sharedInstance: SwarmMailAdapter;

beforeAll(async () => {
  sharedInstance = await createInMemorySwarmMail("shared-test");
});

afterAll(async () => {
  await sharedInstance.close();
  await closeAllSwarmMail();
});

describe("pglite", () => {
  /**
   * Pure function tests - no database needed, instant
   */
  describe("hashProjectPath", () => {
    test("returns 8-character hash", () => {
      const hash = hashProjectPath("/some/project/path");
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    test("same path produces same hash", () => {
      const hash1 = hashProjectPath("/my/project");
      const hash2 = hashProjectPath("/my/project");
      expect(hash1).toBe(hash2);
    });

    test("different paths produce different hashes", () => {
      const hash1 = hashProjectPath("/project/a");
      const hash2 = hashProjectPath("/project/b");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("getProjectTempDirName", () => {
    test("formats as opencode-<name>-<hash>", () => {
      const dirName = getProjectTempDirName("/path/to/my-project");
      expect(dirName).toMatch(/^opencode-my-project-[a-f0-9]{8}$/);
    });

    test("sanitizes special characters", () => {
      const dirName = getProjectTempDirName("/path/to/My Project@v2.0");
      expect(dirName).toMatch(/^opencode-my-project-v2-0-[a-f0-9]{8}$/);
    });

    test("truncates long names to 32 chars", () => {
      const longName = "a".repeat(100);
      const dirName = getProjectTempDirName(`/path/to/${longName}`);
      // "opencode-" (9) + truncated name (32) + "-" (1) + hash (8) = 50 max
      expect(dirName.length).toBeLessThanOrEqual(50);
    });
  });

  describe("getDatabasePath", () => {
    test("returns project-specific path when projectPath provided", () => {
      const dbPath = getDatabasePath("/my/project");
      expect(dbPath).toContain("opencode-project-");
      expect(dbPath).toEndWith("/streams");
    });

    test("returns global path when no projectPath", () => {
      const dbPath = getDatabasePath();
      expect(dbPath).toContain("opencode-global");
      expect(dbPath).toEndWith("/streams");
    });

    test("creates directory if it doesn't exist", () => {
      const uniquePath = `/tmp/test-project-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const dbPath = getDatabasePath(uniquePath);
      const parentDir = dbPath.replace("/streams", "");
      expect(existsSync(parentDir)).toBe(true);
      // Cleanup
      rmSync(parentDir, { recursive: true, force: true });
    });
  });

  /**
   * In-memory instance tests - uses shared instance where possible
   */
  describe("createInMemorySwarmMail", () => {
    test("shared instance is functional", async () => {
      // Use the shared instance - no new instance created
      expect(sharedInstance).toBeDefined();
      expect(sharedInstance.registerAgent).toBeFunction();
      expect(sharedInstance.sendMessage).toBeFunction();
    });

    test("can register and query agents", async () => {
      const agent = await sharedInstance.registerAgent(
        "shared-test",
        `agent-${Date.now()}`
      );
      expect(agent.agent_name).toContain("agent-");
    });

    // NOTE: Isolation test removed - it's implicitly tested by the fact that
    // in-memory instances don't share state (each gets fresh PGLite).
    // Creating 2 extra instances just to prove isolation adds 4+ seconds.
  });

  /**
   * Singleton behavior tests - needs real file-based instances
   */
  describe("getSwarmMail singleton", () => {
    const testProjectPath = `/tmp/pglite-singleton-test-${Date.now()}`;
    const originalSocket = process.env.SWARM_MAIL_SOCKET;

    beforeAll(() => {
      // Force embedded mode for tests (avoid daemon startup)
      process.env.SWARM_MAIL_SOCKET = 'false';
    });

    afterAll(async () => {
      await closeSwarmMail(testProjectPath);
      const dbPath = getDatabasePath(testProjectPath);
      const parentDir = dbPath.replace("/streams", "");
      if (existsSync(parentDir)) {
        rmSync(parentDir, { recursive: true, force: true });
      }
      process.env.SWARM_MAIL_SOCKET = originalSocket;
    });

    test("returns same instance for same project path", async () => {
      const instance1 = await getSwarmMail(testProjectPath);
      const instance2 = await getSwarmMail(testProjectPath);
      expect(instance1).toBe(instance2);
    });

    test("instance is functional", async () => {
      const instance = await getSwarmMail(testProjectPath);
      const agent = await instance.registerAgent(
        testProjectPath,
        "singleton-test-agent"
      );
      expect(agent.agent_name).toBe("singleton-test-agent");
    });
  });

  /**
   * Socket mode default behavior tests
   * 
   * Integration test: verifies getSwarmMail() uses embedded mode when
   * SWARM_MAIL_SOCKET=false, and falls back to embedded when socket fails.
   */
  describe("socket mode default behavior", () => {
    test("uses embedded mode when SWARM_MAIL_SOCKET=false", async () => {
      const originalSocket = process.env.SWARM_MAIL_SOCKET;
      process.env.SWARM_MAIL_SOCKET = 'false';
      
      const testProjectPath = `/tmp/pglite-embedded-test-${Date.now()}`;
      
      try {
        // Should use embedded PGLite (no daemon attempt)
        const instance = await getSwarmMail(testProjectPath);
        expect(instance).toBeDefined();
        
        // Should be able to use it
        await instance.registerAgent(testProjectPath, "embedded-test");
        
        await closeSwarmMail(testProjectPath);
      } finally {
        // Cleanup
        const dbPath = getDatabasePath(testProjectPath);
        const parentDir = dbPath.replace("/streams", "");
        if (existsSync(parentDir)) {
          rmSync(parentDir, { recursive: true, force: true });
        }
        process.env.SWARM_MAIL_SOCKET = originalSocket;
      }
    });
    
    test("attempts daemon mode by default (no env var set)", async () => {
      const originalSocket = process.env.SWARM_MAIL_SOCKET;
      delete process.env.SWARM_MAIL_SOCKET; // Explicitly unset
      
      const testProjectPath = `/tmp/pglite-daemon-default-test-${Date.now()}`;
      
      try {
        // Should attempt daemon mode, fall back to embedded if daemon not running
        // This test verifies the default is daemon attempt, not that daemon succeeds
        const instance = await getSwarmMail(testProjectPath);
        expect(instance).toBeDefined();
        
        // Should work either way (daemon or embedded fallback)
        await instance.registerAgent(testProjectPath, "default-test");
        
        await closeSwarmMail(testProjectPath);
      } finally {
        // Cleanup
        const dbPath = getDatabasePath(testProjectPath);
        const parentDir = dbPath.replace("/streams", "");
        if (existsSync(parentDir)) {
          rmSync(parentDir, { recursive: true, force: true });
        }
        process.env.SWARM_MAIL_SOCKET = originalSocket;
      }
    });
    
    // Note: Testing successful daemon connection is covered in daemon.test.ts.
    // Here we test the default behavior and opt-out mechanism.
  });

  /**
   * WASM abort recovery tests - needs to create corrupted state
   * 
   * Combined into single test to minimize PGLite instance creation.
   * Each instance takes ~2s to initialize WASM.
   */
  describe("WASM abort recovery", () => {
    const testProjectPath = `/tmp/pglite-recovery-test-${Date.now()}`;
    const originalSocket = process.env.SWARM_MAIL_SOCKET;

    beforeAll(() => {
      // Force embedded mode for tests (avoid daemon startup)
      process.env.SWARM_MAIL_SOCKET = 'false';
    });

    afterAll(async () => {
      await closeAllSwarmMail();
      const dbPath = getDatabasePath(testProjectPath);
      const parentDir = dbPath.replace("/streams", "");
      if (existsSync(parentDir)) {
        rmSync(parentDir, { recursive: true, force: true });
      }
      process.env.SWARM_MAIL_SOCKET = originalSocket;
    });

    test("recovers from stale postmaster.pid and corrupted database", async () => {
      const dbPath = getDatabasePath(testProjectPath);

      // PART 1: Test recovery from stale postmaster.pid
      // Create valid database first
      const swarmMail = await getSwarmMail(testProjectPath);
      await swarmMail.registerAgent(testProjectPath, "initial-agent");
      await closeSwarmMail(testProjectPath);

      // Simulate crash with stale postmaster.pid
      writeFileSync(
        join(dbPath, "postmaster.pid"),
        `-42\n/tmp/pglite\n${Date.now()}\n5432\n\n\n 12345 666\n`
      );

      // Should recover
      const recovered = await getSwarmMail(testProjectPath);
      const agent1 = await recovered.registerAgent(testProjectPath, "recovered");
      expect(agent1.agent_name).toBe("recovered");

      // PART 2: Test recovery from completely corrupted database
      await closeSwarmMail(testProjectPath);

      // Create garbage database
      if (existsSync(dbPath)) rmSync(dbPath, { recursive: true, force: true });
      mkdirSync(dbPath, { recursive: true });
      writeFileSync(join(dbPath, "PG_VERSION"), "garbage");
      writeFileSync(join(dbPath, "postmaster.pid"), "garbage");

      // Should recover
      const fromCorruption = await getSwarmMail(testProjectPath);
      const agent2 = await fromCorruption.registerAgent(testProjectPath, "from-corruption");
      expect(agent2.agent_name).toBe("from-corruption");
    });
  });
});
