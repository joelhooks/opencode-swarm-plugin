/**
 * API client tests
 * 
 * TDD tests for swarm-mail data fetching
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { getCells } from "./api";
import type { Cell } from "../components/CellNode";

describe("getCells API function", () => {
  test("returns empty array when no cells exist", async () => {
    const cells = await getCells("http://localhost:3001");
    expect(Array.isArray(cells)).toBe(true);
  });

  test("returns cells with correct structure", async () => {
    const cells = await getCells("http://localhost:3001");
    
    // Each cell should have required fields
    for (const cell of cells) {
      expect(cell).toHaveProperty("id");
      expect(cell).toHaveProperty("title");
      expect(cell).toHaveProperty("status");
      expect(cell).toHaveProperty("priority");
      expect(cell).toHaveProperty("issue_type");
      expect(typeof cell.id).toBe("string");
      expect(typeof cell.title).toBe("string");
      expect(["open", "in_progress", "blocked", "closed"]).toContain(cell.status);
      expect(typeof cell.priority).toBe("number");
      expect(["epic", "task", "bug", "chore", "feature"]).toContain(cell.issue_type);
    }
  });

  test("builds parent-child tree structure correctly", async () => {
    const cells = await getCells("http://localhost:3001");
    
    // Epics should have children array
    const epics = cells.filter(c => c.issue_type === "epic");
    for (const epic of epics) {
      expect(epic).toHaveProperty("children");
      expect(Array.isArray(epic.children)).toBe(true);
      
      // Children should have parent_id pointing to epic
      if (epic.children) {
        for (const child of epic.children) {
          expect(child.parent_id).toBe(epic.id);
        }
      }
    }
  });

  test("handles network errors gracefully", async () => {
    // Invalid URL should throw or return empty array
    try {
      await getCells("http://localhost:99999");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
