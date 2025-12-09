#!/usr/bin/env bun
/**
 * OpenCode Swarm Plugin CLI
 *
 * A beautiful interactive CLI for setting up and managing swarm coordination.
 *
 * Commands:
 *   swarm setup    - Interactive installer for all dependencies
 *   swarm doctor   - Check dependency health with detailed status
 *   swarm init     - Initialize swarm in current project
 *   swarm version  - Show version info
 *   swarm          - Interactive mode (same as setup)
 */

import * as p from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const VERSION = "0.9.0";

// ============================================================================
// Types
// ============================================================================

interface Dependency {
  name: string;
  command: string;
  checkArgs: string[];
  required: boolean;
  install: string;
  installType: "brew" | "curl" | "go" | "npm" | "manual";
  description: string;
}

interface CheckResult {
  dep: Dependency;
  available: boolean;
  version?: string;
}

// ============================================================================
// Dependencies
// ============================================================================

const DEPENDENCIES: Dependency[] = [
  {
    name: "OpenCode",
    command: "opencode",
    checkArgs: ["--version"],
    required: true,
    install: "brew install sst/tap/opencode",
    installType: "brew",
    description: "AI coding assistant (plugin host)",
  },
  {
    name: "Beads",
    command: "bd",
    checkArgs: ["--version"],
    required: true,
    install:
      "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash",
    installType: "curl",
    description: "Git-backed issue tracking",
  },
  {
    name: "Go",
    command: "go",
    checkArgs: ["version"],
    required: false,
    install: "brew install go",
    installType: "brew",
    description: "Required for Agent Mail",
  },
  {
    name: "Agent Mail",
    command: "agent-mail",
    checkArgs: ["--help"],
    required: false,
    install: "go install github.com/joelhooks/agent-mail/cmd/agent-mail@latest",
    installType: "go",
    description: "Multi-agent coordination & file reservations",
  },
  {
    name: "CASS",
    command: "cass",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/Dicklesworthstone/cass",
    installType: "manual",
    description: "Cross-agent session search",
  },
  {
    name: "UBS",
    command: "ubs",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/joelhooks/ubs",
    installType: "manual",
    description: "Pre-commit bug scanning",
  },
  {
    name: "semantic-memory",
    command: "semantic-memory",
    checkArgs: ["--help"],
    required: false,
    install: "npm install -g semantic-memory",
    installType: "npm",
    description: "Learning persistence with vector search",
  },
  {
    name: "Redis",
    command: "redis-cli",
    checkArgs: ["ping"],
    required: false,
    install: "brew install redis && brew services start redis",
    installType: "brew",
    description: "Rate limiting (SQLite fallback available)",
  },
];

// ============================================================================
// Utilities
// ============================================================================

async function checkCommand(
  cmd: string,
  args: string[],
): Promise<{ available: boolean; version?: string }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      const output = await new Response(proc.stdout).text();
      const versionMatch = output.match(/v?(\d+\.\d+\.\d+)/);
      return { available: true, version: versionMatch?.[1] };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

async function runInstall(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function checkAllDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const dep of DEPENDENCIES) {
    const { available, version } = await checkCommand(
      dep.command,
      dep.checkArgs,
    );
    results.push({ dep, available, version });
  }
  return results;
}

// ============================================================================
// File Templates
// ============================================================================

const PLUGIN_WRAPPER = `import { SwarmPlugin } from "opencode-swarm-plugin"
export default SwarmPlugin
`;

const SWARM_COMMAND = `---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Take a complex task, break it into beads, and unleash parallel agents.

## Usage

/swarm <task description or bead-id>

## Workflow

1. **Initialize**: \`agentmail_init\` with project_path and task_description
2. **Decompose**: Use \`swarm_select_strategy\` then \`swarm_plan_prompt\` to break down the task
3. **Create beads**: \`beads_create_epic\` with subtasks and file assignments
4. **Reserve files**: \`agentmail_reserve\` for each subtask's files
5. **Spawn agents**: Use Task tool with \`swarm_spawn_subtask\` prompts - spawn ALL in parallel
6. **Monitor**: Check \`agentmail_inbox\` for progress, use \`agentmail_summarize_thread\` for overview
7. **Complete**: \`swarm_complete\` when done, then \`beads_sync\` to push

## Strategy Selection

The plugin auto-selects decomposition strategy based on task keywords:

| Strategy      | Best For                | Keywords                               |
| ------------- | ----------------------- | -------------------------------------- |
| file-based    | Refactoring, migrations | refactor, migrate, rename, update all  |
| feature-based | New features            | add, implement, build, create, feature |
| risk-based    | Bug fixes, security     | fix, bug, security, critical, urgent   |

Begin decomposition now.
`;

