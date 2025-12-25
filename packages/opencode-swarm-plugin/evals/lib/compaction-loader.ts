/**
 * Compaction Data Loader
 *
 * Loads COMPACTION events from session JSONL files for use in evals.
 *
 * Features:
 * - Lazy loading with early termination for large datasets
 * - Filtering by compaction_type, sessionIds, and limit
 * - Graceful error handling (skips invalid lines)
 * - Type-safe with Zod validation
 *
 * @module compaction-loader
 */
import * as fs from "node:fs";
import { createInterface } from "node:readline";
import * as path from "node:path";
import type { CoordinatorEvent } from "../../src/eval-capture.js";
import { CoordinatorEventSchema } from "../../src/eval-capture.js";

/**
 * Compaction event - subset of CoordinatorEvent with event_type === "COMPACTION"
 */
export type CompactionEvent = Extract<
  CoordinatorEvent,
  { event_type: "COMPACTION" }
>;

/**
 * Compaction session - session with only COMPACTION events
 */
export interface CompactionSession {
  session_id: string;
  epic_id: string;
  start_time: string;
  end_time: string;
  events: CompactionEvent[];
}

/**
 * Load options
 */
export interface LoadOptions {
  /** Filter by compaction_type */
  compaction_type?:
    | "detection_complete"
    | "prompt_generated"
    | "context_injected"
    | "resumption_started"
    | "tool_call_tracked";
  /** Filter by session IDs */
  sessionIds?: string[];
  /** Limit number of results */
  limit?: number;
}

/**
 * Load COMPACTION events from session JSONL files
 *
 * Reads all .jsonl files in the session directory, parses events,
 * and returns only COMPACTION events matching the filters.
 *
 * @param sessionDir - Path to session directory (default: ~/.config/swarm-tools/sessions)
 * @param options - Filter options
 * @returns Array of compaction events
 *
 * @example
 * // Load all COMPACTION events
 * const events = await loadCompactionEvents("/path/to/sessions");
 *
 * @example
 * // Load only detection_complete events
 * const events = await loadCompactionEvents("/path/to/sessions", {
 *   compaction_type: "detection_complete",
 * });
 *
 * @example
 * // Load events from specific sessions
 * const events = await loadCompactionEvents("/path/to/sessions", {
 *   sessionIds: ["session-1", "session-2"],
 *   limit: 10,
 * });
 */
export async function loadCompactionEvents(
  sessionDir: string,
  options?: LoadOptions,
): Promise<CompactionEvent[]> {
  const { compaction_type, sessionIds, limit } = options ?? {};

  // Check if directory exists
  if (!fs.existsSync(sessionDir)) {
    return [];
  }

  let files: string[];
  try {
    // Read all .jsonl files
    files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  } catch (error) {
    // Directory exists but can't be read - log and return empty
    console.warn(`Failed to read session directory ${sessionDir}:`, error);
    return [];
  }

  // Filter by sessionIds if provided
  const targetFiles = sessionIds
    ? files.filter((f) => sessionIds.includes(f.replace(".jsonl", "")))
    : files;

  const events: CompactionEvent[] = [];

  for (const file of targetFiles) {
    const filePath = path.join(sessionDir, file);

    try {
      // Stream large files line-by-line to avoid loading entire file into memory
      const shouldStream = limit && limit < 100; // For small limits, streaming is overkill
      
      if (shouldStream) {
        // Use streaming for better memory efficiency
        const found = await loadFromFileStream(filePath, {
          compaction_type,
          remainingLimit: limit - events.length,
        });
        events.push(...found);
      } else {
        // For small files or no limit, read entire file (faster)
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);

        for (const line of lines) {
          const event = parseLine(line);
          if (event && event.event_type === "COMPACTION") {
            // Filter by compaction_type if provided
            if (!compaction_type || event.compaction_type === compaction_type) {
              events.push(event);

              // Apply limit early to avoid processing unnecessary files
              if (limit && events.length >= limit) {
                return events.slice(0, limit);
              }
            }
          }
        }
      }

      // Early termination if limit reached
      if (limit && events.length >= limit) {
        return events.slice(0, limit);
      }
    } catch (error) {
      // Log file read errors but continue processing other files
      console.warn(`Failed to read session file ${filePath}:`, error);
    }
  }

  return limit ? events.slice(0, limit) : events;
}

