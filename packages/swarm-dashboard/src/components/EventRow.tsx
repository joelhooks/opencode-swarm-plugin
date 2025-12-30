/**
 * Individual event row component
 * 
 * Displays a single event with timestamp, type badge, agent name, and summary
 * Uses WebTUI/Catppuccin theme variables for dark/light mode
 */

import type { AgentEvent, BaseEvent } from "../lib/types";

interface EventRowProps {
  event: AgentEvent;
}

/**
 * Format timestamp as HH:MM:SS
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Get badge colors based on event type using Catppuccin palette
 */
function getBadgeColors(eventType: AgentEvent["type"]): { bg: string; text: string } {
  const colorMap: Record<string, { bg: string; text: string }> = {
    // Agent events - Blue/Sapphire
    agent_registered: { bg: "var(--sapphire, #74c7ec)", text: "var(--base, #1e1e2e)" },
    agent_active: { bg: "var(--sapphire, #74c7ec)", text: "var(--base, #1e1e2e)" },

    // Task completion - Green
    task_completed: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },

    // Task start/progress - Yellow/Peach
    task_started: { bg: "var(--peach, #fab387)", text: "var(--base, #1e1e2e)" },
    task_progress: { bg: "var(--yellow, #f9e2af)", text: "var(--base, #1e1e2e)" },

    // Task blocked - Red
    task_blocked: { bg: "var(--red, #f38ba8)", text: "var(--base, #1e1e2e)" },

    // Messages - Mauve/Purple
    message_sent: { bg: "var(--mauve, #cba6f7)", text: "var(--base, #1e1e2e)" },
    message_read: { bg: "var(--mauve, #cba6f7)", text: "var(--base, #1e1e2e)" },
    message_acked: { bg: "var(--lavender, #b4befe)", text: "var(--base, #1e1e2e)" },
    thread_created: { bg: "var(--mauve, #cba6f7)", text: "var(--base, #1e1e2e)" },
    thread_activity: { bg: "var(--lavender, #b4befe)", text: "var(--base, #1e1e2e)" },

    // File operations - Overlay
    file_reserved: { bg: "var(--surface2, #585b70)", text: "var(--text, #cdd6f4)" },
    file_released: { bg: "var(--surface1, #45475a)", text: "var(--text, #cdd6f4)" },
    file_conflict: { bg: "var(--red, #f38ba8)", text: "var(--base, #1e1e2e)" },

    // Decomposition/outcomes - Teal
    decomposition_generated: { bg: "var(--teal, #94e2d5)", text: "var(--base, #1e1e2e)" },
    subtask_outcome: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },

    // Checkpoints/Compaction - Blue
    swarm_checkpointed: { bg: "var(--blue, #89b4fa)", text: "var(--base, #1e1e2e)" },
    swarm_recovered: { bg: "var(--blue, #89b4fa)", text: "var(--base, #1e1e2e)" },
    checkpoint_created: { bg: "var(--blue, #89b4fa)", text: "var(--base, #1e1e2e)" },
    context_compacted: { bg: "var(--blue, #89b4fa)", text: "var(--base, #1e1e2e)" },
    compaction_triggered: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },
    swarm_detected: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },
    context_injected: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },

    // Human feedback - Flamingo
    human_feedback: { bg: "var(--flamingo, #f2cdcd)", text: "var(--base, #1e1e2e)" },

    // Cell/Hive events - Rosewater/Pink
    cell_created: { bg: "var(--rosewater, #f5e0dc)", text: "var(--base, #1e1e2e)" },
    cell_updated: { bg: "var(--pink, #f5c2e7)", text: "var(--base, #1e1e2e)" },
    cell_status_changed: { bg: "var(--pink, #f5c2e7)", text: "var(--base, #1e1e2e)" },
    cell_closed: { bg: "var(--maroon, #eba0ac)", text: "var(--base, #1e1e2e)" },
    epic_created: { bg: "var(--rosewater, #f5e0dc)", text: "var(--base, #1e1e2e)" },
    hive_synced: { bg: "var(--pink, #f5c2e7)", text: "var(--base, #1e1e2e)" },

    // Memory events - Green/Teal
    memory_stored: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },
    memory_found: { bg: "var(--teal, #94e2d5)", text: "var(--base, #1e1e2e)" },
    memory_updated: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },
    memory_validated: { bg: "var(--teal, #94e2d5)", text: "var(--base, #1e1e2e)" },
    memory_deleted: { bg: "var(--maroon, #eba0ac)", text: "var(--base, #1e1e2e)" },

    // CASS events - Sky
    cass_searched: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },
    cass_viewed: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },
    cass_indexed: { bg: "var(--sky, #89dceb)", text: "var(--base, #1e1e2e)" },

    // Skills events - Peach
    skill_loaded: { bg: "var(--peach, #fab387)", text: "var(--base, #1e1e2e)" },
    skill_created: { bg: "var(--peach, #fab387)", text: "var(--base, #1e1e2e)" },

    // Decision events - Yellow
    decision_recorded: { bg: "var(--yellow, #f9e2af)", text: "var(--base, #1e1e2e)" },

    // Swarm lifecycle - Green/Teal
    swarm_started: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },
    worker_spawned: { bg: "var(--teal, #94e2d5)", text: "var(--base, #1e1e2e)" },
    worker_completed: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },
    review_started: { bg: "var(--yellow, #f9e2af)", text: "var(--base, #1e1e2e)" },
    review_completed: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },
    swarm_completed: { bg: "var(--green, #a6e3a1)", text: "var(--base, #1e1e2e)" },
  };

  return colorMap[eventType] || { bg: "var(--surface1, #45475a)", text: "var(--text, #cdd6f4)" };
}

