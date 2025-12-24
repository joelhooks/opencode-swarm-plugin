# Session Message Scanning - Implementation Summary

## What Was Done

Added session message scanning to the compaction hook to detect swarm activity by examining actual tool calls in the conversation, not just `.hive/` state.

## Files Modified

### `packages/opencode-swarm-plugin/examples/plugin-wrapper-template.ts`

**1. Module-level SDK client** (line 73)
```typescript
let sdkClient: any = null;
```

**2. SDK client initialization** (line 1662)
```typescript
sdkClient = input.client;
```

**3. SessionScanResult interface** (lines 1334-1343)
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

**4. scanSessionMessages() function** (lines 1351-1491)
- Fetches session messages via SDK client
- Scans message parts for tool calls
- Classifies tools by confidence level
- Returns scan result with detection status

**5. Compaction hook integration** (lines 1922-2003)
- Step 1: Scan session messages
- Step 2: Detect from hive cells (existing)
- Step 3: Merge results and boost confidence

### New Files

**`SESSION_MESSAGE_SCANNING.md`**
- Complete documentation
- Tool classification reference
- Example scenarios
- Future enhancement ideas

## Key Features

### Tool Classification

**High Confidence** (definite swarm):
- `hive_create_epic`
- `swarm_decompose`
- `swarm_spawn_subtask`
- `swarm_complete`
- `swarmmail_init`
- `swarmmail_reserve`

**Medium Confidence** (active swarm):
- `hive_start`, `hive_close`
- `swarm_status`, `swarm_progress`
- `swarmmail_send`

**Low Confidence** (possible swarm):
- `hive_create`
- `hive_query`

### Confidence Boosting Logic

```
Session has HIGH-confidence tools + Hive is none/low → Boost to HIGH
Session has ANY swarm tools + Hive is none → Boost to MEDIUM
Session has ANY swarm tools + Hive is low → Boost to MEDIUM
```

### Observability

New log events in `~/.config/swarm-tools/logs/compaction.log`:
- `session_scan_start` - Starting scan
- `session_scan_messages_fetched` - Message count
- `session_scan_tool_found` - Each swarm tool detected
- `session_scan_complete` - Summary with stats
- `confidence_boost_from_session_scan` - When boosting confidence
- `final_swarm_detection` - Combined result

## Testing

### Type Safety
```bash
bun run typecheck  # ✓ 0 errors
```

### Logic Tests
All 5 test cases passed:
- Empty messages → no detection
- High-confidence tool → detected with high confidence
- Low-confidence tool → detected without high confidence
- Non-swarm tool → no detection
- Multiple high-confidence tools → detected with count

### Edge Cases Handled
- No SDK client available
- No messages in session
- Malformed message parts
- API errors during fetch

## Example Scenario

**User initiates swarm decomposition:**
```
User: "Decompose this task for parallel agents"
Agent: swarm_decompose(task="Add auth flow")
[Compaction triggered before hive_create_epic]
```

**OLD BEHAVIOR:**
- detectSwarm() finds no cells in .hive/
- confidence: "none"
- No swarm context injected
- Resumed session loses swarm state

**NEW BEHAVIOR:**
- scanSessionMessages() finds swarm_decompose call
- swarmDetected: true, high-confidence
- detectSwarm() finds no cells (confidence: "none")
- Confidence boosted: none → HIGH
- Swarm context injected
- Resumed session continues coordination

## Next Steps

1. **Deploy**: Users run `swarm setup --reinstall`
2. **Monitor**: Watch `compaction.log` for new events
3. **Test**: Trigger compaction during swarm decomposition phase
4. **Iterate**: Consider enhancements (see SESSION_MESSAGE_SCANNING.md)

## Future Enhancements

1. **Tool output inspection** - Parse output for error patterns
2. **Agent name extraction** - Identify active agents from args
3. **Epic ID extraction** - Pull epic ID from tool args
4. **Time-based filtering** - Only scan recent messages
5. **Message part analysis** - Count assistant vs tool vs user parts

## Implementation Philosophy

**Err on the side of continuation.**

False positive = extra context (low cost, high safety)
False negative = lost swarm (high cost, coordination failure)

The session message scan catches early swarm activity (planning, decomposition) before cells are materialized in `.hive/`. This prevents losing swarm state during compaction in the critical bootstrapping phase.
