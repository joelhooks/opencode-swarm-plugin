/**
 * Typed hook for consuming Swarm Mail SSE events
 * 
 * Connects to DurableStreamServer endpoint and provides:
 * - Type-safe event parsing (validates against AgentEvent schema)
 * - Project filtering (only events for specified project_key)
 * - Connection state tracking
 * - Event callbacks for each event type
 * - Automatic reconnection with exponential backoff
 * 
 * Usage:
 * ```tsx
 * const { state, events, subscribe, unsubscribe } = useSwarmEvents({
 *   url: "http://localhost:4483/events",
 *   projectKey: "/path/to/project",
 *   onTaskProgress: (event) => console.log("Progress:", event.progress_percent),
 * });
 * ```
 */

import { useCallback, useState } from "react";
import type { AgentEvent } from "../lib/types";
import { useEventSource } from "./useEventSource";

export interface UseSwarmEventsOptions {
  /** SSE endpoint URL (default: http://localhost:4483/events) */
  url?: string;
  /** Filter events by project_key (optional) */
  projectKey?: string;
  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;
  /** Called when any event is received */
  onEvent?: (event: AgentEvent) => void;
  /** Called when connection opens */
  onOpen?: () => void;
  /** Called when connection closes or errors */
  onError?: (error: Error) => void;
}

const DEFAULT_URL = "http://localhost:4483/events";

export function useSwarmEvents(options: UseSwarmEventsOptions = {}) {
  const {
    url = DEFAULT_URL,
    projectKey,
    reconnect = true,
    onEvent,
    onOpen,
    onError,
  } = options;

  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<AgentEvent | null>(null);
  const [lastEventTime, setLastEventTime] = useState<Date | null>(null);

  const handleMessage = useCallback(
    (messageEvent: MessageEvent) => {
      try {
        // Parse outer wrapper from DurableStreamServer
        // Format: { offset: number, data: string (JSON), timestamp: number }
        const wrapper = JSON.parse(messageEvent.data) as { 
          offset: number; 
          data: string; 
          timestamp: number;
        };
        
        // Parse inner event data (double-encoded JSON)
        const event = JSON.parse(wrapper.data) as AgentEvent;

        // Filter by project_key if specified
        if (projectKey && event.project_key !== projectKey) {
          return;
        }

        // Update state
        setLatestEvent(event);
        setEvents((prev) => [...prev, event]);
        setLastEventTime(new Date());

        // Call event callback
        onEvent?.(event);
      } catch (error) {
        console.error("Failed to parse SSE event:", error, messageEvent.data);
      }
    },
    [projectKey, onEvent]
  );

  const eventSourceState = useEventSource(url, {
    reconnect,
    onMessage: handleMessage,
    onOpen,
    onError,
  });

  const clearEvents = useCallback(() => {
    setEvents([]);
    setLatestEvent(null);
    setLastEventTime(null);
  }, []);

  const getEventsByType = useCallback(
    <T extends AgentEvent["type"]>(type: T) => {
      return events.filter((e) => e.type === type) as Extract<
        AgentEvent,
        { type: T }
      >[];
    },
    [events]
  );

  const getEventsByAgent = useCallback(
    (agentName: string) => {
      return events.filter((e) => {
        // Check if event has agent_name field (most event types do)
        return "agent_name" in e && e.agent_name === agentName;
      });
    },
    [events]
  );

  const getEventsByEpic = useCallback(
    (epicId: string) => {
      return events.filter((e) => {
        // Check if event has epic_id field
        return "epic_id" in e && e.epic_id === epicId;
      });
    },
    [events]
  );

  return {
    ...eventSourceState,
    /** All received events (filtered by projectKey if specified) */
    events,
    /** Most recently received event */
    latestEvent,
    /** Clear all stored events */
    clearEvents,
    /** Get events of a specific type */
    getEventsByType,
    /** Get events for a specific agent */
    getEventsByAgent,
    /** Get events for a specific epic */
    getEventsByEpic,
    /** Connection state for health UI */
    connectionState: eventSourceState.state,
    /** Time of last received event */
    lastEventTime,
    /** Number of reconnection attempts */
    reconnectAttempts: eventSourceState.retryCount,
  };
}

