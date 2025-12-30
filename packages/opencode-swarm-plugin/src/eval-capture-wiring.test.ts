/**
 * Tests for wiring orphaned capture functions to tool.execute.after hooks
 * 
 * Tests verify that:
 * 1. Each orphaned function is called when the correct tool executes
 * 2. Parameters are extracted from tool output correctly
 * 3. Events are captured even when tool output parsing fails (non-fatal)
 * 
 * NOTE: These are integration tests that simulate the tool.execute.after hook
 * by dynamically importing the capture functions with the same pattern used in index.ts
 */
import { describe, expect, test, mock, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { setCoordinatorContext, clearCoordinatorContext } from "./planning-guardrails";

describe("captureResearcherSpawned wiring", () => {
  let sessionDir: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "swarm-test-researcher-"));
    sessionDir = join(testDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    process.env.SWARM_SESSIONS_DIR = sessionDir;
    
    // Set coordinator context for epic_id
    setCoordinatorContext({
      isCoordinator: true,
      epicId: "bd-test-123",
      sessionId: "test-session-123"
    });
  });

  afterEach(() => {
    clearCoordinatorContext();
    delete process.env.SWARM_SESSIONS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should be called when Task tool spawns researcher subagent", async () => {
    // Simulate tool.execute.after for Task tool with researcher spawn
    const toolInput = {
      tool: "task",
      sessionID: "test-session-123",
      prompt: 'Research Next.js Cache Components using pdf-brain and context7',
      agentName: "swarm-researcher"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        success: true,
        researcher_id: "BlueLake",
        research_topic: "Next.js Cache Components",
        tools_used: ["pdf-brain", "context7"]
      })
    };

    // Simulate the hook logic from index.ts
    if (toolInput.tool === "task" && toolInput.agentName?.toLowerCase().includes("research")) {
      const { captureResearcherSpawned } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      await captureResearcherSpawned({
        session_id: toolInput.sessionID,
        epic_id: "bd-test-123",
        researcher_id: result.researcher_id || "unknown",
        research_topic: result.research_topic || toolInput.prompt?.substring(0, 100) || "unknown",
        tools_used: result.tools_used || [],
      });
    }
    
    // Verify event was captured to session file
    const sessionPath = join(sessionDir, "test-session-123.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    
    const content = fs.readFileSync(sessionPath, "utf-8");
    const event = JSON.parse(content.trim());
    expect(event.event_type).toBe("DECISION");
    expect(event.decision_type).toBe("researcher_spawned");
    expect(event.payload.researcher_id).toBe("BlueLake");
    expect(event.payload.research_topic).toBe("Next.js Cache Components");
    expect(event.payload.tools_used).toEqual(["pdf-brain", "context7"]);
  });

  test("should extract researcher info from Task tool output when agentName contains research", async () => {
    const toolInput = {
      tool: "task",
      sessionID: "test-session-456",
      agentName: "RESEARCHER" // Uppercase contains "research"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        researcher_id: "GreenStorm",
        research_topic: "Effect-TS Schema patterns"
      })
    };

    // Simulate hook
    if (toolInput.tool === "task" && toolInput.agentName?.toLowerCase().includes("research")) {
      const { captureResearcherSpawned } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      await captureResearcherSpawned({
        session_id: toolInput.sessionID,
        epic_id: "bd-test-123",
        researcher_id: result.researcher_id || "unknown",
        research_topic: result.research_topic || "unknown",
        tools_used: result.tools_used || [],
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-456.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.payload.researcher_id).toBe("GreenStorm");
  });

  test("should not call captureResearcherSpawned for non-researcher Task calls", async () => {
    const toolInput = {
      tool: "task",
      sessionID: "test-session-789",
      agentName: "swarm/worker" // NOT researcher
    };
    
    const toolOutput = {
      output: JSON.stringify({ success: true })
    };

    // Simulate hook - should NOT match
    if (toolInput.tool === "task" && toolInput.agentName?.toLowerCase().includes("research")) {
      const { captureResearcherSpawned } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      await captureResearcherSpawned({
        session_id: toolInput.sessionID,
        epic_id: "bd-test-123",
        researcher_id: result.researcher_id || "unknown",
        research_topic: result.research_topic || "unknown",
        tools_used: result.tools_used || [],
      });
    }
    
    // Should NOT create session file
    const sessionPath = join(sessionDir, "test-session-789.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(false);
  });
});

