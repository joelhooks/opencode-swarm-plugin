# Swarm Database Analysis

**Database:** `~/.config/swarm-tools/swarm.db`  
**Logs:** `~/.config/swarm-tools/logs/compaction.log`  
**Analysis Date:** 2026-01-07  
**Analyst:** DarkDusk (swarm worker)  
**Cell:** opencode-swarm-monorepo-lf2p4u-mk471w7vzon

---

## Executive Summary

The swarm database contains **1,821 events** across **81 unique projects**, with strong data coverage for coordinator decisions, review outcomes, and memory storage. The system is actively used with **1,668 active beads** and **8,953 memories** indexed. Compaction logging shows stability with isolated errors related to model provider configuration.

**Key Findings:**
- Event sourcing is working well - good distribution across event types
- Review system has 64% approval rate (38 approved vs 18 needs_changes)
- Compaction errors are configuration-related, not architectural
- Memory system heavily used (6,659 opencode-swarm memories, 2,276 default)
- Decision tracing provides good observability (132 traces, 62 reviews, 62 spawns)

---

## Database Schema Documentation

### Core Event Sourcing

#### `events` table
**Purpose:** Append-only event log for all swarm activities

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-incrementing event ID |
| `type` | TEXT | Event type (see Event Types section) |
| `project_key` | TEXT | Absolute path to project |
| `timestamp` | INTEGER | Unix timestamp (milliseconds) |
| `sequence` | INTEGER | Generated from ID for ordering |
| `data` | TEXT | JSON payload with event-specific data |
| `created_at` | TEXT | ISO8601 timestamp |

**Indexes:**
- `idx_events_project_key` - Fast project filtering
- `idx_events_type` - Event type queries
- `idx_events_timestamp` - Time-based queries
- `idx_events_project_type` - Combined project + type lookup

---

### Multi-Agent Coordination

#### `agents` table
**Purpose:** Track registered agents and their activity

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Agent registration ID |
| `project_key` | TEXT | Project context |
| `name` | TEXT | Agent name (e.g., "DarkDusk", "coordinator") |
| `program` | TEXT | Runtime (default: 'opencode') |
| `model` | TEXT | LLM model identifier |
| `task_description` | TEXT | Current task |
| `registered_at` | INTEGER | Registration timestamp |
| `last_active_at` | INTEGER | Last activity timestamp |

**Unique constraint:** `(project_key, name)` - one registration per agent per project

**Current Stats:**
- **Total registrations:** 109
- **Unique agent names:** 93
- **Most active:** coordinator (3), TestWorker (3), WiseWind (2)

#### `messages` table
**Purpose:** Inter-agent messaging (swarm mail)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Message ID |
| `project_key` | TEXT | Project context |
| `from_agent` | TEXT | Sender agent name |
| `subject` | TEXT | Message subject |
| `body` | TEXT | Message content |
| `thread_id` | TEXT | Thread identifier (typically epic/bead ID) |
| `importance` | TEXT | normal/high/urgent |
| `ack_required` | INTEGER | Boolean flag for acknowledgment |
| `created_at` | INTEGER | Send timestamp |

**Indexes:**
- `idx_messages_project` - Project filtering
- `idx_messages_thread` - Thread lookups
- `idx_messages_created` - Time-ordered retrieval

#### `message_recipients` table
**Purpose:** Track message delivery and read status

| Column | Type | Description |
|--------|------|-------------|
| `message_id` | INTEGER | Foreign key to messages |
| `agent_name` | TEXT | Recipient agent |
| `read_at` | INTEGER | Read timestamp (NULL = unread) |
| `acked_at` | INTEGER | Acknowledgment timestamp |

**Primary key:** `(message_id, agent_name)` - one record per recipient

