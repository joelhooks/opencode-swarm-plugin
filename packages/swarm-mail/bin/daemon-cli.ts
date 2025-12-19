#!/usr/bin/env bun
/**
 * swarm-mail-daemon CLI
 *
 * Command-line interface for managing the in-process PGLiteSocketServer daemon.
 *
 * Commands:
 *   start [options]  - Start the in-process daemon
 *   stop             - Stop the daemon
 *   status           - Show daemon status
 *
 * @example
 * ```bash
 * # Start daemon on default port
 * swarm-mail-daemon start
 *
 * # Start with custom port
 * swarm-mail-daemon start --port 5555
 *
 * # Start with Unix socket
 * swarm-mail-daemon start --path /tmp/swarm-mail.sock
 *
 * # Check status
 * swarm-mail-daemon status
 *
 * # Stop daemon
 * swarm-mail-daemon stop
 * ```
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
	type DaemonOptions,
	getPidFilePath,
	healthCheck,
	isDaemonRunning,
	startDaemon,
	stopDaemon,
} from "../src/daemon";

// Colors for terminal output
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function success(msg: string) {
	console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function error(msg: string) {
	console.error(`${colors.red}✗${colors.reset} ${msg}`);
}

function info(msg: string) {
	console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function showHelp() {
	console.log(`
${colors.bold}swarm-mail-daemon${colors.reset} - Manage in-process PGLiteSocketServer daemon

${colors.bold}USAGE${colors.reset}
  swarm-mail-daemon <command> [options]

${colors.bold}COMMANDS${colors.reset}
  start [options]  Start the in-process daemon
  stop             Stop the daemon
  status           Show daemon status

${colors.bold}START OPTIONS${colors.reset}
  --port <number>    TCP port to bind (default: 5433)
  --host <string>    Host to bind (default: 127.0.0.1)
  --path <string>    Unix socket path (alternative to port/host)
  --db <string>      Database path (default: .opencode/streams or ~/.opencode/streams)
  --project <string> Project path for PID file location

${colors.bold}EXAMPLES${colors.reset}
  # Start daemon on default port
  swarm-mail-daemon start

  # Start with custom port
  swarm-mail-daemon start --port 5555

  # Start with Unix socket
  swarm-mail-daemon start --path /tmp/swarm-mail.sock

  # Start with custom database path
  swarm-mail-daemon start --db /custom/db/path

  # Check status
  swarm-mail-daemon status

  # Stop daemon
  swarm-mail-daemon stop
`);
}

/**
 * Read PID from PID file
 */
async function readPid(projectPath?: string): Promise<number | null> {
	const pidFilePath = getPidFilePath(projectPath);
	if (!existsSync(pidFilePath)) {
		return null;
	}
	try {
		const content = await readFile(pidFilePath, "utf-8");
		const pid = Number.parseInt(content.trim(), 10);
		if (Number.isNaN(pid) || pid <= 0) {
			return null;
		}
		return pid;
	} catch {
		return null;
	}
}

/**
 * Start command handler
 */
async function startCommand(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			port: { type: "string", short: "p" },
			host: { type: "string", short: "h" },
			path: { type: "string" },
			db: { type: "string" },
			project: { type: "string" },
			help: { type: "boolean" },
		},
	});

	if (values.help) {
		showHelp();
		return;
	}

	const options: DaemonOptions = {
		port: values.port ? Number.parseInt(values.port, 10) : undefined,
		host: values.host,
		path: values.path,
		dbPath: values.db,
		projectPath: values.project,
	};

	try {
		// Check if already running
		if (await isDaemonRunning(options.projectPath)) {
			const pid = await readPid(options.projectPath);
			const connInfo = options.path
				? `socket=${options.path}`
				: `port=${options.port || 5433}`;
			info(`Daemon already running (PID: ${pid}, ${connInfo})`);
			return;
		}

		info("Starting daemon...");
		const daemonInfo = await startDaemon(options);

		const connInfo = daemonInfo.socketPath
			? `socket=${daemonInfo.socketPath}`
			: `port=${daemonInfo.port}`;
		success(`Daemon started (PID: ${daemonInfo.pid}, ${connInfo})`);
	} catch (err) {
		error(
			`Failed to start daemon: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}
}

/**
 * Stop command handler
 */
async function stopCommand(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			project: { type: "string" },
			help: { type: "boolean" },
		},
	});

	if (values.help) {
		showHelp();
		return;
	}

	try {
		const pid = await readPid(values.project);

		if (!pid || !(await isDaemonRunning(values.project))) {
			info("Daemon is not running");
			return;
		}

		info(`Stopping daemon (PID: ${pid})...`);
		await stopDaemon(values.project);
		success("Daemon stopped");
	} catch (err) {
		error(
			`Failed to stop daemon: ${err instanceof Error ? err.message : String(err)}`,
		);
		process.exit(1);
	}
}

/**
 * Status command handler
 */
async function statusCommand(args: string[]): Promise<void> {
	const { values } = parseArgs({
		args,
		options: {
			port: { type: "string", short: "p" },
			host: { type: "string", short: "h" },
			path: { type: "string" },
			project: { type: "string" },
			help: { type: "boolean" },
		},
	});

	if (values.help) {
		showHelp();
		return;
	}

	const projectPath = values.project;
	const pid = await readPid(projectPath);
	const running = await isDaemonRunning(projectPath);

	if (!running) {
		console.log(`${colors.bold}Status:${colors.reset} ${colors.red}Stopped${colors.reset}`);
		console.log(`${colors.bold}PID File:${colors.reset} ${getPidFilePath(projectPath)}`);
		return;
	}

	// Daemon is running - check health
	const port = values.port ? Number.parseInt(values.port, 10) : 5433;
	const host = values.host || "127.0.0.1";
	const path = values.path;

	const healthOptions = path ? { path } : { port, host };
	const healthy = await healthCheck(healthOptions);

	console.log(
		`${colors.bold}Status:${colors.reset} ${colors.green}Running${colors.reset}`,
	);
	console.log(`${colors.bold}PID:${colors.reset} ${pid}`);
	console.log(`${colors.bold}PID File:${colors.reset} ${getPidFilePath(projectPath)}`);

	if (path) {
		console.log(`${colors.bold}Socket:${colors.reset} ${path}`);
	} else {
		console.log(`${colors.bold}Host:${colors.reset} ${host}`);
		console.log(`${colors.bold}Port:${colors.reset} ${port}`);
	}

	console.log(
		`${colors.bold}Health:${colors.reset} ${healthy ? `${colors.green}OK${colors.reset}` : `${colors.red}Failed${colors.reset}`}`,
	);
}

/**
 * Main CLI entrypoint
 */
async function main() {
	const [command, ...args] = process.argv.slice(2);

	if (!command || command === "help" || command === "--help" || command === "-h") {
		showHelp();
		process.exit(0);
	}

	switch (command) {
		case "start":
			await startCommand(args);
			break;
		case "stop":
			await stopCommand(args);
			break;
		case "status":
			await statusCommand(args);
			break;
		default:
			error(`Unknown command: ${command}`);
			showHelp();
			process.exit(1);
	}
}

main().catch((err) => {
	error(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
	process.exit(1);
});
