# Engineering Design Review: Event-Sourced Beads with Effect-TS

**Date:** 2025-12-15  
**Epic:** opencode-swarm-plugin-5cvcc  
**Status:** Research Complete  
**Authors:** Swarm Research Team (5 parallel agents)

---

## Executive Summary

**Question:** How crazy would it be to rebuild steveyegge/beads using Effect-TS durable streams and event sourcing?

**Answer:** Not crazy at all. **Recommended: Hybrid approach with 75% infrastructure reuse.**

| Aspect | Assessment |
|--------|------------|
| **Technical Feasibility** | ✅ High - swarm-mail provides solid foundation |
| **Effort Estimate** | 2-3 weeks for MVP, 4-6 weeks for full parity |
| **Risk Level** | Medium - git sync is proven, event sourcing adds complexity |
| **Recommendation** | **BUILD IT** - hybrid CRUD + event audit trail |

---

## 1. Problem Statement

### Current State

We have two separate systems:
1. **steveyegge/beads** (Go) - Battle-tested issue tracker with git sync
2. **swarm-mail** (TypeScript/Effect) - Event sourcing primitives for agent coordination

### Desired State

A unified TypeScript implementation that:
- Maintains beads' proven git sync mechanism
- Leverages swarm-mail's event sourcing infrastructure
- Integrates with our existing `beads_*` plugin tools
- Enables learning from bead lifecycle patterns

### Why Event Sourcing?

| Benefit | Value for Beads |
|---------|-----------------|
| **Full audit trail** | Debug distributed swarm operations |
| **Time travel** | Reconstruct historical state for analysis |
| **Event replay** | Rebuild projections after schema changes |
| **Learning data** | Events ARE training data for decomposition strategies |
| **Decoupled writes** | Append-only is simpler than CRUD |

---

## 2. Architecture Analysis

### 2.1 steveyegge/beads Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    steveyegge/beads                          │
├─────────────────────────────────────────────────────────────┤
│  CLI (bd)                                                    │
│    └── 50+ subcommands                                       │
├─────────────────────────────────────────────────────────────┤
│  RPC Layer                                                   │
│    └── Daemon with client/server architecture                │
├─────────────────────────────────────────────────────────────┤
│  Storage (SQLite)                                            │
│    ├── issues table (CRUD, mutable)                          │
│    ├── dependencies table (relational)                       │
│    ├── labels table                                          │
│    ├── comments table (append-only)                          │
│    ├── events table (AUDIT TRAIL ONLY)                       │
│    ├── dirty_issues table (change tracking)                  │
│    └── blocked_issues_cache (precomputed)                    │
├─────────────────────────────────────────────────────────────┤
│  Git Sync                                                    │
│    ├── JSONL export (snapshot, not events)                   │
│    ├── 3-way merge driver (field-level)                      │
│    └── Hash-based IDs (collision-resistant)                  │
└─────────────────────────────────────────────────────────────┘
```

**Key Insight:** beads is **NOT event-sourced**. It's hybrid CRUD + event audit trail.
- Events are for audit only, not replayed for state reconstruction
- Current state lives in mutable `issues` table
- JSONL exports snapshots, not events

### 2.2 swarm-mail Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      swarm-mail                              │
├─────────────────────────────────────────────────────────────┤
│  TIER 3: COORDINATION                                        │
│    └── ask<Req, Res>() - Request/Response                    │
├─────────────────────────────────────────────────────────────┤
│  TIER 2: PATTERNS                                            │
│    ├── DurableMailbox - Actor inbox                          │
│    └── DurableLock - CAS-based mutex                         │
├─────────────────────────────────────────────────────────────┤
│  TIER 1: PRIMITIVES                                          │
│    ├── DurableCursor - Checkpointed stream reader            │
│    └── DurableDeferred - Distributed promise                 │
├─────────────────────────────────────────────────────────────┤
│  STORAGE                                                     │
│    ├── PGLite (embedded Postgres)                            │
│    ├── Event store (append-only)                             │
│    ├── Projections (materialized views)                      │
│    └── Migrations                                            │
└─────────────────────────────────────────────────────────────┘
```

**Key Capabilities:**
- Append-only event log with sequence numbers
- Inline projection updates (same transaction)
- Batched replay for large logs
- Database adapter for DI/testing

