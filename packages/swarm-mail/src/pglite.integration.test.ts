import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { closeAllSwarmMail, getDatabasePath, getSwarmMail } from "./pglite";

describe("PGLite recovery integration", () => {
  const testProjectPath = `/tmp/pglite-integration-test-${Date.now()}`;
  const originalSocket = process.env.SWARM_MAIL_SOCKET;
  
  beforeAll(() => {
    // Force embedded mode for tests (avoid daemon startup)
    process.env.SWARM_MAIL_SOCKET = 'false';
    
    // Clean slate
    const dbPath = getDatabasePath(testProjectPath);
    rmSync(dbPath, { recursive: true, force: true });
  });
  
  afterAll(async () => {
    await closeAllSwarmMail();
    const dbPath = getDatabasePath(testProjectPath);
    rmSync(dbPath, { recursive: true, force: true });
    
    // Restore env
    process.env.SWARM_MAIL_SOCKET = originalSocket;
  });

  test("concurrent getSwarmMail calls return same instance (race condition fix)", async () => {
    // Call getSwarmMail 5 times concurrently
    const promises = Array(5).fill(null).map(() => getSwarmMail(testProjectPath));
    const instances = await Promise.all(promises);
    
    // All should be the exact same instance
    const first = instances[0];
    for (const instance of instances) {
      expect(instance).toBe(first);
    }
  });

  test("recovery from corruption logs the database path", async () => {
    // This test validates Bug 4 fix - path should be in log
    const logSpy = spyOn(console, "log");
    
    // Create corrupted state by writing garbage to DB path (like pglite.test.ts does)
    const corruptProjectPath = `${testProjectPath}-corrupt`;
    const dbPath = getDatabasePath(corruptProjectPath);
    
    // Ensure clean state
    rmSync(dbPath, { recursive: true, force: true });
    mkdirSync(dbPath, { recursive: true });
    
    // Create garbage database files to trigger WASM abort
    writeFileSync(`${dbPath}/PG_VERSION`, "garbage");
    writeFileSync(`${dbPath}/postmaster.pid`, "garbage");
    
    // This should trigger recovery
    await getSwarmMail(corruptProjectPath);
    
    // Check if any log contained the path
    const calls = logSpy.mock.calls;
    const hasPath = calls.some(call => 
      call.some(arg => typeof arg === "string" && arg.includes(dbPath))
    );
    
    // Restore spy
    logSpy.mockRestore();
    
    // Path should be logged during recovery
    expect(hasPath).toBe(true);
  });
});