/**
 * Extract display summary from event
 */
function getEventSummary(event: AgentEvent): string {
  switch (event.type) {
    // Agent events
    case "agent_registered":
      return event.model ? `Registered with ${event.model}` : "Registered";
    case "agent_active":
      return "Agent active";
    
    // Task events
    case "task_started":
      return `Started ${event.bead_id}`;
    case "task_progress":
      return event.message || `Progress: ${event.progress_percent}%`;
    case "task_completed":
      return event.summary || "Task completed";
    case "task_blocked":
      return event.reason || "Task blocked";
    
    // Message events
    case "message_sent":
      return `To ${event.to_agents.join(", ")}: ${event.subject}`;
    case "message_read":
      return `Read message ${event.message_id}`;
    case "message_acked":
      return `Acknowledged message ${event.message_id}`;
    case "thread_created":
      return `Thread: ${event.initial_subject}`;
    case "thread_activity":
      return `Thread ${event.thread_id}: ${event.message_count} messages`;
    
    // File events
    case "file_reserved":
      return `Reserved ${event.paths.length} file(s)`;
    case "file_released":
      return event.paths
        ? `Released ${event.paths.length} file(s)`
        : "Released reservations";
    case "file_conflict":
      return `Conflict: ${event.requesting_agent} vs ${event.holding_agent} on ${event.paths.length} file(s)`;
    
    // Decomposition/Learning events
    case "decomposition_generated":
      return `Decomposed: ${event.epic_title} (${event.subtasks.length} subtasks)`;
    case "subtask_outcome":
      return `Subtask ${event.success ? "succeeded" : "failed"} (${event.duration_ms}ms)`;
    case "human_feedback":
      return event.accepted ? "Feedback: Accepted" : "Feedback: Rejected";
    
    // Checkpoint/Compaction events
    case "swarm_checkpointed":
      return `Checkpoint created for ${event.bead_id}`;
    case "swarm_recovered":
      return `Recovered ${event.bead_id}`;
    case "checkpoint_created":
      return `Checkpoint: ${event.checkpoint_id} (${event.progress_percent}%)`;
    case "context_compacted":
      return `Compacted: ${event.tokens_before} → ${event.tokens_after} tokens`;
    case "compaction_triggered":
      return `Compaction triggered: ${event.trigger}`;
    case "swarm_detected":
      return `Swarm detected: ${event.confidence} confidence`;
    case "context_injected":
      return `Context injected: ${event.context_type}`;
    
    // Cell/Hive events
    case "cell_created":
      return `Created: ${event.title}`;
    case "cell_updated":
      return `Updated: ${event.cell_id}`;
    case "cell_status_changed":
      return `Status: ${event.from_status} → ${event.to_status}`;
    case "cell_closed":
      return event.reason ? `Closed: ${event.reason}` : "Closed";
    case "epic_created":
      return `Epic: ${event.title} (${event.subtask_count} subtasks)`;
    case "hive_synced":
      return `Synced ${event.cells_synced} cells (${event.push_success ? "pushed" : "local only"})`;
    
    // Memory events
    case "memory_stored":
      return `Stored: ${event.content_preview.slice(0, 50)}...`;
    case "memory_found":
      return `Found ${event.result_count} memories for "${event.query}"`;
    case "memory_updated":
      return `Memory ${event.operation}: ${event.memory_id}`;
    case "memory_validated":
      return `Validated: ${event.memory_id}`;
    case "memory_deleted":
      return `Deleted: ${event.memory_id}`;
    
    // CASS events
    case "cass_searched":
      return `Searched: "${event.query}" (${event.result_count} results)`;
    case "cass_viewed":
      return `Viewed: ${event.session_path}`;
    case "cass_indexed":
      return `Indexed ${event.sessions_indexed} sessions, ${event.messages_indexed} messages`;
    
    // Skills events
    case "skill_loaded":
      return `Loaded: ${event.skill_name} (${event.skill_source})`;
    case "skill_created":
      return `Created: ${event.skill_name} (${event.skill_scope})`;
    
    // Decision events
    case "decision_recorded":
      return `Decision: ${event.decision_type}`;
    
    // Swarm lifecycle events
    case "swarm_started":
      return `Swarm started: ${event.epic_title} (${event.subtask_count} subtasks, ${event.total_files} files)`;
    case "worker_spawned":
      return `Worker spawned: ${event.worker_agent} for ${event.subtask_title}`;
    case "worker_completed":
      return event.success
        ? `Worker completed: ${event.worker_agent} (${event.duration_ms}ms)`
        : `Worker failed: ${event.worker_agent} - ${event.error_message || "unknown error"}`;
    case "review_started":
      return `Review started: ${event.bead_id} (attempt ${event.attempt})`;
    case "review_completed":
      return `Review ${event.status}: ${event.bead_id} (attempt ${event.attempt})`;
    case "swarm_completed":
      return event.success
        ? `Swarm completed: ${event.epic_title} (${event.subtasks_completed} completed, ${event.total_duration_ms}ms)`
        : `Swarm failed: ${event.epic_title} (${event.subtasks_failed} failed)`;
    
    default: {
      // Fallback for any unhandled event types
      return `Event: ${(event as BaseEvent).type}`;
    }
  }
}