### 2.3 Proposed Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Event-Sourced Beads                          │
├─────────────────────────────────────────────────────────────┤
│  Plugin Tools (beads_*)                                      │
│    └── Existing API preserved                                │
├─────────────────────────────────────────────────────────────┤
│  Event Store (swarm-mail)                                    │
│    ├── BeadEvent types (20 event types)                      │
│    ├── Append-only log (local audit trail)                   │
│    └── NOT synced via git                                    │
├─────────────────────────────────────────────────────────────┤
│  Projections (swarm-mail pattern)                            │
│    ├── beads table (current state)                           │
│    ├── bead_dependencies table                               │
│    ├── bead_labels table                                     │
│    ├── bead_comments table                                   │
│    ├── blocked_beads_cache (derived)                         │
│    └── dirty_beads table (change tracking)                   │
├─────────────────────────────────────────────────────────────┤
│  Git Sync (beads pattern)                                    │
│    ├── JSONL export FROM PROJECTIONS                         │
│    ├── Reuse beads merge driver (MIT)                        │
│    └── Hash-based IDs                                        │
├─────────────────────────────────────────────────────────────┤
│  Effect-TS Primitives                                        │
│    ├── DurableCursor - Event replay                          │
│    └── DurableLock - Concurrent update safety                │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

1. **Events stay local** - Not synced via git (too complex)
2. **JSONL exports projections** - Same format as beads for merge driver compatibility
3. **Hybrid model** - Events for audit/learning, projections for queries
4. **Reuse beads merge driver** - MIT licensed, battle-tested

---

## 3. Component Reuse Assessment

### 3.1 From swarm-mail (75% reusable)

| Component | Reuse | Notes |
|-----------|-------|-------|
| Event Store | 80% | Add bead event types |
| Projection Pattern | 95% | Add new `updateMaterializedViews` cases |
| DatabaseAdapter | 100% | Perfect as-is |
| DurableCursor | 90% | For replay and incremental sync |
| DurableLock | 90% | **CRITICAL** for concurrent updates |
| DurableMailbox | 30% | Over-engineered for CRUD |
| DurableDeferred | 20% | Not needed |
| Migrations | 100% | Add bead tables |
| LRU Cache | 100% | Multi-repo support |

### 3.2 From steveyegge/beads (vendor/port)

| Component | Action | License |
|-----------|--------|---------|
| Merge Driver | Vendor | MIT (@neongreen) |
| Hash ID Generator | Port to TS | MIT |
| JSONL Schema | Adopt | MIT |
| FlushManager Pattern | Port to TS | MIT |
| Blocked Cache Logic | Port to TS | MIT |
| Ready Work Query | Port to TS | MIT |

### 3.3 New Development Required

| Component | Effort | Priority |
|-----------|--------|----------|
| Bead event types | ✅ Done | - |
| Bead projections | 2-3 days | P0 |
| Dirty tracking | 1 day | P0 |
| JSONL export | 2 days | P0 |
| JSONL import | 2 days | P0 |
| Merge driver integration | 1 day | P0 |
| Ready work query | 1 day | P1 |
| Blocked cache | 1 day | P1 |
| Dependency cycle detection | 1 day | P1 |
| Plugin tool migration | 3-5 days | P1 |

---

## 4. Event Schema Design

### 4.1 Event Types (20 total)

**Already implemented** in `src/schemas/bead-events.ts`:

```typescript
type BeadEvent =
  // Lifecycle (6)
  | BeadCreatedEvent
  | BeadUpdatedEvent
  | BeadStatusChangedEvent
  | BeadClosedEvent
  | BeadReopenedEvent
  | BeadDeletedEvent
  
  // Dependencies (2)
  | BeadDependencyAddedEvent
  | BeadDependencyRemovedEvent
  
  // Labels (2)
  | BeadLabelAddedEvent
  | BeadLabelRemovedEvent
  
  // Comments (3)
  | BeadCommentAddedEvent
  | BeadCommentUpdatedEvent
  | BeadCommentDeletedEvent
  
  // Epic (3)
  | BeadEpicChildAddedEvent
  | BeadEpicChildRemovedEvent
  | BeadEpicClosureEligibleEvent
  
  // Swarm Integration (2)
  | BeadAssignedEvent
  | BeadWorkStartedEvent
  
  // Maintenance (1)
  | BeadCompactedEvent
```

### 4.2 Projection Schema

