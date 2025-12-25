/**
 * Post-Compaction Tool Call Tracker
 *
 * Tracks tool calls after compaction resumption to detect coordinator violations
 * and provide learning signals for eval-driven development.
 *
 * ## Purpose
 *
 * When context is compacted, the continuation agent needs observation to learn
 * if it's following coordinator discipline. This tracker:
 *
 * 1. Emits resumption_started on first tool call (marks compaction exit)
 * 2. Tracks up to N tool calls (default 20) with violation detection
 * 3. Stops tracking after limit to avoid noise in long sessions
 *
 * ## Coordinator Violations Detected
 *
 * - **Edit/Write**: Coordinators NEVER edit files - spawn worker instead
 * - **swarmmail_reserve/agentmail_reserve**: Workers reserve, not coordinators
 *
 * ## Integration
 *
 * Used by compaction hook to wire tool.call events → eval capture.
 *
 * @example
 * ```typescript
 * const tracker = createPostCompactionTracker({
 *   sessionId: "session-123",
 *   epicId: "bd-epic-456",
 *   onEvent: captureCompactionEvent,
 * });
 *
 * // Wire to OpenCode hook
 * hooks["tool.call"] = (input) => {
 *   tracker.trackToolCall({
 *     tool: input.tool,
 *     args: input.args,
 *     timestamp: Date.now(),
 *   });
 * };
 * ```
 */

/**
 * Tool call event structure
 */
export interface ToolCallEvent {
  tool: string;
  args: Record<string, unknown>;
  timestamp: number;
}

/**
 * Compaction event payload (matches eval-capture.ts structure)
 */
export interface CompactionEvent {
  session_id: string;
  epic_id: string;
  compaction_type:
    | "detection_complete"
    | "prompt_generated"
    | "context_injected"
    | "resumption_started"
    | "tool_call_tracked";
  payload: {
    session_id?: string;
    epic_id?: string;
    tool?: string;
    args?: Record<string, unknown>;
    call_number?: number;
    is_coordinator_violation?: boolean;
    violation_reason?: string;
    timestamp?: number;
  };
}

/**
 * Tracker configuration
 */
export interface PostCompactionTrackerConfig {
  sessionId: string;
  epicId: string;
  onEvent: (event: CompactionEvent) => void;
  maxCalls?: number;
}

/**
 * Post-compaction tracker instance
 */
export interface PostCompactionTracker {
  trackToolCall(event: ToolCallEvent): void;
  isTracking(): boolean;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default maximum number of tool calls to track
 *
 * Chosen to balance:
 * - Enough data for pattern detection (20 calls is ~2-3 minutes of coordinator work)
 * - Avoiding noise pollution in long sessions
 */
export const DEFAULT_MAX_TRACKED_CALLS = 20;

// ============================================================================
// Coordinator Violation Detection
// ============================================================================

/**
 * Tools that coordinators are NEVER allowed to use
 *
 * Key insight from semantic memory: coordinators lose identity after compaction
 * and start doing implementation work. These violations are observable signals
 * that the coordinator mandate wasn't preserved in continuation prompt.
 */
const FORBIDDEN_COORDINATOR_TOOLS: Record<string, string> = {
  edit: "Coordinators NEVER edit files - spawn worker instead",
  write: "Coordinators NEVER write files - spawn worker instead",
  swarmmail_reserve: "Coordinators NEVER reserve files - workers reserve files",
  agentmail_reserve: "Coordinators NEVER reserve files - workers reserve files",
};

/**
 * Check if tool call is a coordinator violation
 *
 * @param tool - Tool name from OpenCode tool.call hook
 * @returns Violation status with reason if forbidden
 *
 * @example
 * ```typescript
 * const result = isCoordinatorViolation("edit");
 * // { isViolation: true, reason: "Coordinators NEVER edit..." }
 *
 * const result = isCoordinatorViolation("read");
 * // { isViolation: false }
 * ```
 */
export function isCoordinatorViolation(tool: string): {
  isViolation: boolean;
  reason?: string;
} {
  const reason = FORBIDDEN_COORDINATOR_TOOLS[tool];
  return {
    isViolation: !!reason,
    reason,
  };
}

// ============================================================================
// Tracker Factory
// ============================================================================

/**
 * Create a post-compaction tool call tracker
 *
 * @example
 * ```typescript
 * const tracker = createPostCompactionTracker({
 *   sessionId: "session-123",
 *   epicId: "bd-epic-456",
 *   onEvent: (event) => captureCompactionEvent(event),
 *   maxCalls: 20
 * });
 *
 * // Track tool calls
 * tracker.trackToolCall({
 *   tool: "read",
 *   args: { filePath: "/test.ts" },
 *   timestamp: Date.now()
 * });
 * ```
 */
export function createPostCompactionTracker(
  config: PostCompactionTrackerConfig,
): PostCompactionTracker {
  const {
    sessionId,
    epicId,
    onEvent,
    maxCalls = DEFAULT_MAX_TRACKED_CALLS,
  } = config;

  let callCount = 0;
  let resumptionEmitted = false;

  return {
    trackToolCall(event: ToolCallEvent): void {
      // Stop tracking after max calls reached
      if (callCount >= maxCalls) {
        return;
      }

      // Emit resumption_started on first call
      if (!resumptionEmitted) {
        onEvent({
          session_id: sessionId,
          epic_id: epicId,
          compaction_type: "resumption_started",
          payload: {
            session_id: sessionId,
            epic_id: epicId,
            timestamp: event.timestamp,
          },
        });
        resumptionEmitted = true;
      }

      // Increment before emitting so call_number is 1-based
      callCount++;

      // Check for coordinator violations
      const violation = isCoordinatorViolation(event.tool);

      // Emit tool_call_tracked event
      onEvent({
        session_id: sessionId,
        epic_id: epicId,
        compaction_type: "tool_call_tracked",
        payload: {
          tool: event.tool,
          args: event.args,
          call_number: callCount,
          is_coordinator_violation: violation.isViolation,
          violation_reason: violation.reason,
          timestamp: event.timestamp,
        },
      });
    },

    isTracking(): boolean {
      return callCount < maxCalls;
    },
  };
}
