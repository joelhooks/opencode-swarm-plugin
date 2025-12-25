import { useState, useEffect } from 'react';
import { CellNode, type Cell } from './CellNode';
import { getCells } from '../lib/api';

interface CellsPaneProps {
  onCellSelect?: (cellId: string) => void;
  /** Base URL for API calls (default: http://localhost:3001) */
  apiBaseUrl?: string;
}

/**
 * Cells pane component displaying epic/subtask hierarchy
 * 
 * Features:
 * - Tree view with expandable epics
 * - Status icons (○ open, ◐ in_progress, ● closed, ⊘ blocked)
 * - Priority badges (P0-P3)
 * - Cell selection with highlight
 * - Real-time data from swarm-mail hive database
 * - Auto-refresh every 5 seconds
 * 
 * @param onCellSelect - Callback when a cell is selected
 * @param apiBaseUrl - Base URL for API calls
 */
export const CellsPane = ({ onCellSelect, apiBaseUrl = "http://localhost:3001" }: CellsPaneProps) => {
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch cells on mount and every 5 seconds
  useEffect(() => {
    const fetchCells = async () => {
      try {
        const fetchedCells = await getCells(apiBaseUrl);
        setCells(fetchedCells);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch cells");
      } finally {
        setLoading(false);
      }
    };

    fetchCells();
    const intervalId = setInterval(fetchCells, 5000); // Refresh every 5s

    return () => clearInterval(intervalId);
  }, [apiBaseUrl]);

  const handleSelect = (cellId: string) => {
    setSelectedCellId(cellId);
    if (onCellSelect) {
      onCellSelect(cellId);
    }
  };

  const openCellsCount = cells.reduce((count, cell) => {
    const cellCount = cell.status === 'open' ? 1 : 0;
    const childrenCount = cell.children?.filter(c => c.status === 'open').length || 0;
    return count + cellCount + childrenCount;
  }, 0);

  const totalCellsCount = cells.reduce((count, cell) => {
    return count + 1 + (cell.children?.length || 0);
  }, 0);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Cells
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {loading ? "Loading..." : `${totalCellsCount} cells · ${openCellsCount} open`}
        </p>
        {error && (
          <p className="text-sm text-red-500 mt-1">
            {error}
          </p>
        )}
      </div>

      {/* Tree view */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading cells...
          </div>
        ) : cells.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            No cells found
          </div>
        ) : (
          cells.map((cell) => (
            <CellNode
              key={cell.id}
              cell={cell}
              isSelected={selectedCellId === cell.id}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>

      {/* Footer with legend */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
          <span className="flex items-center gap-1">
            <span>○</span> Open
          </span>
          <span className="flex items-center gap-1">
            <span>◐</span> In Progress
          </span>
          <span className="flex items-center gap-1">
            <span>●</span> Closed
          </span>
          <span className="flex items-center gap-1">
            <span>⊘</span> Blocked
          </span>
        </div>
      </div>
    </div>
  );
};
