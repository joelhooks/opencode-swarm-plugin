/**
 * ConnectionStatus component
 * 
 * Shows WebSocket connection state with visual indicator and retry UI.
 * 
 * States:
 * - connected: green dot, "Connected" text
 * - connecting: yellow pulsing dot, "Connecting..." text
 * - disconnected: red dot, "Disconnected" text, retry button
 * 
 * Props from App.tsx:
 * - connectionState: 'connecting' | 'connected' | 'disconnected'
 * - error?: string - optional error message to display
 * - onReconnect: () => void - callback for retry button
 * 
 * Styling: Catppuccin Mocha theme, inline styles matching existing components
 */

import type { CSSProperties } from "react";

export interface ConnectionStatusProps {
  connectionState: "connecting" | "connected" | "disconnected";
  error?: string;
  onReconnect: () => void;
  /** Time of last received event (for "time since" display) */
  lastEventTime?: Date | null;
  /** Number of reconnection attempts */
  reconnectAttempts?: number;
  /** Current SSE cursor position (optional debug info) */
  cursorPosition?: number;
}

/**
 * Get color for connection state using Catppuccin Mocha palette
 */
function getStateColor(state: ConnectionStatusProps["connectionState"]): string {
  switch (state) {
    case "connected":
      return "var(--green, #a6e3a1)";
    case "connecting":
      return "var(--yellow, #f9e2af)";
    case "disconnected":
      return "var(--red, #f38ba8)";
  }
}

/**
 * Get text label for connection state
 */
function getStateLabel(state: ConnectionStatusProps["connectionState"]): string {
  switch (state) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting...";
    case "disconnected":
      return "Disconnected";
  }
}

/**
 * Format time difference as human-readable string
 */
function formatTimeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function ConnectionStatus({
  connectionState,
  error,
  onReconnect,
  lastEventTime,
  reconnectAttempts = 0,
  cursorPosition,
}: ConnectionStatusProps) {
  const isPulsing = connectionState === "connecting";
  const showRetryButton = connectionState === "disconnected";
  const showReconnectAttempts = reconnectAttempts > 0;

  const containerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  };

  const statusRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  };

  const indicatorStyle: CSSProperties = {
    height: "0.5rem",
    width: "0.5rem",
    borderRadius: "50%",
    flexShrink: 0,
    backgroundColor: getStateColor(connectionState),
    animation: isPulsing ? "pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite" : undefined,
  };

  const labelStyle: CSSProperties = {
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "var(--text, #cdd6f4)",
  };

  const retryButtonStyle: CSSProperties = {
    fontSize: "0.75rem",
    padding: "0.25rem 0.5rem",
    borderRadius: "0.25rem",
    border: "1px solid var(--surface1, #45475a)",
    backgroundColor: "var(--surface0, #313244)",
    color: "var(--text, #cdd6f4)",
    cursor: "pointer",
    transition: "background-color 0.2s, border-color 0.2s",
  };

  const errorStyle: CSSProperties = {
    fontSize: "0.75rem",
    color: "var(--red, #f38ba8)",
    margin: 0,
    paddingLeft: "1rem",
  };

  const metadataStyle: CSSProperties = {
    fontSize: "0.75rem",
    color: "var(--subtext0, #a6adc8)",
    margin: 0,
    paddingLeft: "1rem",
  };

  return (
    <div style={containerStyle}>
      <div style={statusRowStyle}>
        <span
          style={indicatorStyle}
          data-testid="connection-indicator"
          data-pulse={isPulsing}
          title={getStateLabel(connectionState)}
        />
        <span style={labelStyle}>{getStateLabel(connectionState)}</span>
        {showRetryButton && (
          <button
            type="button"
            style={retryButtonStyle}
            onClick={onReconnect}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface1, #45475a)";
              e.currentTarget.style.borderColor = "var(--mauve, #cba6f7)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface0, #313244)";
              e.currentTarget.style.borderColor = "var(--surface1, #45475a)";
            }}
            aria-label="Retry connection"
          >
            Retry
          </button>
        )}
      </div>
      {error && <p style={errorStyle}>{error}</p>}
      
      {/* Metadata row: time since last event, reconnect attempts, cursor */}
      {(lastEventTime || showReconnectAttempts || cursorPosition !== undefined) && (
        <div style={{ ...metadataStyle, display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          {lastEventTime && <span>Last event: {formatTimeSince(lastEventTime)}</span>}
          {showReconnectAttempts && <span>Reconnect attempt {reconnectAttempts}</span>}
          {cursorPosition !== undefined && <span>Cursor: {cursorPosition}</span>}
        </div>
      )}
      
      {/* Inline keyframes for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