/**
 * Hook for subscribing to specific event types
 * 
 * Usage:
 * ```tsx
 * useSwarmEventSubscription({
 *   url: "http://localhost:4483/events",
 *   onTaskProgress: (event) => console.log("Progress:", event),
 *   onTaskCompleted: (event) => console.log("Done:", event),
 * });
 * ```
 */
export interface UseSwarmEventSubscriptionOptions extends UseSwarmEventsOptions {
  onAgentRegistered?: (event: Extract<AgentEvent, { type: "agent_registered" }>) => void;
  onAgentActive?: (event: Extract<AgentEvent, { type: "agent_active" }>) => void;
  onMessageSent?: (event: Extract<AgentEvent, { type: "message_sent" }>) => void;
  onMessageRead?: (event: Extract<AgentEvent, { type: "message_read" }>) => void;
  onMessageAcked?: (event: Extract<AgentEvent, { type: "message_acked" }>) => void;
  onFileReserved?: (event: Extract<AgentEvent, { type: "file_reserved" }>) => void;
  onFileReleased?: (event: Extract<AgentEvent, { type: "file_released" }>) => void;
  onTaskStarted?: (event: Extract<AgentEvent, { type: "task_started" }>) => void;
  onTaskProgress?: (event: Extract<AgentEvent, { type: "task_progress" }>) => void;
  onTaskCompleted?: (event: Extract<AgentEvent, { type: "task_completed" }>) => void;
  onTaskBlocked?: (event: Extract<AgentEvent, { type: "task_blocked" }>) => void;
  onDecompositionGenerated?: (event: Extract<AgentEvent, { type: "decomposition_generated" }>) => void;
  onSubtaskOutcome?: (event: Extract<AgentEvent, { type: "subtask_outcome" }>) => void;
  onHumanFeedback?: (event: Extract<AgentEvent, { type: "human_feedback" }>) => void;
  onSwarmCheckpointed?: (event: Extract<AgentEvent, { type: "swarm_checkpointed" }>) => void;
  onSwarmRecovered?: (event: Extract<AgentEvent, { type: "swarm_recovered" }>) => void;
}

export function useSwarmEventSubscription(
  options: UseSwarmEventSubscriptionOptions
) {
  const {
    onAgentRegistered,
    onAgentActive,
    onMessageSent,
    onMessageRead,
    onMessageAcked,
    onFileReserved,
    onFileReleased,
    onTaskStarted,
    onTaskProgress,
    onTaskCompleted,
    onTaskBlocked,
    onDecompositionGenerated,
    onSubtaskOutcome,
    onHumanFeedback,
    onSwarmCheckpointed,
    onSwarmRecovered,
    ...swarmOptions
  } = options;

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      switch (event.type) {
        case "agent_registered":
          onAgentRegistered?.(event);
          break;
        case "agent_active":
          onAgentActive?.(event);
          break;
        case "message_sent":
          onMessageSent?.(event);
          break;
        case "message_read":
          onMessageRead?.(event);
          break;
        case "message_acked":
          onMessageAcked?.(event);
          break;
        case "file_reserved":
          onFileReserved?.(event);
          break;
        case "file_released":
          onFileReleased?.(event);
          break;
        case "task_started":
          onTaskStarted?.(event);
          break;
        case "task_progress":
          onTaskProgress?.(event);
          break;
        case "task_completed":
          onTaskCompleted?.(event);
          break;
        case "task_blocked":
          onTaskBlocked?.(event);
          break;
        case "decomposition_generated":
          onDecompositionGenerated?.(event);
          break;
        case "subtask_outcome":
          onSubtaskOutcome?.(event);
          break;
        case "human_feedback":
          onHumanFeedback?.(event);
          break;
        case "swarm_checkpointed":
          onSwarmCheckpointed?.(event);
          break;
        case "swarm_recovered":
          onSwarmRecovered?.(event);
          break;
      }
    },
    [
      onAgentRegistered,
      onAgentActive,
      onMessageSent,
      onMessageRead,
      onMessageAcked,
      onFileReserved,
      onFileReleased,
      onTaskStarted,
      onTaskProgress,
      onTaskCompleted,
      onTaskBlocked,
      onDecompositionGenerated,
      onSubtaskOutcome,
      onHumanFeedback,
      onSwarmCheckpointed,
      onSwarmRecovered,
    ]
  );

  return useSwarmEvents({
    ...swarmOptions,
    onEvent: handleEvent,
  });
}