```sql
-- Migration v5: Bead projections
CREATE TABLE beads (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'feature', 'task', 'epic', 'chore')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'blocked', 'closed')),
  title TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  parent_id TEXT REFERENCES beads(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  closed_at BIGINT,
  closed_reason TEXT,
  created_by TEXT,
  CONSTRAINT valid_parent CHECK (parent_id IS NULL OR parent_id != id)
);

CREATE INDEX idx_beads_project ON beads(project_key);
CREATE INDEX idx_beads_status ON beads(status) WHERE status != 'closed';
CREATE INDEX idx_beads_parent ON beads(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_beads_priority ON beads(priority, created_at);

CREATE TABLE bead_dependencies (
  bead_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('blocks', 'blocked-by', 'related', 'discovered-from')),
  created_at BIGINT NOT NULL,
  created_by TEXT,
  PRIMARY KEY (bead_id, depends_on_id, relationship)
);

CREATE TABLE bead_labels (
  bead_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (bead_id, label)
);

CREATE TABLE bead_comments (
  id SERIAL PRIMARY KEY,
  bead_id TEXT NOT NULL REFERENCES beads(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  parent_id INTEGER REFERENCES bead_comments(id),
  created_at BIGINT NOT NULL,
  updated_at BIGINT
);

CREATE INDEX idx_bead_comments_bead ON bead_comments(bead_id, created_at);

-- Derived views
CREATE TABLE blocked_beads_cache (
  bead_id TEXT PRIMARY KEY REFERENCES beads(id) ON DELETE CASCADE,
  blocker_ids TEXT[] NOT NULL,  -- Array of blocking bead IDs
  updated_at BIGINT NOT NULL
);

CREATE TABLE dirty_beads (
  bead_id TEXT PRIMARY KEY,
  marked_at BIGINT NOT NULL
);
```

---

## 5. Git Sync Strategy

### 5.1 Export Flow

```
Event Appended
    ↓
updateMaterializedViews() [inline, same tx]
    ↓
Mark bead dirty (INSERT INTO dirty_beads)
    ↓
FlushManager debounce (30s)
    ↓
Export dirty beads to JSONL
    ↓
Clear dirty flags
    ↓
Git hooks (optional auto-commit)
```

### 5.2 Import Flow

```
Git pull / merge
    ↓
Parse JSONL
    ↓
For each issue:
  - Hash match? Skip (no change)
  - ID exists? Update projection
  - New ID? Insert projection
    ↓
Emit "bead_imported" events (for audit)
    ↓
Rebuild blocked_beads_cache
```

### 5.3 Merge Driver Integration

```bash
# .gitattributes
.beads/issues.jsonl merge=beads

# git config (set during init)
git config merge.beads.driver "npx swarm-beads merge %A %O %A %B"
git config merge.beads.name "swarm-beads JSONL merge driver"
```

**Merge driver implementation:** Port beads' Go merge driver to TypeScript or shell out to `bd merge` if installed.

---

## 6. Risk Assessment

### 6.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Event store performance at scale | Low | Medium | Batched replay, indexed queries |
| Merge conflicts in JSONL | Low | Low | Proven merge driver, hash IDs |
| Projection drift from events | Medium | High | Checksums, replay on mismatch |
| Effect-TS learning curve | Medium | Low | Good docs, existing patterns |
| PGLite limitations | Low | Medium | Adapter pattern allows swap |

### 6.2 Migration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing beads_* tools | Medium | High | Adapter layer, gradual migration |
| Data loss during migration | Low | Critical | Backup, dry-run mode |
| Git history pollution | Low | Low | Single migration commit |

### 6.3 Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Concurrent agent conflicts | Medium | Medium | DurableLock, file reservations |
| Event log growth | Low | Low | Compaction, archival |
| Debug complexity | Medium | Medium | Event replay, audit trail |

---

## 7. Implementation Plan

### Phase 1: Foundation (Week 1)

- [ ] Add bead projections migration (v5)
- [ ] Implement `updateMaterializedViews` for bead events
- [ ] Port dirty tracking from beads
- [ ] Basic JSONL export from projections

### Phase 2: Git Sync (Week 2)

- [ ] Port/vendor merge driver
- [ ] JSONL import with hash dedup
- [ ] FlushManager pattern (debounced export)
- [ ] Git hooks integration

### Phase 3: Query Layer (Week 3)

