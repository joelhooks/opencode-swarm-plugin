# Dashboard Implementation Notes

## Architecture

The swarm dashboard uses a hybrid data fetching strategy:

### SSE Event Stream (Real-time Events)
- **Source**: `http://localhost:3001/events` (Durable Stream Server)
- **Components**: AgentsPane, EventsPane
- **Pattern**: Derive state from events using `useMemo()`
- **Data flow**: SSE → useSwarmEvents → getEventsByType → useMemo → UI
- **Why**: Event stream is immutable, rebuilding state on each event is safe

### REST API (Snapshot Data)
- **Source**: `http://localhost:3001/cells` (TODO: needs implementation)
- **Components**: CellsPane
- **Pattern**: `useEffect` + polling (5s interval)
- **Data flow**: Fetch → useState → UI (auto-refresh)
- **Why**: Hive database is authoritative source, poll for changes

## CellsPane Implementation

**Files Modified**:
- `src/lib/api.ts` - Added `getCells()` function with tree-building logic
- `src/components/CellsPane.tsx` - Replaced mock data with real API calls
- `src/lib/api.test.ts` - TDD tests for getCells
- `src/components/CellsPane.test.tsx` - Component tests

**Key Features**:
- Auto-refresh every 5 seconds
- Loading states (initial + refresh)
- Error handling with fallback to empty array
- Tree structure building (parent-child relationships)
- Cell count display (total + open count)

**Tree Building Algorithm**:
1. Fetch flat array from API
2. Build Map<cellId, Cell> for O(1) lookup
3. Second pass: attach children to parents or mark as root
4. Sort: epics first, then by priority
5. Recursively sort children

## AgentsPane (Already Working)

**Pattern**: Event-driven state derivation
- Listens to: agent_registered, agent_active, task_started, task_progress, task_completed
- Builds Map<agent_name, Agent> from events
- Determines active vs idle based on 5min threshold
- Sorts: active first, then by recency

**No changes needed** - this was already correctly implemented!

## Server Endpoint Required

The dashboard expects `GET /cells` endpoint at the SSE server.

**Expected response**:
```json
{
  "cells": [
    {
      "id": "cell-123",
      "title": "Example Cell",
      "status": "open",
      "priority": 1,
      "issue_type": "task",
      "parent_id": "epic-456"
    }
  ]
}
```

**Implementation location**: `swarm-mail/src/streams/durable-server.ts`

**Required logic**:
```typescript
// In fetch handler, add route:
if (url.pathname === "/cells") {
  const hive = await createHiveAdapter({ projectPath });
  const cells = await hive.queryCells({});
  return new Response(JSON.stringify({ cells }), {
    headers: { "Content-Type": "application/json" }
  });
}
```

## Running Tests

```bash
cd packages/swarm-dashboard
bun test src/lib/api.test.ts
bun test src/components/CellsPane.test.tsx
```

## Future Improvements

- [ ] WebSocket for cells updates instead of polling
- [ ] Add cells events to SSE stream (cell_created, cell_updated, cell_closed)
- [ ] Derive cells from events like AgentsPane (would need backend changes)
- [ ] Add filtering (by status, type, priority)
- [ ] Add search
