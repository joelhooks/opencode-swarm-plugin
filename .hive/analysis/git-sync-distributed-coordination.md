# Git Sync and Distributed Coordination Analysis: steveyegge/beads

**Date:** 2025-12-15  
**Bead:** opencode-swarm-plugin-5cvcc.4  
**Epic:** opencode-swarm-plugin-5cvcc  
**Repository:** https://github.com/steveyegge/beads

## Executive Summary

steveyegge/beads achieves distributed sync via git using:
1. **JSONL append-only format** with incremental dirty tracking
2. **Field-level 3-way merge** algorithm (vendored from @neongreen)
3. **Content-based hash IDs** with collision-resistant adaptive scaling
4. **Event-driven FlushManager** for race-free export

**Key insight:** The system is NOT event sourcing. It's a SQLite-backed issue tracker that uses JSONL as a git-friendly serialization format. The "events" are issue snapshots, not domain events.

## 1. JSONL Format and Incremental Updates

### Schema

One JSON object per line. No structural envelope - just issue data:

```jsonl
{"id":"bd-0134cc5a","title":"Fix auto-import","description":"...","status":"closed","priority":0,"issue_type":"bug","created_at":"2025-10-27T21:48:57.733846-07:00","updated_at":"2025-10-30T17:12:58.21084-07:00","closed_at":"2025-10-27T22:26:40.627239-07:00"}
```

**Fields:**
- `id` - hash-based or hierarchical (e.g., `bd-0134cc5a` or `bd-af78.1`)
- Timestamps - RFC3339Nano for microsecond precision
- `dependencies[]` - inline array of dependency records
- Soft delete fields: `deleted_at`, `deleted_by`, `delete_reason`, `original_type`

**Not event sourcing:** Issues are full snapshots, not deltas. No event type field.

### Incremental Export

**Dirty tracking table:**
```sql
CREATE TABLE dirty_issues (
    issue_id TEXT PRIMARY KEY,
    marked_at TIMESTAMP,
    content_hash TEXT  -- for timestamp-only dedup
);
```

**Flow:**
1. Any mutation → `MarkIssueDirty(issueID)` inserts into `dirty_issues`
2. FlushManager debounces for 30 seconds (batches rapid changes)
3. Export: `GetDirtyIssues()` → fetch full issue records → merge into existing JSONL
4. `ClearDirtyIssuesByID()` removes exported issues from dirty table

**Incremental vs Full:**
- **Incremental:** Only exports dirty issues (default)
- **Full:** Re-exports all issues (after ID changes like `rename-prefix`)

**File integrity check (bd-160):**
- Stores SHA256 hash of entire JSONL file
- On flush, compares stored hash vs actual file hash
- If mismatch → forces full re-export (prevents staleness)

### Race Condition Fix (bd-52)

**Problem:** Original timer-based flush had shared mutable state:
- `isDirty` flag, `flushTimer`, `storeActive` all accessed concurrently
- Daemon, CLI, hooks, auto-flush timer → race conditions

**Solution:** Event-driven FlushManager with single-owner pattern:
```
┌─────────────────────────────────────┐
│        FlushManager                 │
│  (Single-Owner Pattern)             │
│                                     │
│  Channels (buffered):               │
│    - markDirtyCh                    │
│    - timerFiredCh                   │
│    - flushNowCh                     │
│    - shutdownCh                     │
│                                     │
│  State (owned by run() goroutine):  │
│    - isDirty                        │
│    - needsFullExport                │
│    - debounceTimer                  │
└─────────────────────────────────────┘
```

**Key:** All state owned by single background goroutine. External code communicates via buffered channels only.

## 2. Merge Conflict Resolution

### Automatic Merge Driver

**Configured during `bd init`:**
```bash
git config merge.beads.driver "bd merge %A %O %A %B"
git config merge.beads.name "bd JSONL merge driver"
echo ".beads/issues.jsonl merge=beads" >> .gitattributes
```

**Algorithm (from @neongreen/beads-merge, vendored into bd):**

```
merge3Way(base, left, right):
  1. Parse all 3 JSONL files
  2. Build maps keyed by (id, created_at, created_by)
  3. For each unique key:
     - Match issues across versions
     - Apply field-level merge rules
     - Output merged issue or conflict marker
```

### Merge Strategies

**Field-level rules:**
- **Timestamps:** Max value wins (e.g., `updated_at`)
- **Dependencies:** Union of both sides
- **Status/priority:** 3-way merge (check if both sides changed)
- **Text fields (title/description):** Side with latest `updated_at` wins