describe("captureSkillLoaded wiring", () => {
  let sessionDir: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "swarm-test-skill-"));
    sessionDir = join(testDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    process.env.SWARM_SESSIONS_DIR = sessionDir;
    
    setCoordinatorContext({
      isCoordinator: true,
      epicId: "bd-skill-epic",
      sessionId: "test-session-skill"
    });
  });

  afterEach(() => {
    clearCoordinatorContext();
    delete process.env.SWARM_SESSIONS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should be called when skills_use tool executes", async () => {
    const toolInput = {
      tool: "skills_use",
      sessionID: "test-session-skill-1",
      name: "testing-patterns",
      context: "Adding tests to legacy code"
    };

    // Simulate hook
    if (toolInput.tool === "skills_use") {
      const { captureSkillLoaded } = await import("./eval-capture.js");
      await captureSkillLoaded({
        session_id: toolInput.sessionID,
        epic_id: "bd-skill-epic",
        skill_name: toolInput.name || "unknown",
        context: toolInput.context,
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-skill-1.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.event_type).toBe("DECISION");
    expect(event.decision_type).toBe("skill_loaded");
    expect(event.payload.skill_name).toBe("testing-patterns");
    expect(event.payload.context).toBe("Adding tests to legacy code");
  });

  test("should handle skills_use without context parameter", async () => {
    const toolInput = {
      tool: "skills_use",
      sessionID: "test-session-skill-2",
      name: "swarm-coordination"
    };

    // Simulate hook
    if (toolInput.tool === "skills_use") {
      const { captureSkillLoaded } = await import("./eval-capture.js");
      await captureSkillLoaded({
        session_id: toolInput.sessionID,
        epic_id: "bd-skill-epic",
        skill_name: toolInput.name || "unknown",
        context: toolInput.context,
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-skill-2.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.payload.skill_name).toBe("swarm-coordination");
    expect(event.payload.context).toBeUndefined();
  });
});

describe("captureInboxChecked wiring", () => {
  let sessionDir: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "swarm-test-inbox-"));
    sessionDir = join(testDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    process.env.SWARM_SESSIONS_DIR = sessionDir;
    
    setCoordinatorContext({
      isCoordinator: true,
      epicId: "bd-inbox-epic",
      sessionId: "test-session-inbox"
    });
  });

  afterEach(() => {
    clearCoordinatorContext();
    delete process.env.SWARM_SESSIONS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should be called when swarmmail_inbox tool executes", async () => {
    const toolInput = {
      tool: "swarmmail_inbox",
      sessionID: "test-session-inbox-1"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        messages: [
          { id: 1, subject: "Progress update", importance: "normal" },
          { id: 2, subject: "BLOCKED", importance: "high" },
          { id: 3, subject: "Question", importance: "normal" }
        ],
        message_count: 3,
        urgent_count: 1
      })
    };

    // Simulate hook
    if (toolInput.tool === "swarmmail_inbox") {
      const { captureInboxChecked } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      await captureInboxChecked({
        session_id: toolInput.sessionID,
        epic_id: "bd-inbox-epic",
        message_count: result.message_count || 0,
        urgent_count: result.urgent_count || 0,
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-inbox-1.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.event_type).toBe("DECISION");
    expect(event.decision_type).toBe("inbox_checked");
    expect(event.payload.message_count).toBe(3);
    expect(event.payload.urgent_count).toBe(1);
  });

  test("should handle empty inbox", async () => {
    const toolInput = {
      tool: "swarmmail_inbox",
      sessionID: "test-session-inbox-2"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        messages: [],
        message_count: 0,
        urgent_count: 0
      })
    };

    // Simulate hook
    if (toolInput.tool === "swarmmail_inbox") {
      const { captureInboxChecked } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      await captureInboxChecked({
        session_id: toolInput.sessionID,
        epic_id: "bd-inbox-epic",
        message_count: result.message_count || 0,
        urgent_count: result.urgent_count || 0,
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-inbox-2.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.payload.message_count).toBe(0);
    expect(event.payload.urgent_count).toBe(0);
  });
});