#### `reservations` table
**Purpose:** File locking for concurrent editing

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Reservation ID |
| `project_key` | TEXT | Project context |
| `agent_name` | TEXT | Agent holding reservation |
| `path_pattern` | TEXT | File path or glob pattern |
| `exclusive` | INTEGER | Boolean - exclusive lock? |
| `reason` | TEXT | Why reserved (typically bead ID) |
| `created_at` | INTEGER | Lock acquired timestamp |
| `expires_at` | INTEGER | TTL expiration |
| `released_at` | INTEGER | Release timestamp (NULL = active) |
| `lock_holder_id` | TEXT | Lock holder identifier |

**Indexes:**
- `idx_reservations_active` - Fast lookup of unreleased locks

---

### Work Item Tracking (Hive)

#### `beads` table
**Purpose:** Core work item storage (tasks, bugs, features, epics)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Unique bead ID (e.g., "opencode-next--xts0a-mk471w7vzon") |
| `project_key` | TEXT | Project context |
| `type` | TEXT | bug/feature/task/epic/chore/message |
| `status` | TEXT | open/in_progress/blocked/closed/tombstone |
| `title` | TEXT | Display title (max 500 chars) |
| `description` | TEXT | Full description |
| `priority` | INTEGER | 0-3 (0=highest) |
| `parent_id` | TEXT | Foreign key for epic/subtask hierarchy |
| `assignee` | TEXT | Assigned agent |
| `created_at` | INTEGER | Creation timestamp |
| `updated_at` | INTEGER | Last modification |
| `closed_at` | INTEGER | Closure timestamp (NULL = open) |
| `closed_reason` | TEXT | Why closed |
| `deleted_at` | INTEGER | Soft delete timestamp |
| `deleted_by` | TEXT | Who deleted |
| `delete_reason` | TEXT | Why deleted |
| `created_by` | TEXT | Creator agent |

**Constraints:**
- `CHECK (status = 'closed') = (closed_at IS NOT NULL)` - enforce closed_at on closed beads
- `CHECK priority BETWEEN 0 AND 3` - valid priority range

**Current Stats (1,668 active beads):**

| Status | Type | Count |
|--------|------|-------|
| blocked | epic | 1 |
| blocked | task | 8 |
| closed | bug | 68 |
| closed | chore | 8 |
| closed | epic | 219 |
| closed | feature | 25 |
| closed | task | 1,049 |
| in_progress | bug | 1 |
| in_progress | task | 2 |
| open | bug | 20 |
| open | chore | 2 |
| open | epic | 75 |
| open | feature | 10 |
| open | task | 180 |

**Key Insights:**
- **75 open epics** - significant ongoing work
- **180 open tasks** - healthy backlog
- **1,049 closed tasks** - strong completion rate
- **9 blocked items** - minimal blockage (0.5% of active items)

#### `cells` view
**Purpose:** Alias for beads table (migrating naming from "beads" → "cells")

Triggers (`cells_insert`, `cells_update`, `cells_delete`) maintain compatibility during naming transition.

#### `bead_dependencies` table
**Purpose:** Relationships between beads

| Column | Type | Description |
|--------|------|-------------|
| `cell_id` | TEXT | Source bead |
| `depends_on_id` | TEXT | Target bead |
| `relationship` | TEXT | blocks/related/parent-child/discovered-from/replies-to/relates-to/duplicates/supersedes |
| `created_at` | INTEGER | Link creation timestamp |
| `created_by` | TEXT | Who created link |

**Primary key:** `(cell_id, depends_on_id, relationship)` - allow multiple relationship types

---

### Decision Intelligence

#### `decision_traces` table
**Purpose:** Capture coordinator decision-making process

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Trace ID |
| `decision_type` | TEXT | Type of decision made |
| `epic_id` | TEXT | Related epic (if any) |
| `bead_id` | TEXT | Related bead (if any) |
| `agent_name` | TEXT | Agent making decision |
| `project_key` | TEXT | Project context |
| `decision` | TEXT | The decision made |
| `rationale` | TEXT | Why this decision |
| `inputs_gathered` | TEXT | What data was considered |
| `policy_evaluated` | TEXT | Which policies applied |
| `alternatives` | TEXT | Other options considered |
| `precedent_cited` | TEXT | Past similar decisions |
| `outcome_event_id` | INTEGER | Link to outcome event |
| `quality_score` | REAL | Decision quality metric |
| `timestamp` | INTEGER | Decision timestamp |
| `created_at` | TEXT | Record creation |

