/**
 * Beads Module - Type-safe wrappers around the `bd` CLI
 *
 * This module provides validated, type-safe operations for the beads
 * issue tracker. All responses are parsed and validated with Zod schemas.
 *
 * Key principles:
 * - Always use `--json` flag for bd commands
 * - Validate all output with Zod schemas
 * - Throw typed errors on failure
 * - Support atomic epic creation with rollback hints
 *
 * IMPORTANT: Call setBeadsWorkingDirectory() before using tools to ensure
 * bd commands run in the correct project directory.
 */
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";

// ============================================================================
// Working Directory Configuration
// ============================================================================

/**
 * Module-level working directory for bd commands.
 * Set this via setBeadsWorkingDirectory() before using tools.
 * If not set, commands run in process.cwd() which may be wrong for plugins.
 */
let beadsWorkingDirectory: string | null = null;

/**
 * Set the working directory for all beads commands.
 * Call this from the plugin initialization with the project directory.
 *
 * @param directory - Absolute path to the project directory
 */
export function setBeadsWorkingDirectory(directory: string): void {
  beadsWorkingDirectory = directory;
}

/**
 * Get the current working directory for beads commands.
 * Returns the configured directory or process.cwd() as fallback.
 */
export function getBeadsWorkingDirectory(): string {
  return beadsWorkingDirectory || process.cwd();
}

/**
 * Run a bd command in the correct working directory.
 * Uses Bun.spawn with cwd option to ensure commands run in project directory.
 */
async function runBdCommand(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = getBeadsWorkingDirectory();
  const proc = Bun.spawn(["bd", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

/**
 * Run a git command in the correct working directory.
 */
async function runGitCommand(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cwd = getBeadsWorkingDirectory();
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

import {
  BeadSchema,
  BeadCreateArgsSchema,
  BeadUpdateArgsSchema,
  BeadCloseArgsSchema,
  BeadQueryArgsSchema,
  EpicCreateArgsSchema,
  EpicCreateResultSchema,
  type Bead,
  type BeadCreateArgs,
  type EpicCreateResult,
} from "./schemas";

/**
 * Custom error for bead operations
 */
export class BeadError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode?: number,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = "BeadError";
  }
}

/**
 * Custom error for validation failures
 */
export class BeadValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
  ) {
    super(message);
    this.name = "BeadValidationError";
  }
}

/**
 * Build a bd create command from args
 *
 * Note: Bun's `$` template literal properly escapes arguments when passed as array.
 * Each array element is treated as a separate argument, preventing shell injection.
 * Example: ["bd", "create", "; rm -rf /"] becomes: bd create "; rm -rf /"
 */
function buildCreateCommand(args: BeadCreateArgs): string[] {
  const parts = ["bd", "create", args.title];

  if (args.type && args.type !== "task") {
    parts.push("-t", args.type);
  }

  if (args.priority !== undefined && args.priority !== 2) {
    parts.push("-p", args.priority.toString());
  }

  if (args.description) {
    parts.push("-d", args.description);
  }

  if (args.parent_id) {
    parts.push("--parent", args.parent_id);
  }

  // Custom ID for human-readable bead names (e.g., 'phase-0', 'phase-1.e2e-test')
  if (args.id) {
    parts.push("--id", args.id);
  }

  parts.push("--json");
  return parts;
}

/**
 * Parse and validate bead JSON output
 * Handles both object and array responses (CLI may return either)
 */
function parseBead(output: string): Bead {
  try {
    const parsed = JSON.parse(output);
    // CLI commands like `bd close`, `bd update` return arrays even for single items
    const data = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!data) {
      throw new BeadError(
        "No bead data in response. The bd CLI may not be installed or returned unexpected output. Try: Run 'bd --version' to verify installation, or check if .beads/ directory exists in project.",
        "parse",
      );
    }
    return BeadSchema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BeadValidationError(
        `Invalid bead data: ${error.message}`,
        error,
      );
    }
    if (error instanceof BeadError) {
      throw error;
    }
    throw new BeadError(
      `Failed to parse bead JSON because output is malformed. Try: Check if bd CLI is up to date with 'bd --version' (need v1.0.0+), or inspect output: ${output.slice(0, 100)}`,
      "parse",
    );
  }
}

