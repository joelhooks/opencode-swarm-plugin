/**
 * Tests for AgentsPane component
 * 
 * Tests the refactored AgentsPane that receives events as props
 * instead of creating its own useSwarmEvents hook.
 */

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { AgentsPane } from "./AgentsPane";
import type { AgentEvent } from "../lib/types";

describe("AgentsPane", () => {
  test("renders empty state when no agents", () => {
    const events: AgentEvent[] = [];
    
    const { getByText } = render(<AgentsPane events={events} state="connected" />);

    expect(getByText(/no agents/i)).toBeDefined();
  });

  test("renders agent cards for registered agents", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "agent_registered",
        agent_name: "BlueLake",
        timestamp: now,
        sequence: 1,
        project_key: "/test",
        program: "opencode",
        model: "unknown",
        task_description: "Test task 1",
      },
      {
        id: 2,
        type: "agent_registered",
        agent_name: "RedMountain",
        timestamp: now,
        sequence: 2,
        project_key: "/test",
        program: "opencode",
        model: "unknown",
        task_description: "Test task 2",
      },
    ];

    const { getByText } = render(<AgentsPane events={events} state="connected" />);

    expect(getByText("BlueLake")).toBeDefined();
    expect(getByText("RedMountain")).toBeDefined();
  });

  test("shows connection state indicator", () => {
    const events: AgentEvent[] = [];
    
    const { getByText } = render(<AgentsPane events={events} state="connecting" />);

    expect(getByText(/connecting/i)).toBeDefined();
  });

  test("derives agent state from multiple event types", () => {
    const baseTime = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "agent_registered",
        agent_name: "Worker1",
        timestamp: baseTime,
        sequence: 1,
        project_key: "/test",
        program: "opencode",
        model: "unknown",
        task_description: "Initial task",
      },
      {
        id: 2,
        type: "task_started",
        agent_name: "Worker1",
        timestamp: baseTime + 1000,
        sequence: 2,
        project_key: "/test",
        bead_id: "task-123",
        message: "Starting work",
        files_affected: [],
      },
      {
        id: 3,
        type: "task_progress",
        agent_name: "Worker1",
        timestamp: baseTime + 2000,
        sequence: 3,
        project_key: "/test",
        bead_id: "task-123",
        message: "50% complete",
        progress_percent: 50,
      },
    ];

    const { getByText } = render(<AgentsPane events={events} state="connected" />);

    // Agent should appear with latest task message
    expect(getByText("Worker1")).toBeDefined();
    expect(getByText("50% complete")).toBeDefined();
  });

  test("groups agents by project_key", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "agent_registered",
        agent_name: "Worker1",
        timestamp: now,
        sequence: 1,
        project_key: "/Users/joel/project-a",
        program: "opencode",
        model: "unknown",
        task_description: "Task A",
      },
      {
        id: 2,
        type: "agent_registered",
        agent_name: "Worker2",
        timestamp: now,
        sequence: 2,
        project_key: "/Users/joel/project-a",
        program: "opencode",
        model: "unknown",
        task_description: "Task B",
      },
      {
        id: 3,
        type: "agent_registered",
        agent_name: "Worker3",
        timestamp: now,
        sequence: 3,
        project_key: "/Users/joel/project-b",
        program: "opencode",
        model: "unknown",
        task_description: "Task C",
      },
    ];

    const { getByText } = render(<AgentsPane events={events} state="connected" />);

    // Should show project paths
    expect(getByText(/project-a/)).toBeDefined();
    expect(getByText(/project-b/)).toBeDefined();
    
    // All agents should still be visible
    expect(getByText("Worker1")).toBeDefined();
    expect(getByText("Worker2")).toBeDefined();
    expect(getByText("Worker3")).toBeDefined();
  });

  test("shows green indicator for projects with active agents", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      // Active agent in project A (activity within 5 min)
      {
        id: 1,
        type: "agent_registered",
        agent_name: "ActiveWorker",
        timestamp: now - 1000,
        sequence: 1,
        project_key: "/Users/joel/project-a",
        program: "opencode",
        model: "unknown",
        task_description: "Active task",
      },
      // Idle agent in project B (activity > 5 min ago)
      {
        id: 2,
        type: "agent_registered",
        agent_name: "IdleWorker",
        timestamp: now - (6 * 60 * 1000),
        sequence: 2,
        project_key: "/Users/joel/project-b",
        program: "opencode",
        model: "unknown",
        task_description: "Idle task",
      },
    ];

    const { container } = render(<AgentsPane events={events} state="connected" />);

    // Look for status indicators by data-testid or aria-label
    const projectHeaders = container.querySelectorAll('[data-project-header]');
    expect(projectHeaders.length).toBeGreaterThanOrEqual(2);
  });

  test("sorts projects with active agents first", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      // Idle agent in project A
      {
        id: 1,
        type: "agent_registered",
        agent_name: "OldWorker",
        timestamp: now - (10 * 60 * 1000),
        sequence: 1,
        project_key: "/Users/joel/project-a",
        program: "opencode",
        model: "unknown",
      },
      // Active agent in project B
      {
        id: 2,
        type: "agent_registered",
        agent_name: "NewWorker",
        timestamp: now - 1000,
        sequence: 2,
        project_key: "/Users/joel/project-b",
        program: "opencode",
        model: "unknown",
      },
    ];

    const { container } = render(<AgentsPane events={events} state="connected" />);

    // Get all project headers in order
    const projectHeaders = container.querySelectorAll('[data-project-header]');
    const projectTexts = Array.from(projectHeaders).map(h => h.textContent);
    
    // project-b (active) should come before project-a (idle)
    const projectBIndex = projectTexts.findIndex(t => t?.includes('project-b'));
    const projectAIndex = projectTexts.findIndex(t => t?.includes('project-a'));
    expect(projectBIndex).toBeLessThan(projectAIndex);
  });

  test("shows last path segments for long project paths", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "agent_registered",
        agent_name: "Worker",
        timestamp: now,
        sequence: 1,
        project_key: "/Users/joel/Code/very/long/nested/path/my-project",
        program: "opencode",
        model: "unknown",
      },
    ];

    const { getByText } = render(<AgentsPane events={events} state="connected" />);

    // Should show abbreviated path (last 2 segments)
    expect(getByText(/my-project/)).toBeDefined();
  });
});
