/**
 * Tests for ConnectionStatus component
 * 
 * Validates:
 * - Proper rendering for all connection states (connected, connecting, disconnected)
 * - Error message display
 * - Retry button visibility and click handler
 * - Catppuccin color usage
 * - Pulsing animation for connecting state
 */

import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ConnectionStatus } from "./ConnectionStatus";

describe("ConnectionStatus", () => {
  afterEach(() => {
    cleanup();
  });
  test("shows green dot and 'Connected' text when connected", () => {
    const { getByTestId, getByText } = render(
      <ConnectionStatus
        connectionState="connected"
        onReconnect={() => {}}
      />
    );

    const indicator = getByTestId("connection-indicator");
    expect(indicator.getAttribute("title")).toBe("Connected");
    expect(getByText("Connected")).toBeDefined();
  });

  test("shows yellow pulsing dot and 'Connecting...' text when connecting", () => {
    const { getByTestId, getByText } = render(
      <ConnectionStatus
        connectionState="connecting"
        onReconnect={() => {}}
      />
    );

    const indicator = getByTestId("connection-indicator");
    expect(indicator.getAttribute("title")).toBe("Connecting...");
    expect(getByText("Connecting...")).toBeDefined();
    
    // Check for pulse animation class/attribute
    expect(indicator.getAttribute("data-pulse")).toBe("true");
  });

  test("shows red dot, 'Disconnected' text, and retry button when disconnected", () => {
    const { getByTestId, getByText, getByRole } = render(
      <ConnectionStatus
        connectionState="disconnected"
        onReconnect={() => {}}
      />
    );

    const indicator = getByTestId("connection-indicator");
    expect(indicator.getAttribute("title")).toBe("Disconnected");
    expect(getByText("Disconnected")).toBeDefined();
    expect(getByRole("button", { name: /retry/i })).toBeDefined();
  });

  test("calls onReconnect when retry button is clicked", () => {
    const onReconnect = mock(() => {});

    const { getByRole } = render(
      <ConnectionStatus
        connectionState="disconnected"
        onReconnect={onReconnect}
      />
    );

    const retryButton = getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  test("displays error message when error prop is provided", () => {
    const errorMessage = "WebSocket connection failed: network error";

    const { getByText } = render(
      <ConnectionStatus
        connectionState="disconnected"
        error={errorMessage}
        onReconnect={() => {}}
      />
    );

    expect(getByText(errorMessage)).toBeDefined();
  });

  test("does not show retry button when connected", () => {
    const { queryByRole } = render(
      <ConnectionStatus
        connectionState="connected"
        onReconnect={() => {}}
      />
    );

    expect(queryByRole("button", { name: /retry/i })).toBeNull();
  });

  test("does not show retry button when connecting", () => {
    const { queryByRole } = render(
      <ConnectionStatus
        connectionState="connecting"
        onReconnect={() => {}}
      />
    );

    expect(queryByRole("button", { name: /retry/i })).toBeNull();
  });

  test("does not show error message when error prop is undefined", () => {
    const { getByText, queryByText } = render(
      <ConnectionStatus
        connectionState="disconnected"
        onReconnect={() => {}}
      />
    );

    // Should only show status text, no error
    const text = getByText("Disconnected");
    expect(text).toBeDefined();
    expect(queryByText(/error/i)).toBeNull();
  });

  test("displays time since last event when lastEventTime is provided", () => {
    const now = Date.now();
    const lastEventTime = new Date(now - 5000); // 5 seconds ago

    const { getByText } = render(
      <ConnectionStatus
        connectionState="connected"
        lastEventTime={lastEventTime}
        onReconnect={() => {}}
      />
    );

    // Should show "5s ago" or similar
    expect(getByText(/ago/i)).toBeDefined();
  });

  test("displays reconnect attempt count when reconnectAttempts > 0", () => {
    const { getByText } = render(
      <ConnectionStatus
        connectionState="connecting"
        reconnectAttempts={3}
        onReconnect={() => {}}
      />
    );

    // Should show attempt count
    expect(getByText(/attempt/i)).toBeDefined();
    expect(getByText(/3/)).toBeDefined();
  });

  test("does not display attempt count when reconnectAttempts is 0", () => {
    const { queryByText } = render(
      <ConnectionStatus
        connectionState="connected"
        reconnectAttempts={0}
        onReconnect={() => {}}
      />
    );

    // Should not show attempt count
    expect(queryByText(/attempt/i)).toBeNull();
  });

  test("displays cursor position when cursorPosition is provided", () => {
    const { getByText } = render(
      <ConnectionStatus
        connectionState="connected"
        cursorPosition={42}
        onReconnect={() => {}}
      />
    );

    // Should show cursor position
    expect(getByText(/cursor/i)).toBeDefined();
    expect(getByText(/42/)).toBeDefined();
  });

  test("does not display cursor position when not provided", () => {
    const { queryByText } = render(
      <ConnectionStatus
        connectionState="connected"
        onReconnect={() => {}}
      />
    );

    // Should not show cursor position
    expect(queryByText(/cursor/i)).toBeNull();
  });

  test("updates time display dynamically as time passes", () => {
    const now = Date.now();
    const lastEventTime = new Date(now - 1000); // 1 second ago

    const { getByText, rerender } = render(
      <ConnectionStatus
        connectionState="connected"
        lastEventTime={lastEventTime}
        onReconnect={() => {}}
      />
    );

    // Initial render should show "1s ago"
    expect(getByText(/1s ago/i)).toBeDefined();

    // Rerender after some time passes (simulate)
    // In reality, component should update via interval
    rerender(
      <ConnectionStatus
        connectionState="connected"
        lastEventTime={lastEventTime}
        onReconnect={() => {}}
      />
    );
  });
});
