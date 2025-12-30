/**
 * CellsPane component tests
 * 
 * Tests cell display and hierarchy from events
 * Uses events prop pattern (no internal fetch)
 */

import { describe, test, expect } from "bun:test";
import { render } from "@testing-library/react";
import { CellsPane } from "./CellsPane";
import type { AgentEvent, CellCreatedEvent, CellStatusChangedEvent } from "../lib/types";

// Use getByText from render result instead of screen (avoids document timing issues)
describe("CellsPane", () => {
  test("displays empty state when no cells", () => {
    const events: AgentEvent[] = [];
    
    const { getByText } = render(<CellsPane events={events} />);
    
    expect(getByText("No cells found")).toBeDefined();
  });

  test("displays cells from cell_created events", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "cell_created",
        timestamp: now,
        sequence: 1,
        project_key: "/test",
        cell_id: "epic-1",
        title: "Test Epic",
        issue_type: "epic",
        priority: 0,
      } as CellCreatedEvent,
      {
        id: 2,
        type: "cell_created",
        timestamp: now,
        sequence: 2,
        project_key: "/test",
        cell_id: "task-1",
        title: "Test Task",
        issue_type: "task",
        priority: 1,
        // No parent_id - both are root cells
      } as CellCreatedEvent,
    ];

    const { getByText } = render(<CellsPane events={events} />);

    expect(getByText("Test Epic")).toBeDefined();
    expect(getByText("Test Task")).toBeDefined();
  });

  test("displays cell count in header", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "cell_created",
        timestamp: now,
        sequence: 1,
        project_key: "/test",
        cell_id: "epic-1",
        title: "Epic",
        issue_type: "epic",
        priority: 0,
      } as CellCreatedEvent,
      {
        id: 2,
        type: "cell_created",
        timestamp: now,
        sequence: 2,
        project_key: "/test",
        cell_id: "task-1",
        title: "Task",
        issue_type: "task",
        priority: 1,
      } as CellCreatedEvent,
    ];

    const { getByText } = render(<CellsPane events={events} />);

    // Should show "2 cells"
    expect(getByText(/2 cells/)).toBeDefined();
  });

  test("updates cell status from cell_status_changed events", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "cell_created",
        timestamp: now,
        sequence: 1,
        project_key: "/test",
        cell_id: "task-1",
        title: "My Task",
        issue_type: "task",
        priority: 1,
      } as CellCreatedEvent,
      {
        id: 2,
        type: "cell_status_changed",
        timestamp: now + 1000,
        sequence: 2,
        project_key: "/test",
        cell_id: "task-1",
        from_status: "open",
        to_status: "in_progress",
      } as CellStatusChangedEvent,
    ];

    const { getByText, getByTitle } = render(<CellsPane events={events} />);

    // Task should be visible
    expect(getByText("My Task")).toBeDefined();
    // Status should be in_progress (shown as ◐ icon)
    expect(getByTitle("in_progress")).toBeDefined();
  });

  test("groups subtasks under parent epics", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "cell_created",
        timestamp: now,
        sequence: 1,
        project_key: "/test",
        cell_id: "epic-1",
        title: "Parent Epic",
        issue_type: "epic",
        priority: 0,
      } as CellCreatedEvent,
      {
        id: 2,
        type: "cell_created",
        timestamp: now,
        sequence: 2,
        project_key: "/test",
        cell_id: "task-1",
        title: "Child Task",
        issue_type: "task",
        priority: 1,
        parent_id: "epic-1",
      } as CellCreatedEvent,
    ];

    const { container, getByText } = render(<CellsPane events={events} />);

    // Parent should be visible
    expect(getByText("Parent Epic")).toBeDefined();
    // Child should be visible (rendered as nested under parent)
    expect(getByText("Child Task")).toBeDefined();
  });

  test("shows priority badges", () => {
    const now = Date.now();
    const events: AgentEvent[] = [
      {
        id: 1,
        type: "cell_created",
        timestamp: now,
        sequence: 1,
        project_key: "/test",
        cell_id: "task-1",
        title: "Critical Task",
        issue_type: "task",
        priority: 0,
      } as CellCreatedEvent,
      {
        id: 2,
        type: "cell_created",
        timestamp: now,
        sequence: 2,
        project_key: "/test",
        cell_id: "task-2",
        title: "Low Priority Task",
        issue_type: "task",
        priority: 3,
      } as CellCreatedEvent,
    ];

    const { getByText } = render(<CellsPane events={events} />);

    // Should show P0 and P3 badges
    expect(getByText("P0")).toBeDefined();
    expect(getByText("P3")).toBeDefined();
  });
});
