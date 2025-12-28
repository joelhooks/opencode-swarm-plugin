/**
 * Logger infrastructure using Pino
 *
 * Features:
 * - File logging to ~/.config/swarm-tools/logs/ (when SWARM_LOG_FILE=1)
 * - Pretty mode for development (SWARM_LOG_PRETTY=1 env var)
 * - Default: stdout JSON logging (works everywhere including global installs)
 *
 * NOTE: We intentionally avoid pino.transport() because it spawns worker_threads
 * that have module resolution issues in bundled/global-install contexts.
 * Uses pino.destination() for sync file writes instead.
 */

import { mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Logger } from "pino";
import pino from "pino";

const DEFAULT_LOG_DIR = join(homedir(), ".config", "swarm-tools", "logs");

/**
 * Creates the log directory if it doesn't exist
 */
function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
}

const loggerCache = new Map<string, Logger>();

/**
 * Gets or creates the main logger instance
 *
 * Logging modes (set via environment variables):
 * - Default: stdout JSON (works in all contexts)
 * - SWARM_LOG_FILE=1: writes to ~/.config/swarm-tools/logs/swarm.log
 * - SWARM_LOG_PRETTY=1: pretty console output (requires pino-pretty installed)
 *
 * @param logDir - Optional log directory (defaults to ~/.config/swarm-tools/logs)
 * @returns Pino logger instance
 */
export function getLogger(logDir: string = DEFAULT_LOG_DIR): Logger {
  const cacheKey = `swarm:${logDir}`;

  if (loggerCache.has(cacheKey)) {
    return loggerCache.get(cacheKey)!;
  }

  const baseConfig = {
    level: process.env.LOG_LEVEL || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  let logger: Logger;

  if (process.env.SWARM_LOG_FILE === "1") {
    // File logging mode - use pino.destination for sync file writes
    ensureLogDir(logDir);
    const logPath = join(logDir, "swarm.log");
    logger = pino(baseConfig, pino.destination({ dest: logPath, sync: false }));
  } else {
    // Default: stdout logging (works in bundled CLI, global installs, everywhere)
    logger = pino(baseConfig);
  }

  loggerCache.set(cacheKey, logger);
  return logger;
}

/**
 * Creates a child logger for a specific module
 *
 * @param module - Module name (e.g., "compaction", "cli")
 * @param logDir - Optional log directory (defaults to ~/.config/swarm-tools/logs)
 * @returns Child logger instance
 */
export function createChildLogger(
  module: string,
  logDir: string = DEFAULT_LOG_DIR,
): Logger {
  const cacheKey = `${module}:${logDir}`;

  if (loggerCache.has(cacheKey)) {
    return loggerCache.get(cacheKey)!;
  }

  const baseConfig = {
    level: process.env.LOG_LEVEL || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  let childLogger: Logger;

  if (process.env.SWARM_LOG_FILE === "1") {
    // File logging mode
    ensureLogDir(logDir);
    const logPath = join(logDir, `${module}.log`);
    childLogger = pino(baseConfig, pino.destination({ dest: logPath, sync: false }));
  } else {
    // Default: stdout logging
    childLogger = pino(baseConfig);
  }

  const logger = childLogger.child({ module });
  loggerCache.set(cacheKey, logger);
  return logger;
}

/**
 * Default logger instance for immediate use
 */
export const logger = getLogger();
