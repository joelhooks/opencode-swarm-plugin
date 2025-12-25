/**
 * CellsPane component tests
 * 
 * Tests real-time cell fetching and display
 */

import { describe, test, expect, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { CellsPane } from "./CellsPane";
import type { Cell } from "./CellNode";

// Mock getCells to avoid actual fetch calls
const mockGetCells = mock(async () => {
  const mockCells: Cell[] = [
    {
      id: "epic-1",
      title: "Test Epic",
      status: "in_progress",
      priority: 0,
      issue_type: "epic",
      children: [
        {
          id: "task-1",
          title: "Test Task",
          status: "open",
          priority: 1,
          issue_type: "task",
          parent_id: "epic-1",
        },
      ],
    },
  ];
  return mockCells;
});

mock.module("../lib/api", () => ({
  getCells: mockGetCells,
}));

describe("CellsPane", () => {
  test("displays loading state initially", () => {
    render(<CellsPane />);
    expect(screen.getByText("Loading...")).toBeDefined();
  });

  test("displays cells after loading", async () => {
    render(<CellsPane />);
    
    await waitFor(() => {
      expect(screen.getByText("Test Epic")).toBeDefined();
      expect(screen.getByText("Test Task")).toBeDefined();
    });
  });

  test("displays cell count in header", async () => {
    render(<CellsPane />);
    
    await waitFor(() => {
      // Should show "2 cells · 1 open" (epic + task, task is open)
      const header = screen.getByText(/2 cells/);
      expect(header).toBeDefined();
      expect(screen.getByText(/1 open/)).toBeDefined();
    });
  });

  test("displays empty state when no cells", async () => {
    mockGetCells.mockResolvedValueOnce([]);
    
    render(<CellsPane />);
    
    await waitFor(() => {
      expect(screen.getByText("No cells found")).toBeDefined();
    });
  });

  test("handles API errors gracefully", async () => {
    mockGetCells.mockRejectedValueOnce(new Error("Network error"));
    
    render(<CellsPane />);
    
    await waitFor(() => {
      expect(screen.getByText(/Network error/i)).toBeDefined();
    });
  });
});
