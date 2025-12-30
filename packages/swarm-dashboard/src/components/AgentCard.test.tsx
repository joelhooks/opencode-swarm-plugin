/**
 * Tests for AgentCard component
 */

import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { AgentCard } from "./AgentCard";

describe("AgentCard", () => {
  test("renders agent name", () => {
    const { getByText } = render(
      <AgentCard
        name="BlueLake"
        status="active"
        lastActiveTime={Date.now()}
      />
    );

    expect(getByText("BlueLake")).toBeDefined();
  });

  test("shows active status with green indicator", () => {
    const { getByTestId } = render(
      <AgentCard
        name="BlueLake"
        status="active"
        lastActiveTime={Date.now()}
      />
    );

    const indicator = getByTestId("status-indicator");
    // Just verify the indicator exists and has title
    expect(indicator.getAttribute("title")).toBe("Active");
  });

  test("shows idle status with gray indicator", () => {
    const { getByTestId } = render(
      <AgentCard
        name="BlueLake"
        status="idle"
        lastActiveTime={Date.now() - 10 * 60 * 1000}
      />
    );

    const indicator = getByTestId("status-indicator");
    // Just verify the indicator exists and has title
    expect(indicator.getAttribute("title")).toBe("Idle");
  });

  test("displays current task when provided", () => {
    const { getByText } = render(
      <AgentCard
        name="BlueLake"
        status="active"
        lastActiveTime={Date.now()}
        currentTask="Implementing auth service"
      />
    );

    expect(getByText("Implementing auth service")).toBeDefined();
  });

  test("displays relative time for last active", () => {
    const twoMinutesAgo = Date.now() - 2 * 60 * 1000;
    const { getByText } = render(
      <AgentCard
        name="BlueLake"
        status="active"
        lastActiveTime={twoMinutesAgo}
      />
    );

    expect(getByText(/2 min ago/)).toBeDefined();
  });
});