**Current Stats (132 traces):**

| Decision Type | Count |
|---------------|-------|
| review_decision | 62 |
| worker_spawn | 62 |
| strategy_selection | 5 |
| scope_change | 2 |
| file_selection | 1 |

**Key Insights:**
- **Perfect parity:** 62 spawns = 62 reviews (all workers get reviewed)
- **Strategy selection rare** - mostly using defaults or implicit selection
- **Scope changes documented** - good change control

#### `entity_links` table
**Purpose:** Link decisions to related entities (files, patterns, etc.)

---

### Learning & Memory

#### `memories` table
**Purpose:** Unified memory storage (learnings + indexed sessions)

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Memory ID |
| `content` | TEXT | Memory text content |
| `metadata` | TEXT | JSON metadata |
| `collection` | TEXT | Collection name (default/opencode-swarm/etc) |
| `tags` | TEXT | JSON array of tags |
| `created_at` | TEXT | Creation timestamp |
| `updated_at` | TEXT | Last update |
| `decay_factor` | REAL | Confidence decay (1.0 = fresh) |
| `embedding` | F32_BLOB(1024) | Vector embedding for semantic search |
| `valid_from` | TEXT | Validity window start |
| `valid_until` | TEXT | Validity window end |
| `superseded_by` | TEXT | Link to newer memory |
| `auto_tags` | TEXT | Auto-extracted tags |
| `keywords` | TEXT | Auto-extracted keywords |

**Current Stats (8,953 total memories):**

| Collection | Count |
|------------|-------|
| opencode-swarm | 6,659 |
| default | 2,276 |
| swarm-coordination | 10 |
| test-collection | 2 |
| Various test collections | 6 |

**Key Insights:**
- **Heavy session indexing:** 6,659 opencode-swarm memories (likely session messages)
- **Manual learnings:** 2,276 default collection (stored via hivemind_store)
- **Vector search enabled:** `embedding F32_BLOB(1024)` with libsql vector index
- **Full-text search:** FTS5 virtual table (`memories_fts`) with triggers

#### `memory_links` table
**Purpose:** Semantic relationships between memories

#### `entities` and `relationships` tables
**Purpose:** Knowledge graph - extract entities from memories and link them

---

### Evaluation & Learning

#### `eval_records` table
**Purpose:** Track swarm decomposition evaluation outcomes

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Eval record ID |
| `project_key` | TEXT | Project context |
| `task` | TEXT | Original task description |
| `context` | TEXT | Additional context |
| `strategy` | TEXT | Decomposition strategy used |
| `epic_title` | TEXT | Epic title |
| `subtasks` | TEXT | JSON array of subtasks |
| `outcomes` | TEXT | JSON array of outcomes |
| `overall_success` | INTEGER | Boolean - did it succeed? |
| `total_duration_ms` | INTEGER | Time to complete |
| `total_errors` | INTEGER | Error count |
| `human_accepted` | INTEGER | Human validation |
| `human_modified` | INTEGER | Human edits needed |
| `human_notes` | TEXT | Feedback notes |
| `file_overlap_count` | INTEGER | Conflicting file assignments |
| `scope_accuracy` | REAL | How accurate was scope estimate |
| `time_balance_ratio` | REAL | Work distribution balance |
| `created_at` | INTEGER | Record creation |
| `updated_at` | INTEGER | Last update |

**Current Stats (26 eval records):**
- **Successful:** 5 (100% of evaluated records with success field)
- **Failed:** 0
- **Strategy distribution:** feature-based (5 records, 100% success rate)

**Note:** Only 5 records have `overall_success` populated - suggests eval system is partially implemented.

