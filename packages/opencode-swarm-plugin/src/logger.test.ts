import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm, readdir, readFile } from "node:fs/promises";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pino from "pino";

/**
 * Logger tests that don't rely on module cache clearing.
 * 
 * Instead of trying to reset the cached logger instances (which doesn't work in Bun ESM),
 * we test the logger behavior directly using unique log directories per test.
 * The logger module caches by logDir path, so unique paths = unique instances.
 * 
 * IMPORTANT: Test directories MUST be created with mkdir() BEFORE calling getLogger/createChildLogger
 * to prevent ENOENT race conditions. The race happens when:
 * 1. Test calls getLogger(testLogDir) which triggers ensureLogDir(testLogDir)
 * 2. Test immediately calls readdir(testLogDir) 
 * 3. If ensureLogDir hasn't completed, readdir fails with ENOENT
 * 
 * Fix: Create directories explicitly in tests before any logger operations.
 */
describe("Logger Infrastructure", () => {
  let tempRoot: string;
  let originalLogFile: string | undefined;

  beforeAll(() => {
    // Create isolated temp directory for logger tests
    tempRoot = mkdtempSync(join(tmpdir(), "swarm-test-logger-"));
  });

  afterAll(() => {
    // Clean up temp directory
    rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Save original env
    originalLogFile = process.env.SWARM_LOG_FILE;
  });

  afterEach(async () => {
    // Restore environment
    if (originalLogFile !== undefined) {
      process.env.SWARM_LOG_FILE = originalLogFile;
    } else {
      delete process.env.SWARM_LOG_FILE;
    }
  });

  describe("getLogger", () => {
    test("returns a valid Pino logger instance", async () => {
      // Use unique dir to avoid cache conflicts
      const testLogDir = join(tempRoot, `test-${Date.now()}-1`);
      await mkdir(testLogDir, { recursive: true });
      process.env.SWARM_LOG_FILE = "1";
      
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.warn).toBe("function");
    });

    test("creates log directory if it doesn't exist", async () => {
      const testLogDir = join(tempRoot, `test-${Date.now()}-2`, "nested", "path");
      process.env.SWARM_LOG_FILE = "1";
      
      const { getLogger } = await import("./logger");
      getLogger(testLogDir);

      expect(existsSync(testLogDir)).toBe(true);
    });

    test("creates log file when SWARM_LOG_FILE=1", async () => {
      const testLogDir = join(tempRoot, `test-${Date.now()}-3`);
      await mkdir(testLogDir, { recursive: true });
      process.env.SWARM_LOG_FILE = "1";
      
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      // Write a log to force file creation
      logger.info("test message");

      // Wait for async file writes (pino.destination is async)
      await new Promise((resolve) => setTimeout(resolve, 200));

      const files = await readdir(testLogDir);
      expect(files).toContain("swarm.log");
    });

    test("writes log entries to file", async () => {
      const testLogDir = join(tempRoot, `test-${Date.now()}-4`);
      await mkdir(testLogDir, { recursive: true });
      process.env.SWARM_LOG_FILE = "1";
      
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      logger.info("test log entry");
      logger.error("test error entry");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const logPath = join(testLogDir, "swarm.log");
      const content = await readFile(logPath, "utf-8");
      
      expect(content).toContain("test log entry");
      expect(content).toContain("test error entry");
    });
  });

  describe("createChildLogger", () => {
    test("creates child logger with module namespace", async () => {
      const testLogDir = join(tempRoot, `test-${Date.now()}-5`);
      await mkdir(testLogDir, { recursive: true });
      process.env.SWARM_LOG_FILE = "1";
      
      const { createChildLogger } = await import("./logger");
      const childLogger = createChildLogger("compaction", testLogDir);

      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe("function");
    });

    test("child logger writes to module-specific file", async () => {
      const testLogDir = join(tempRoot, `test-${Date.now()}-6`);
      await mkdir(testLogDir, { recursive: true });
      process.env.SWARM_LOG_FILE = "1";
      
      const { createChildLogger } = await import("./logger");
      const childLogger = createChildLogger("compaction", testLogDir);
      childLogger.info("compaction test message");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const files = await readdir(testLogDir);
      expect(files).toContain("compaction.log");
    });

    test("multiple child loggers write to separate files", async () => {
      const testLogDir = join(tempRoot, `test-${Date.now()}-7`);
      await mkdir(testLogDir, { recursive: true });
      process.env.SWARM_LOG_FILE = "1";
      
      const { createChildLogger } = await import("./logger");
      const compactionLogger = createChildLogger("compaction", testLogDir);
      const cliLogger = createChildLogger("cli", testLogDir);

      compactionLogger.info("compaction message");
      cliLogger.info("cli message");

      // Wait for async file writes
      await new Promise((resolve) => setTimeout(resolve, 200));

      const files = await readdir(testLogDir);
      expect(files).toContain("compaction.log");
      expect(files).toContain("cli.log");
    });
  });

  describe("stdout mode (default)", () => {
    test("works without file logging by default", async () => {
      // Use a unique directory to get a fresh logger instance
      const testLogDir = join(tempRoot, `test-stdout-${Date.now()}-8`);
      await mkdir(testLogDir, { recursive: true });
      delete process.env.SWARM_LOG_FILE;

      // Import logger - since we use a unique path, cache won't interfere
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);

      expect(logger).toBeDefined();
      // Should not throw when logging to stdout
      logger.info("stdout mode message");
    });

    test("does not create log files when SWARM_LOG_FILE is not set", async () => {
      // Use a unique directory to get a fresh logger instance
      const testLogDir = join(tempRoot, `test-stdout-${Date.now()}-9`);
      await mkdir(testLogDir, { recursive: true });
      delete process.env.SWARM_LOG_FILE;

      // Import logger - since we use a unique path, cache won't interfere
      const { getLogger } = await import("./logger");
      const logger = getLogger(testLogDir);
      logger.info("this goes to stdout");

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Log directory should exist but no log files (stdout mode)
      const files = await readdir(testLogDir);
      const logFiles = files.filter(f => f.endsWith(".log"));
      expect(logFiles).toHaveLength(0);
    });
  });
});
