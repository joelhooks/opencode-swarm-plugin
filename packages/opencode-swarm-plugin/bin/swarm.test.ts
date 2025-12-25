#!/usr/bin/env bun
/**
 * Tests for swarm CLI file operation helpers
 * 
 * These tests verify the verbose output helpers used in `swarm setup`:
 * - writeFileWithStatus: logs created/updated/unchanged status
 * - mkdirWithStatus: logs directory creation
 * - rmWithStatus: logs file removal
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

type FileStatus = "created" | "updated" | "unchanged";

/**
 * Mock logger for testing (matches @clack/prompts API)
 */
class MockLogger {
  logs: Array<{ type: string; message: string }> = [];

  success(msg: string) {
    this.logs.push({ type: "success", message: msg });
  }

  message(msg: string) {
    this.logs.push({ type: "message", message: msg });
  }

  reset() {
    this.logs = [];
  }
}

describe("File operation helpers", () => {
  let testDir: string;
  let logger: MockLogger;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    logger = new MockLogger();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writeFileWithStatus", () => {
    // Helper that mimics the implementation
    function writeFileWithStatus(path: string, content: string, label: string): FileStatus {
      const exists = existsSync(path);
      
      if (exists) {
        const current = readFileSync(path, "utf-8");
        if (current === content) {
          logger.message(`  ${label}: ${path} (unchanged)`);
          return "unchanged";
        }
      }
      
      writeFileSync(path, content);
      const status: FileStatus = exists ? "updated" : "created";
      logger.success(`${label}: ${path} (${status})`);
      return status;
    }

    test("returns 'created' for new file", () => {
      const filePath = join(testDir, "new.txt");
      const result = writeFileWithStatus(filePath, "content", "Test");
      
      expect(result).toBe("created");
      expect(logger.logs[0].type).toBe("success");
      expect(logger.logs[0].message).toContain("(created)");
      expect(existsSync(filePath)).toBe(true);
    });

    test("returns 'unchanged' if content is same", () => {
      const filePath = join(testDir, "existing.txt");
      writeFileSync(filePath, "same content");
      
      const result = writeFileWithStatus(filePath, "same content", "Test");
      
      expect(result).toBe("unchanged");
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("(unchanged)");
    });

    test("returns 'updated' if content differs", () => {
      const filePath = join(testDir, "existing.txt");
      writeFileSync(filePath, "old content");
      
      const result = writeFileWithStatus(filePath, "new content", "Test");
      
      expect(result).toBe("updated");
      expect(logger.logs[0].type).toBe("success");
      expect(logger.logs[0].message).toContain("(updated)");
      expect(readFileSync(filePath, "utf-8")).toBe("new content");
    });
  });

  describe("mkdirWithStatus", () => {
    function mkdirWithStatus(path: string): boolean {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
        logger.message(`  Created directory: ${path}`);
        return true;
      }
      return false;
    }

    test("creates directory and logs when it doesn't exist", () => {
      const dirPath = join(testDir, "newdir");
      const result = mkdirWithStatus(dirPath);
      
      expect(result).toBe(true);
      expect(existsSync(dirPath)).toBe(true);
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("Created directory");
    });

    test("returns false when directory already exists", () => {
      const dirPath = join(testDir, "existing");
      mkdirSync(dirPath);
      
      const result = mkdirWithStatus(dirPath);
      
      expect(result).toBe(false);
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("rmWithStatus", () => {
    function rmWithStatus(path: string, label: string): void {
      if (existsSync(path)) {
        rmSync(path);
        logger.message(`  Removed ${label}: ${path}`);
      }
    }

    test("removes file and logs when it exists", () => {
      const filePath = join(testDir, "todelete.txt");
      writeFileSync(filePath, "content");
      
      rmWithStatus(filePath, "test file");
      
      expect(existsSync(filePath)).toBe(false);
      expect(logger.logs[0].type).toBe("message");
      expect(logger.logs[0].message).toContain("Removed test file");
    });

    test("does nothing when file doesn't exist", () => {
      const filePath = join(testDir, "nonexistent.txt");
      
      rmWithStatus(filePath, "test file");
      
      expect(logger.logs.length).toBe(0);
    });
  });

  describe("getResearcherAgent", () => {
    // Mock implementation for testing - will match actual implementation
    function getResearcherAgent(model: string): string {
      return `---
name: swarm-researcher
description: Research agent for discovering and documenting context
model: ${model}
---

READ-ONLY research agent. Never modifies code - only gathers intel and stores findings.`;
    }

    test("includes model in frontmatter", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("model: anthropic/claude-haiku-4-5");
    });

    test("emphasizes READ-ONLY nature", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("READ-ONLY");
    });

    test("includes agent name in frontmatter", () => {
      const template = getResearcherAgent("anthropic/claude-haiku-4-5");
      
      expect(template).toContain("name: swarm-researcher");
    });
  });
});

