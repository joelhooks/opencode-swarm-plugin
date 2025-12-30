/**
 * WebSocket hook for Swarm Dashboard using partysocket
 * 
 * Wraps partysocket's useWebSocket with our event parsing logic.
 * Provides automatic reconnection, buffering, and cleanup.
 */

import { useCallback, useEffect, useState, useRef } from "react";
import { useWebSocket as usePartyWebSocket } from "partysocket/react";
import type { AgentEvent } from "../lib/types";
import { useCursorPersistence } from "./useCursorPersistence";

export type WebSocketState = 
  | "connecting" 
  | "connected" 
  | "reconnecting" 
  | "disconnected" 
  | "error";

export interface UseSwarmSocketOptions {
  /** Called when events are received */
  onEvents?: (events: AgentEvent[]) => void;
}

/**
 * Hook for connecting to the swarm dashboard WebSocket
 * 
 * Uses partysocket for battle-tested reconnection logic.
 * Handles React StrictMode double-mount by deduplicating events by ID.
 * 
 * @example
 * ```tsx
 * const { state, events } = useSwarmSocket("ws://localhost:4483/ws");
 * ```
 */
export function useSwarmSocket(url: string, options: UseSwarmSocketOptions = {}) {
  const [state, setState] = useState<WebSocketState>("connecting");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  
  // Store callback in ref to avoid recreating handlers
  const onEventsRef = useRef(options.onEvents);
  onEventsRef.current = options.onEvents;
  
  // Track if we've sent subscribe message
  const subscribedRef = useRef(false);
  const unmountedRef = useRef(false);
  
  // Cursor persistence for resumable streams
  const { getCursor, setCursor } = useCursorPersistence(url);

  // Handlers for partysocket
  const handleOpen = useCallback((event: WebSocketEventMap["open"]) => {
    if (unmountedRef.current) return;
    console.log("[WS] OPEN - connected");
    setState("connected");
    
    // Send subscribe message with cursor if available
    const ws = event.target as WebSocket;
    const lastCursor = getCursor();
    const offset = lastCursor ? Number(lastCursor) : 0;
    
    console.log("[WS] Sending subscribe with offset:", offset);
    ws.send(JSON.stringify({ type: "subscribe", offset }));
    subscribedRef.current = true;
  }, [getCursor]);

  const handleMessage = useCallback((event: WebSocketEventMap["message"]) => {
    if (unmountedRef.current) return;
    
    try {
      const data = JSON.parse(event.data);
      
      // Ignore server control messages
      if (data.type === "connected") {
        console.log("[WS] Server confirmed connection");
        return;
      }
      
      if (data.type === "heartbeat" || data.type === "pong") {
        return;
      }
      
      // Process event
      if (data.type === "event" && data.data) {
        const agentEvent = JSON.parse(data.data) as AgentEvent;
        
        // Track cursor from event offset (WebSocket doesn't have Last-Event-ID header)
        if (data.offset !== undefined) {
          setCursor(String(data.offset));
        }
        
        // Deduplicate by id - only add if not already present
        setEvents((prev) => {
          if (prev.some((e) => e.id === agentEvent.id)) {
            return prev; // Already have this event
          }
          
          // Log first few events, then throttle
          if (prev.length < 10) {
            const agentName = 
              ("agent_name" in agentEvent && agentEvent.agent_name) ||
              ("from_agent" in agentEvent && agentEvent.from_agent) ||
              "";
            console.log("[WS] Event:", agentEvent.type, agentName);
          } else if (prev.length === 10) {
            console.log("[WS] ... (throttling event logs)");
          }
          
          return [...prev, agentEvent];
        });
        
        // Notify callback
        onEventsRef.current?.([agentEvent]);
      }
    } catch (err) {
      console.error("[WS] Parse error:", err);
    }
  }, [setCursor]);

  const handleClose = useCallback((event: WebSocketEventMap["close"]) => {
    if (unmountedRef.current) return;
    console.log("[WS] CLOSE:", event.code, event.reason);
    
    // Reset subscribe flag so we re-subscribe on reconnect
    subscribedRef.current = false;
    
    if (event.code === 1000) {
      setState("disconnected");
    } else {
      setState("reconnecting");
    }
  }, []);

  const handleError = useCallback((event: WebSocketEventMap["error"]) => {
    if (unmountedRef.current) return;
    console.error("[WS] ERROR:", event);
    setState("error");
  }, []);

  // Create partysocket WebSocket
  const ws = usePartyWebSocket(
    url,
    undefined, // protocols
    {
      onOpen: handleOpen,
      onMessage: handleMessage,
      onClose: handleClose,
      onError: handleError,
      // partysocket options
      startClosed: false,
      maxReconnectionDelay: 10000, // 10s max
      minReconnectionDelay: 1000,   // 1s min
      reconnectionDelayGrowFactor: 1.3,
      connectionTimeout: 4000,       // 4s before retry
      maxRetries: Infinity,          // Always retry
      debug: false,
    }
  );

  // Cleanup on unmount
  useEffect(() => {
    unmountedRef.current = false;
    
    return () => {
      console.log("[WS] Cleanup - setting unmounted");
      unmountedRef.current = true;
      ws.close(1000, "Component unmount");
    };
  }, [ws]);

  return {
    state,
    events,
    ws, // Expose underlying WebSocket for advanced use cases
  };
}
