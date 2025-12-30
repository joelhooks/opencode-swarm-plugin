/**
 * Hook for persisting SSE/WebSocket cursor position across page reloads
 * 
 * Features:
 * - Stores last-seen cursor in localStorage
 * - Key format: swarm-cursor-{endpoint-url-hash}
 * - Handles null cursors gracefully
 * - Different endpoints get different storage keys
 * 
 * Usage:
 * ```tsx
 * const { getCursor, setCursor } = useCursorPersistence("http://localhost:8080/events");
 * 
 * // Get last cursor on mount
 * const lastCursor = getCursor();
 * 
 * // Update cursor when new events arrive
 * setCursor(event.id);
 * ```
 */

import { useCallback, useMemo } from "react";

/**
 * Simple hash function for generating consistent storage keys
 * Uses Java-style string hash algorithm
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Hook for persisting cursor position in localStorage
 * 
 * @param endpoint - The SSE/WebSocket endpoint URL (used to generate storage key)
 * @returns Object with getCursor and setCursor methods
 */
export function useCursorPersistence(endpoint: string) {
  // Generate storage key from endpoint URL (memoized)
  const storageKey = useMemo(() => {
    const hash = simpleHash(endpoint);
    return `swarm-cursor-${hash}`;
  }, [endpoint]);
  
  /**
   * Get the last stored cursor for this endpoint
   * Returns null if no cursor stored or if localStorage data is corrupted
   */
  const getCursor = useCallback((): string | null => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return null;
      
      // Parse and validate stored value
      const parsed = JSON.parse(stored);
      return typeof parsed === "string" ? parsed : null;
    } catch (err) {
      // Corrupted data - return null and clean up
      console.warn(`[useCursorPersistence] Failed to parse cursor for ${endpoint}:`, err);
      localStorage.removeItem(storageKey);
      return null;
    }
  }, [storageKey, endpoint]);
  
  /**
   * Store a new cursor value for this endpoint
   * Pass null to clear the stored cursor
   */
  const setCursor = useCallback((cursor: string | null) => {
    try {
      if (cursor === null) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, JSON.stringify(cursor));
      }
    } catch (err) {
      // localStorage quota exceeded or disabled
      console.error(`[useCursorPersistence] Failed to store cursor for ${endpoint}:`, err);
    }
  }, [storageKey, endpoint]);
  
  return {
    getCursor,
    setCursor,
  };
}
