/**
 * Agents pane component
 * 
 * Shows active agents grouped by project with real-time updates via SSE.
 * Uses WebTUI theme variables for dark/light mode support.
 */

import { useMemo, useState } from "react";
import { AgentCard } from "./AgentCard";
import type {
  AgentActiveEvent,
  AgentEvent,
  AgentRegisteredEvent,
  ConnectionState,
  TaskCompletedEvent,
  TaskProgressEvent,
  TaskStartedEvent,
} from "../lib/types";

interface Agent {
  name: string;
  status: "active" | "idle";
  lastActiveTime: number;
  currentTask?: string;
  projectKey: string;
}

interface ProjectGroup {
  projectKey: string;
  displayName: string;
  agents: Agent[];
  hasActiveAgent: boolean;
  lastActivityTime: number;
}

/**
 * Agent is considered active if last seen within 5 minutes
 */
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Get display name for project path (last 2 segments for long paths)
 */
function getProjectDisplayName(projectKey: string): string {
  const parts = projectKey.split('/').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('/') || projectKey;
  }
  return parts.slice(-2).join('/');
}

export interface AgentsPaneProps {
  /** Events array from useSwarmEvents or useWebSocket hook */
  events: AgentEvent[];
  /** Connection state */
  state: ConnectionState | "disconnected";
}

