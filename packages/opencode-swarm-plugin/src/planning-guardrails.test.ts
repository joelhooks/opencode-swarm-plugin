import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  analyzeTodoWrite,
  shouldAnalyzeTool,
  detectCoordinatorViolation,
  type ViolationDetectionResult,
} from "./planning-guardrails";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "os";

describe("planning-guardrails", () => {
  describe("shouldAnalyzeTool", () => {
    it("returns true for todowrite", () => {
      expect(shouldAnalyzeTool("todowrite")).toBe(true);
      expect(shouldAnalyzeTool("TodoWrite")).toBe(true);
    });

    it("returns false for other tools", () => {
      expect(shouldAnalyzeTool("hive_create")).toBe(false);
      expect(shouldAnalyzeTool("swarm_decompose")).toBe(false);
      expect(shouldAnalyzeTool("read")).toBe(false);
    });
  });

  describe("analyzeTodoWrite", () => {
    it("returns no warning for small todo lists", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Implement feature A", status: "pending" },
          { content: "Add tests", status: "pending" },
        ],
      });

      expect(result.looksLikeParallelWork).toBe(false);
      expect(result.warning).toBeUndefined();
      expect(result.totalCount).toBe(2);
    });

    it("warns for 6+ file modification todos", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Implement src/auth/login.ts", status: "pending" },
          { content: "Create src/auth/logout.ts", status: "pending" },
          { content: "Add src/auth/types.ts", status: "pending" },
          { content: "Update src/auth/index.ts", status: "pending" },
          { content: "Refactor src/lib/session.ts", status: "pending" },
          { content: "Modify src/middleware/auth.ts", status: "pending" },
        ],
      });

      expect(result.looksLikeParallelWork).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain("multi-file implementation plan");
      expect(result.warning).toContain("swarm");
      expect(result.fileModificationCount).toBeGreaterThanOrEqual(4);
    });

    it("does not warn for tracking/coordination todos", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Review PR #123", status: "pending" },
          { content: "Check tests pass", status: "pending" },
          { content: "Verify deployment", status: "pending" },
          { content: "Run integration tests", status: "pending" },
          { content: "Merge to main", status: "pending" },
          { content: "Push to production", status: "pending" },
        ],
      });

      expect(result.looksLikeParallelWork).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it("does not warn for mixed todos with few file modifications", () => {
      const result = analyzeTodoWrite({
        todos: [
          { content: "Implement src/feature.ts", status: "pending" },
          { content: "Review changes", status: "pending" },
          { content: "Run tests", status: "pending" },
          { content: "Check linting", status: "pending" },
          { content: "Deploy to staging", status: "pending" },
          { content: "Verify in browser", status: "pending" },
        ],
      });

      // Only 1 file modification out of 6 - should not trigger
      expect(result.looksLikeParallelWork).toBe(false);
      expect(result.warning).toBeUndefined();
    });

    it("handles empty or missing todos", () => {
      expect(analyzeTodoWrite({}).looksLikeParallelWork).toBe(false);
      expect(analyzeTodoWrite({ todos: [] }).looksLikeParallelWork).toBe(false);
      expect(analyzeTodoWrite({ todos: undefined as any }).looksLikeParallelWork).toBe(false);
    });

    it("handles malformed todo items", () => {
      const result = analyzeTodoWrite({
        todos: [
          null,
          undefined,
          "string instead of object",
          { noContent: true },
          { content: "Implement src/valid.ts", status: "pending" },
          { content: "Create src/another.ts", status: "pending" },
        ] as any,
      });

      // Should handle gracefully without crashing
      expect(result.totalCount).toBe(6);
    });
  });

  describe("detectCoordinatorViolation", () => {
    const sessionId = "test-session-123";
    const epicId = "test-epic-456";

    // Clean up session files after tests
    afterEach(() => {
      const sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
      const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
      if (fs.existsSync(sessionPath)) {
        fs.unlinkSync(sessionPath);
      }
    });

    describe("coordinator_edited_file violation", () => {
      it("detects Edit tool call from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "edit",
          toolArgs: { filePath: "/path/to/file.ts", oldString: "old", newString: "new" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_edited_file");
        expect(result.message).toContain("Coordinators should spawn workers");
        expect(result.payload.tool).toBe("edit");
        expect(result.payload.file).toBe("/path/to/file.ts");
      });

      it("detects Write tool call from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "write",
          toolArgs: { filePath: "/path/to/new-file.ts", content: "export const foo = 1;" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_edited_file");
        expect(result.message).toContain("Coordinators should spawn workers");
        expect(result.payload.tool).toBe("write");
        expect(result.payload.file).toBe("/path/to/new-file.ts");
      });

      it("does not detect edit from worker agent", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "edit",
          toolArgs: { filePath: "/path/to/file.ts", oldString: "old", newString: "new" },
          agentContext: "worker",
        });

        expect(result.isViolation).toBe(false);
      });

      it("does not detect Read tool (read-only)", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "read",
          toolArgs: { filePath: "/path/to/file.ts" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(false);
      });
    });

    describe("coordinator_ran_tests violation", () => {
      it("detects bash test execution from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "bash",
          toolArgs: { command: "bun test src/module.test.ts" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_ran_tests");
        expect(result.message).toContain("Workers run tests");
        expect(result.payload.command).toContain("bun test");
      });

      it("detects npm test from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "bash",
          toolArgs: { command: "npm run test:unit" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_ran_tests");
      });

      it("detects jest from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "bash",
          toolArgs: { command: "jest --coverage" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_ran_tests");
      });

      it("does not detect non-test bash commands", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "bash",
          toolArgs: { command: "git status" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(false);
      });

      it("does not detect test execution from worker", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "bash",
          toolArgs: { command: "bun test" },
          agentContext: "worker",
        });

        expect(result.isViolation).toBe(false);
      });
    });

    describe("coordinator_reserved_files violation", () => {
      it("detects swarmmail_reserve from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "swarmmail_reserve",
          toolArgs: { paths: ["src/auth/**"], reason: "Working on auth" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_reserved_files");
        expect(result.message).toContain("Workers reserve files");
        expect(result.payload.paths).toEqual(["src/auth/**"]);
      });

      it("detects agentmail_reserve from coordinator", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "agentmail_reserve",
          toolArgs: { paths: ["src/lib/**"], reason: "Refactoring" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("coordinator_reserved_files");
      });

      it("does not detect reserve from worker", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "swarmmail_reserve",
          toolArgs: { paths: ["src/auth/**"], reason: "Working on auth" },
          agentContext: "worker",
        });

        expect(result.isViolation).toBe(false);
      });
    });

    describe("no_worker_spawned violation", () => {
      it("detects no spawn after decomposition", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "hive_create_epic",
          toolArgs: {
            epic_title: "Add feature",
            subtasks: [
              { title: "Task 1", files: ["a.ts"] },
              { title: "Task 2", files: ["b.ts"] },
            ],
          },
          agentContext: "coordinator",
          checkNoSpawn: true,
        });

        expect(result.isViolation).toBe(true);
        expect(result.violationType).toBe("no_worker_spawned");
        expect(result.message).toContain("decomposition without spawning");
        expect(result.payload.epic_title).toBe("Add feature");
        expect(result.payload.subtask_count).toBe(2);
      });

      it("does not flag if workers were spawned", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "hive_create_epic",
          toolArgs: {
            epic_title: "Add feature",
            subtasks: [
              { title: "Task 1", files: ["a.ts"] },
              { title: "Task 2", files: ["b.ts"] },
            ],
          },
          agentContext: "coordinator",
          checkNoSpawn: false, // Workers were spawned
        });

        expect(result.isViolation).toBe(false);
      });

      it("does not flag from worker agent", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "hive_create_epic",
          toolArgs: {
            epic_title: "Add feature",
            subtasks: [{ title: "Task 1", files: ["a.ts"] }],
          },
          agentContext: "worker",
          checkNoSpawn: true,
        });

        expect(result.isViolation).toBe(false);
      });
    });

    describe("event capture integration", () => {
      it("captures violation event to session file when violation detected", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "edit",
          toolArgs: { filePath: "/test.ts", oldString: "a", newString: "b" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(true);

        // Verify event was written to session file
        const sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
        const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
        expect(fs.existsSync(sessionPath)).toBe(true);

        const content = fs.readFileSync(sessionPath, "utf-8");
        const lines = content.trim().split("\n");
        expect(lines.length).toBe(1);

        const event = JSON.parse(lines[0]);
        expect(event.event_type).toBe("VIOLATION");
        expect(event.violation_type).toBe("coordinator_edited_file");
        expect(event.session_id).toBe(sessionId);
        expect(event.epic_id).toBe(epicId);
        expect(event.payload.tool).toBe("edit");
      });

      it("does not capture event when no violation", () => {
        const result = detectCoordinatorViolation({
          sessionId,
          epicId,
          toolName: "read",
          toolArgs: { filePath: "/test.ts" },
          agentContext: "coordinator",
        });

        expect(result.isViolation).toBe(false);

        // Verify no session file created
        const sessionDir = path.join(os.homedir(), ".config", "swarm-tools", "sessions");
        const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
        expect(fs.existsSync(sessionPath)).toBe(false);
      });
    });
  });
});