**Tombstone handling:**
- Tombstones always win over live issues (unless expired)
- Both tombstones → later `deleted_at` wins
- Expired tombstones → live issue resurrects

**Deletion semantics:**
- Implicit deletion (missing in one branch) wins over modification
- Explicit deletion (tombstone) always preserved

### Conflict Markers

When merge fails, output git-style markers:
```
<<<<<<< LEFT
{"id":"bd-123",...}
=======
{"id":"bd-123",...}
>>>>>>> RIGHT
```

Import detects these and auto-retries merge or prompts manual resolution.

## 3. Hash-Based ID Collision Handling

### ID Generation

**Content-based hash:**
```go
func GenerateHashID(prefix, title, description string, created time.Time, workspaceID string) string {
    h := sha256.New()
    h.Write([]byte(title))
    h.Write([]byte(description))
    h.Write([]byte(created.Format(time.RFC3339Nano)))
    h.Write([]byte(workspaceID))
    return hex.EncodeToString(h.Sum(nil)) // full 64-char hash
}
```

**Progressive collision handling:**
- Start with 6 chars: `bd-a3f2dd`
- On collision, try 7 chars: `bd-a3f2dda`
- On collision, try 8 chars: `bd-a3f2dda8`

**Nonce-based retry:**
1. Try base length with nonce 0-9 (10 attempts)
2. Try base+1 length with nonce 0-9 (10 attempts)
3. Try base+2 length with nonce 0-9 (10 attempts)
Total: 30 attempts before failure

### Collision Math

**Birthday paradox formula:**
```
P(collision) ≈ 1 - e^(-n²/2N)
```
Where N = 36^length (alphanumeric: [a-z0-9])

**Collision probability:**
| DB Size | 6-char | 7-char | 8-char |
|---------|--------|--------|--------|
| 1,000   | 0.02%  | 0.00%  | 0.00%  |
| 10,000  | 2.27%  | 0.06%  | 0.00%  |
| 100,000 | 99.99% | 6.24%  | 0.18%  |

**Adaptive scaling:** ID length auto-increases when collision prob > 25% (configurable).

### Why This Works for Distributed Sync

**Content-based IDs eliminate structural collisions:**
- Different issues → different content → different hashes
- Same issue imported twice → same hash → update, not duplicate
- Git merge sees different IDs → no conflict

**Only real conflicts:**
- Same issue modified on both branches (different timestamps/fields)
- This is a semantic conflict, not an ID collision
- Merge driver resolves with field-level rules

## 4. PGLite Event Store Compatibility

### Architectural Differences

**beads (current):**
```
SQLite (source of truth)
   ↓
dirty_issues table (tracks changes)
   ↓
FlushManager (debounces)
   ↓
JSONL export (snapshot of current state)
   ↓
git (sync medium)
```

**event sourcing (desired):**
```
PGLite event_log (append-only, source of truth)
   ↓
projections (materialized views)
   ↓
JSONL export (??)
   ↓
git (sync medium)
```

### Key Questions

**1. What would JSONL represent?**
- **Option A:** Export projection snapshots (issues table)
  - Pros: Same schema as beads, compatible merge driver
  - Cons: Loses event history, not true event sourcing
- **Option B:** Export raw events (event_log entries)
  - Pros: Full history preserved
  - Cons: Merge conflicts nightmarish (event reordering, causality)

**2. How to handle distributed event ordering?**
- **beads approach:** Timestamps + deterministic merge rules
- **event sourcing approach:** Vector clocks? Lamport timestamps? Hybrid logical clocks?
- **Problem:** Git merge doesn't understand causality

**3. Incremental export from event store?**
- **beads:** Dirty tracking table + `marked_at` timestamp
- **event sourcing:** Cursor/watermark on event_log?
  - `SELECT * FROM event_log WHERE id > last_exported_id`
  - Store cursor in metadata table

**4. Conflict resolution for events?**
- **beads:** Field-level 3-way merge on snapshots
- **event sourcing:** Can't merge events - must resolve at projection level
  - Export projections, not events?
  - Or accept out-of-order events and rebuild projections?

### Compatibility Assessment

**✅ Can work IF:**
- Export projection snapshots (issues table), not raw events
- Use same JSONL schema and merge driver as beads
- Event store is local-only (not synced via git)
- Git syncs projection state, not event log