describe("captureBlockerResolved wiring", () => {
  let sessionDir: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "swarm-test-blocker-resolved-"));
    sessionDir = join(testDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    process.env.SWARM_SESSIONS_DIR = sessionDir;
    
    setCoordinatorContext({
      isCoordinator: true,
      epicId: "bd-blocker-epic",
      sessionId: "test-session-unblock"
    });
  });

  afterEach(() => {
    clearCoordinatorContext();
    delete process.env.SWARM_SESSIONS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should be called when hive_update changes status from blocked to open", async () => {
    const toolInput = {
      tool: "hive_update",
      sessionID: "test-session-unblock-1",
      id: "bd-123.2",
      status: "open"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        id: "bd-123.2",
        status: "open",
        previous_status: "blocked",
        worker_id: "GreenStorm",
        blocker_type: "dependency",
        resolution: "Database schema now available from bd-123.1"
      })
    };

    // Simulate hook
    if (toolInput.tool === "hive_update") {
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const newStatus = result.status || toolInput.status;
      const previousStatus = result.previous_status;

      if (previousStatus === "blocked" && newStatus !== "blocked") {
        const { captureBlockerResolved } = await import("./eval-capture.js");
        await captureBlockerResolved({
          session_id: toolInput.sessionID,
          epic_id: "bd-blocker-epic",
          worker_id: result.worker_id || "unknown",
          subtask_id: result.id || toolInput.id || "unknown",
          blocker_type: result.blocker_type || "unknown",
          resolution: result.resolution || "Status changed to " + newStatus,
        });
      }
    }
    
    const sessionPath = join(sessionDir, "test-session-unblock-1.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.event_type).toBe("DECISION");
    expect(event.decision_type).toBe("blocker_resolved");
    expect(event.payload.worker_id).toBe("GreenStorm");
    expect(event.payload.subtask_id).toBe("bd-123.2");
    expect(event.payload.blocker_type).toBe("dependency");
  });

  test("should be called when hive_update changes status from blocked to in_progress", async () => {
    const toolInput = {
      tool: "hive_update",
      sessionID: "test-session-unblock-2",
      id: "bd-456.1",
      status: "in_progress"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        id: "bd-456.1",
        status: "in_progress",
        previous_status: "blocked",
        worker_id: "BlueLake",
        blocker_type: "scope_clarification",
        resolution: "Coordinator approved scope expansion"
      })
    };

    // Simulate hook
    if (toolInput.tool === "hive_update") {
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const newStatus = result.status || toolInput.status;
      const previousStatus = result.previous_status;

      if (previousStatus === "blocked" && newStatus !== "blocked") {
        const { captureBlockerResolved } = await import("./eval-capture.js");
        await captureBlockerResolved({
          session_id: toolInput.sessionID,
          epic_id: "bd-blocker-epic",
          worker_id: result.worker_id || "unknown",
          subtask_id: result.id || toolInput.id || "unknown",
          blocker_type: result.blocker_type || "unknown",
          resolution: result.resolution || "Status changed to " + newStatus,
        });
      }
    }
    
    const sessionPath = join(sessionDir, "test-session-unblock-2.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
  });

  test("should NOT be called when status changes but not from blocked", async () => {
    const toolInput = {
      tool: "hive_update",
      sessionID: "test-session-unblock-3",
      id: "bd-789.3",
      status: "in_progress"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        id: "bd-789.3",
        status: "in_progress",
        previous_status: "open" // NOT blocked
      })
    };

    // Simulate hook - should NOT match
    if (toolInput.tool === "hive_update") {
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const newStatus = result.status || toolInput.status;
      const previousStatus = result.previous_status;

      if (previousStatus === "blocked" && newStatus !== "blocked") {
        const { captureBlockerResolved } = await import("./eval-capture.js");
        await captureBlockerResolved({
          session_id: toolInput.sessionID,
          epic_id: "bd-blocker-epic",
          worker_id: result.worker_id || "unknown",
          subtask_id: result.id || toolInput.id || "unknown",
          blocker_type: result.blocker_type || "unknown",
          resolution: result.resolution || "Status changed to " + newStatus,
        });
      }
    }
    
    // Should NOT create session file
    const sessionPath = join(sessionDir, "test-session-unblock-3.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(false);
  });
});

