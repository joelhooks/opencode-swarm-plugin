# Drizzle Migration Type Error Fixes - Status

## Agent: QuickForest
## Cell: opencode-swarm-monorepo-lf2p4u-mjdk1vfllm3
## Status: BLOCKED (80% complete)

## Completed Fixes

### 1. Message Importance Nullability (✅ DONE)
**Files:** `packages/swarm-mail/src/streams/projections-drizzle.ts`

**Issue:** Schema allows `null` for `importance`, but Message type expects `string`.

**Fix:** Added nullish coalescing to default to "normal":
```typescript
importance: row.importance ?? "normal"
```

**Locations:**
- Line 197 (getInboxDrizzle)
- Line 233 (getMessageDrizzle)
- Line 264 (getThreadMessagesDrizzle)

### 2. Boolean Storage (✅ DONE)
**Files:** `packages/swarm-mail/src/streams/store-drizzle.ts`

**Issue:** Schema uses `integer({ mode: "boolean" })` but code was manually converting to 1/0.

**Fix:** Pass booleans directly, let Drizzle handle conversion:
```typescript
// BEFORE
ack_required: event.ack_required ? 1 : 0

// AFTER  
ack_required: event.ack_required
```

**Locations:**
- Line 322 (handleMessageSentDrizzle)
- Line 373 (handleFileReservedDrizzle) 
- Lines 476-477 (handleHumanFeedbackDrizzle)

### 3. Dynamic Query Builders (✅ DONE)
**Files:**
- `packages/swarm-mail/src/streams/store-drizzle.ts`
- `packages/swarm-mail/src/streams/projections-drizzle.ts`

**Issue:** TypeScript doesn't narrow query builder type when limit/offset are conditionally applied.

**Fix:** Added `.$dynamic()` to enable type-safe conditional chaining:
```typescript
let query = db.select().from(table).$dynamic();
if (options?.limit) query = query.limit(options.limit);
```

**Locations:**
- store-drizzle.ts line 120
- projections-drizzle.ts line 443

### 4. Drizzle Schema Property Names (✅ DONE)
**File:** `packages/swarm-mail/src/db/schema/hive.ts`

**Issue:** Schema used camelCase TypeScript properties (e.g., `projectKey`) but Cell interface expects snake_case.

**Fix:** Changed all property names to snake_case to match interface:
```typescript
// BEFORE
projectKey: text("project_key").notNull()

// AFTER
project_key: text("project_key").notNull()
```

**Affected tables:**
- beads (16 properties)
- cellEvents (5 properties)
- beadLabels (3 properties)
- beadComments (7 properties)
- beadDependencies (5 properties)
- blockedBeadsCache (3 properties)
- dirtyBeads (2 properties)
- schemaVersion (2 properties)

## Remaining Fixes (BLOCKED - Need File Access)

### 5. Update Query Code to Use Snake_Case (❌ BLOCKED)
**Files:** 
- `packages/swarm-mail/src/hive/projections.ts` (reserved by SilverDusk)
- `packages/swarm-mail/src/hive/queries.ts` (reserved by SilverDusk)

**Issue:** Code still references old camelCase properties after schema update.

**Fix:** Mechanical find-replace:
```
beads.projectKey → beads.project_key
beads.parentId → beads.parent_id
beads.createdAt → beads.created_at
beads.updatedAt → beads.updated_at
beads.deletedAt → beads.deleted_at
beads.closedAt → beads.closed_at
beadDependencies.cellId → beadDependencies.cell_id
beadDependencies.dependsOnId → beadDependencies.depends_on_id
beadLabels.cellId → beadLabels.cell_id
beadComments.cellId → beadComments.cell_id
beadComments.parentId → beadComments.parent_id
beadComments.updatedAt → beadComments.updated_at
```

Also add `.$dynamic()` to queries with conditional limit/offset (projections.ts lines 465-477).

### 6. Remove Duplicate Export (❌ BLOCKED)
**File:** `packages/swarm-mail/src/streams/index.ts` (reserved by SwiftMoon)

**Issue:** Both `projections.ts` and `projections-drizzle.ts` export types with same names (Agent, Message, etc.).

**Fix:** Remove line 597:
```typescript
// DELETE THIS LINE
export * from "./projections-drizzle";
```

The Drizzle implementations are internal - only PGlite projections should be re-exported.

## Verification

After completing remaining fixes, run:
```bash
bun turbo typecheck --filter=swarm-mail
```

Expected: 0 errors

## Notes

- SilverDusk and SwiftMoon agents appear to be orphaned (no active processes found)
- Reservations can be force-released to unblock
- All remaining work is mechanical find-replace (est. 10 minutes)
