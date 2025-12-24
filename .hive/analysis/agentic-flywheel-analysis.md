# ADR: Patterns from agentic_coding_flywheel_setup

**Status:** Accepted  
**Date:** 2025-12-24  
**Cell:** opencode-swarm-monorepo-lf2p4u-mjfzm2qunwj  
**Source:** https://github.com/Dicklesworthstone/agentic_coding_flywheel_setup

## Context

Analyzed Dicklesworthstone's ACFS repo - a one-liner VPS setup for agentic coding that installs 30+ tools including Claude Code, Codex CLI, Gemini CLI, and the "Dicklesworthstone stack" (NTM, MCP Agent Mail, UBS, CASS, SLB, etc.).

Goal: Extract patterns to improve our swarm coordination system.

## Decision

Adopt 5 patterns from ACFS, prioritized by impact and effort:

### 1. Contract Validation (HIGH PRIORITY - 2 days)

**Pattern:** Every generated module calls `acfs_require_contract()` FIRST, failing fast if required env vars or functions are missing.

```bash
# ACFS contract.sh
acfs_require_contract() {
  local missing=()
  [[ -z "${TARGET_USER:-}" ]] && missing+=("TARGET_USER")
  [[ -z "${MODE:-}" ]] && missing+=("MODE")
  
  if ! declare -f log_detail >/dev/null; then
    missing+=("log_detail function")
  fi
  
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Contract violation: Missing ${missing[*]}"
    return 1
  fi
}
```

**Our gap:** Workers can call `swarm_complete` without `swarmmail_init`, leading to cryptic errors 30 minutes later.

**Implementation:**
```typescript
export async function validateWorkerContract(context: WorkerContext) {
  const missing: string[] = [];
  
  if (!context.swarmmail_initialized) missing.push("swarmmail_init not called");
  if (!context.reservations) missing.push("file reservations not acquired");
  if (!context.cell_id) missing.push("cell_id missing");
  
  if (missing.length > 0) {
    throw new ContractViolation(`Worker contract violated: ${missing.join(", ")}`);
  }
}
```

### 2. Stable IDs for Subtasks (HIGH PRIORITY - 1 day)

**Pattern:** Use stable string identifiers instead of array indices.

```typescript
// ACFS state.json v2
{
  "completed_phases": ["user_setup", "filesystem"],  // NOT [1, 2]
  "current_phase": "shell_setup"
}
```

**Problem solved:** If phases are reordered or new ones inserted, numeric indices break resume logic.

**Our gap:** Subtask dependencies use array indices. Insert a subtask → off-by-one errors.

**Implementation:** Generate stable IDs like `auth-setup-f3a2` instead of relying on array position.

### 3. Doctor-Style Health Checks (MEDIUM - 3 days)

**Pattern:** Three-tier health checks with caching and timeouts.

```bash
# Tier 1: Binary exists (fast)
command -v claude

# Tier 2: Shallow verify (medium)  
claude --version

# Tier 3: Deep functional test (slow, --deep only)
claude api test
```

Features:
- 5-minute cache TTL
- 15-second timeout per check
- JSON output mode for automation

**Implementation:** Add `swarm_health_check()` that coordinator runs every 60s.

### 4. Manifest-Driven Tool Generation (MEDIUM - 4 days)

**Pattern:** Single YAML source of truth → generated artifacts.

```yaml
# acfs.manifest.yaml
modules:
  - id: lang.bun
    phase: 6
    dependencies: [base.system]
    installed_check:
      command: "test -x ~/.bun/bin/bun"
    verify: ["~/.bun/bin/bun --version"]
```

TypeScript compiler generates:
- Shell install scripts
- Doctor checks
- Documentation

**Our application:** Define swarm tools in YAML, generate MCP definitions + validation.

### 5. Checksum-Verified External Scripts (LOW - 2 days)

**Pattern:** Never run external scripts without checksum verification.

```bash
# checksums.yaml
installers:
  bun:
    url: "https://bun.sh/install"
    sha256: "abc123..."
```

Features:
- HTTPS-only enforcement
- Checksum verification BEFORE execution
- Graceful mismatch handling (prompt to skip/abort)
- Retry logic for transient network errors

**Our application:** Verify skill downloads before installation.

## Key Differences

| Aspect | ACFS | Our Swarm |
|--------|------|-----------|
| State Format | JSON with stable string IDs | JSONL event log with numeric IDs |
| Generation | YAML → TypeScript → Bash | Manual tool definitions |
| Idempotency | `installed_check` in manifest | Ad-hoc `hive_query` checks |
| Validation | Contract checking at runtime | No pre-flight validation |
| Health Checks | 3-tier with caching + timeouts | No health monitoring |
| Security | Checksum-verified installers | Trust-on-first-use |

## Code Patterns Worth Copying

### Atomic Writes

```bash
state_write_atomic() {
  temp_file="$(mktemp "${target_dir}/.state.XXXXXX.tmp")"
  printf '%s\n' "$content" > "$temp_file"
  sync "$temp_file" 2>/dev/null || sync || true
  chmod 644 "$temp_file"
  mv -f "$temp_file" "$file_path"  # POSIX atomic rename
}
```

### Sentinel-Based Fetching

```bash
# Preserve trailing newlines without temp files
local sentinel="__ACFS_EOF_SENTINEL__"
content="$(acfs_curl "$url" && printf '%s' "$sentinel")"
content="${content%"$sentinel"}"  # Strip sentinel, keep newlines
```

### Actionable Error Messages

```bash
log_error "ACFS contract violation (${context})"
log_detail "Missing: ${missing[*]}"
log_detail "Fix: install.sh must source scripts/lib/*.sh, set required vars..."
```

## Implementation Plan

| Priority | Pattern | Effort | Impact |
|----------|---------|--------|--------|
| 1 | Contract Validation | 2 days | Prevents 80% of coordination bugs |
| 2 | Stable Subtask IDs | 1 day | Prevents resume/dependency bugs |
| 3 | Health Checks | 3 days | Detects stale reservations, orphaned agents |
| 4 | Manifest Generation | 4 days | Long-term maintenance reduction |
| 5 | Checksum Skills | 2 days | Security hardening |

**Total:** ~12 days for priorities 1-4

## Consequences

### Positive
- Fail-fast on coordination errors (contract validation)
- Safe subtask insertion/reordering (stable IDs)
- Proactive issue detection (health checks)
- Reduced tool maintenance (manifest generation)

### Negative
- Breaking change for stable IDs (migration needed)
- Health check overhead (mitigated by caching)
- Manifest compiler is new code to maintain

### Neutral
- Checksum verification adds friction to skill development (acceptable tradeoff)

## Related Cells

- `mjk6htl0c24` - Coordinator should spawn research workers, not fetch directly
- `mjk6mha6mi2` - Add observability to pre-compaction hook
