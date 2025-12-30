/**
 * Test setup for Bun + Testing Library
 * 
 * Provides DOM environment using happy-dom + global fetch mocks
 */

import { Window } from "happy-dom";
import { beforeEach, afterEach, spyOn } from "bun:test";
import { cleanup } from "@testing-library/react";

// Create happy-dom window and inject globals SYNCHRONOUSLY at module load time
// CRITICAL: This happens during import, before @testing-library/react code runs
const window = new Window({ url: "http://localhost:3000" });

// Inject into globalThis immediately (not deferred)
// These must be set before @testing-library/react imports execute
Object.defineProperty(globalThis, "window", { value: window, writable: true, configurable: true });
Object.defineProperty(globalThis, "document", { value: window.document, writable: true, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: window.navigator, writable: true, configurable: true });
Object.defineProperty(globalThis, "HTMLElement", { value: window.HTMLElement, writable: true, configurable: true });
Object.defineProperty(globalThis, "Element", { value: window.Element, writable: true, configurable: true });
Object.defineProperty(globalThis, "Node", { value: window.Node, writable: true, configurable: true });

// LocalStorage mock for cursor persistence
class LocalStorageMock {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

Object.defineProperty(globalThis, "localStorage", { value: new LocalStorageMock(), writable: true, configurable: true });

// Default cell fixtures for tests
export const mockCellFixtures = [
  {
    id: "epic-1",
    title: "Test Epic",
    status: "in_progress",
    priority: 0,
    issue_type: "epic",
  },
  {
    id: "task-1",
    title: "Test Task",
    status: "open",
    priority: 1,
    issue_type: "task",
    parent_id: "epic-1",
  },
];

let fetchSpy: any;

beforeEach(() => {
  // Mock fetch globally with default fixtures
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (url: string | Request) => {
    const urlString = typeof url === "string" ? url : url.url;
    
    // Return mock cell data for /cells endpoint
    if (urlString.includes("/cells")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ cells: mockCellFixtures }),
      } as Response;
    }
    
    // Default: network error
    throw new TypeError("fetch failed - unmocked URL: " + urlString);
  });
});

afterEach(() => {
  // Clean up rendered components between tests
  cleanup();
  
  if (fetchSpy) {
    fetchSpy.mockRestore();
  }
});
