/**
 * Tests for EventsPane component
 */
import { describe, test, expect } from "bun:test";
import { render } from "@testing-library/react";
import { EventsPane } from "./EventsPane";
import type { AgentEvent } from "../lib/types";

// Mock useSwarmEvents hook
const mockEvents: AgentEvent[] = [
  {
    type: "agent_registered",
    project_key: "/test/project",
    timestamp: Date.now() - 10000,
    agent_name: "TestAgent",
    model: "claude-3-5-sonnet",
  },
  {
    type: "task_started",
    project_key: "/test/project",
    timestamp: Date.now() - 5000,
    agent_name: "WorkerAgent",
    bead_id: "bd-123",
  },
  {
    type: "task_completed",
    project_key: "/test/project",
    timestamp: Date.now(),
    agent_name: "WorkerAgent",
    bead_id: "bd-123",
    summary: "Auth flow implemented",
    success: true,
  },
];

describe("EventsPane", () => {
  test("renders events in scrollable list", () => {
    const { getByText } = render(<EventsPane events={mockEvents} />);

    // Should show all events
    expect(getByText("agent_registered")).toBeDefined();
    expect(getByText("task_started")).toBeDefined();
    expect(getByText("task_completed")).toBeDefined();
  });

  test("renders empty state when no events", () => {
    const { getByText } = render(<EventsPane events={[]} />);

    expect(getByText(/no events/i)).toBeDefined();
  });

  test("shows event type filter buttons", () => {
    const { getByRole } = render(<EventsPane events={mockEvents} />);

    // Should show filter buttons (use exact match to avoid matching event content)
    expect(getByRole("button", { name: "All" })).toBeDefined();
    expect(getByRole("button", { name: "Agent" })).toBeDefined();
    expect(getByRole("button", { name: "Task" })).toBeDefined();
    expect(getByRole("button", { name: "Message" })).toBeDefined();
    expect(getByRole("button", { name: "File" })).toBeDefined();
  });

  test("filters events by type", () => {
    const { queryByText } = render(<EventsPane events={mockEvents} initialFilter="task_started" />);

    // Should only show task_started events
    expect(queryByText("task_started")).toBeDefined();
    expect(queryByText("agent_registered")).toBeNull();
  });

  test("shows event count", () => {
    const { getByText } = render(<EventsPane events={mockEvents} />);

    // Should show count
    expect(getByText(/3 events?/i)).toBeDefined();
  });
});