/**
 * Parse and validate array of beads
 */
function parseBeads(output: string): Bead[] {
  try {
    const parsed = JSON.parse(output);
    return z.array(BeadSchema).parse(parsed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BeadValidationError(
        `Invalid beads data: ${error.message}`,
        error,
      );
    }
    throw new BeadError(
      `Failed to parse beads JSON because output is malformed. Try: Check if bd CLI is up to date with 'bd --version' (need v1.0.0+), or inspect output: ${output.slice(0, 100)}`,
      "parse",
    );
  }
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create a new bead with type-safe validation
 */
export const beads_create = tool({
  description: "Create a new bead with type-safe validation",
  args: {
    title: tool.schema.string().describe("Bead title"),
    type: tool.schema
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Issue type (default: task)"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("Priority 0-3 (default: 2)"),
    description: tool.schema.string().optional().describe("Bead description"),
    parent_id: tool.schema
      .string()
      .optional()
      .describe("Parent bead ID for epic children"),
  },
  async execute(args, ctx) {
    const validated = BeadCreateArgsSchema.parse(args);
    const cmdParts = buildCreateCommand(validated);

    // Execute command in the correct working directory
    const result = await runBdCommand(cmdParts.slice(1)); // Remove 'bd' prefix

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to create bead because bd command exited with code ${result.exitCode}. Error: ${result.stderr}. Try: Check if beads initialized with 'bd init' in project root, or verify .beads/ directory exists.`,
        cmdParts.join(" "),
        result.exitCode,
        result.stderr,
      );
    }

    // Validate output before parsing
    const stdout = result.stdout.trim();
    if (!stdout) {
      throw new BeadError(
        "bd create returned empty output because command produced no response. Try: Check if bd is properly installed with 'bd --version', or run 'bd list' to test basic functionality.",
        cmdParts.join(" "),
        0,
        "Empty stdout",
      );
    }

    // Check for error messages in stdout (bd sometimes outputs errors to stdout)
    if (stdout.startsWith("error:") || stdout.startsWith("Error:")) {
      throw new BeadError(
        `bd create failed because command returned error in stdout: ${stdout}. Try: Check error message above, verify beads initialized with 'bd init', or check .beads/issues.jsonl for corruption.`,
        cmdParts.join(" "),
        0,
        stdout,
      );
    }

    const bead = parseBead(stdout);
    return JSON.stringify(bead, null, 2);
  },
});

/**
 * Create an epic with subtasks in one atomic operation
 */
export const beads_create_epic = tool({
  description: "Create epic with subtasks in one atomic operation",
  args: {
    epic_title: tool.schema.string().describe("Epic title"),
    epic_description: tool.schema
      .string()
      .optional()
      .describe("Epic description"),
    epic_id: tool.schema
      .string()
      .optional()
      .describe("Custom ID for the epic (e.g., 'phase-0')"),
    subtasks: tool.schema
      .array(
        tool.schema.object({
          title: tool.schema.string(),
          priority: tool.schema.number().min(0).max(3).optional(),
          files: tool.schema.array(tool.schema.string()).optional(),
          id_suffix: tool.schema
            .string()
            .optional()
            .describe(
              "Custom ID suffix (e.g., 'e2e-test' becomes 'phase-0.e2e-test')",
            ),
        }),
      )
      .describe("Subtasks to create under the epic"),
  },
  async execute(args, ctx) {
    const validated = EpicCreateArgsSchema.parse(args);
    const created: Bead[] = [];

    try {
      // 1. Create epic
      const epicCmd = buildCreateCommand({
        title: validated.epic_title,
        type: "epic",
        priority: 1,
        description: validated.epic_description,
        id: validated.epic_id,
      });

      const epicResult = await runBdCommand(epicCmd.slice(1)); // Remove 'bd' prefix

      if (epicResult.exitCode !== 0) {
        throw new BeadError(
          `Failed to create epic because bd command failed: ${epicResult.stderr}. Try: Verify beads initialized with 'bd init', check if .beads/ directory is writable, or run 'bd list' to test basic functionality.`,
          epicCmd.join(" "),
          epicResult.exitCode,
        );
      }

      const epic = parseBead(epicResult.stdout);
      created.push(epic);

      // 2. Create subtasks
      for (const subtask of validated.subtasks) {
        // Build subtask ID: if epic has custom ID and subtask has suffix, combine them
        // e.g., epic_id='phase-0', id_suffix='e2e-test' → 'phase-0.e2e-test'
        let subtaskId: string | undefined;
        if (validated.epic_id && subtask.id_suffix) {
          subtaskId = `${validated.epic_id}.${subtask.id_suffix}`;
        }

        const subtaskCmd = buildCreateCommand({
          title: subtask.title,
          type: "task",
          priority: subtask.priority ?? 2,
          parent_id: epic.id,
          id: subtaskId,
        });

        const subtaskResult = await runBdCommand(subtaskCmd.slice(1)); // Remove 'bd' prefix

        if (subtaskResult.exitCode !== 0) {
          throw new BeadError(
            `Failed to create subtask because bd command failed: ${subtaskResult.stderr}. Try: Check if parent epic exists with 'bd show ${epic.id}', verify .beads/issues.jsonl is not corrupted, or check for invalid characters in title.`,
            subtaskCmd.join(" "),
            subtaskResult.exitCode,
          );
        }

        const subtaskBead = parseBead(subtaskResult.stdout);
        created.push(subtaskBead);
      }

      const result: EpicCreateResult = {
        success: true,
        epic,
        subtasks: created.slice(1),
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      // Partial failure - execute rollback automatically
      const rollbackCommands: string[] = [];
      const rollbackErrors: string[] = [];

      for (const bead of created) {
        try {
          const closeArgs = [
            "close",
            bead.id,
            "--reason",
            "Rollback partial epic",
            "--json",
          ];
          const rollbackResult = await runBdCommand(closeArgs);
          if (rollbackResult.exitCode === 0) {
            rollbackCommands.push(
              `bd close ${bead.id} --reason "Rollback partial epic"`,
            );
          } else {
            rollbackErrors.push(
              `${bead.id}: exit ${rollbackResult.exitCode} - ${rollbackResult.stderr.trim()}`,
            );
          }
        } catch (rollbackError) {
          // Log rollback failure and collect error
          const errMsg =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          console.error(`Failed to rollback bead ${bead.id}:`, rollbackError);
          rollbackErrors.push(`${bead.id}: ${errMsg}`);
        }
      }

      // Throw error with rollback info including any failures
      const errorMsg = error instanceof Error ? error.message : String(error);
      let rollbackInfo = "";

      if (rollbackCommands.length > 0) {
        rollbackInfo += `\n\nRolled back ${rollbackCommands.length} bead(s):\n${rollbackCommands.join("\n")}`;
      }

      if (rollbackErrors.length > 0) {
        rollbackInfo += `\n\nRollback failures (${rollbackErrors.length}):\n${rollbackErrors.join("\n")}`;
      }

      if (!rollbackInfo) {
        rollbackInfo = "\n\nNo beads to rollback.";
      }

      throw new BeadError(
        `Epic creation failed: ${errorMsg}${rollbackInfo}. Try: If rollback failed, manually close beads with 'bd close <id> --reason "Rollback"', check .beads/issues.jsonl for partial state, or re-run beads_create_epic with corrected parameters.`,
        "beads_create_epic",
        1,
      );
    }
  },
});

/**
 * Query beads with filters
 */
export const beads_query = tool({
  description: "Query beads with filters (replaces bd list, bd ready, bd wip)",
  args: {
    status: tool.schema
      .enum(["open", "in_progress", "blocked", "closed"])
      .optional()
      .describe("Filter by status"),
    type: tool.schema
      .enum(["bug", "feature", "task", "epic", "chore"])
      .optional()
      .describe("Filter by type"),
    ready: tool.schema
      .boolean()
      .optional()
      .describe("Only show unblocked beads (uses bd ready)"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results to return (default: 20)"),
  },
  async execute(args, ctx) {
    const validated = BeadQueryArgsSchema.parse(args);

    let cmd: string[];

    if (validated.ready) {
      cmd = ["bd", "ready", "--json"];
    } else {
      cmd = ["bd", "list", "--json"];
      if (validated.status) {
        cmd.push("--status", validated.status);
      }
      if (validated.type) {
        cmd.push("--type", validated.type);
      }
    }

    const result = await runBdCommand(cmd.slice(1)); // Remove 'bd' prefix

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to query beads because bd command failed: ${result.stderr}. Try: Check if beads initialized with 'bd init', verify .beads/ directory exists, or run 'bd --version' to check CLI version.`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const beads = parseBeads(result.stdout);
    const limited = beads.slice(0, validated.limit);

    return JSON.stringify(limited, null, 2);
  },
});

/**
 * Update a bead's status or description
 */
export const beads_update = tool({
  description: "Update bead status/description",
  args: {
    id: tool.schema.string().describe("Bead ID"),
    status: tool.schema
      .enum(["open", "in_progress", "blocked", "closed"])
      .optional()
      .describe("New status"),
    description: tool.schema.string().optional().describe("New description"),
    priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("New priority"),
  },
  async execute(args, ctx) {
    const validated = BeadUpdateArgsSchema.parse(args);

    const cmd = ["bd", "update", validated.id];

    if (validated.status) {
      cmd.push("--status", validated.status);
    }
    if (validated.description) {
      cmd.push("-d", validated.description);
    }
    if (validated.priority !== undefined) {
      cmd.push("-p", validated.priority.toString());
    }
    cmd.push("--json");

    const result = await runBdCommand(cmd.slice(1)); // Remove 'bd' prefix

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to update bead because bd command failed: ${result.stderr}. Try: Verify bead exists with 'bd show ${validated.id}', check for invalid status values, or inspect .beads/issues.jsonl for corruption.`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const bead = parseBead(result.stdout);
    return JSON.stringify(bead, null, 2);
  },
});

/**
 * Close a bead with reason
 */
export const beads_close = tool({
  description: "Close a bead with reason",
  args: {
    id: tool.schema.string().describe("Bead ID"),
    reason: tool.schema.string().describe("Completion reason"),
  },
  async execute(args, ctx) {
    const validated = BeadCloseArgsSchema.parse(args);

    const cmd = [
      "bd",
      "close",
      validated.id,
      "--reason",
      validated.reason,
      "--json",
    ];

    const result = await runBdCommand(cmd.slice(1)); // Remove 'bd' prefix

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to close bead because bd command failed: ${result.stderr}. Try: Verify bead exists and is not already closed with 'beads_query(status="closed")' or 'bd show ${validated.id}', check if bead ID is correct.`,
        cmd.join(" "),
        result.exitCode,
      );
    }

    const bead = parseBead(result.stdout);
    return `Closed ${bead.id}: ${validated.reason}`;
  },
});