const PLANNER_AGENT = `---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: claude-sonnet-4-5
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

1. Call \`swarm_select_strategy\` to analyze the task
2. Call \`swarm_plan_prompt\` to get strategy-specific guidance
3. Create a BeadTree following the guidelines
4. Return ONLY valid JSON - no markdown, no explanation

## Output Format

\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "...",
      "files": ["src/..."],
      "dependencies": [],
      "estimated_complexity": 2
    }
  ]
}
\`\`\`

## Rules

- 2-7 subtasks (too few = not parallel, too many = overhead)
- No file overlap between subtasks
- Include tests with the code they test
- Order by dependency (if B needs A, A comes first)
`;

// ============================================================================
// Commands
// ============================================================================

async function doctor() {
  p.intro("swarm doctor v" + VERSION);

  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();

  s.stop("Dependencies checked");

  const required = results.filter((r) => r.dep.required);
  const optional = results.filter((r) => !r.dep.required);

  p.log.step("Required dependencies:");
  for (const { dep, available, version } of required) {
    if (available) {
      p.log.success(dep.name + (version ? " v" + version : ""));
    } else {
      p.log.error(dep.name + " - not found");
      p.log.message("  Install: " + dep.install);
    }
  }

  p.log.step("Optional dependencies:");
  for (const { dep, available, version } of optional) {
    if (available) {
      p.log.success(
        dep.name + (version ? " v" + version : "") + " - " + dep.description,
      );
    } else {
      p.log.warn(dep.name + " - not found (" + dep.description + ")");
      if (dep.installType !== "manual") {
        p.log.message("  Install: " + dep.install);
      } else {
        p.log.message("  See: " + dep.install);
      }
    }
  }

  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  if (requiredMissing.length > 0) {
    p.outro(
      "Missing " +
        requiredMissing.length +
        " required dependencies. Run 'swarm setup' to install.",
    );
    process.exit(1);
  } else if (optionalMissing.length > 0) {
    p.outro(
      "All required dependencies installed. " +
        optionalMissing.length +
        " optional missing.",
    );
  } else {
    p.outro("All dependencies installed!");
  }
}

