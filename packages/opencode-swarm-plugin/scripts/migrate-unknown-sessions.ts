#!/usr/bin/env bun

/**
 * Migration script to re-attribute unknown.jsonl events to proper session files
 * 
 * Strategy:
 * 1. Read all events from unknown.jsonl
 * 2. For each event, find matching session by epic_id
 * 3. Append to existing session or create new session file
 * 4. Rename unknown.jsonl to unknown.jsonl.migrated
 * 
 * Usage:
 *   bun run scripts/migrate-unknown-sessions.ts [--dry-run]
 */

import { execSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface SessionEvent {
  session_id: string;
  epic_id: string;
  timestamp: string;
  event_type: string;
  [key: string]: unknown;
}

interface MigrationStats {
  totalEvents: number;
  migratedEvents: number;
  sessionsUpdated: number;
  sessionsCreated: number;
  unattributableEvents: number;
  eventsByEpic: Map<string, number>;
}

const SESSIONS_DIR = join(process.env.HOME || "~", ".config/swarm-tools/sessions");
const UNKNOWN_FILE = join(SESSIONS_DIR, "unknown.jsonl");
const MIGRATED_FILE = join(SESSIONS_DIR, "unknown.jsonl.migrated");

/**
 * Atomic file write using temp file + rename
 * Based on learned pattern for crash-safe state persistence
 */
function atomicWriteFile(path: string, content: string): void {
    const dir = join(path, "..");
    const tempFile = `${dir}/.${Date.now()}.tmp`;
  
  try {
    // Write to temp file in same directory (required for atomic rename)
    writeFileSync(tempFile, content, "utf-8");
    
    // Atomic rename (POSIX guarantees atomicity on same filesystem)
    renameSync(tempFile, path);
    
    // Sync directory entry (ensures rename is flushed)
    execSync(`sync "${dir}"`, { stdio: "ignore" });
  } catch (error) {
    // Cleanup temp file on error
    try {
      execSync(`rm -f "${tempFile}"`, { stdio: "ignore" });
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Read JSONL file and parse events
 */
function readJSONL(path: string): SessionEvent[] {
  try {
    const content = readFileSync(path, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Build index of epic_id -> session_id from all existing session files
 */
function buildEpicIndex(): Map<string, string> {
  const epicIndex = new Map<string, string>();
  
  try {
    const files = execSync(`ls "${SESSIONS_DIR}"/ses_*.jsonl 2>/dev/null || true`, {
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter((f) => f);
    
    for (const sessionFile of files) {
      const events = readJSONL(sessionFile);
      const sessionId = events[0]?.session_id;
      
      if (!sessionId) continue;
      
      // Index all epic_ids in this session
      for (const event of events) {
        if (event.epic_id && !epicIndex.has(event.epic_id)) {
          epicIndex.set(event.epic_id, sessionId);
        }
      }
    }
  } catch (error) {
    console.error("Error building epic index:", error);
  }
  
  return epicIndex;
}

/**
 * Generate a new session ID
 * Format: ses_<base58-like-id>
 */
function generateSessionId(): string {
  // Generate random base58-like suffix (avoiding 0, O, I, l for readability)
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 22; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  
  return `ses_${suffix}`;
}

/**
 * Append events to a session file atomically
 */
function appendToSession(sessionId: string, events: SessionEvent[], dryRun: boolean): void {
  const sessionFile = `${SESSIONS_DIR}/${sessionId}.jsonl`;
  
  // Read existing events (if file exists)
  const existingEvents = readJSONL(sessionFile);
  
  // Create set of existing event fingerprints for idempotency check
  const existingFingerprints = new Set(
    existingEvents.map((e) => 
      JSON.stringify({ epic_id: e.epic_id, timestamp: e.timestamp, event_type: e.event_type })
    )
  );
  
  // Filter out events that already exist (idempotency)
  const newEvents = events.filter((e) => {
    const fingerprint = JSON.stringify({
      epic_id: e.epic_id,
      timestamp: e.timestamp,
      event_type: e.event_type,
    });
    return !existingFingerprints.has(fingerprint);
  });
  
  if (newEvents.length === 0) {
    console.log(`  → No new events to add to ${sessionId}.jsonl (all already exist)`);
    return;
  }
  
  // Update session_id for all events
  const updatedEvents = newEvents.map((e) => ({ ...e, session_id: sessionId }));
  
  // Combine and write
  const allEvents = [...existingEvents, ...updatedEvents];
  const content = allEvents.map((e) => JSON.stringify(e)).join("\n") + "\n";
  
  if (dryRun) {
    console.log(`  → Would write ${newEvents.length} events to ${sessionId}.jsonl`);
  } else {
    atomicWriteFile(sessionFile, content);
    console.log(`  → Wrote ${newEvents.length} events to ${sessionId}.jsonl`);
  }
}

/**
 * Main migration logic
 */
function migrate(dryRun: boolean = false): MigrationStats {
  const stats: MigrationStats = {
    totalEvents: 0,
    migratedEvents: 0,
    sessionsUpdated: 0,
    sessionsCreated: 0,
    unattributableEvents: 0,
    eventsByEpic: new Map(),
  };
  
  console.log("🔍 Reading unknown.jsonl...");
  const unknownEvents = readJSONL(UNKNOWN_FILE);
  stats.totalEvents = unknownEvents.length;
  
  if (stats.totalEvents === 0) {
    console.log("✅ No events to migrate (unknown.jsonl is empty)");
    return stats;
  }
  
  console.log(`📊 Found ${stats.totalEvents} events in unknown.jsonl`);
  
  console.log("🗂️  Building epic_id index from existing sessions...");
  const epicIndex = buildEpicIndex();
  console.log(`📇 Indexed ${epicIndex.size} epic_ids across existing sessions`);
  
  // Group events by target session
  const eventsBySession = new Map<string, SessionEvent[]>();
  const newSessions = new Set<string>();
  
  for (const event of unknownEvents) {
    const { epic_id } = event;
    
    if (!epic_id) {
      console.warn(`⚠️  Event without epic_id: ${JSON.stringify(event)}`);
      stats.unattributableEvents++;
      continue;
    }
    
    // Track events per epic
    stats.eventsByEpic.set(epic_id, (stats.eventsByEpic.get(epic_id) || 0) + 1);
    
    // Find or create session
    let sessionId = epicIndex.get(epic_id);
    
    if (!sessionId) {
      // Create new session for this epic_id
      sessionId = generateSessionId();
      epicIndex.set(epic_id, sessionId);
      newSessions.add(sessionId);
      console.log(`🆕 Creating new session ${sessionId} for epic ${epic_id}`);
    }
    
    // Group events by session
    if (!eventsBySession.has(sessionId)) {
      eventsBySession.set(sessionId, []);
    }
    const sessionEvents = eventsBySession.get(sessionId);
    if (sessionEvents) {
      sessionEvents.push(event);
    }
  }
  
  // Write events to sessions
  console.log(`\n📝 Writing events to ${eventsBySession.size} session files...`);
  
  for (const [sessionId, events] of eventsBySession) {
    const isNew = newSessions.has(sessionId);
    console.log(`\n${isNew ? "🆕" : "➕"} Session ${sessionId} (${events.length} events)`);
    
    appendToSession(sessionId, events, dryRun);
    
    stats.migratedEvents += events.length;
    if (isNew) {
      stats.sessionsCreated++;
    } else {
      stats.sessionsUpdated++;
    }
  }
  
  // Rename unknown.jsonl to .migrated
  if (!dryRun) {
    console.log(`\n🏷️  Renaming unknown.jsonl to unknown.jsonl.migrated...`);
    renameSync(UNKNOWN_FILE, MIGRATED_FILE);
  } else {
    console.log(`\n🏷️  Would rename unknown.jsonl to unknown.jsonl.migrated`);
  }
  
  return stats;
}

/**
 * Print summary
 */
function printSummary(stats: MigrationStats, dryRun: boolean): void {
  console.log("\n" + "=".repeat(60));
  console.log(dryRun ? "DRY RUN SUMMARY" : "MIGRATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total events in unknown.jsonl:    ${stats.totalEvents}`);
  console.log(`Events migrated:                   ${stats.migratedEvents}`);
  console.log(`Sessions updated:                  ${stats.sessionsUpdated}`);
  console.log(`Sessions created:                  ${stats.sessionsCreated}`);
  console.log(`Unattributable events:             ${stats.unattributableEvents}`);
  console.log(`Unique epic_ids:                   ${stats.eventsByEpic.size}`);
  
  if (stats.eventsByEpic.size > 0 && stats.eventsByEpic.size <= 10) {
    console.log("\nEvents by epic_id:");
    for (const [epicId, count] of Array.from(stats.eventsByEpic.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${epicId}: ${count} events`);
    }
  }
  
  console.log("=".repeat(60));
  
  if (dryRun) {
    console.log("\n💡 Run without --dry-run to perform actual migration");
  } else {
    console.log("\n✅ Migration complete!");
  }
}

// Show help
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`
Migration script to re-attribute unknown.jsonl events to proper session files

USAGE:
  bun run scripts/migrate-unknown-sessions.ts [OPTIONS]

OPTIONS:
  --dry-run    Preview changes without modifying files
  --help, -h   Show this help message

DESCRIPTION:
  This script reads events from unknown.jsonl and re-attributes them to the
  correct session files based on their epic_id. Events are matched to existing
  sessions, or new session files are created as needed.

  The script is idempotent - running it multiple times will not duplicate events.

EXAMPLES:
  # Preview migration
  bun run scripts/migrate-unknown-sessions.ts --dry-run

  # Perform migration
  bun run scripts/migrate-unknown-sessions.ts
`);
  process.exit(0);
}

// Main execution
const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
  console.log("🧪 DRY RUN MODE - No files will be modified\n");
}

try {
  const stats = migrate(dryRun);
  printSummary(stats, dryRun);
  process.exit(0);
} catch (error) {
  console.error("\n❌ Migration failed:", error);
  process.exit(1);
}