/**
 * Mark a bead as in-progress
 */
export const beads_start = tool({
  description:
    "Mark a bead as in-progress (shortcut for update --status in_progress)",
  args: {
    id: tool.schema.string().describe("Bead ID"),
  },
  async execute(args, ctx) {
    const result = await runBdCommand([
      "update",
      args.id,
      "--status",
      "in_progress",
      "--json",
    ]);

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to start bead because bd update command failed: ${result.stderr}. Try: Verify bead exists with 'bd show ${args.id}', check if already in_progress with 'beads_query(status="in_progress")', or use beads_update directly.`,
        `bd update ${args.id} --status in_progress --json`,
        result.exitCode,
      );
    }

    const bead = parseBead(result.stdout);
    return `Started: ${bead.id}`;
  },
});

/**
 * Get the next ready bead
 */
export const beads_ready = tool({
  description: "Get the next ready bead (unblocked, highest priority)",
  args: {},
  async execute(args, ctx) {
    const result = await runBdCommand(["ready", "--json"]);

    if (result.exitCode !== 0) {
      throw new BeadError(
        `Failed to get ready beads because bd ready command failed: ${result.stderr}. Try: Check if beads initialized with 'bd init', verify .beads/ directory is readable, or run 'bd list --json' to test basic query.`,
        "bd ready --json",
        result.exitCode,
      );
    }

    const beads = parseBeads(result.stdout);

    if (beads.length === 0) {
      return "No ready beads";
    }

    const next = beads[0];
    return JSON.stringify(next, null, 2);
  },
});

/**
 * Sync beads to git and push
 */
export const beads_sync = tool({
  description: "Sync beads to git and push (MANDATORY at session end)",
  args: {
    auto_pull: tool.schema
      .boolean()
      .optional()
      .describe("Pull before sync (default: true)"),
  },
  async execute(args, ctx) {
    const autoPull = args.auto_pull ?? true;
    const TIMEOUT_MS = 30000; // 30 seconds

    /**
     * Helper to run a command with timeout
     * Properly clears the timeout to avoid lingering timers
     */
    const withTimeout = async <T>(
      promise: Promise<T>,
      timeoutMs: number,
      operation: string,
    ): Promise<T> => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () =>
            reject(
              new BeadError(
                `Operation timed out after ${timeoutMs}ms`,
                operation,
              ),
            ),
          timeoutMs,
        );
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
      }
    };

    // 1. Flush beads to JSONL (doesn't use worktrees)
    const flushResult = await withTimeout(
      runBdCommand(["sync", "--flush-only"]),
      TIMEOUT_MS,
      "bd sync --flush-only",
    );
    if (flushResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to flush beads because bd sync failed: ${flushResult.stderr}. Try: Check if .beads/ directory is writable, verify no corrupted JSONL files, or run 'bd list' to test basic beads functionality.`,
        "bd sync --flush-only",
        flushResult.exitCode,
      );
    }

    // 2. Check if there are changes to commit
    const beadsStatusResult = await runGitCommand([
      "status",
      "--porcelain",
      ".beads/",
    ]);
    const hasChanges = beadsStatusResult.stdout.trim() !== "";

    if (hasChanges) {
      // 3. Stage .beads changes
      const addResult = await runGitCommand(["add", ".beads/"]);
      if (addResult.exitCode !== 0) {
        throw new BeadError(
          `Failed to stage beads because git add failed: ${addResult.stderr}. Try: Check if .beads/ directory exists, verify git is initialized with 'git status', or check for .gitignore patterns blocking .beads/.`,
          "git add .beads/",
          addResult.exitCode,
        );
      }

      // 4. Commit
      const commitResult = await withTimeout(
        runGitCommand(["commit", "-m", "chore: sync beads"]),
        TIMEOUT_MS,
        "git commit",
      );
      if (
        commitResult.exitCode !== 0 &&
        !commitResult.stdout.includes("nothing to commit")
      ) {
        throw new BeadError(
          `Failed to commit beads because git commit failed: ${commitResult.stderr}. Try: Check git config (user.name, user.email) with 'git config --list', verify working tree is clean, or check for pre-commit hooks blocking commit.`,
          "git commit",
          commitResult.exitCode,
        );
      }
    }

    // 5. Pull if requested (with rebase to avoid merge commits)
    if (autoPull) {
      // Check for unstaged changes that would block pull --rebase
      const dirtyCheckResult = await runGitCommand([
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]);
      const hasDirtyFiles = dirtyCheckResult.stdout.trim() !== "";
      let didStash = false;

      // Stash dirty files before pull (self-healing for "unstaged changes" error)
      if (hasDirtyFiles) {
        console.warn(
          "[beads] Detected unstaged changes, stashing before pull...",
        );
        const stashResult = await runGitCommand([
          "stash",
          "push",
          "-m",
          "beads_sync: auto-stash before pull",
          "--include-untracked",
        ]);
        if (stashResult.exitCode === 0) {
          didStash = true;
          console.warn("[beads] Changes stashed successfully");
        } else {
          // Stash failed - try pull anyway, it might work
          console.warn(
            `[beads] Stash failed (${stashResult.stderr}), attempting pull anyway...`,
          );
        }
      }

      const pullResult = await withTimeout(
        runGitCommand(["pull", "--rebase"]),
        TIMEOUT_MS,
        "git pull --rebase",
      );

      // Restore stashed changes regardless of pull result
      if (didStash) {
        console.warn("[beads] Restoring stashed changes...");
        const unstashResult = await runGitCommand(["stash", "pop"]);
        if (unstashResult.exitCode !== 0) {
          // Unstash failed - this is bad, user needs to know
          console.error(
            `[beads] WARNING: Failed to restore stashed changes: ${unstashResult.stderr}`,
          );
          console.error(
            "[beads] Your changes are in 'git stash list' - run 'git stash pop' manually",
          );
        } else {
          console.warn("[beads] Stashed changes restored");
        }
      }

      if (pullResult.exitCode !== 0) {
        throw new BeadError(
          `Failed to pull because git pull --rebase failed: ${pullResult.stderr}. Try: Resolve merge conflicts manually with 'git status', check if remote is accessible with 'git remote -v', or use skip_verification to bypass automatic pull.`,
          "git pull --rebase",
          pullResult.exitCode,
        );
      }

      // 6. Import any changes from remote
      const importResult = await withTimeout(
        runBdCommand(["sync", "--import-only"]),
        TIMEOUT_MS,
        "bd sync --import-only",
      );
      if (importResult.exitCode !== 0) {
        // Non-fatal - just log warning
        console.warn(`[beads] Import warning: ${importResult.stderr}`);
      }
    }

    // 7. Push
    const pushResult = await withTimeout(
      runGitCommand(["push"]),
      TIMEOUT_MS,
      "git push",
    );
    if (pushResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to push because git push failed: ${pushResult.stderr}. Try: Check if remote branch is up to date with 'git pull --rebase', verify push permissions, check remote URL with 'git remote -v', or force push with 'git push --force-with-lease' if safe.`,
        "git push",
        pushResult.exitCode,
      );
    }

    // 4. Verify clean state
    const statusResult = await runGitCommand(["status", "--porcelain"]);
    const status = statusResult.stdout.trim();

    if (status !== "") {
      return `Beads synced and pushed, but working directory not clean:\n${status}`;
    }

    return "Beads synced and pushed successfully";
  },
});

/**
 * Link a bead to an Agent Mail thread
 */
export const beads_link_thread = tool({
  description: "Add metadata linking bead to Agent Mail thread",
  args: {
    bead_id: tool.schema.string().describe("Bead ID"),
    thread_id: tool.schema.string().describe("Agent Mail thread ID"),
  },
  async execute(args, ctx) {
    // Update bead description to include thread link
    // This is a workaround since bd doesn't have native metadata support
    const queryResult = await runBdCommand(["show", args.bead_id, "--json"]);

    if (queryResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to get bead because bd show command failed: ${queryResult.stderr}. Try: Verify bead ID is correct with 'beads_query()', check if bead exists with 'bd list --json', or check .beads/issues.jsonl for valid entries.`,
        `bd show ${args.bead_id} --json`,
        queryResult.exitCode,
      );
    }

    const bead = parseBead(queryResult.stdout);
    const existingDesc = bead.description || "";

    // Add thread link if not already present
    const threadMarker = `[thread:${args.thread_id}]`;
    if (existingDesc.includes(threadMarker)) {
      return `Bead ${args.bead_id} already linked to thread ${args.thread_id}`;
    }

    const newDesc = existingDesc
      ? `${existingDesc}\n\n${threadMarker}`
      : threadMarker;

    const updateResult = await runBdCommand([
      "update",
      args.bead_id,
      "-d",
      newDesc,
      "--json",
    ]);

    if (updateResult.exitCode !== 0) {
      throw new BeadError(
        `Failed to update bead because bd update command failed: ${updateResult.stderr}. Try: Verify bead exists with 'bd show ${args.bead_id}', check for invalid characters in description, or inspect .beads/issues.jsonl for corruption.`,
        `bd update ${args.bead_id} -d ...`,
        updateResult.exitCode,
      );
    }

    return `Linked bead ${args.bead_id} to thread ${args.thread_id}`;
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const beadsTools = {
  beads_create: beads_create,
  beads_create_epic: beads_create_epic,
  beads_query: beads_query,
  beads_update: beads_update,
  beads_close: beads_close,
  beads_start: beads_start,
  beads_ready: beads_ready,
  beads_sync: beads_sync,
  beads_link_thread: beads_link_thread,
};