// ============================================================================
// Log Command Tests (TDD)
// ============================================================================

// ============================================================================
// Cells Command Tests (TDD)
// ============================================================================

/**
 * Format cells as table output
 */
function formatCellsTable(cells: Array<{
  id: string;
  title: string;
  status: string;
  priority: number;
}>): string {
  if (cells.length === 0) {
    return "No cells found";
  }

  const rows = cells.map(c => ({
    id: c.id,
    title: c.title.length > 50 ? c.title.slice(0, 47) + "..." : c.title,
    status: c.status,
    priority: String(c.priority),
  }));

  // Calculate column widths
  const widths = {
    id: Math.max(2, ...rows.map(r => r.id.length)),
    title: Math.max(5, ...rows.map(r => r.title.length)),
    status: Math.max(6, ...rows.map(r => r.status.length)),
    priority: Math.max(8, ...rows.map(r => r.priority.length)),
  };

  // Build header
  const header = [
    "ID".padEnd(widths.id),
    "TITLE".padEnd(widths.title),
    "STATUS".padEnd(widths.status),
    "PRIORITY".padEnd(widths.priority),
  ].join("  ");

  const separator = "-".repeat(header.length);

  // Build rows
  const bodyRows = rows.map(r =>
    [
      r.id.padEnd(widths.id),
      r.title.padEnd(widths.title),
      r.status.padEnd(widths.status),
      r.priority.padEnd(widths.priority),
    ].join("  ")
  );

  return [header, separator, ...bodyRows].join("\n");
}