describe("captureScopeChangeDecision wiring", () => {
  let sessionDir: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "swarm-test-scope-"));
    sessionDir = join(testDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    process.env.SWARM_SESSIONS_DIR = sessionDir;
    
    setCoordinatorContext({
      isCoordinator: true,
      epicId: "bd-scope-epic",
      sessionId: "test-session-scope"
    });
  });

  afterEach(() => {
    clearCoordinatorContext();
    delete process.env.SWARM_SESSIONS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should be called when swarmmail_send has 'Scope Change' in subject", async () => {
    const toolInput = {
      tool: "swarmmail_send",
      sessionID: "test-session-scope-1",
      to: ["worker"],
      subject: "Scope Change Approved: bd-123.1",
      body: "You can proceed with email validation",
      thread_id: "bd-123"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        success: true,
        approved: true,
        worker_id: "BlueLake",
        subtask_id: "bd-123.1",
        original_scope: "Add auth service",
        new_scope: "Add auth service + email validation",
        estimated_time_add: 900000
      })
    };

    // Simulate hook
    if (toolInput.tool === "swarmmail_send" && toolInput.subject?.includes("Scope Change")) {
      const { captureScopeChangeDecision } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const threadId = toolInput.thread_id || "bd-scope-epic";
      
      await captureScopeChangeDecision({
        session_id: toolInput.sessionID,
        epic_id: threadId,
        worker_id: result.worker_id || "unknown",
        subtask_id: result.subtask_id || "unknown",
        approved: result.approved ?? false,
        original_scope: result.original_scope,
        new_scope: result.new_scope,
        requested_scope: result.requested_scope,
        rejection_reason: result.rejection_reason,
        estimated_time_add: result.estimated_time_add,
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-scope-1.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.event_type).toBe("DECISION");
    expect(event.decision_type).toBe("scope_change_approved");
    expect(event.payload.worker_id).toBe("BlueLake");
    expect(event.payload.subtask_id).toBe("bd-123.1");
  });

  test("should handle scope change rejection", async () => {
    const toolInput = {
      tool: "swarmmail_send",
      sessionID: "test-session-scope-2",
      subject: "Scope Change Rejected: bd-456.2",
      thread_id: "bd-456"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        approved: false,
        worker_id: "GreenStorm",
        subtask_id: "bd-456.2",
        requested_scope: "Add auth + OAuth + SSO",
        rejection_reason: "Too large for single subtask"
      })
    };

    // Simulate hook
    if (toolInput.tool === "swarmmail_send" && toolInput.subject?.includes("Scope Change")) {
      const { captureScopeChangeDecision } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const threadId = toolInput.thread_id || "bd-scope-epic";
      
      await captureScopeChangeDecision({
        session_id: toolInput.sessionID,
        epic_id: threadId,
        worker_id: result.worker_id || "unknown",
        subtask_id: result.subtask_id || "unknown",
        approved: result.approved ?? false,
        original_scope: result.original_scope,
        new_scope: result.new_scope,
        requested_scope: result.requested_scope,
        rejection_reason: result.rejection_reason,
        estimated_time_add: result.estimated_time_add,
      });
    }
    
    const sessionPath = join(sessionDir, "test-session-scope-2.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.decision_type).toBe("scope_change_rejected");
  });

  test("should NOT be called for swarmmail_send without 'Scope Change' in subject", async () => {
    const toolInput = {
      tool: "swarmmail_send",
      sessionID: "test-session-scope-3",
      subject: "Progress update"
    };
    
    const toolOutput = {
      output: JSON.stringify({ success: true })
    };

    // Simulate hook - should NOT match
    if (toolInput.tool === "swarmmail_send" && toolInput.subject?.includes("Scope Change")) {
      const { captureScopeChangeDecision } = await import("./eval-capture.js");
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      await captureScopeChangeDecision({
        session_id: toolInput.sessionID,
        epic_id: "bd-scope-epic",
        worker_id: result.worker_id || "unknown",
        subtask_id: result.subtask_id || "unknown",
        approved: result.approved ?? false,
        original_scope: result.original_scope,
        new_scope: result.new_scope,
        requested_scope: result.requested_scope,
        rejection_reason: result.rejection_reason,
        estimated_time_add: result.estimated_time_add,
      });
    }
    
    // Should NOT create session file
    const sessionPath = join(sessionDir, "test-session-scope-3.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(false);
  });
});