- [ ] Ready work query with blocked cache
- [ ] Dependency tree traversal
- [ ] Cycle detection
- [ ] Epic closure eligibility

### Phase 4: Plugin Migration (Week 4)

- [ ] Migrate beads_* tools to new backend
- [ ] Backward compatibility layer
- [ ] Integration tests
- [ ] Documentation

### Phase 5: Polish (Week 5-6)

- [ ] Performance optimization
- [ ] Error handling
- [ ] Monitoring/observability
- [ ] Migration tooling for existing .beads data

---

## 8. Alternatives Considered

### 8.1 Pure Event Sourcing (Rejected)

**Approach:** Export raw events to JSONL, replay on import.

**Why rejected:**
- Merge conflicts become nightmarish (event reordering)
- Git doesn't understand causality
- Beads' proven approach works better

### 8.2 Keep Separate Systems (Rejected)

**Approach:** Don't integrate, keep beads Go CLI separate.

**Why rejected:**
- Duplicated infrastructure
- No learning from bead patterns
- Context switching between tools

### 8.3 Fork steveyegge/beads (Considered)

**Approach:** Fork and modify Go implementation.

**Why not chosen:**
- Different language (Go vs TypeScript)
- Harder to integrate with swarm-mail
- Maintenance burden of fork

### 8.4 Hybrid Approach (Selected)

**Approach:** TypeScript rewrite using swarm-mail primitives, beads patterns.

**Why selected:**
- Best of both worlds
- 75% infrastructure reuse
- Native integration with swarm-mail
- Learning from event patterns

---

## 9. Success Criteria

### MVP (4 weeks)

- [ ] All beads_* plugin tools work with new backend
- [ ] Git sync works (export, import, merge)
- [ ] Ready work and blocked queries functional
- [ ] No data loss from existing .beads directories

### Full Parity (6 weeks)

- [ ] All bd CLI features available
- [ ] Performance within 2x of Go implementation
- [ ] Event-based learning integration
- [ ] Multi-repo support

### Stretch Goals

- [ ] Real-time sync via Agent Mail
- [ ] Web UI for bead visualization
- [ ] AI-powered bead suggestions

---

## 10. Recommendation

**BUILD IT.**

The hybrid approach is sound:
1. **Low risk** - Proven patterns from both systems
2. **High value** - Unified infrastructure, learning integration
3. **Reasonable effort** - 4-6 weeks with 75% reuse
4. **Clear path** - Phased implementation, backward compatible

### Next Steps

1. **Approve this EDR** - Stakeholder sign-off
2. **Create implementation epic** - Break into beads (meta!)
3. **Start Phase 1** - Foundation work
4. **Weekly check-ins** - Track progress, adjust scope

---

## Appendix A: Research Artifacts

| Document | Location |
|----------|----------|
| Git Sync Analysis | `.beads/analysis/git-sync-distributed-coordination.md` |
| Bead Event Schemas | `packages/opencode-swarm-plugin/src/schemas/bead-events.ts` |
| Bead Event Tests | `packages/opencode-swarm-plugin/src/schemas/bead-events.test.ts` |

## Appendix B: Reference Implementation

### steveyegge/beads Key Files

| File | Purpose |
|------|---------|
| `internal/storage/storage.go` | Storage interface |
| `internal/storage/sqlite/*.go` | SQLite implementation |
| `internal/merge/merge.go` | 3-way merge driver |
| `internal/types/types.go` | Core types |
| `cmd/bd/autoflush.go` | FlushManager |

### swarm-mail Key Files

| File | Purpose |
|------|---------|
| `src/streams/store.ts` | Event store |
| `src/streams/events.ts` | Event types |
| `src/streams/projections.ts` | Materialized views |
| `src/streams/effect/*.ts` | Durable primitives |

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **Bead** | An issue/task in the tracker |
| **Epic** | A bead with child beads |
| **Projection** | Materialized view derived from events |
| **JSONL** | JSON Lines format (one object per line) |
| **Dirty tracking** | Recording which beads changed since last export |
| **Hash ID** | Content-based identifier (e.g., `bd-a3f2dd`) |
| **DurableCursor** | Checkpointed event stream reader |
| **DurableLock** | Distributed mutex via CAS |

---

*This EDR was generated by a swarm of 5 parallel research agents, synthesized by the coordinator.*
