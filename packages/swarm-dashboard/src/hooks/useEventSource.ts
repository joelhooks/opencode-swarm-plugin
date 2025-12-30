/**
 * Generic EventSource hook with automatic reconnection
 * 
 * Features:
 * - Exponential backoff on connection failures (1s -> 2s -> 4s -> ... max 30s)
 * - Automatic reconnection on error/close
 * - lastEventId tracking for resumable streams
 * - Connection state management
 * - Cleanup on unmount
 * 
 * Based on SSE best practices:
 * - EventSource handles reconnection natively, but we wrap for state tracking
 * - lastEventId enables server-side replay from last received event
 * - Exponential backoff prevents server hammering on failures
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { UseEventSourceState } from "../lib/types";
import { useCursorPersistence } from "./useCursorPersistence";

const MAX_RETRY_DELAY = 30000; // 30 seconds
const INITIAL_RETRY_DELAY = 1000; // 1 second

export interface UseEventSourceOptions {
  /** Enable automatic reconnection on error (default: true) */
  reconnect?: boolean;
  /** Initial retry delay in ms (default: 1000) */
  initialRetryDelay?: number;
  /** Maximum retry delay in ms (default: 30000) */
  maxRetryDelay?: number;
  /** Called when a message is received */
  onMessage?: (event: MessageEvent) => void;
  /** Called when connection opens */
  onOpen?: () => void;
  /** Called when connection closes or errors */
  onError?: (error: Error) => void;
}

export function useEventSource(
  url: string | null,
  options: UseEventSourceOptions = {}
) {
  const {
    reconnect = true,
    initialRetryDelay = INITIAL_RETRY_DELAY,
    maxRetryDelay = MAX_RETRY_DELAY,
    onMessage,
    onOpen,
    onError,
  } = options;

  const [state, setState] = useState<UseEventSourceState>({
    state: "connecting",
    retryCount: 0,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryDelayRef = useRef(initialRetryDelay);
  const unmountedRef = useRef(false);
  
  // Cursor persistence for resumable streams
  const { getCursor, setCursor } = useCursorPersistence(url || "");
  
  // Store callbacks in refs to avoid reconnection on callback changes
  // This is the key fix - callbacks changing shouldn't trigger reconnect
  const onMessageRef = useRef(onMessage);
  const onOpenRef = useRef(onOpen);
  const onErrorRef = useRef(onError);
  
  // Update refs when callbacks change (without triggering reconnect)
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);
  
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);
  
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const connect = useCallback(() => {
    if (!url || unmountedRef.current) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setState((prev) => ({
      ...prev,
      state: prev.retryCount > 0 ? "reconnecting" : "connecting",
    }));

    try {
      // EventSource automatically sends Last-Event-ID header on same-page reconnects
      // But NOT across page reloads - so we add cursor query param for initial load
      let connectionUrl = url;
      const lastCursor = getCursor();
      if (lastCursor) {
        const urlObj = new URL(url);
        urlObj.searchParams.set("cursor", lastCursor);
        connectionUrl = urlObj.toString();
      }
      
      const es = new EventSource(connectionUrl);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (unmountedRef.current) {
          es.close();
          return;
        }
        
        setState((prev) => ({
          ...prev,
          state: "connected",
          error: undefined,
        }));
        
        // Reset retry delay on successful connection
        retryDelayRef.current = initialRetryDelay;
        
        // Use ref to get latest callback without causing reconnect
        onOpenRef.current?.();
      };

      es.onmessage = (event: MessageEvent) => {
        if (unmountedRef.current) return;
        
        // Track last event ID for resumable streams
        // EventSource provides this via event.lastEventId (SSE id: field)
        if (event.lastEventId) {
          setState((prev) => ({
            ...prev,
            lastEventId: event.lastEventId,
          }));
          
          // Persist cursor to localStorage for page reload recovery
          setCursor(event.lastEventId);
        }
        
        // Use ref to get latest callback without causing reconnect
        onMessageRef.current?.(event);
      };

      es.onerror = () => {
        if (unmountedRef.current) return;
        
        const error = new Error("EventSource connection error");
        
        setState((prev) => ({
          ...prev,
          state: "error",
          error,
          retryCount: prev.retryCount + 1,
        }));
        
        // Use ref to get latest callback without causing reconnect
        onErrorRef.current?.(error);
        
        // Close the connection
        es.close();
        
        // Schedule reconnection if enabled
        if (reconnect) {
          const delay = Math.min(
            retryDelayRef.current,
            maxRetryDelay
          );
          
          retryTimeoutRef.current = window.setTimeout(() => {
            connect();
          }, delay);
          
          // Exponential backoff
          retryDelayRef.current = Math.min(
            retryDelayRef.current * 2,
            maxRetryDelay
          );
        }
      };
    } catch (error) {
      setState((prev) => ({
        ...prev,
        state: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      }));
      
      onErrorRef.current?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  // Callbacks are stored in refs, so they don't need to be dependencies
  // This prevents reconnection when callbacks change (the key fix!)
  // getCursor and setCursor are stable (memoized by useCursorPersistence)
  }, [url, reconnect, initialRetryDelay, maxRetryDelay, getCursor, setCursor]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    setState((prev) => ({
      ...prev,
      state: "closed",
    }));
  }, []);

  // Connect on mount or URL change
  useEffect(() => {
    // Reset unmounted flag on mount
    unmountedRef.current = false;
    
    if (url) {
      connect();
    }
    
    return () => {
      unmountedRef.current = true;
      disconnect();
    };
  }, [url, connect, disconnect]);

  return {
    ...state,
    /** Manually trigger reconnection */
    reconnect: connect,
    /** Manually disconnect */
    disconnect,
  };
}