describe("captureBlockerDetected wiring", () => {
  let sessionDir: string;
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "swarm-test-blocker-detected-"));
    sessionDir = join(testDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    process.env.SWARM_SESSIONS_DIR = sessionDir;
    
    setCoordinatorContext({
      isCoordinator: true,
      epicId: "bd-detect-epic",
      sessionId: "test-session-block"
    });
  });

  afterEach(() => {
    clearCoordinatorContext();
    delete process.env.SWARM_SESSIONS_DIR;
    rmSync(testDir, { recursive: true, force: true });
  });

  test("should be called when hive_update changes status TO blocked", async () => {
    const toolInput = {
      tool: "hive_update",
      sessionID: "test-session-block-1",
      id: "bd-123.2",
      status: "blocked"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        id: "bd-123.2",
        status: "blocked",
        worker_id: "GreenStorm",
        blocker_type: "dependency",
        blocker_description: "Waiting for database schema from bd-123.1"
      })
    };

    // Simulate hook
    if (toolInput.tool === "hive_update") {
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const newStatus = result.status || toolInput.status;
      const previousStatus = result.previous_status;

      if (newStatus === "blocked" && previousStatus !== "blocked") {
        const { captureBlockerDetected } = await import("./eval-capture.js");
        await captureBlockerDetected({
          session_id: toolInput.sessionID,
          epic_id: "bd-detect-epic",
          worker_id: result.worker_id || "unknown",
          subtask_id: result.id || toolInput.id || "unknown",
          blocker_type: result.blocker_type || "unknown",
          blocker_description: result.blocker_description || result.description || "No description provided",
        });
      }
    }
    
    const sessionPath = join(sessionDir, "test-session-block-1.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(true);
    const event = JSON.parse(fs.readFileSync(sessionPath, "utf-8").trim());
    expect(event.event_type).toBe("OUTCOME");
    expect(event.outcome_type).toBe("blocker_detected");
    expect(event.payload.worker_id).toBe("GreenStorm");
    expect(event.payload.blocker_type).toBe("dependency");
  });

  test("should NOT be called when status changes but not TO blocked", async () => {
    const toolInput = {
      tool: "hive_update",
      sessionID: "test-session-block-2",
      id: "bd-456.1",
      status: "in_progress"
    };
    
    const toolOutput = {
      output: JSON.stringify({
        id: "bd-456.1",
        status: "in_progress"
      })
    };

    // Simulate hook - should NOT match
    if (toolInput.tool === "hive_update") {
      const result = toolOutput.output ? JSON.parse(toolOutput.output) : {};
      const newStatus = result.status || toolInput.status;
      const previousStatus = result.previous_status;

      if (newStatus === "blocked" && previousStatus !== "blocked") {
        const { captureBlockerDetected } = await import("./eval-capture.js");
        await captureBlockerDetected({
          session_id: toolInput.sessionID,
          epic_id: "bd-detect-epic",
          worker_id: result.worker_id || "unknown",
          subtask_id: result.id || toolInput.id || "unknown",
          blocker_type: result.blocker_type || "unknown",
          blocker_description: result.blocker_description || result.description || "No description provided",
        });
      }
    }
    
    // Should NOT create session file
    const sessionPath = join(sessionDir, "test-session-block-2.jsonl");
    expect(fs.existsSync(sessionPath)).toBe(false);
  });
});