**❌ Won't work IF:**
- Try to export raw events via JSONL
- Need distributed event log consensus (beyond git's capabilities)
- Require causal ordering guarantees across clones

### Recommended Hybrid Approach

**Local event sourcing + git snapshot sync:**

```
┌─────────────────────────────────────┐
│  PGLite Event Store (local only)   │
│  - Append-only event_log            │
│  - Projections (issues, comments)   │
└─────────────────────────────────────┘
           ↓ (project)
┌─────────────────────────────────────┐
│  Materialized Projections           │
│  - issues table (snapshot)          │
│  - dirty tracking (like beads)      │
└─────────────────────────────────────┘
           ↓ (export)
┌─────────────────────────────────────┐
│  JSONL Snapshot (git-friendly)      │
│  - Same schema as beads             │
│  - Uses beads merge driver          │
└─────────────────────────────────────┘
           ↓ (sync)
┌─────────────────────────────────────┐
│  Git (distributed sync)             │
│  - JSONL is source of truth for sync│
│  - Events stay local                │
└─────────────────────────────────────┘
```

**Benefits:**
- Local event sourcing for audit/replay
- Git-friendly snapshot sync (proven by beads)
- Compatible with existing beads merge driver
- No distributed event log complexity

**Trade-offs:**
- Event history not synced (acceptable?)
- Projection conflicts resolved at snapshot level
- Local events can diverge (rebuild from JSONL on import)

## 5. Implementation Recommendations

### For opencode-swarm-plugin

**If adopting beads' git sync:**

1. **Reuse merge driver:** Vendor `internal/merge/merge.go` (MIT licensed)
2. **JSONL schema:** Match beads format for compatibility
3. **Dirty tracking:** Implement in PGLite:
   ```sql
   CREATE TABLE dirty_issues (
       issue_id TEXT PRIMARY KEY,
       marked_at TIMESTAMP
   );
   ```
4. **FlushManager pattern:** Port event-driven flush logic (avoid bd-52 race)
5. **Content-based IDs:** Use hash IDs for collision resistance

**Key files to study:**
- `internal/merge/merge.go` - 3-way merge algorithm
- `cmd/bd/autoflush.go` - FlushManager architecture
- `internal/types/id_generator.go` - Hash ID generation
- `internal/storage/sqlite/dirty.go` - Dirty tracking
- `cmd/bd/export.go` - JSONL export logic

### Event Sourcing Adaptations

**Projection-based export:**
```typescript
// PGLite event store
const eventStore = new EventStore(pglite);

// Materialize issues projection
const issuesProjection = eventStore.project('issues', (event) => {
  // Reduce events into current state
});

// Export projection as JSONL
const dirtyIssues = await issuesProjection.getDirty();
const jsonl = dirtyIssues.map(issue => JSON.stringify(issue)).join('\n');
await fs.writeFile('.beads/issues.jsonl', jsonl);
```

**Import updates event log:**
```typescript
// Import JSONL snapshot
const issues = parseJSONL(await fs.readFile('.beads/issues.jsonl'));

// Generate "imported" events
for (const issue of issues) {
  await eventStore.append({
    type: 'IssueImported',
    payload: issue,
    metadata: { source: 'git-sync', timestamp: Date.now() }
  });
}

// Rebuild projections
await issuesProjection.rebuild();
```

**Dirty tracking via watermark:**
```typescript
// Track last exported event ID
const metadata = await db.execute(`
  SELECT last_exported_event_id FROM sync_metadata
`);

// Get events since last export
const dirtyEvents = await eventStore.query({
  afterId: metadata.last_exported_event_id
});

// Export affected issues (group by aggregate)
const affectedIssueIds = [...new Set(dirtyEvents.map(e => e.aggregateId))];
const issues = await issuesProjection.get(affectedIssueIds);
```

## 6. Conclusion

**beads' git sync is production-ready and battle-tested.** Key strengths:
- Simple JSONL format (git-friendly, human-readable)
- Robust merge driver (field-level 3-way merge)
- Collision-resistant hash IDs (adaptive scaling)
- Race-free flush coordination (event-driven FlushManager)

**For event sourcing compatibility:**
- Export projections, not events
- Treat JSONL as snapshot sync, event log as local audit trail
- Reuse beads merge driver and JSONL schema
- Accept event history doesn't sync (rebuild from JSONL on import)

**This is the right architecture.** Don't reinvent git sync - adopt beads' proven approach.

---

## References

- **Repository:** https://github.com/steveyegge/beads
- **Merge algorithm:** `internal/merge/merge.go` (MIT license, @neongreen)
- **Docs:** `docs/GIT_INTEGRATION.md`, `docs/INTERNALS.md`, `docs/COLLISION_MATH.md`
- **License:** MIT - vendoring permitted with attribution