#### `swarm_contexts` table
**Purpose:** Checkpoint swarm state for recovery

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Context ID |
| `project_key` | TEXT | Project context |
| `epic_id` | TEXT | Related epic |
| `bead_id` | TEXT | Related bead |
| `strategy` | TEXT | Decomposition strategy |
| `files` | TEXT | JSON array of files |
| `dependencies` | TEXT | JSON dependencies |
| `directives` | TEXT | Coordinator directives |
| `recovery` | TEXT | Recovery instructions |
| `checkpointed_at` | INTEGER | Checkpoint timestamp |
| `recovered_at` | INTEGER | Recovery timestamp (NULL = not recovered) |
| `recovered_from_checkpoint` | INTEGER | Boolean - was this recovered? |

**Current Stats:**
- **Total contexts:** 4
- **Unique epics:** 4
- All contexts appear to be from different epics (no re-checkpointing)

---

## Event Type Analysis

**Total Events:** 1,821  
**Date Range:** 2026-01-06 onwards (live database)

### Event Type Frequency Table

| Event Type | Count | Percentage | Category |
|------------|-------|------------|----------|
| `cell_closed` | 325 | 17.8% | Work Item Lifecycle |
| `cell_created` | 296 | 16.3% | Work Item Lifecycle |
| `coordinator_decision` | 150 | 8.2% | Decision Intelligence |
| `message_sent` | 132 | 7.2% | Agent Communication |
| `agent_registered` | 115 | 6.3% | Agent Lifecycle |
| `memory_found` | 95 | 5.2% | Learning System |
| `coordinator_compaction` | 83 | 4.6% | Context Management |
| `thread_created` | 63 | 3.5% | Communication |
| `review_completed` | 59 | 3.2% | Quality Control |
| `memory_stored` | 58 | 3.2% | Learning System |
| `file_reserved` | 55 | 3.0% | File Locking |
| `skill_created` | 45 | 2.5% | Skills System |
| `cell_updated` | 39 | 2.1% | Work Item Lifecycle |
| `hive_synced` | 39 | 2.1% | Git Sync |
| `cell_status_changed` | 37 | 2.0% | Work Item Lifecycle |
| `review_started` | 27 | 1.5% | Quality Control |
| `decomposition_generated` | 26 | 1.4% | Task Planning |
| `epic_created` | 26 | 1.4% | Work Item Lifecycle |
| `swarm_started` | 26 | 1.4% | Swarm Lifecycle |
| `swarm_completed` | 17 | 0.9% | Swarm Lifecycle |
| `validation_started` | 17 | 0.9% | Quality Control |
| `coordinator_violation` | 15 | 0.8% | Error Detection |
| `file_released` | 15 | 0.8% | File Locking |
| `coordinator_outcome` | 9 | 0.5% | Decision Intelligence |
| `skill_loaded` | 8 | 0.4% | Skills System |
| `subtask_outcome` | 7 | 0.4% | Swarm Lifecycle |
| `validation_completed` | 6 | 0.3% | Quality Control |
| `worker_completed` | 6 | 0.3% | Swarm Lifecycle |
| `swarm_checkpointed` | 4 | 0.2% | Context Management |
| `memory_deleted` | 3 | 0.2% | Learning System |
| `memory_validated` | 2 | 0.1% | Learning System |
| `message_read` | 2 | 0.1% | Communication |
| `progress_reported` | 2 | 0.1% | Worker Monitoring |
| `reservation_acquired` | 2 | 0.1% | File Locking |
| `review_feedback` | 2 | 0.1% | Quality Control |
| `task_started` | 2 | 0.1% | Swarm Lifecycle |
| `cass_searched` | 1 | 0.1% | Session Search |
| `message_acked` | 1 | 0.1% | Communication |
| `reservation_released` | 1 | 0.1% | File Locking |
| `swarm_recovered` | 1 | 0.1% | Error Recovery |
| `task_blocked` | 1 | 0.1% | Workflow |

### Event Category Distribution

