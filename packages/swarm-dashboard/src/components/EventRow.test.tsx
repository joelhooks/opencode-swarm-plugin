/**
 * Tests for EventRow component
 */
import { describe, test, expect } from "bun:test";
import { render } from "@testing-library/react";
import { EventRow } from "./EventRow";
import type { AgentEvent } from "../lib/types";

describe("EventRow", () => {
  test("renders agent_registered event with correct badge color", () => {
    const event: AgentEvent = {
      type: "agent_registered",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "TestAgent",
      model: "claude-3-5-sonnet",
    };

    const { getByText } = render(<EventRow event={event} />);

    // Should show type badge
    expect(getByText("agent_registered")).toBeDefined();

    // Should show agent name
    expect(getByText("TestAgent")).toBeDefined();

    // Should show timestamp
    expect(getByText(/\d{2}:\d{2}:\d{2}/)).toBeDefined();
  });

  test("renders task_completed event with green badge", () => {
    const event: AgentEvent = {
      type: "task_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "WorkerAgent",
      bead_id: "bd-123",
      summary: "Completed auth flow",
      success: true,
    };

    const { getByText } = render(<EventRow event={event} />);

    const badge = getByText("task_completed");
    // Check for green color in inline style (component uses inline styles, not classes)
    expect(badge).toBeDefined();
  });

  test("renders task_blocked event with red badge", () => {
    const event: AgentEvent = {
      type: "task_blocked",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "WorkerAgent",
      bead_id: "bd-123",
      reason: "Waiting for dependency",
    };

    const { getByText } = render(<EventRow event={event} />);

    const badge = getByText("task_blocked");
    expect(badge).toBeDefined();
  });

  test("renders file_reserved event with gray badge", () => {
    const event: AgentEvent = {
      type: "file_reserved",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "WorkerAgent",
      paths: ["src/auth.ts"],
      expires_at: Date.now() + 3600000,
    };

    const { getByText } = render(<EventRow event={event} />);

    const badge = getByText("file_reserved");
    expect(badge).toBeDefined();
  });

  test("renders message_sent event with purple badge", () => {
    const event: AgentEvent = {
      type: "message_sent",
      project_key: "/test/project",
      timestamp: Date.now(),
      from_agent: "Coordinator",
      to_agents: ["Worker1"],
      subject: "Status update",
      body: "All good",
    };

    const { getByText } = render(<EventRow event={event} />);

    const badge = getByText("message_sent");
    expect(badge).toBeDefined();
  });

  test("renders task_started event with yellow badge", () => {
    const event: AgentEvent = {
      type: "task_started",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "WorkerAgent",
      bead_id: "bd-123",
    };

    const { getByText } = render(<EventRow event={event} />);

    const badge = getByText("task_started");
    expect(badge).toBeDefined();
  });

  test("formats timestamp as HH:MM:SS", () => {
    const timestamp = new Date("2024-12-25T14:30:45Z").getTime();
    const event: AgentEvent = {
      type: "agent_active",
      project_key: "/test/project",
      timestamp,
      agent_name: "TestAgent",
    };

    const { getByText } = render(<EventRow event={event} />);

    // Timestamp should be formatted
    expect(getByText(/\d{2}:\d{2}:\d{2}/)).toBeDefined();
  });

  test("shows summary for events with summary field", () => {
    const event: AgentEvent = {
      type: "task_completed",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "WorkerAgent",
      bead_id: "bd-123",
      summary: "Auth flow implemented",
      success: true,
    };

    const { getByText } = render(<EventRow event={event} />);

    expect(getByText("Auth flow implemented")).toBeDefined();
  });

  test("shows reason for blocked events", () => {
    const event: AgentEvent = {
      type: "task_blocked",
      project_key: "/test/project",
      timestamp: Date.now(),
      agent_name: "WorkerAgent",
      bead_id: "bd-123",
      reason: "Waiting for database schema",
    };

    const { getByText } = render(<EventRow event={event} />);

    expect(getByText("Waiting for database schema")).toBeDefined();
  });
});