export function AgentsPane({ events, state }: AgentsPaneProps) {
  console.log("[AgentsPane] events:", events.length, "state:", state);
  
  // Track collapsed projects
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  
  // Derive project groups from events
  const projectGroups = useMemo<ProjectGroup[]>(() => {
    console.log("[AgentsPane] Computing agents from", events.length, "events");
    // Helper to filter events by type
    const getEventsByType = <T extends AgentEvent["type"]>(type: T) => {
      return events.filter((e) => e.type === type) as Extract<
        AgentEvent,
        { type: T }
      >[];
    };
    
    // Get all agent registrations
    const registrations = getEventsByType("agent_registered") as AgentRegisteredEvent[];
    const activeEvents = getEventsByType("agent_active") as AgentActiveEvent[];
    const taskStarted = getEventsByType("task_started") as TaskStartedEvent[];
    const taskProgress = getEventsByType("task_progress") as TaskProgressEvent[];
    const taskCompleted = getEventsByType("task_completed") as TaskCompletedEvent[];

    // Build map of agent name -> agent state
    const agentMap = new Map<string, Agent>();

    // Initialize from registrations
    for (const event of registrations) {
      agentMap.set(event.agent_name, {
        name: event.agent_name,
        status: "idle",
        lastActiveTime: event.timestamp,
        currentTask: event.task_description,
        projectKey: event.project_key,
      });
    }

    // Update with active pings
    for (const event of activeEvents) {
      const agent = agentMap.get(event.agent_name);
      if (agent) {
        agent.lastActiveTime = Math.max(agent.lastActiveTime, event.timestamp);
      }
    }

    // Update with task events
    for (const event of taskStarted) {
      const agent = agentMap.get(event.agent_name);
      if (agent) {
        agent.lastActiveTime = Math.max(agent.lastActiveTime, event.timestamp);
        agent.currentTask = event.bead_id;
      }
    }

    for (const event of taskProgress) {
      const agent = agentMap.get(event.agent_name);
      if (agent) {
        agent.lastActiveTime = Math.max(agent.lastActiveTime, event.timestamp);
        if (event.message) {
          agent.currentTask = event.message;
        }
      }
    }

    for (const event of taskCompleted) {
      const agent = agentMap.get(event.agent_name);
      if (agent) {
        agent.lastActiveTime = Math.max(agent.lastActiveTime, event.timestamp);
        agent.currentTask = undefined;
      }
    }

    // Determine active vs idle based on last activity
    const now = Date.now();
    for (const agent of agentMap.values()) {
      agent.status = now - agent.lastActiveTime < ACTIVE_THRESHOLD_MS ? "active" : "idle";
    }

    // Group agents by project
    const projectMap = new Map<string, ProjectGroup>();
    
    for (const agent of agentMap.values()) {
      if (!projectMap.has(agent.projectKey)) {
        projectMap.set(agent.projectKey, {
          projectKey: agent.projectKey,
          displayName: getProjectDisplayName(agent.projectKey),
          agents: [],
          hasActiveAgent: false,
          lastActivityTime: 0,
        });
      }
      
      const project = projectMap.get(agent.projectKey)!;
      project.agents.push(agent);
      if (agent.status === "active") {
        project.hasActiveAgent = true;
      }
      project.lastActivityTime = Math.max(project.lastActivityTime, agent.lastActiveTime);
    }

    // Sort agents within each project (active first, then by last active time)
    for (const project of projectMap.values()) {
      project.agents.sort((a, b) => {
        if (a.status !== b.status) {
          return a.status === "active" ? -1 : 1;
        }
        return b.lastActiveTime - a.lastActiveTime;
      });
    }

    // Sort projects: active first, then by most recent activity
    return Array.from(projectMap.values()).sort((a, b) => {
      if (a.hasActiveAgent !== b.hasActiveAgent) {
        return a.hasActiveAgent ? -1 : 1;
      }
      return b.lastActivityTime - a.lastActivityTime;
    });
  }, [events]);

  const toggleProject = (projectKey: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
      return next;
    });
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--background1)",
        borderRadius: "0.5rem",
        border: "1px solid var(--surface0, #313244)",
        overflow: "hidden",
      }}
    >
      {/* Header with connection state */}
      <div
        style={{
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--surface0, #313244)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2
          style={{
            fontSize: "1.125rem",
            fontWeight: 600,
            color: "var(--foreground0)",
            margin: 0,
          }}
        >
          Agents
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span
            style={{
              height: "0.5rem",
              width: "0.5rem",
              borderRadius: "50%",
              backgroundColor:
                state === "connected"
                  ? "var(--green, #a6e3a1)"
                  : state === "connecting" || state === "reconnecting"
                    ? "var(--yellow, #f9e2af)"
                    : "var(--red, #f38ba8)",
              animation:
                state === "connecting" || state === "reconnecting"
                  ? "pulse 2s infinite"
                  : "none",
            }}
            title={state}
          />
          <span
            style={{
              fontSize: "0.75rem",
              // WCAG AA: --subtext0 gives 6.8:1 contrast
              color: "var(--subtext0, #a6adc8)",
              textTransform: "capitalize",
            }}
          >
            {state}
          </span>
        </div>
      </div>

      {/* Project groups */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem" }}>
        {projectGroups.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--overlay1, #7f849c)",
              textAlign: "center",
              padding: "2rem",
            }}
          >
            <p style={{ margin: 0 }}>No agents</p>
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem" }}>
              Agents appear when they register
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {projectGroups.map((project) => {
              const isCollapsed = collapsedProjects.has(project.projectKey);
              
              return (
                <div key={project.projectKey}>
                  {/* Project header */}
                  <div
                    data-project-header
                    onClick={() => toggleProject(project.projectKey)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      padding: "0.5rem",
                      cursor: "pointer",
                      borderRadius: "0.25rem",
                      transition: "background-color 0.2s",
                      userSelect: "none",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--surface0, #313244)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    {/* Project status indicator */}
                    <span
                      style={{
                        height: "0.5rem",
                        width: "0.5rem",
                        borderRadius: "50%",
                        backgroundColor: project.hasActiveAgent
                          ? "var(--green, #a6e3a1)"
                          : "var(--overlay0, #6c7086)",
                        flexShrink: 0,
                      }}
                      title={project.hasActiveAgent ? "Active" : "Idle"}
                    />
                    
                    {/* Collapse/expand arrow */}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--subtext0, #a6adc8)",
                        transition: "transform 0.2s",
                        transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                      }}
                    >
                      ▼
                    </span>
                    
                    {/* Project name */}
                    <span
                      style={{
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        color: "var(--subtext1, #bac2de)",
                        flex: 1,
                      }}
                    >
                      {project.displayName}
                    </span>
                    
                    {/* Agent count */}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--overlay1, #7f849c)",
                        fontFamily: "monospace",
                      }}
                    >
                      {project.agents.length} {project.agents.length === 1 ? "agent" : "agents"}
                    </span>
                  </div>
                  
                  {/* Agent cards */}
                  {!isCollapsed && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        paddingLeft: "1.5rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      {project.agents.map((agent) => (
                        <AgentCard
                          key={agent.name}
                          name={agent.name}
                          status={agent.status}
                          lastActiveTime={agent.lastActiveTime}
                          currentTask={agent.currentTask}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