| Category | Event Count | Percentage |
|----------|-------------|------------|
| **Work Item Lifecycle** | 723 | 39.7% |
| **Decision Intelligence** | 159 | 8.7% |
| **Learning System** | 158 | 8.7% |
| **Agent Communication** | 198 | 10.9% |
| **Quality Control** | 111 | 6.1% |
| **Swarm Lifecycle** | 62 | 3.4% |
| **File Locking** | 73 | 4.0% |
| **Context Management** | 87 | 4.8% |
| **Agent Lifecycle** | 115 | 6.3% |
| **Other** | 135 | 7.4% |

**Key Insights:**
- **Work item lifecycle dominates** (40%) - heavy bead creation/closing
- **Decision intelligence well-captured** (8.7%) - good audit trail
- **Learning system active** (8.7%) - memory storage and retrieval happening
- **Quality control coverage** (6.1%) - reviews started/completed tracked
- **Low swarm completion rate** - 26 started vs 17 completed (65%) suggests some swarms don't finish cleanly

---

## Strategy Usage Breakdown

**Note:** Strategy data extraction from `coordinator_decision` events shows empty results. This suggests:
1. Strategy field may not be consistently populated in event data JSON
2. Strategies may be implicit (not recorded in decisions)
3. Field name may differ from expected `$.strategy` path

**Alternative source:** `eval_records` table shows:
- **feature-based:** 5 records (100% success rate)

**Decision trace analysis:**
- **strategy_selection decisions:** 5 (matches eval_records count)
- Suggests strategy selection happens but isn't captured in standard coordinator_decision events

**Recommendation:** Audit `coordinator_decision` event schema to ensure strategy is captured consistently. Current event payload examples:
```json
{"action":"spawn"}
{"action":"old"}
{"session_id":"...","epic_id":"bd-123","event_type":"DECISION","payload":{"strategy":"file-based"},"decision_type":"strategy_selected"}
```

The `strategy_selected` decision_type appears to be the correct place, but it's a separate decision event, not embedded in all coordinator decisions.

---

## Review Outcomes Analysis

**Source:** `review_completed` events (59 total)

| Review Status | Count | Percentage |
|---------------|-------|------------|
| `approved` | 38 | 64.4% |
| `needs_changes` | 18 | 30.5% |
| `blocked` | 3 | 5.1% |

**Key Insights:**
- **Healthy approval rate:** 64% first-pass approval
- **Constructive feedback:** 30% need changes (not rejected, just iterated)
- **Minimal blockage:** Only 5% hard-blocked (likely architectural issues)
- **3-strike rule working:** Blocked status suggests multiple rejection cycles

**Comparison to decision traces:**
- 62 `review_decision` traces vs 59 `review_completed` events
- Suggests 3 reviews are still in-flight or weren't completed

---

## Compaction Event Analysis

**Total compaction events:** 83

### Compaction Event Structure

Sample event payload:
```json
{
  "session_id": "test-compaction-1767725432376-0",
  "epic_id": "bd-123",
  "event_type": "COMPACTION",
  "payload": {
    "confidence": "high",
    "context_type": "full",
    "epic_id": "bd-456"
  },
  "compaction_type": "detection_complete"
}
```

**Compaction Types:**
- `detection_complete` - Swarm signature detected
- `prompt_generated` - LLM compaction prompt created

**Issue:** No `prompt_type` field found in database events. All 83 events return NULL for `json_extract(data, '$.prompt_type')`.

**Alternative analysis from log files shows:**
- Compaction prompts ARE being generated (log entries with full prompts)
- Prompt length example: 5,800 characters (repeated coordinator mantra)
- Suggests prompt_type may be in nested structure or log-only

---

## Compaction Log Error Analysis

**Log file:** `~/.config/swarm-tools/logs/compaction.log`  
**Total lines:** 1,768  
**Analysis period:** 2026-01-02 to 2026-01-06

### Error Pattern Summary

| Error Type | Count | Severity |
|------------|-------|----------|
| `ProviderModelNotFoundError` | 6 | Medium |
| `Cannot find module` errors | 2 | High |
| LLM compaction timeouts (30s) | 6 | Medium |

### Detailed Error Patterns

#### 1. ProviderModelNotFoundError (6 occurrences)