/**
 * Get agent name from event
 */
function getAgentName(event: AgentEvent): string | undefined {
  if ("agent_name" in event && typeof event.agent_name === "string") {
    return event.agent_name;
  }
  if ("from_agent" in event && typeof event.from_agent === "string") {
    return event.from_agent;
  }
  return undefined;
}

export function EventRow({ event }: EventRowProps) {
  const agentName = getAgentName(event);
  const summary = getEventSummary(event);
  const badgeColors = getBadgeColors(event.type);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.75rem",
        padding: "0.5rem 1rem",
        borderBottom: "1px solid var(--surface0, #313244)",
        fontSize: "0.875rem",
      }}
    >
      {/* Timestamp */}
      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--foreground2)",
          fontFamily: "monospace",
          width: "5rem",
          flexShrink: 0,
          paddingTop: "0.125rem",
        }}
      >
        {formatTime(event.timestamp)}
      </div>

      {/* Event type badge */}
      <div style={{ flexShrink: 0 }}>
        <span
          style={{
            padding: "0.125rem 0.5rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            borderRadius: "0.25rem",
            backgroundColor: badgeColors.bg,
            color: badgeColors.text,
          }}
        >
          {event.type}
        </span>
      </div>

      {/* Agent name */}
      {agentName && (
        <div
          style={{
            color: "var(--foreground0)",
            fontWeight: 500,
            width: "8rem",
            flexShrink: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            paddingTop: "0.125rem",
          }}
        >
          {agentName}
        </div>
      )}

      {/* Summary */}
      <div
        style={{
          color: "var(--foreground1)",
          flex: 1,
          paddingTop: "0.125rem",
          wordBreak: "break-word",
        }}
      >
        {summary}
      </div>
    </div>
  );
}
