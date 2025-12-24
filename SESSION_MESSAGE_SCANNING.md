# Session Message Scanning for Swarm Detection

## What Was Added

Added session message scanning to the compaction hook in `plugin-wrapper-template.ts` to detect swarm activity by examining actual tool calls in the conversation, not just `.hive/` state.

## Key Components

### 1. `scanSessionMessages(sessionID: string)` Function

**Location:** Lines 1331-1491

Scans session messages using the SDK client for swarm-related tool calls.

**Returns:**
```typescript
interface SessionScanResult {
  messageCount: number;
  toolCalls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    output?: string;
  }>;
  swarmDetected: boolean;
  reasons: string[];
}
```

**Tool Classification:**
- **High confidence**: `hive_create_epic`, `swarm_decompose`, `swarm_spawn_subtask`, `swarm_complete`, `swarmmail_init`, `swarmmail_reserve`
- **Medium confidence**: `hive_start`, `hive_close`, `swarm_status`, `swarm_progress`, `swarmmail_send`
- **Low confidence**: `hive_create`, `hive_query`

**Detection Logic:**
- If ANY high-confidence tools found → `swarmDetected: true` + reason listing tools
- If ANY swarm tools found → `swarmDetected: true` + count reason
- Otherwise → `swarmDetected: false`

### 2. Integration in Compaction Hook

**Location:** Lines 1922-2003

**Flow:**
1. **STEP 1**: Scan session messages (new)
2. **STEP 2**: Detect from hive cells (existing)
3. **STEP 3**: Merge results and boost confidence

**Confidence Boosting:**
- Session has high-confidence tools + hive confidence is `none` or `low` → boost to `high`
- Session has any swarm tools + hive confidence is `none` → boost to `medium`
- Session has any swarm tools + hive confidence is `low` → boost to `medium`

### 3. Logging

**New log events:**
- `session_scan_start` - Starting scan
- `session_scan_messages_fetched` - Message count fetched
- `session_scan_tool_found` - Each swarm tool found
- `session_scan_complete` - Summary with message count, tool calls, unique tools
- `session_scan_exception` - Error during scan
- `confidence_boost_from_session_scan` - When session scan boosts hive detection
- `final_swarm_detection` - Combined result after merging

## Why This Matters

**Before:**
- Only checked `.hive/issues.jsonl` for cells
- No visibility into actual conversation activity
- Couldn't detect swarm if cells not synced yet
- No message count or tool call tracking

**After:**
- Scans actual session messages for swarm tool usage
- Detects swarm activity even if `.hive/` is empty
- Boosts confidence when seeing high-signal tools like `swarm_decompose`
- Full observability: message count, tool calls, unique tools used

## Example Scenarios

### Scenario 1: Swarm Decomposition Without Cells Yet
```
Session: User calls swarm_decompose, agent generates plan
Hive: No cells created yet (agent hasn't called hive_create_epic)

Old behavior: confidence: "none" (no cells = no swarm)
New behavior: confidence: "high" (swarm_decompose is high-confidence signal)
```

### Scenario 2: Swarm Mid-Flight
```
Session: Multiple swarm_spawn_subtask, swarm_progress calls
Hive: 2 in_progress cells

Old behavior: confidence: "high" (from in_progress cells)
New behavior: confidence: "high" (reinforced by 5 high-confidence tool calls)
Detection reasons include BOTH hive state AND message activity
```

### Scenario 3: Cells But No Recent Activity
```
Session: No swarm tools used
Hive: 3 cells created 2 days ago, all closed

Old behavior: confidence: "low" (cells exist but old)
New behavior: confidence: "low" (no session activity to boost)
```

## Next Steps for Users

After updating the plugin, users need to run:
```bash
swarm setup --reinstall
```

This copies the updated plugin wrapper to `.opencode/plugins/`.

## Testing

Type check passes:
```bash
bun run typecheck  # ✓ No errors
```

## Future Enhancements

1. **Tool output inspection** - Parse output for error patterns
2. **Agent name extraction** - Identify which agents are active
3. **Epic ID extraction** - Pull epic ID from tool args for context
4. **Time-based filtering** - Only scan recent messages (last hour?)
5. **Message part type analysis** - Count assistant vs tool vs user parts

## Logs Location

All compaction events are logged to:
```
~/.config/swarm-tools/logs/compaction.log
```

Use `swarm log compaction --tail` to watch in real-time.