/**
 * Parse a JSONL line into a CoordinatorEvent
 * 
 * @param line - JSONL line to parse
 * @returns Parsed and validated event, or null if invalid
 */
function parseLine(line: string): CoordinatorEvent | null {
  try {
    const parsed = JSON.parse(line);
    return CoordinatorEventSchema.parse(parsed);
  } catch {
    // Invalid JSON or failed validation - skip silently
    return null;
  }
}

/**
 * Load COMPACTION events from a file using streaming (for large files)
 * 
 * @param filePath - Path to session JSONL file
 * @param options - Filter options
 * @returns Array of matching compaction events
 */
async function loadFromFileStream(
  filePath: string,
  options: {
    compaction_type?: LoadOptions["compaction_type"];
    remainingLimit?: number;
  },
): Promise<CompactionEvent[]> {
  const { compaction_type, remainingLimit } = options;
  const events: CompactionEvent[] = [];

  const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of rl) {
    const event = parseLine(line);
    if (event && event.event_type === "COMPACTION") {
      if (!compaction_type || event.compaction_type === compaction_type) {
        events.push(event);

        // Early termination for streaming
        if (remainingLimit && events.length >= remainingLimit) {
          rl.close();
          fileStream.close();
          break;
        }
      }
    }
  }

  return events;
}

/**
 * Load COMPACTION sessions grouped by session_id
 *
 * Groups COMPACTION events by session_id and returns session metadata.
 *
 * @param sessionDir - Path to session directory
 * @param options - Filter options
 * @returns Array of compaction sessions
 *
 * @example
 * // Load all sessions with COMPACTION events
 * const sessions = await loadCompactionSessions("/path/to/sessions");
 *
 * @example
 * // Load sessions with specific compaction_type
 * const sessions = await loadCompactionSessions("/path/to/sessions", {
 *   compaction_type: "prompt_generated",
 * });
 */
export async function loadCompactionSessions(
  sessionDir: string,
  options?: LoadOptions,
): Promise<CompactionSession[]> {
  const events = await loadCompactionEvents(sessionDir, options);

  if (events.length === 0) {
    return [];
  }

  // Group events by session_id
  const sessionMap = new Map<string, CompactionEvent[]>();

  for (const event of events) {
    const existing = sessionMap.get(event.session_id);
    if (existing) {
      existing.push(event);
    } else {
      sessionMap.set(event.session_id, [event]);
    }
  }

  // Build sessions with metadata
  const sessions: CompactionSession[] = [];

  for (const [sessionId, sessionEvents] of sessionMap.entries()) {
    if (sessionEvents.length === 0) {
      continue;
    }

    // Get epic_id from first event
    const epicId = sessionEvents[0].epic_id;

    // Get timestamps
    const timestamps = sessionEvents.map((e) => new Date(e.timestamp).getTime());
    const startTime = new Date(Math.min(...timestamps)).toISOString();
    const endTime = new Date(Math.max(...timestamps)).toISOString();

    sessions.push({
      session_id: sessionId,
      epic_id: epicId,
      start_time: startTime,
      end_time: endTime,
      events: sessionEvents,
    });
  }

  // Apply limit
  return options?.limit ? sessions.slice(0, options.limit) : sessions;
}

/**
 * Load COMPACTION events from default session directory
 *
 * Convenience wrapper that uses the default ~/.config/swarm-tools/sessions directory.
 *
 * @param options - Filter options
 * @returns Array of compaction events
 *
 * @example
 * // Load recent compaction events
 * const events = await loadDefaultCompactionEvents({ limit: 10 });
 */
export async function loadDefaultCompactionEvents(
  options?: LoadOptions,
): Promise<CompactionEvent[]> {
  const { getSessionDir } = await import("../../src/eval-capture.js");
  return loadCompactionEvents(getSessionDir(), options);
}

/**
 * Load COMPACTION sessions from default session directory
 *
 * Convenience wrapper that uses the default ~/.config/swarm-tools/sessions directory.
 *
 * @param options - Filter options
 * @returns Array of compaction sessions
 *
 * @example
 * // Load all compaction sessions
 * const sessions = await loadDefaultCompactionSessions();
 */
export async function loadDefaultCompactionSessions(
  options?: LoadOptions,
): Promise<CompactionSession[]> {
  const { getSessionDir } = await import("../../src/eval-capture.js");
  return loadCompactionSessions(getSessionDir(), options);
}