describe("Cells command", () => {
  describe("formatCellsTable", () => {
    test("formats cells as table with id, title, status, priority", () => {
      const cells = [
        {
          id: "test-abc123-xyz",
          title: "Fix bug",
          status: "open",
          priority: 0,
          type: "bug",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
        {
          id: "test-def456-abc",
          title: "Add feature",
          status: "in_progress",
          priority: 2,
          type: "feature",
          created_at: 1234567890,
          updated_at: 1234567890,
        },
      ];

      const table = formatCellsTable(cells);

      // Should contain headers
      expect(table).toContain("ID");
      expect(table).toContain("TITLE");
      expect(table).toContain("STATUS");
      expect(table).toContain("PRIORITY");

      // Should contain cell data
      expect(table).toContain("test-abc123-xyz");
      expect(table).toContain("Fix bug");
      expect(table).toContain("open");
      expect(table).toContain("0");

      expect(table).toContain("test-def456-abc");
      expect(table).toContain("Add feature");
      expect(table).toContain("in_progress");
      expect(table).toContain("2");
    });

    test("returns 'No cells found' for empty array", () => {
      const table = formatCellsTable([]);
      expect(table).toBe("No cells found");
    });
  });
});

describe("Log command helpers", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `swarm-log-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("parseLogLine", () => {
    function parseLogLine(line: string): { level: number; time: string; module: string; msg: string } | null {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.level === "number" && parsed.time && parsed.msg) {
          return {
            level: parsed.level,
            time: parsed.time,
            module: parsed.module || "unknown",
            msg: parsed.msg,
          };
        }
      } catch {
        // Invalid JSON
      }
      return null;
    }

    test("parses valid log line", () => {
      const line = '{"level":30,"time":"2024-12-24T16:00:00.000Z","module":"compaction","msg":"started"}';
      const result = parseLogLine(line);
      
      expect(result).not.toBeNull();
      expect(result?.level).toBe(30);
      expect(result?.module).toBe("compaction");
      expect(result?.msg).toBe("started");
    });

    test("returns null for invalid JSON", () => {
      const line = "not json";
      expect(parseLogLine(line)).toBeNull();
    });

    test("defaults module to 'unknown' if missing", () => {
      const line = '{"level":30,"time":"2024-12-24T16:00:00.000Z","msg":"test"}';
      const result = parseLogLine(line);
      
      expect(result?.module).toBe("unknown");
    });
  });

  describe("filterLogsByLevel", () => {
    function filterLogsByLevel(logs: Array<{ level: number }>, minLevel: number): Array<{ level: number }> {
      return logs.filter((log) => log.level >= minLevel);
    }

    test("filters logs by minimum level", () => {
      const logs = [
        { level: 10 }, // trace
        { level: 30 }, // info
        { level: 50 }, // error
      ];
      
      const result = filterLogsByLevel(logs, 30);
      expect(result).toHaveLength(2);
      expect(result[0].level).toBe(30);
      expect(result[1].level).toBe(50);
    });

    test("includes all logs when minLevel is 0", () => {
      const logs = [
        { level: 10 },
        { level: 20 },
        { level: 30 },
      ];
      
      const result = filterLogsByLevel(logs, 0);
      expect(result).toHaveLength(3);
    });
  });

  describe("filterLogsByModule", () => {
    function filterLogsByModule(logs: Array<{ module: string }>, module: string): Array<{ module: string }> {
      return logs.filter((log) => log.module === module);
    }

    test("filters logs by exact module name", () => {
      const logs = [
        { module: "compaction" },
        { module: "swarm" },
        { module: "compaction" },
      ];
      
      const result = filterLogsByModule(logs, "compaction");
      expect(result).toHaveLength(2);
    });

    test("returns empty array when no match", () => {
      const logs = [
        { module: "compaction" },
      ];
      
      const result = filterLogsByModule(logs, "swarm");
      expect(result).toHaveLength(0);
    });
  });

  describe("filterLogsBySince", () => {
    function parseDuration(duration: string): number | null {
      const match = duration.match(/^(\d+)([smhd])$/);
      if (!match) return null;
      
      const [, num, unit] = match;
      const value = parseInt(num, 10);
      
      const multipliers: Record<string, number> = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
      };
      
      return value * multipliers[unit];
    }

    function filterLogsBySince(logs: Array<{ time: string }>, sinceMs: number): Array<{ time: string }> {
      const cutoffTime = Date.now() - sinceMs;
      return logs.filter((log) => new Date(log.time).getTime() >= cutoffTime);
    }

    test("parseDuration handles seconds", () => {
      expect(parseDuration("30s")).toBe(30 * 1000);
    });

    test("parseDuration handles minutes", () => {
      expect(parseDuration("5m")).toBe(5 * 60 * 1000);
    });

    test("parseDuration handles hours", () => {
      expect(parseDuration("2h")).toBe(2 * 60 * 60 * 1000);
    });

    test("parseDuration handles days", () => {
      expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
    });

    test("parseDuration returns null for invalid format", () => {
      expect(parseDuration("invalid")).toBeNull();
      expect(parseDuration("30x")).toBeNull();
      expect(parseDuration("30")).toBeNull();
    });

    test("filterLogsBySince filters old logs", () => {
      const now = Date.now();
      const logs = [
        { time: new Date(now - 10000).toISOString() }, // 10s ago
        { time: new Date(now - 120000).toISOString() }, // 2m ago
        { time: new Date(now - 1000).toISOString() }, // 1s ago
      ];
      
      const result = filterLogsBySince(logs, 60000); // Last 1m
      expect(result).toHaveLength(2); // Only logs within last minute
    });
  });

  describe("formatLogLine", () => {
    function levelToName(level: number): string {
      if (level >= 60) return "FATAL";
      if (level >= 50) return "ERROR";
      if (level >= 40) return "WARN ";
      if (level >= 30) return "INFO ";
      if (level >= 20) return "DEBUG";
      return "TRACE";
    }

    function formatLogLine(log: { level: number; time: string; module: string; msg: string }): string {
      const timestamp = new Date(log.time).toLocaleTimeString();
      const levelName = levelToName(log.level);
      const module = log.module.padEnd(12);
      return `${timestamp} ${levelName} ${module} ${log.msg}`;
    }

    test("formats log line with timestamp and level", () => {
      const log = {
        level: 30,
        time: "2024-12-24T16:00:00.000Z",
        module: "compaction",
        msg: "started",
      };
      
      const result = formatLogLine(log);
      expect(result).toContain("INFO");
      expect(result).toContain("compaction");
      expect(result).toContain("started");
    });

    test("pads module name for alignment", () => {
      const log1 = formatLogLine({ level: 30, time: "2024-12-24T16:00:00.000Z", module: "a", msg: "test" });
      const log2 = formatLogLine({ level: 30, time: "2024-12-24T16:00:00.000Z", module: "compaction", msg: "test" });
      
      // Module names should be padded to 12 chars
      expect(log1).toContain("a            test"); // 'a' + 11 spaces
      expect(log2).toContain("compaction   test"); // 'compaction' + 3 spaces (10 chars + 2)
    });

    test("levelToName maps all levels correctly", () => {
      expect(levelToName(10)).toBe("TRACE");
      expect(levelToName(20)).toBe("DEBUG");
      expect(levelToName(30)).toBe("INFO ");
      expect(levelToName(40)).toBe("WARN ");
      expect(levelToName(50)).toBe("ERROR");
      expect(levelToName(60)).toBe("FATAL");
    });
  });

  describe("readLogFiles", () => {
    test("reads multiple .1log files", () => {
      // Create test log files
      const log1 = join(testDir, "swarm.1log");
      const log2 = join(testDir, "swarm.2log");
      const log3 = join(testDir, "compaction.1log");
      
      writeFileSync(log1, '{"level":30,"time":"2024-12-24T16:00:00.000Z","msg":"line1"}\n');
      writeFileSync(log2, '{"level":30,"time":"2024-12-24T16:00:01.000Z","msg":"line2"}\n');
      writeFileSync(log3, '{"level":30,"time":"2024-12-24T16:00:02.000Z","module":"compaction","msg":"line3"}\n');
      
      function readLogFiles(dir: string): string[] {
        if (!existsSync(dir)) return [];
        
        const files = readdirSync(dir)
          .filter((f) => /\.\d+log$/.test(f))
          .sort() // Sort by filename
          .map((f) => join(dir, f));
        
        const lines: string[] = [];
        for (const file of files) {
          const content = readFileSync(file, "utf-8");
          lines.push(...content.split("\n").filter((line) => line.trim()));
        }
        
        return lines;
      }
      
      const lines = readLogFiles(testDir);
      expect(lines).toHaveLength(3);
      // Files are sorted alphabetically: compaction.1log, swarm.1log, swarm.2log
      expect(lines.some((l) => l.includes("line1"))).toBe(true);
      expect(lines.some((l) => l.includes("line2"))).toBe(true);
      expect(lines.some((l) => l.includes("line3"))).toBe(true);
    });

    test("returns empty array for non-existent directory", () => {
      function readLogFiles(dir: string): string[] {
        if (!existsSync(dir)) return [];
        return [];
      }
      
      const lines = readLogFiles(join(testDir, "nonexistent"));
      expect(lines).toHaveLength(0);
    });
  });

  describe("watchLogs", () => {
    test("detects new log lines appended to file", async () => {
      const logFile = join(testDir, "swarm.1log");
      const collectedLines: string[] = [];
      
      // Create initial log file
      writeFileSync(logFile, '{"level":30,"time":"2024-12-24T16:00:00.000Z","msg":"initial"}\n');
      
      // Import watch utilities
      const { watch } = await import("fs");
      const { appendFileSync } = await import("fs");
      
      // Track file position for incremental reads
      let lastSize = 0;
      
      function readNewLines(filePath: string): string[] {
        const content = readFileSync(filePath, "utf-8");
        const newContent = content.slice(lastSize);
        lastSize = content.length;
        return newContent.split("\n").filter((line) => line.trim());
      }
      
      // Simulate watch behavior
      const watcher = watch(testDir, (eventType, filename) => {
        if (filename && /\.\d+log$/.test(filename)) {
          const newLines = readNewLines(join(testDir, filename));
          collectedLines.push(...newLines);
        }
      });
      
      // Wait for watcher to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      // Append new log line
      appendFileSync(logFile, '{"level":30,"time":"2024-12-24T16:00:01.000Z","msg":"appended"}\n');
      
      // Wait for event to fire
      await new Promise((resolve) => setTimeout(resolve, 200));
      
      watcher.close();
      
      // Should have detected the new line
      expect(collectedLines.some((l) => l.includes("appended"))).toBe(true);
    });

    test("parseWatchArgs extracts --watch flag", () => {
      function parseWatchArgs(args: string[]): { watch: boolean; interval: number } {
        let watch = false;
        let interval = 1000; // default 1 second
        
        for (let i = 0; i < args.length; i++) {
          const arg = args[i];
          if (arg === "--watch" || arg === "-w") {
            watch = true;
          } else if (arg === "--interval" && i + 1 < args.length) {
            interval = parseInt(args[++i], 10);
          }
        }
        
        return { watch, interval };
      }
      
      expect(parseWatchArgs(["--watch"])).toEqual({ watch: true, interval: 1000 });
      expect(parseWatchArgs(["-w"])).toEqual({ watch: true, interval: 1000 });
      expect(parseWatchArgs(["--watch", "--interval", "500"])).toEqual({ watch: true, interval: 500 });
      expect(parseWatchArgs(["compaction", "--watch"])).toEqual({ watch: true, interval: 1000 });
      expect(parseWatchArgs(["--level", "error"])).toEqual({ watch: false, interval: 1000 });
    });
  });
});

// ============================================================================
// Eval Commands Tests (TDD)
// ============================================================================

describe("Eval commands", () => {
  describe("formatEvalStatus", () => {
    test("displays phase, thresholds, and recent scores", () => {
      const status = {
        phase: "stabilization" as const,
        runCount: 25,
        thresholds: {
          stabilization: 0.1,
          production: 0.05,
        },
        recentScores: [
          { timestamp: "2024-12-24T10:00:00.000Z", score: 0.85 },
          { timestamp: "2024-12-24T11:00:00.000Z", score: 0.87 },
          { timestamp: "2024-12-24T12:00:00.000Z", score: 0.82 },
        ],
      };

      const output = formatEvalStatus(status);

      // Should show phase
      expect(output).toContain("stabilization");
      
      // Should show run count
      expect(output).toContain("25");
      
      // Should show thresholds
      expect(output).toContain("10%"); // stabilization threshold
      expect(output).toContain("5%");  // production threshold
      
      // Should show recent scores
      expect(output).toContain("0.85");
      expect(output).toContain("0.87");
      expect(output).toContain("0.82");
    });

    test("shows bootstrap phase message", () => {
      const status = {
        phase: "bootstrap" as const,
        runCount: 5,
        thresholds: {
          stabilization: 0.1,
          production: 0.05,
        },
        recentScores: [],
      };

      const output = formatEvalStatus(status);

      expect(output).toContain("bootstrap");
      expect(output).toContain("collecting data");
    });

    test("shows production phase message", () => {
      const status = {
        phase: "production" as const,
        runCount: 75,
        thresholds: {
          stabilization: 0.1,
          production: 0.05,
        },
        recentScores: [],
      };

      const output = formatEvalStatus(status);

      expect(output).toContain("production");
    });
  });

  describe("formatEvalHistory", () => {
    test("shows eval entries with timestamps and scores", () => {
      const history = [
        {
          timestamp: "2024-12-24T10:00:00.000Z",
          eval_name: "swarm-decomposition",
          score: 0.85,
          run_count: 1,
        },
        {
          timestamp: "2024-12-24T11:00:00.000Z",
          eval_name: "swarm-decomposition",
          score: 0.87,
          run_count: 2,
        },
        {
          timestamp: "2024-12-24T12:00:00.000Z",
          eval_name: "coordinator-behavior",
          score: 0.92,
          run_count: 1,
        },
      ];

      const output = formatEvalHistory(history);

      // Should show all eval names
      expect(output).toContain("swarm-decomposition");
      expect(output).toContain("coordinator-behavior");
      
      // Should show scores
      expect(output).toContain("0.85");
      expect(output).toContain("0.87");
      expect(output).toContain("0.92");
      
      // Should show run counts
      expect(output).toContain("run #1");
      expect(output).toContain("run #2");
    });

    test("returns empty message for no history", () => {
      const output = formatEvalHistory([]);
      expect(output).toContain("No eval history");
    });

    test("formats timestamps as readable dates", () => {
      const history = [
        {
          timestamp: "2024-12-24T10:00:00.000Z",
          eval_name: "test",
          score: 0.85,
          run_count: 1,
        },
      ];

      const output = formatEvalHistory(history);

      // Should contain a formatted date (not raw ISO)
      expect(output).not.toContain("2024-12-24T10:00:00.000Z");
      expect(output).toMatch(/\d{1,2}:\d{2}/); // Time format
    });
  });

  describe("generateSparkline", () => {
    test("generates sparkline from scores", () => {
      const scores = [0.1, 0.3, 0.5, 0.7, 0.9, 1.0];
      const sparkline = generateSparkline(scores);

      // Should use sparkline characters
      expect(sparkline).toMatch(/[▁▂▃▄▅▆▇█]/);
      
      // Length should match input
      expect(sparkline.length).toBe(scores.length);
      
      // Should show ascending trend
      expect(sparkline).toContain("▁"); // Low score
      expect(sparkline).toContain("█"); // High score
    });

    test("handles single score", () => {
      const sparkline = generateSparkline([0.5]);
      expect(sparkline.length).toBe(1);
      expect(sparkline).toMatch(/[▁▂▃▄▅▆▇█]/);
    });

    test("handles all same scores", () => {
      const sparkline = generateSparkline([0.5, 0.5, 0.5]);
      expect(sparkline.length).toBe(3);
      // All should be same character
      expect(new Set(sparkline.split("")).size).toBe(1);
    });

    test("returns empty for empty array", () => {
      const sparkline = generateSparkline([]);
      expect(sparkline).toBe("");
    });
  });

  describe("formatEvalRunResult", () => {
    test("shows pass/fail with gate result", () => {
      const result = {
        passed: true,
        phase: "production" as const,
        message: "Production phase: 2.5% regression - acceptable",
        baseline: 0.85,
        currentScore: 0.83,
        regressionPercent: 0.025,
      };

      const output = formatEvalRunResult(result);

      expect(output).toContain("PASS");
      expect(output).toContain("production");
      expect(output).toContain("0.83"); // current score
      expect(output).toContain("2.5%"); // regression
    });

    test("shows failure with details", () => {
      const result = {
        passed: false,
        phase: "production" as const,
        message: "Production phase FAIL: 8.0% regression - exceeds 5% threshold",
        baseline: 0.85,
        currentScore: 0.78,
        regressionPercent: 0.08,
      };

      const output = formatEvalRunResult(result);

      expect(output).toContain("FAIL");
      expect(output).toContain("8.0%");
      expect(output).toContain("exceeds");
    });

    test("shows bootstrap phase without baseline", () => {
      const result = {
        passed: true,
        phase: "bootstrap" as const,
        message: "Bootstrap phase (5/10 runs) - collecting data",
        currentScore: 0.85,
      };

      const output = formatEvalRunResult(result);

      expect(output).toContain("bootstrap");
      expect(output).toContain("collecting data");
      expect(output).not.toContain("baseline");
    });
  });
});

// ============================================================================
// Eval Command Helpers (Implementation)
// ============================================================================

/**
 * Generate sparkline from array of scores (0-1 range)
 */
function generateSparkline(scores: number[]): string {
  if (scores.length === 0) return "";

  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;

  if (range === 0) {
    // All scores the same
    return chars[4].repeat(scores.length);
  }

  return scores
    .map((score) => {
      const normalized = (score - min) / range;
      const index = Math.min(Math.floor(normalized * chars.length), chars.length - 1);
      return chars[index];
    })
    .join("");
}

/**
 * Format eval status for display
 */
function formatEvalStatus(status: {
  phase: "bootstrap" | "stabilization" | "production";
  runCount: number;
  thresholds: { stabilization: number; production: number };
  recentScores: Array<{ timestamp: string; score: number }>;
}): string {
  const lines: string[] = [];

  // Phase banner
  const phaseEmoji = status.phase === "bootstrap" ? "🌱" : status.phase === "stabilization" ? "⚙️" : "🚀";
  lines.push(`${phaseEmoji} Phase: ${status.phase}`);
  lines.push(`Runs: ${status.runCount}`);
  lines.push("");

  // Thresholds
  lines.push("Thresholds:");
  lines.push(`  Stabilization: ${(status.thresholds.stabilization * 100).toFixed(0)}% regression warning`);
  lines.push(`  Production:    ${(status.thresholds.production * 100).toFixed(0)}% regression failure`);
  lines.push("");

  // Recent scores with sparkline
  if (status.recentScores.length > 0) {
    lines.push("Recent scores:");
    const sparkline = generateSparkline(status.recentScores.map((s) => s.score));
    lines.push(`  ${sparkline}`);
    for (const { timestamp, score } of status.recentScores) {
      const time = new Date(timestamp).toLocaleString();
      lines.push(`  ${time}: ${score.toFixed(2)}`);
    }
  } else {
    lines.push("No scores yet - collecting data");
  }

  return lines.join("\n");
}

/**
 * Format eval history for display
 */
function formatEvalHistory(history: Array<{
  timestamp: string;
  eval_name: string;
  score: number;
  run_count: number;
}>): string {
  if (history.length === 0) {
    return "No eval history found";
  }

  const lines: string[] = [];
  lines.push("Eval History:");
  lines.push("");

  // Group by eval name
  const grouped = new Map<string, typeof history>();
  for (const entry of history) {
    if (!grouped.has(entry.eval_name)) {
      grouped.set(entry.eval_name, []);
    }
    grouped.get(entry.eval_name)!.push(entry);
  }

  // Display each eval group
  for (const [evalName, entries] of grouped) {
    lines.push(`${evalName}:`);
    const sparkline = generateSparkline(entries.map((e) => e.score));
    lines.push(`  Trend: ${sparkline}`);
    
    // Show latest 5 entries
    const latest = entries.slice(-5);
    for (const entry of latest) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      lines.push(`  ${time} - run #${entry.run_count}: ${entry.score.toFixed(2)}`);
    }
    
    if (entries.length > 5) {
      lines.push(`  ... and ${entries.length - 5} more`);
    }
    
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format eval run result (gate check)
 */
function formatEvalRunResult(result: {
  passed: boolean;
  phase: "bootstrap" | "stabilization" | "production";
  message: string;
  baseline?: number;
  currentScore: number;
  regressionPercent?: number;
}): string {
  const lines: string[] = [];

  // Pass/fail banner
  const status = result.passed ? "✅ PASS" : "❌ FAIL";
  lines.push(status);
  lines.push("");

  // Phase and score
  lines.push(`Phase: ${result.phase}`);
  lines.push(`Score: ${result.currentScore.toFixed(2)}`);

  if (result.baseline !== undefined) {
    lines.push(`Baseline: ${result.baseline.toFixed(2)}`);
  }

  if (result.regressionPercent !== undefined) {
    const sign = result.regressionPercent > 0 ? "+" : "";
    lines.push(`Regression: ${sign}${(result.regressionPercent * 100).toFixed(1)}%`);
  }

  lines.push("");
  lines.push(result.message);

  return lines.join("\n");
}

// ============================================================================
// Eval Run Tests
// ============================================================================

describe("Eval Run CI Mode", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `eval-run-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("writes eval results JSON file", async () => {
    // Import the function we need to test
    const { recordEvalRun, getScoreHistory } = await import("../src/eval-history.js");
    const { checkGate } = await import("../src/eval-gates.js");
    const { ensureHiveDirectory } = await import("../src/hive.js");

    // Set up test data
    const evalName = "test-eval";
    const mockScore = 0.85;

    // Ensure directory exists
    ensureHiveDirectory(testDir);

    // Get history and record run (simulating what eval run does)
    const history = getScoreHistory(testDir, evalName);
    recordEvalRun(testDir, {
      timestamp: new Date().toISOString(),
      eval_name: evalName,
      score: mockScore,
      run_count: history.length + 1,
    });

    // Check gate
    const gateResult = checkGate(testDir, evalName, mockScore);

    // Write results file (simulating CI mode)
    const resultsPath = join(testDir, ".hive", "eval-results.json");
    const results = { [evalName]: gateResult };
    writeFileSync(resultsPath, JSON.stringify(results, null, 2));

    // Verify file exists and has correct structure
    expect(existsSync(resultsPath)).toBe(true);

    const savedResults = JSON.parse(readFileSync(resultsPath, "utf-8"));
    expect(savedResults).toHaveProperty(evalName);
    expect(savedResults[evalName]).toMatchObject({
      passed: true,
      phase: "bootstrap",
      currentScore: mockScore,
    });
  });

  test("bootstrap phase always passes", async () => {
    const { checkGate } = await import("../src/eval-gates.js");

    // Even with a low score, bootstrap phase should pass
    const result = checkGate(testDir, "test-eval", 0.1);

    expect(result.passed).toBe(true);
    expect(result.phase).toBe("bootstrap");
    expect(result.message).toContain("Bootstrap phase");
  });

  test("production phase fails on regression", async () => {
    const { recordEvalRun } = await import("../src/eval-history.js");
    const { checkGate } = await import("../src/eval-gates.js");
    const { ensureHiveDirectory } = await import("../src/hive.js");

    ensureHiveDirectory(testDir);

    // Simulate 60 runs with consistent high scores to reach production phase
    for (let i = 0; i < 60; i++) {
      recordEvalRun(testDir, {
        timestamp: new Date().toISOString(),
        eval_name: "test-eval",
        score: 0.9,
        run_count: i + 1,
      });
    }

    // Now test with a regressed score (>5% drop from 0.9 baseline)
    const regressedScore = 0.8; // 11% drop
    const result = checkGate(testDir, "test-eval", regressedScore);

    expect(result.passed).toBe(false);
    expect(result.phase).toBe("production");
    expect(result.message).toContain("FAIL");
  });
});