**Pattern:**
```
ProviderModelNotFoundError: ProviderModelNotFoundError
data: {
  providerID: "__SWARM_LITE_
```

**Root Cause:** Provider ID prefix `__SWARM_LITE_` is incomplete/malformed.

**Impact:** Compaction prompt generation fails, falls back to default behavior.

**Recommendation:** 
- Audit model provider configuration in swarm plugin
- Ensure `SWARM_LITE` provider is properly registered
- Add validation before attempting LLM calls

#### 2. Module Resolution Errors (2 occurrences)

**Pattern:**
```
error: Cannot find module '@opencode-ai/plugin' from '/Users/joel/.config/opencode/plugin/swarm.ts'
```

**Root Cause:** Plugin wrapper attempting to import from npm package scope.

**Impact:** Complete plugin failure, OpenCode crashes.

**Recommendation:**
- **CRITICAL:** Plugin wrapper MUST be self-contained
- Per AGENTS.md mandate: "Plugin wrapper at `~/.config/opencode/plugin/swarm.ts` must have ZERO imports from `opencode-swarm-plugin`"
- Inline all logic or use CLI spawn pattern

#### 3. LLM Compaction Timeouts (6 occurrences)

**Pattern:**
```json
{
  "level": "error",
  "msg": "generate_compaction_prompt_exception",
  "error": "LLM compaction timeout (30s)",
  "duration_ms": 30002
}
```

**Root Cause:** Compaction prompt generation exceeds 30-second timeout.

**Impact:** Compaction fails, context not compressed, potential context exhaustion.

**Recommendation:**
- Increase timeout to 60s for complex sessions
- Implement streaming compaction for large contexts
- Add compaction quality metrics (prompt length vs output length)

### Success Rate Analysis

**Log message distribution:**

| Message Type | Count | Notes |
|-------------|-------|-------|
| `generate_compaction_prompt_llm_complete` | 10 | Successful completions |
| `swarm_state_resolved` | 4 | State recovery successful |
| `generate_compaction_prompt_exception` | 4 | Timeout exceptions |
| `using_projection_as_snapshot` | 3 | Projection-based state |
| `session_scan_complete` | 3 | Session indexed successfully |
| `generate_compaction_prompt_llm_failed` | 1 | Module resolution failure |

**Success Rate:** ~71% (10 successes / 14 attempts)

**Note:** Timeouts don't appear in stderr-based error counts, only in exception logs. True failure rate may be higher.

---

## Project Activity Analysis

**Total unique projects:** 81

### Top 10 Most Active Projects

| Project | Event Count | Percentage |
|---------|-------------|------------|
| `/Users/joel/Code/joelhooks/opencode-next` | 599 | 32.9% |
| `/var/folders/.../beads-integration-test-*` | 315 | 17.3% |
| `/Users/joel/Code/vercel/vrain` | 223 | 12.2% |
| `/Users/joel/Code/.../opencode-swarm-plugin/packages/opencode-swarm-plugin` | 153 | 8.4% |
| `/Users/joel/Code/.../opencode-swarm-plugin/packages/opencode-swarm-plugin/.test-skills-*` | 50 | 2.7% |
| `/Users/joel/Code/joelhooks/opencode-swarm-plugin` | 45 | 2.5% |
| `/Users/joel/Code/skillrecordings/migrate-egghead` | 43 | 2.4% |
| `/Users/joel/Code/vercel/academy-scratch` | 26 | 1.4% |
| `/tmp/test-project` | 20 | 1.1% |
| `/var/folders/.../swarm-e2e-*` | 20 | 1.1% |

**Key Insights:**
- **opencode-next dominates** (33%) - main development project
- **Test projects significant** (17%) - heavy integration testing
- **Monorepo sub-packages tracked separately** - may want to consolidate project_key normalization
- **71 other projects** with minimal activity (< 20 events each) - breadcrumbs from various sessions

---

## Database Health & Recommendations

### Schema Design: ✅ Strong

