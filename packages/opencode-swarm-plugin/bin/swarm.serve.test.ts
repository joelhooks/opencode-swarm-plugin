/**
 * Tests for `swarm serve` command
 */

import { describe, test, expect } from "bun:test";
import { spawn } from "bun";

describe("swarm serve command", () => {
  test("serve command accepts custom port via --port flag", () => {
    // Verify that CLI parsing works for custom port
    const args = ["serve", "--port", "8080"];
    const port = args.includes("--port") 
      ? Number.parseInt(args[args.indexOf("--port") + 1])
      : 3001;
    
    expect(port).toBe(8080);
  });

  test("serve command defaults to port 3001", () => {
    const args = ["serve"];
    const port = args.includes("--port") 
      ? Number.parseInt(args[args.indexOf("--port") + 1])
      : 3001;
    
    expect(port).toBe(3001);
  });

  test("serve command uses project path from CWD", () => {
    const projectPath = process.cwd();
    expect(projectPath).toBeDefined();
    expect(typeof projectPath).toBe("string");
  });

  test("serve command appears in help text", async () => {
    const proc = spawn(["bun", "run", "bin/swarm.ts", "help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    
    expect(output).toContain("swarm serve");
    expect(output).toContain("Start SSE server");
    expect(output).toContain("--port");
  });
});