async function setup() {
  console.clear();
  p.intro("opencode-swarm-plugin v" + VERSION);

  const s = p.spinner();
  s.start("Checking dependencies...");

  const results = await checkAllDependencies();

  s.stop("Dependencies checked");

  const required = results.filter((r) => r.dep.required);
  const optional = results.filter((r) => !r.dep.required);
  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  for (const { dep, available } of results) {
    if (available) {
      p.log.success(dep.name);
    } else if (dep.required) {
      p.log.error(dep.name + " (required)");
    } else {
      p.log.warn(dep.name + " (optional)");
    }
  }

  if (requiredMissing.length > 0) {
    p.log.step("Missing " + requiredMissing.length + " required dependencies");

    for (const { dep } of requiredMissing) {
      const shouldInstall = await p.confirm({
        message: "Install " + dep.name + "? (" + dep.description + ")",
        initialValue: true,
      });

      if (p.isCancel(shouldInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (shouldInstall) {
        const installSpinner = p.spinner();
        installSpinner.start("Installing " + dep.name + "...");

        const success = await runInstall(dep.install);

        if (success) {
          installSpinner.stop(dep.name + " installed");
        } else {
          installSpinner.stop("Failed to install " + dep.name);
          p.log.error("Manual install: " + dep.install);
        }
      } else {
        p.log.warn("Skipping " + dep.name + " - swarm may not work correctly");
      }
    }
  }

  if (optionalMissing.length > 0) {
    const installable = optionalMissing.filter(
      (r) => r.dep.installType !== "manual",
    );

    if (installable.length > 0) {
      const toInstall = await p.multiselect({
        message: "Install optional dependencies?",
        options: installable.map(({ dep }) => ({
          value: dep.name,
          label: dep.name,
          hint: dep.description,
        })),
        required: false,
      });

      if (p.isCancel(toInstall)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      if (Array.isArray(toInstall) && toInstall.length > 0) {
        for (const name of toInstall) {
          const { dep } = installable.find((r) => r.dep.name === name)!;

          if (dep.name === "Agent Mail") {
            const goResult = results.find((r) => r.dep.name === "Go");
            if (!goResult?.available) {
              p.log.warn("Agent Mail requires Go. Installing Go first...");
              const goDep = DEPENDENCIES.find((d) => d.name === "Go")!;
              const goSpinner = p.spinner();
              goSpinner.start("Installing Go...");
              const goSuccess = await runInstall(goDep.install);
              if (goSuccess) {
                goSpinner.stop("Go installed");
              } else {
                goSpinner.stop("Failed to install Go");
                p.log.error("Cannot install Agent Mail without Go");
                continue;
              }
            }
          }

          const installSpinner = p.spinner();
          installSpinner.start("Installing " + dep.name + "...");

          const success = await runInstall(dep.install);

          if (success) {
            installSpinner.stop(dep.name + " installed");
          } else {
            installSpinner.stop("Failed to install " + dep.name);
            p.log.message("  Manual: " + dep.install);
          }
        }
      }
    }

    const manual = optionalMissing.filter(
      (r) => r.dep.installType === "manual",
    );
    if (manual.length > 0) {
      p.log.step("Manual installation required:");
      for (const { dep } of manual) {
        p.log.message("  " + dep.name + ": " + dep.install);
      }
    }
  }

  p.log.step("Setting up OpenCode integration...");

  const configDir = join(homedir(), ".config", "opencode");
  const pluginsDir = join(configDir, "plugins");
  const commandsDir = join(configDir, "commands");
  const agentsDir = join(configDir, "agents");

  for (const dir of [pluginsDir, commandsDir, agentsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const pluginPath = join(pluginsDir, "swarm.ts");
  const commandPath = join(commandsDir, "swarm.md");
  const agentPath = join(agentsDir, "swarm-planner.md");

  writeFileSync(pluginPath, PLUGIN_WRAPPER);
  p.log.success("Plugin: " + pluginPath);

  writeFileSync(commandPath, SWARM_COMMAND);
  p.log.success("Command: " + commandPath);

  writeFileSync(agentPath, PLANNER_AGENT);
  p.log.success("Agent: " + agentPath);

  p.note(
    'cd your-project\nbd init\nopencode\n/swarm "your task"',
    "Next steps",
  );

  p.outro("Setup complete! Run 'swarm doctor' to verify.");
}

async function init() {
  p.intro("swarm init v" + VERSION);

  const gitDir = existsSync(".git");
  if (!gitDir) {
    p.log.error("Not in a git repository");
    p.log.message("Run 'git init' first, or cd to a git repo");
    p.outro("Aborted");
    process.exit(1);
  }

  const beadsDir = existsSync(".beads");
  if (beadsDir) {
    p.log.warn("Beads already initialized in this project");

    const reinit = await p.confirm({
      message: "Re-initialize beads?",
      initialValue: false,
    });

    if (p.isCancel(reinit) || !reinit) {
      p.outro("Aborted");
      process.exit(0);
    }
  }

  const s = p.spinner();
  s.start("Initializing beads...");

  const success = await runInstall("bd init");

  if (success) {
    s.stop("Beads initialized");
    p.log.success("Created .beads/ directory");

    const createBead = await p.confirm({
      message: "Create your first bead?",
      initialValue: true,
    });

    if (!p.isCancel(createBead) && createBead) {
      const title = await p.text({
        message: "Bead title:",
        placeholder: "Implement user authentication",
        validate: (v) => (v.length === 0 ? "Title required" : undefined),
      });

      if (!p.isCancel(title)) {
        const typeResult = await p.select({
          message: "Type:",
          options: [
            { value: "feature", label: "Feature", hint: "New functionality" },
            { value: "bug", label: "Bug", hint: "Something broken" },
            { value: "task", label: "Task", hint: "General work item" },
            { value: "chore", label: "Chore", hint: "Maintenance" },
          ],
        });

        if (!p.isCancel(typeResult)) {
          const beadSpinner = p.spinner();
          beadSpinner.start("Creating bead...");

          const createSuccess = await runInstall(
            'bd create --title "' + title + '" --type ' + typeResult,
          );

          if (createSuccess) {
            beadSpinner.stop("Bead created");
          } else {
            beadSpinner.stop("Failed to create bead");
          }
        }
      }
    }

    p.outro("Project initialized! Use '/swarm' in OpenCode to get started.");
  } else {
    s.stop("Failed to initialize beads");
    p.log.error("Make sure 'bd' is installed: swarm doctor");
    p.outro("Aborted");
    process.exit(1);
  }
}

function version() {
  console.log("opencode-swarm-plugin v" + VERSION);
}

function help() {
  console.log(`
opencode-swarm-plugin v${VERSION}

Multi-agent swarm coordination for OpenCode.

Commands:
  swarm setup    Interactive installer - checks and installs dependencies
  swarm doctor   Health check - shows status of all dependencies  
  swarm init     Initialize beads in current project
  swarm version  Show version
  swarm help     Show this help

After setup, use in OpenCode:
  /swarm "Add user authentication with OAuth"
  @swarm-planner "Refactor components to use hooks"

Documentation: https://github.com/joelhooks/opencode-swarm-plugin
`);
}

// ============================================================================
// Main
// ============================================================================

const command = process.argv[2];

switch (command) {
  case "setup":
    await setup();
    break;
  case "doctor":
    await doctor();
    break;
  case "init":
    await init();
    break;
  case "version":
  case "--version":
  case "-v":
    version();
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  case undefined:
    await setup();
    break;
  default:
    console.error("Unknown command: " + command);
    help();
    process.exit(1);
}