**Strengths:**
- Event sourcing with proper indexing
- Foreign key constraints where appropriate
- Check constraints for data validity
- Soft deletes (tombstone status, deleted_at fields)
- FTS5 full-text search + vector embeddings for memories
- Decision tracing with rich context capture

**Minor Issues:**
- `cells` view is transitional abstraction - should migrate fully to one name
- `beads` table name conflicts with new "cells" terminology
- `swarm_contexts` low usage (4 records) - may be underutilized

### Data Quality: ⚠️ Good with Gaps

**Strengths:**
- Consistent event capture across categories
- Review outcomes well-tracked
- Decision traces capture rationale and alternatives
- Memory system heavily used

**Gaps:**
- Strategy data not in coordinator_decision events (separate event type)
- `eval_records.overall_success` sparsely populated (5/26)
- Compaction events missing `prompt_type` field in database (log-only?)
- 26 swarm_started vs 17 swarm_completed (9 missing outcomes)

### Performance: ✅ Good

**Index coverage:**
- All foreign keys indexed
- Composite indexes for common queries
- Vector index for semantic search
- FTS5 for full-text search

**Query Performance Notes:**
- JSON extraction queries (`json_extract(data, '$.field')`) may be slow at scale
- Consider materialized columns for frequently-accessed JSON fields (strategy, status, etc.)
- 1,821 events is still small - monitor performance at 10k+ events

### Recommendations

#### 1. Schema Evolution

**Priority: Medium**

```sql
-- Materialize commonly-queried JSON fields
ALTER TABLE events ADD COLUMN event_strategy TEXT GENERATED ALWAYS AS (json_extract(data, '$.strategy')) STORED;
ALTER TABLE events ADD COLUMN event_status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED;

CREATE INDEX idx_events_strategy ON events(event_strategy) WHERE event_strategy IS NOT NULL;
```

**Rationale:** JSON extraction is slow. Generated columns + indexes speed up strategy/status queries.

#### 2. Compaction System Hardening

**Priority: High**

- Fix `__SWARM_LITE_` provider ID issue (audit swarm plugin config)
- Increase timeout from 30s → 60s for compaction LLM calls
- Add compaction metrics table:
  ```sql
  CREATE TABLE compaction_metrics (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    input_length INTEGER NOT NULL,
    output_length INTEGER NOT NULL,
    compression_ratio REAL NOT NULL,
    duration_ms INTEGER NOT NULL,
    model TEXT,
    success INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  ```

#### 3. Eval System Completion

**Priority: Medium**

- Populate `overall_success` for all eval records (currently 5/26)
- Add automated eval triggers on swarm completion
- Link eval_records to events table via `outcome_event_id`

#### 4. Swarm Lifecycle Tracking

**Priority: Medium**

**Issue:** 26 swarm_started vs 17 swarm_completed (9 incomplete)

**Investigation needed:**
- Are swarms failing silently?
- Are completion events not being emitted?
- Are some swarms legitimately long-running?

**Recommendation:**
```sql
-- Find swarms with no completion event
SELECT 
  e1.data AS start_event,
  e1.timestamp AS started_at,
  (strftime('%s', 'now') * 1000 - e1.timestamp) / 3600000.0 AS hours_since_start
FROM events e1
WHERE e1.type = 'swarm_started'
  AND NOT EXISTS (
    SELECT 1 FROM events e2 
    WHERE e2.type IN ('swarm_completed', 'swarm_failed')
      AND json_extract(e1.data, '$.epic_id') = json_extract(e2.data, '$.epic_id')
  )
ORDER BY e1.timestamp DESC;
```

#### 5. Plugin Module Resolution

**Priority: CRITICAL** 🚨

**From AGENTS.md:**
> The plugin wrapper at `~/.config/opencode/plugin/swarm.ts` must have ZERO imports from `opencode-swarm-plugin`.

**Action Items:**
1. Audit `~/.config/opencode/plugin/swarm.ts` for forbidden imports
2. Inline all logic OR use CLI spawn pattern (`spawn('swarm', ['command'])`)
3. Add CI check to prevent `import { ... } from "opencode-swarm-plugin"` in plugin wrapper

