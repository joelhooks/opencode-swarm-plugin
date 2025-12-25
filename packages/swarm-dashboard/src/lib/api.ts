/**
 * API client for swarm data
 * Connects to swarm-mail SSE server REST endpoints
 */

export interface SwarmSummary {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "completed";
  workers: number;
  progress: number;
}

export interface SwarmStats {
  activeSwarms: number;
  totalWorkers: number;
  completedToday: number;
  successRate: string;
}

export interface Cell {
  id: string;
  title: string;
  status: "open" | "in_progress" | "blocked" | "closed";
  priority: number;
  issue_type: "epic" | "task" | "bug" | "chore" | "feature";
  parent_id?: string;
  children?: Cell[];
}

/**
 * Internal API response shape from hive database
 */
interface HiveCell {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  parent_id?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Fetch cells from swarm-mail hive database
 * 
 * Falls back to empty array if endpoint is not available (server not running or endpoint not implemented).
 * 
 * @param baseUrl - SSE server URL (default http://localhost:3001)
 * @returns Array of cells with parent-child tree structure
 */
export async function getCells(baseUrl = "http://localhost:3001"): Promise<Cell[]> {
  try {
    const response = await fetch(`${baseUrl}/cells`);
    
    if (!response.ok) {
      // Endpoint not found (404) or other error - return empty for now
      // This allows dashboard to work even if server doesn't have /cells endpoint yet
      if (response.status === 404) {
        console.warn("GET /cells endpoint not found - server may not be running or endpoint not implemented");
      } else {
        console.error(`Failed to fetch cells: ${response.statusText}`);
      }
      return [];
    }
    
    const data = await response.json() as { cells: HiveCell[] };
    const rawCells = data.cells || [];
    
    // Build map for tree construction
    const cellMap = new Map<string, Cell>();
    const rootCells: Cell[] = [];
    
    // First pass: create all cells
    for (const raw of rawCells) {
      const cell: Cell = {
        id: raw.id,
        title: raw.title,
        status: raw.status as Cell["status"],
        priority: raw.priority,
        issue_type: raw.issue_type as Cell["issue_type"],
        parent_id: raw.parent_id,
        children: [],
      };
      cellMap.set(cell.id, cell);
    }
    
    // Second pass: build tree structure
    for (const cell of cellMap.values()) {
      if (cell.parent_id) {
        // This is a child - add to parent's children array
        const parent = cellMap.get(cell.parent_id);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(cell);
        } else {
          // Parent not found - treat as root
          rootCells.push(cell);
        }
      } else {
        // This is a root cell
        rootCells.push(cell);
      }
    }
    
    // Sort cells: epics first, then by priority (lower = higher priority)
    const sortCells = (cells: Cell[]) => {
      cells.sort((a, b) => {
        // Epics first
        if (a.issue_type === "epic" && b.issue_type !== "epic") return -1;
        if (a.issue_type !== "epic" && b.issue_type === "epic") return 1;
        // Then by priority
        return a.priority - b.priority;
      });
      
      // Recursively sort children
      for (const cell of cells) {
        if (cell.children && cell.children.length > 0) {
          sortCells(cell.children);
        }
      }
    };
    
    sortCells(rootCells);
    
    return rootCells;
  } catch (error) {
    // Network error (server not running) or other fetch error
    if (error instanceof TypeError && error.message.includes("fetch")) {
      console.warn("Cannot connect to server - is it running at", baseUrl + "?");
    } else {
      console.error("Error fetching cells:", error);
    }
    return [];
  }
}

/**
 * Fetch active swarms
 */
export async function getActiveSwarms(): Promise<SwarmSummary[]> {
  // TODO: Query swarm-mail database
  return [
    {
      id: "epic-001",
      title: "Dashboard Implementation",
      status: "in_progress",
      workers: 3,
      progress: 65,
    },
  ];
}

/**
 * Fetch swarm statistics
 */
export async function getStats(): Promise<SwarmStats> {
  // TODO: Query swarm-mail database
  return {
    activeSwarms: 2,
    totalWorkers: 3,
    completedToday: 5,
    successRate: "94%",
  };
}

/**
 * Fetch swarm history
 */
export async function getSwarmHistory(): Promise<SwarmSummary[]> {
  // TODO: Query swarm-mail database
  return [];
}
