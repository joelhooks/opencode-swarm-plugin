/**
 * Main Swarm Dashboard application
 * 
 * Integrates three panes:
 * - AgentsPane: Active agents with status indicators
 * - EventsPane: Live SSE event stream with filtering
 * - CellsPane: Epic/subtask tree hierarchy
 */

import { AgentsPane, EventsPane, CellsPane } from "./components";
import { useSwarmEvents } from "./hooks";
import { Layout, Pane } from "./components/Layout";
import "./App.css";

function App() {
  // Connect to SSE stream - provides events for all panes
  const { state, events } = useSwarmEvents({
    url: "http://localhost:3333/sse",
  });
  
  const isConnected = state === "connected";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header with connection status */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              🐝 Swarm Dashboard
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Multi-agent coordination visualization
            </p>
          </div>
          
          {/* Connection status indicator */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected
                  ? "bg-green-500 animate-pulse"
                  : "bg-red-500"
              }`}
              title={isConnected ? "Connected" : "Disconnected"}
              data-testid="connection-status"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>
      </header>

      {/* 3-pane responsive grid */}
      <Layout>
        {/* Agents Pane */}
        <Pane>
          <AgentsPane events={events} state={state} />
        </Pane>

        {/* Events Pane */}
        <Pane>
          <EventsPane events={events} />
        </Pane>

        {/* Cells Pane */}
        <Pane>
          <CellsPane events={events} onCellSelect={(id) => console.log("Selected cell:", id)} />
        </Pane>
      </Layout>
    </div>
  );
}

export default App;