**Current error in logs:**
```
error: Cannot find module '@opencode-ai/plugin' from '/Users/joel/.config/opencode/plugin/swarm.ts'
```

This indicates the plugin wrapper is trying to import from npm scope, which breaks OpenCode context.

#### 6. Memory System Optimization

**Priority: Low**

**Current stats:**
- 8,953 memories total
- 6,659 opencode-swarm collection (session messages)
- 2,276 default collection (manual learnings)

**Recommendations:**
- Implement memory decay cleanup (remove memories with `decay_factor < 0.1`)
- Archive old session memories to separate table after 90 days
- Add memory validation workflow (flag stale/incorrect memories)

---

## Appendix: Sample Queries

### Find incomplete swarms
```sql
SELECT 
  json_extract(data, '$.epic_id') AS epic_id,
  json_extract(data, '$.epic_title') AS title,
  timestamp,
  datetime(timestamp/1000, 'unixepoch') AS started_at
FROM events
WHERE type = 'swarm_started'
  AND json_extract(data, '$.epic_id') NOT IN (
    SELECT json_extract(data, '$.epic_id')
    FROM events
    WHERE type IN ('swarm_completed', 'swarm_failed')
  )
ORDER BY timestamp DESC;
```

### Review outcomes by agent
```sql
SELECT 
  json_extract(dt.decision, '$.agent_name') AS reviewer,
  json_extract(e.data, '$.status') AS outcome,
  COUNT(*) AS count
FROM decision_traces dt
JOIN events e ON dt.outcome_event_id = e.id
WHERE dt.decision_type = 'review_decision'
GROUP BY reviewer, outcome
ORDER BY reviewer, count DESC;
```

### Strategy success rates (from eval_records)
```sql
SELECT 
  strategy,
  COUNT(*) AS total,
  SUM(CAST(overall_success AS INTEGER)) AS successes,
  ROUND(AVG(CAST(overall_success AS FLOAT)) * 100, 1) AS success_rate_pct,
  ROUND(AVG(total_duration_ms) / 1000.0, 1) AS avg_duration_sec
FROM eval_records
WHERE overall_success IS NOT NULL
GROUP BY strategy
ORDER BY success_rate_pct DESC;
```

### Top memory collections
```sql
SELECT 
  collection,
  COUNT(*) AS memory_count,
  ROUND(AVG(decay_factor), 3) AS avg_decay,
  MIN(created_at) AS oldest,
  MAX(created_at) AS newest
FROM memories
GROUP BY collection
ORDER BY memory_count DESC;
```

### Agent activity heatmap
```sql
SELECT 
  name,
  COUNT(DISTINCT project_key) AS projects,
  COUNT(*) AS registrations,
  datetime(MIN(registered_at)/1000, 'unixepoch') AS first_seen,
  datetime(MAX(last_active_at)/1000, 'unixepoch') AS last_active
FROM agents
GROUP BY name
HAVING registrations > 1
ORDER BY registrations DESC;
```

---

## Conclusion

The swarm database is **healthy and actively used** with strong event coverage across all system components. The event sourcing architecture is sound, decision intelligence captures rich context, and the learning system shows heavy usage.

**Critical issues:**
1. **Plugin module resolution** - MUST fix `@opencode-ai/plugin` import in wrapper (causes crashes)
2. **Compaction provider config** - `__SWARM_LITE_` provider ID is malformed

**Moderate issues:**
1. **Incomplete swarms** - 9 out of 26 swarms (35%) have no completion event
2. **Sparse eval data** - Only 5 out of 26 eval records have success metrics
3. **Strategy tracking gaps** - Strategy not consistently captured in coordinator decisions

**Recommended next steps:**
1. Fix plugin wrapper imports (critical path)
2. Investigate incomplete swarm outcomes (data quality)
3. Add compaction metrics table (observability)
4. Materialize JSON fields for query performance (optimization)

**Overall assessment:** 🟢 Production-ready with known issues tracked.
