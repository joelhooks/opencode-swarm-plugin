/**
 * Tests for useCursorPersistence hook
 * 
 * TDD: Write tests first to define behavior
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import { useCursorPersistence } from "./useCursorPersistence";
import "../test-setup"; // Provides localStorage mock

describe("useCursorPersistence", () => {
  const testEndpoint = "http://localhost:8080/events";
  
  // Clean up localStorage before each test
  beforeEach(() => {
    localStorage.clear();
  });
  
  afterEach(() => {
    localStorage.clear();
  });
  
  it("returns null cursor initially when no stored value", () => {
    const { result } = renderHook(() => useCursorPersistence(testEndpoint));
    
    expect(result.current.getCursor()).toBeNull();
  });
  
  it("stores and retrieves cursor value", () => {
    const { result } = renderHook(() => useCursorPersistence(testEndpoint));
    
    act(() => {
      result.current.setCursor("12345");
    });
    
    expect(result.current.getCursor()).toBe("12345");
  });
  
  it("persists cursor across hook remounts", () => {
    // First mount - set cursor
    const { unmount } = renderHook(() => useCursorPersistence(testEndpoint));
    const { result: firstResult } = renderHook(() => useCursorPersistence(testEndpoint));
    
    act(() => {
      firstResult.current.setCursor("67890");
    });
    
    unmount();
    
    // Second mount - should retrieve stored cursor
    const { result: secondResult } = renderHook(() => useCursorPersistence(testEndpoint));
    
    expect(secondResult.current.getCursor()).toBe("67890");
  });
  
  it("uses different storage keys for different endpoints", () => {
    const endpoint1 = "http://localhost:8080/events";
    const endpoint2 = "http://localhost:9090/events";
    
    const { result: hook1 } = renderHook(() => useCursorPersistence(endpoint1));
    const { result: hook2 } = renderHook(() => useCursorPersistence(endpoint2));
    
    act(() => {
      hook1.current.setCursor("cursor1");
      hook2.current.setCursor("cursor2");
    });
    
    expect(hook1.current.getCursor()).toBe("cursor1");
    expect(hook2.current.getCursor()).toBe("cursor2");
  });
  
  it("generates consistent hash for same endpoint", () => {
    const { result: hook1 } = renderHook(() => useCursorPersistence(testEndpoint));
    const { result: hook2 } = renderHook(() => useCursorPersistence(testEndpoint));
    
    act(() => {
      hook1.current.setCursor("test123");
    });
    
    // Hook2 should see the same cursor because it's the same endpoint
    expect(hook2.current.getCursor()).toBe("test123");
  });
  
  it("handles setCursor with null to clear cursor", () => {
    const { result } = renderHook(() => useCursorPersistence(testEndpoint));
    
    act(() => {
      result.current.setCursor("initial");
    });
    
    expect(result.current.getCursor()).toBe("initial");
    
    act(() => {
      result.current.setCursor(null);
    });
    
    expect(result.current.getCursor()).toBeNull();
  });
  
  it("handles malformed localStorage data gracefully", () => {
    // Manually corrupt localStorage
    const hash = simpleHash(testEndpoint);
    localStorage.setItem(`swarm-cursor-${hash}`, "{invalid json");
    
    const { result } = renderHook(() => useCursorPersistence(testEndpoint));
    
    // Should return null instead of throwing
    expect(result.current.getCursor()).toBeNull();
  });
});

// Helper function that should match the one in the hook
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
