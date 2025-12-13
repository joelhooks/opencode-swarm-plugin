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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
const VERSION: string = pkg.version;

// ============================================================================
// ASCII Art & Branding
// ============================================================================

const BEE = `
    \\ \` - ' /
   - .(o o). -
    (  >.<  )
     /|   |\\
    (_|   |_)  bzzzz...
`;

const BANNER = `
 ███████╗██╗    ██╗ █████╗ ██████╗ ███╗   ███╗
 ██╔════╝██║    ██║██╔══██╗██╔══██╗████╗ ████║
 ███████╗██║ █╗ ██║███████║██████╔╝██╔████╔██║
 ╚════██║██║███╗██║██╔══██║██╔══██╗██║╚██╔╝██║
 ███████║╚███╔███╔╝██║  ██║██║  ██║██║ ╚═╝ ██║
 ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝
`;

const TAGLINE = "Multi-agent coordination for OpenCode";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const PACKAGE_NAME = "opencode-swarm-plugin";

// ============================================================================
// Seasonal Messages (inspired by Astro's Houston)
// ============================================================================

type Season = "spooky" | "holiday" | "new-year" | "summer" | "default";

function getSeason(): Season {
  const date = new Date();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (month === 1 && day <= 7) return "new-year";
  if (month === 10 && day > 7) return "spooky";
  if (month === 12 && day > 7 && day < 26) return "holiday";
  if (month >= 6 && month <= 8) return "summer";
  return "default";
}

interface SeasonalBee {
  messages: string[];
  decorations?: string[];
}

function getSeasonalBee(): SeasonalBee {
  const season = getSeason();
  const year = new Date().getFullYear();

  switch (season) {
    case "new-year":
      return {
        messages: [
          `New year, new swarm! Let's build something amazing in ${year}!`,
          `${year} is the year of parallel agents! bzzzz...`,
          `Kicking off ${year} with coordinated chaos!`,
          `Happy ${year}! Time to orchestrate some magic.`,
        ],
        decorations: ["🎉", "🎊", "✨"],
      };
    case "spooky":
      return {
        messages: [
          `Boo! Just kidding. Let's spawn some agents!`,
          `The hive is buzzing with spooky energy...`,
          `No tricks here, only parallel treats!`,
          `Let's conjure up a swarm of worker bees!`,
          `Something wicked this way computes...`,
        ],
        decorations: ["🎃", "👻", "🕷️", "🦇"],
      };
    case "holiday":
      return {
        messages: [
          `'Tis the season to parallelize!`,
          `The hive is warm and cozy. Let's build!`,
          `Ho ho ho! Time to unwrap some agents!`,
          `Jingle bells, agents swell, tasks get done today!`,
          `The best gift? A well-coordinated swarm.`,
        ],
        decorations: ["🎄", "🎁", "❄️", "⭐"],
      };
    case "summer":
      return {
        messages: [
          `Summer vibes and parallel pipelines!`,
          `The hive is buzzing in the sunshine!`,
          `Hot code, cool agents. Let's go!`,
          `Beach day? Nah, build day!`,
        ],
        decorations: ["☀️", "🌻", "🌴"],
      };
    default:
      return {
        messages: [
          `The hive awaits your command.`,
          `Ready to coordinate the swarm!`,
          `Let's build something awesome together.`,
          `Parallel agents, standing by.`,
          `Time to orchestrate some magic!`,
          `The bees are ready to work.`,
          `Bzzzz... initializing swarm intelligence.`,
          `Many agents, one mission.`,
        ],
      };
  }
}

function getRandomMessage(): string {
  const { messages } = getSeasonalBee();
  return messages[Math.floor(Math.random() * messages.length)];
}

function getDecoratedBee(): string {
  const { decorations } = getSeasonalBee();
  if (!decorations || Math.random() > 0.5) return cyan(BEE);

  const decoration =
    decorations[Math.floor(Math.random() * decorations.length)];
  // Add decoration to the bee
  return cyan(BEE.replace("bzzzz...", `bzzzz... ${decoration}`));
}

// ============================================================================
// Model Configuration
// ============================================================================

interface ModelOption {
  value: string;
  label: string;
  hint: string;
}

const COORDINATOR_MODELS: ModelOption[] = [
  {
    value: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    hint: "Best balance of speed and capability (recommended)",
  },
  {
    value: "anthropic/claude-opus-4-5",
    label: "Claude Opus 4.5",
    hint: "Most capable, slower and more expensive",
  },
  {
    value: "openai/gpt-4o",
    label: "GPT-4o",
    hint: "Fast, good for most tasks",
  },
  {
    value: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "Fast and capable",
  },
  {
    value: "google/gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    hint: "More capable, larger context",
  },
];

const WORKER_MODELS: ModelOption[] = [
  {
    value: "anthropic/claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    hint: "Fast and cost-effective (recommended)",
  },
  {
    value: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    hint: "More capable, slower",
  },
  {
    value: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    hint: "Fast and cheap",
  },
  {
    value: "google/gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    hint: "Fast and capable",
  },
];

// ============================================================================
// Update Checking
// ============================================================================

interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      {
        signal: AbortSignal.timeout(3000), // 3 second timeout
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    const latest = data.version;
    const updateAvailable =
      latest !== VERSION && compareVersions(latest, VERSION) > 0;
    return { current: VERSION, latest, updateAvailable };
  } catch {
    return null; // Silently fail - don't block CLI
  }
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

function showUpdateNotification(info: UpdateInfo) {
  if (info.updateAvailable) {
    console.log();
    console.log(
      yellow("  ╭─────────────────────────────────────────────────────╮"),
    );
    console.log(
      yellow("  │") +
        "  Update available! " +
        dim(info.current) +
        " → " +
        green(info.latest) +
        "                " +
        yellow("│"),
    );
    console.log(
      yellow("  │") +
        "  Run: " +
        cyan("npm install -g " + PACKAGE_NAME + "@latest") +
        "  " +
        yellow("│"),
    );
    console.log(
      yellow("  │") +
        "  Or:  " +
        cyan("swarm update") +
        "                                " +
        yellow("│"),
    );
    console.log(
      yellow("  ╰─────────────────────────────────────────────────────╯"),
    );
    console.log();
  }
}

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
    name: "MCP Agent Mail",
    command: "curl",
    checkArgs: [
      "-s",
      "-X",
      "POST",
      "http://localhost:8765/mcp",
      "-H",
      "Content-Type: application/json",
      "-d",
      "{}",
      "-o",
      "/dev/null",
    ],
    required: false,
    install: "https://github.com/Dicklesworthstone/mcp_agent_mail",
    installType: "manual",
    description:
      "Multi-agent coordination & file reservations (like Gmail for coding agents)",
  },
  {
    name: "CASS (Coding Agent Session Search)",
    command: "cass",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/Dicklesworthstone/coding_agent_session_search",
    installType: "manual",
    description: "Indexes and searches AI coding agent history for context",
  },
  {
    name: "UBS (Ultimate Bug Scanner)",
    command: "ubs",
    checkArgs: ["--help"],
    required: false,
    install: "https://github.com/Dicklesworthstone/ultimate_bug_scanner",
    installType: "manual",
    description: "AI-powered static analysis for pre-completion bug scanning",
  },
  {
    name: "semantic-memory",
    command: "semantic-memory",
    checkArgs: ["stats"],
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

/**
 * Get the plugin wrapper template
 *
 * Reads from examples/plugin-wrapper-template.ts which contains a self-contained
 * plugin that shells out to the `swarm` CLI for all tool execution.
 */
function getPluginWrapper(): string {
  const templatePath = join(
    __dirname,
    "..",
    "examples",
    "plugin-wrapper-template.ts",
  );
  try {
    return readFileSync(templatePath, "utf-8");
  } catch (error) {
    // Fallback to minimal wrapper if template not found (shouldn't happen in normal install)
    console.warn(
      `[swarm] Could not read plugin template from ${templatePath}, using minimal wrapper`,
    );
    return `// Minimal fallback - install opencode-swarm-plugin globally for full functionality
import { SwarmPlugin } from "opencode-swarm-plugin"
export default SwarmPlugin
`;
  }
}

const SWARM_COMMAND = `---
description: Decompose task into parallel subtasks and coordinate agents
---

You are a swarm coordinator. Decompose the task into beads and spawn parallel agents.

## Task

$ARGUMENTS

## Workflow

### 1. Initialize
\`swarmmail_init(project_path="$PWD", task_description="Swarm: <task>")\`

### 2. Knowledge Gathering (MANDATORY)

**Before decomposing, query ALL knowledge sources:**

\`\`\`
semantic-memory_find(query="<task keywords>", limit=5)   # Past learnings
cass_search(query="<task description>", limit=5)         # Similar past tasks  
pdf-brain_search(query="<domain concepts>", limit=5)     # Design patterns
skills_list()                                            # Available skills
\`\`\`

Synthesize findings into shared_context for workers.

### 3. Decompose
\`\`\`
swarm_select_strategy(task="<task>")
swarm_plan_prompt(task="<task>", context="<synthesized knowledge>")
swarm_validate_decomposition(response="<BeadTree JSON>")
\`\`\`

### 4. Create Beads
\`beads_create_epic(epic_title="<task>", subtasks=[...])\`

### 5. Reserve Files
\`swarmmail_reserve(paths=[...], reason="<bead-id>: <desc>")\`

### 6. Spawn Agents (ALL in single message)
\`\`\`
swarm_spawn_subtask(bead_id, epic_id, subtask_title, files, shared_context)
Task(subagent_type="swarm/worker", prompt="<from above>")
\`\`\`

### 7. Monitor
\`\`\`
swarm_status(epic_id, project_key)
swarmmail_inbox()
\`\`\`

Intervene if: blocked >5min, file conflicts, scope creep.

### 8. Complete
\`\`\`
swarm_complete(...)
beads_sync()
\`\`\`

## Strategy Reference

| Strategy       | Best For                 | Keywords                               |
| -------------- | ------------------------ | -------------------------------------- |
| file-based     | Refactoring, migrations  | refactor, migrate, rename, update all  |
| feature-based  | New features             | add, implement, build, create, feature |
| risk-based     | Bug fixes, security      | fix, bug, security, critical, urgent   |
| research-based | Investigation, discovery | research, investigate, explore, learn  |

Begin with knowledge gathering now.
`;

const getPlannerAgent = (model: string) => `---
name: swarm-planner
description: Strategic task decomposition for swarm coordination
model: ${model}
---

You are a swarm planner. Decompose tasks into optimal parallel subtasks.

## Workflow

### 1. Knowledge Gathering (MANDATORY)

**Before decomposing, query ALL knowledge sources:**

\`\`\`
semantic-memory_find(query="<task keywords>", limit=5)   # Past learnings
cass_search(query="<task description>", limit=5)         # Similar past tasks  
pdf-brain_search(query="<domain concepts>", limit=5)     # Design patterns
skills_list()                                            # Available skills
\`\`\`

Synthesize findings - note relevant patterns, past approaches, and skills to recommend.

### 2. Strategy Selection

\`swarm_select_strategy(task="<task>")\`

### 3. Generate Plan

\`swarm_plan_prompt(task="<task>", context="<synthesized knowledge>")\`

### 4. Output BeadTree

Return ONLY valid JSON - no markdown, no explanation:

\`\`\`json
{
  "epic": { "title": "...", "description": "..." },
  "subtasks": [
    {
      "title": "...",
      "description": "Include relevant context from knowledge gathering",
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
- Pass synthesized knowledge to workers via subtask descriptions
`;

const getWorkerAgent = (model: string) => `---
name: swarm-worker
description: Executes subtasks in a swarm - fast, focused, cost-effective
model: ${model}
---

You are a swarm worker agent. Execute your assigned subtask efficiently.

## Context

Your prompt includes shared_context from the coordinator's knowledge gathering:
- Relevant patterns from pdf-brain
- Similar past approaches from CASS
- Project-specific learnings from semantic-memory

**Use this context** - it contains patterns and prior art relevant to your task.

## Workflow

1. **Read** assigned files to understand current state
2. **Check skills** if you need domain guidance: \`skills_use(name="<relevant-skill>")\`
3. **Implement** changes following patterns from shared_context
4. **Verify** (typecheck, lint if applicable)
5. **Complete** with \`swarm_complete\`

## Rules

- Focus ONLY on your assigned files
- Report blockers immediately via Swarm Mail (don't spin)
- Use beads_update if blocked
- Call swarm_complete when done - it handles bead closure and file release

## Communication

\`\`\`
swarmmail_send(
  to=["coordinator"],
  subject="Progress/Blocker",
  body="...",
  thread_id="<epic_id>"
)
\`\`\`

## Learning

If you discover a reusable pattern worth preserving:
\`semantic-memory_store(information="<pattern + why it matters>")\`
`;

// ============================================================================
// Commands
// ============================================================================

/**
 * Get the fix command for a dependency
 * Returns null for manual installs (those show a link instead)
 */
function getFixCommand(dep: Dependency): string | null {
  switch (dep.name) {
    case "OpenCode":
      return "brew install sst/tap/opencode";
    case "Beads":
      return "curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash";
    case "Go":
      return "brew install go (or visit https://go.dev/dl/)";
    case "semantic-memory":
      return "npm install -g semantic-memory";
    case "Redis":
      return "brew install redis && brew services start redis";
    case "MCP Agent Mail":
      return "See: https://github.com/Dicklesworthstone/mcp_agent_mail";
    case "CASS (Coding Agent Session Search)":
      return "See: https://github.com/Dicklesworthstone/coding_agent_session_search";
    case "UBS (Ultimate Bug Scanner)":
      return "See: https://github.com/Dicklesworthstone/ultimate_bug_scanner";
    default:
      // Fallback to generic install command if available
      return dep.installType !== "manual" ? dep.install : null;
  }
}

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
      const fixCmd = getFixCommand(dep);
      if (fixCmd) {
        p.log.message(dim("   └─ Fix: " + fixCmd));
      }
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
      const fixCmd = getFixCommand(dep);
      if (fixCmd) {
        p.log.message(dim("   └─ Fix: " + fixCmd));
      }
    }
  }

  const requiredMissing = required.filter((r) => !r.available);
  const optionalMissing = optional.filter((r) => !r.available);

  // Check skills
  p.log.step("Skills:");
  const configDir = join(homedir(), ".config", "opencode");
  const globalSkillsPath = join(configDir, "skills");
  const bundledSkillsPath = join(__dirname, "..", "global-skills");

  // Global skills directory
  if (existsSync(globalSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const skills = readdirSync(globalSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      if (skills.length > 0) {
        p.log.success(`Global skills (${skills.length}): ${skills.join(", ")}`);
      } else {
        p.log.warn("Global skills directory exists but is empty");
      }
    } catch {
      p.log.warn("Global skills directory: " + globalSkillsPath);
    }
  } else {
    p.log.warn("No global skills directory (run 'swarm setup' to create)");
  }

  // Bundled skills
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      p.log.success(
        `Bundled skills (${bundled.length}): ${bundled.join(", ")}`,
      );
    } catch {
      p.log.warn("Could not read bundled skills");
    }
  }

  // Project skills (check current directory)
  const projectSkillsDirs = [".opencode/skills", ".claude/skills", "skills"];
  for (const dir of projectSkillsDirs) {
    if (existsSync(dir)) {
      try {
        const { readdirSync } = require("fs");
        const skills = readdirSync(dir, { withFileTypes: true })
          .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
          .map((d: { name: string }) => d.name);
        if (skills.length > 0) {
          p.log.success(
            `Project skills in ${dir}/ (${skills.length}): ${skills.join(", ")}`,
          );
        }
      } catch {
        // Ignore
      }
    }
  }

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

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

async function setup() {
  console.clear();
  console.log(yellow(BANNER));
  console.log(getDecoratedBee());
  console.log();
  console.log(magenta("  " + getRandomMessage()));
  console.log();

  p.intro("opencode-swarm-plugin v" + VERSION);

  // Check if already configured FIRST
  const configDir = join(homedir(), ".config", "opencode");
  const pluginDir = join(configDir, "plugin");
  const commandDir = join(configDir, "command");
  const agentDir = join(configDir, "agent");

  const pluginPath = join(pluginDir, "swarm.ts");
  const commandPath = join(commandDir, "swarm.md");
  const plannerAgentPath = join(agentDir, "swarm-planner.md");
  const workerAgentPath = join(agentDir, "swarm-worker.md");

  const existingFiles = [
    pluginPath,
    commandPath,
    plannerAgentPath,
    workerAgentPath,
  ].filter((f) => existsSync(f));

  if (existingFiles.length > 0) {
    p.log.success("Swarm is already configured!");
    p.log.message(dim("  Found " + existingFiles.length + "/4 config files"));

    const action = await p.select({
      message: "What would you like to do?",
      options: [
        {
          value: "skip",
          label: "Keep existing config",
          hint: "Exit without changes",
        },
        {
          value: "models",
          label: "Update agent models",
          hint: "Keep customizations, just change models",
        },
        {
          value: "reinstall",
          label: "Reinstall everything",
          hint: "Check deps and regenerate all config files",
        },
      ],
    });

    if (p.isCancel(action) || action === "skip") {
      p.outro("Config unchanged. Run 'swarm config' to see file locations.");
      return;
    }

    if (action === "models") {
      // Quick model update flow
      const coordinatorModel = await p.select({
        message: "Select coordinator model:",
        options: COORDINATOR_MODELS,
        initialValue: "anthropic/claude-sonnet-4-5",
      });

      if (p.isCancel(coordinatorModel)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      const workerModel = await p.select({
        message: "Select worker model:",
        options: WORKER_MODELS,
        initialValue: "anthropic/claude-haiku-4-5",
      });

      if (p.isCancel(workerModel)) {
        p.cancel("Setup cancelled");
        process.exit(0);
      }

      // Update model lines in agent files
      if (existsSync(plannerAgentPath)) {
        const content = readFileSync(plannerAgentPath, "utf-8");
        const updated = content.replace(
          /^model: .+$/m,
          `model: ${coordinatorModel}`,
        );
        writeFileSync(plannerAgentPath, updated);
        p.log.success("Planner: " + coordinatorModel);
      }
      if (existsSync(workerAgentPath)) {
        const content = readFileSync(workerAgentPath, "utf-8");
        const updated = content.replace(
          /^model: .+$/m,
          `model: ${workerModel}`,
        );
        writeFileSync(workerAgentPath, updated);
        p.log.success("Worker: " + workerModel);
      }
      p.outro("Models updated! Your customizations are preserved.");
      return;
    }
    // action === "reinstall" - fall through to full setup
  }

  // Full setup flow
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

  // Only prompt for optional deps if there are missing ones
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

  // Model selection
  p.log.step("Configure swarm agents...");

  const coordinatorModel = await p.select({
    message: "Select coordinator model (for orchestration/planning):",
    options: [
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        hint: "Best balance of speed and capability (recommended)",
      },
      {
        value: "anthropic/claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hint: "Fast and cost-effective",
      },
      {
        value: "anthropic/claude-opus-4-5",
        label: "Claude Opus 4.5",
        hint: "Most capable, slower",
      },
      {
        value: "openai/gpt-4o",
        label: "GPT-4o",
        hint: "Fast, good for most tasks",
      },
      {
        value: "openai/gpt-4-turbo",
        label: "GPT-4 Turbo",
        hint: "Powerful, more expensive",
      },
      {
        value: "google/gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        hint: "Fast and capable",
      },
      {
        value: "google/gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        hint: "More capable",
      },
    ],
    initialValue: "anthropic/claude-sonnet-4-5",
  });

  if (p.isCancel(coordinatorModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  const workerModel = await p.select({
    message: "Select worker model (for task execution):",
    options: [
      {
        value: "anthropic/claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        hint: "Fast and cost-effective (recommended)",
      },
      {
        value: "anthropic/claude-sonnet-4-5",
        label: "Claude Sonnet 4.5",
        hint: "Best balance of speed and capability",
      },
      {
        value: "anthropic/claude-opus-4-5",
        label: "Claude Opus 4.5",
        hint: "Most capable, slower",
      },
      {
        value: "openai/gpt-4o",
        label: "GPT-4o",
        hint: "Fast, good for most tasks",
      },
      {
        value: "openai/gpt-4-turbo",
        label: "GPT-4 Turbo",
        hint: "Powerful, more expensive",
      },
      {
        value: "google/gemini-2.0-flash",
        label: "Gemini 2.0 Flash",
        hint: "Fast and capable",
      },
      {
        value: "google/gemini-1.5-pro",
        label: "Gemini 1.5 Pro",
        hint: "More capable",
      },
    ],
    initialValue: "anthropic/claude-haiku-4-5",
  });

  if (p.isCancel(workerModel)) {
    p.cancel("Setup cancelled");
    process.exit(0);
  }

  p.log.step("Setting up OpenCode integration...");

  // Create directories if needed
  const skillsDir = join(configDir, "skills");
  for (const dir of [pluginDir, commandDir, agentDir, skillsDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  writeFileSync(pluginPath, getPluginWrapper());
  p.log.success("Plugin: " + pluginPath);

  writeFileSync(commandPath, SWARM_COMMAND);
  p.log.success("Command: " + commandPath);

  writeFileSync(plannerAgentPath, getPlannerAgent(coordinatorModel as string));
  p.log.success("Planner agent: " + plannerAgentPath);

  writeFileSync(workerAgentPath, getWorkerAgent(workerModel as string));
  p.log.success("Worker agent: " + workerAgentPath);

  p.log.success("Skills directory: " + skillsDir);

  // Show bundled skills info
  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      p.log.message(dim("  Bundled skills: " + bundled.join(", ")));
    } catch {
      // Ignore
    }
  }

  // Offer to update AGENTS.md with skill awareness
  const agentsPath = join(configDir, "AGENTS.md");
  if (existsSync(agentsPath)) {
    const updateAgents = await p.confirm({
      message: "Update AGENTS.md with skill awareness?",
      initialValue: true,
    });

    if (!p.isCancel(updateAgents) && updateAgents) {
      const s = p.spinner();
      s.start("Updating AGENTS.md...");

      const agentsPrompt = `You are updating the user's AGENTS.md file to add swarm plugin awareness.

## Task
Read ${agentsPath} and add sections for Skills, CASS, and Semantic Memory if they don't exist. Update existing sections if present.

## What to Add

1. **Tool Preferences** - If there's a tool_preferences section, add these tools:
   - skills_list, skills_use, skills_read - knowledge injection
   - cass_search, cass_view, cass_expand - search past agent sessions
   - semantic-memory_find, semantic-memory_store - persistent learning

2. **Skills Section** - Add this (adapt style to match the file):

### Skills (Knowledge Injection)

Skills are reusable knowledge packages. Load them on-demand for specialized tasks.

**When to Use:**
- Before unfamiliar work - check if a skill exists
- When you need domain-specific patterns
- For complex workflows that benefit from guidance

**Usage:**
\`\`\`
skills_list()                              # See available skills
skills_use(name="swarm-coordination")      # Load a skill
skills_use(name="cli-builder", context="building a new CLI") # With context
\`\`\`

**Bundled Skills:** cli-builder, learning-systems, mcp-tool-authoring, skill-creator, swarm-coordination

3. **CASS Section** - Add this:

### CASS (Cross-Agent Session Search)

Search across ALL your AI coding agent histories before solving problems from scratch.

**When to Use:**
- BEFORE implementing anything - check if any agent solved it before
- When debugging - "what did I try last time this error happened?"
- When learning patterns - "how did Cursor handle this API?"

**Usage:**
\`\`\`
cass_search(query="authentication token refresh", limit=5)  # Search all agents
cass_search(query="useEffect cleanup", agent="claude", days=7)  # Filter by agent/time
cass_view(path="/path/from/search", line=42)  # View specific result
cass_expand(path="/path", line=42, context=10)  # Expand context around match
\`\`\`

**Pro tip:** Query CASS at the START of complex tasks. Past solutions save time.

4. **Semantic Memory Section** - Add this:

### Semantic Memory (Persistent Learning)

Store and retrieve learnings across sessions. Memories persist and are searchable.

**When to Use:**
- After solving a tricky problem - store the solution
- After making architectural decisions - store the reasoning
- Before starting work - search for relevant past learnings
- When you discover project-specific patterns

**Usage:**
\`\`\`
# Store a learning
semantic-memory_store(information="OAuth refresh tokens need 5min buffer before expiry", metadata="auth, tokens")

# Search for relevant memories
semantic-memory_find(query="token refresh", limit=5)

# Validate a memory is still accurate (resets decay timer)
semantic-memory_validate(id="mem_123")
\`\`\`

**Pro tip:** Store the WHY, not just the WHAT. Future you needs context.

## Rules
- Preserve existing content and style
- Don't duplicate - update existing sections if present
- Keep tone consistent with the rest of the file
- Place sections in logical order (Skills, CASS, Semantic Memory)
- If there's a tool_preferences section, add the tools there too

Edit the file now.`;

      try {
        const result = Bun.spawnSync(["opencode", "run", agentsPrompt], {
          stdout: "pipe",
          stderr: "pipe",
          timeout: 120000,
        });

        if (result.exitCode === 0) {
          s.stop("AGENTS.md updated");
          p.log.success("Added skill awareness to AGENTS.md");
        } else {
          s.stop("Could not update AGENTS.md");
          p.log.warn("You can manually add skills section later");
        }
      } catch {
        s.stop("Could not update AGENTS.md");
        p.log.warn("You can manually add skills section later");
      }
    }
  }

  p.note(
    'cd your-project\nbd init\nopencode\n/swarm "your task"\n\nSkills: Use skills_list to see available skills',
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

    // Offer to create project skills directory
    const createSkillsDir = await p.confirm({
      message: "Create project skills directory (.opencode/skills/)?",
      initialValue: false,
    });

    if (!p.isCancel(createSkillsDir) && createSkillsDir) {
      const skillsPath = ".opencode/skills";
      if (!existsSync(skillsPath)) {
        mkdirSync(skillsPath, { recursive: true });
        p.log.success("Created " + skillsPath + "/");
        p.log.message(
          dim("  Add SKILL.md files here for project-specific skills"),
        );
      } else {
        p.log.warn(skillsPath + "/ already exists");
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

async function version() {
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE));
  console.log();
  console.log("  Version: " + VERSION);
  console.log("  Docs:    https://github.com/joelhooks/opencode-swarm-plugin");
  console.log();

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

function config() {
  const configDir = join(homedir(), ".config", "opencode");
  const pluginPath = join(configDir, "plugin", "swarm.ts");
  const commandPath = join(configDir, "command", "swarm.md");
  const plannerAgentPath = join(configDir, "agent", "swarm-planner.md");
  const workerAgentPath = join(configDir, "agent", "swarm-worker.md");
  const globalSkillsPath = join(configDir, "skills");

  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Config Files:"));
  console.log();

  const files = [
    { path: pluginPath, desc: "Plugin loader", emoji: "🔌" },
    { path: commandPath, desc: "/swarm command prompt", emoji: "📜" },
    { path: plannerAgentPath, desc: "@swarm-planner agent", emoji: "🤖" },
    { path: workerAgentPath, desc: "@swarm-worker agent", emoji: "🐝" },
  ];

  for (const { path, desc, emoji } of files) {
    const exists = existsSync(path);
    const status = exists ? "✓" : "✗";
    const color = exists ? "\x1b[32m" : "\x1b[31m";
    console.log(`  ${emoji} ${desc}`);
    console.log(`     ${color}${status}\x1b[0m ${dim(path)}`);
    console.log();
  }

  // Skills section
  console.log(cyan("Skills:"));
  console.log();

  // Global skills directory
  const globalSkillsExists = existsSync(globalSkillsPath);
  const globalStatus = globalSkillsExists ? "✓" : "✗";
  const globalColor = globalSkillsExists ? "\x1b[32m" : "\x1b[31m";
  console.log(`  📚 Global skills directory`);
  console.log(
    `     ${globalColor}${globalStatus}\x1b[0m ${dim(globalSkillsPath)}`,
  );

  // Count skills if directory exists
  if (globalSkillsExists) {
    try {
      const { readdirSync } = require("fs");
      const skills = readdirSync(globalSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      if (skills.length > 0) {
        console.log(
          `     ${dim(`Found ${skills.length} skill(s): ${skills.join(", ")}`)}`,
        );
      }
    } catch {
      // Ignore errors
    }
  }
  console.log();

  // Project skills locations
  console.log(`  📁 Project skills locations ${dim("(checked in order)")}`);
  console.log(`     ${dim(".opencode/skills/")}`);
  console.log(`     ${dim(".claude/skills/")}`);
  console.log(`     ${dim("skills/")}`);
  console.log();

  // Bundled skills info
  const bundledSkillsPath = join(__dirname, "..", "global-skills");
  if (existsSync(bundledSkillsPath)) {
    try {
      const { readdirSync } = require("fs");
      const bundled = readdirSync(bundledSkillsPath, { withFileTypes: true })
        .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
        .map((d: { name: string }) => d.name);
      console.log(`  🎁 Bundled skills ${dim("(always available)")}`);
      console.log(`     ${dim(bundled.join(", "))}`);
      console.log();
    } catch {
      // Ignore errors
    }
  }

  console.log(dim("Edit these files to customize swarm behavior."));
  console.log(dim("Run 'swarm setup' to regenerate defaults."));
  console.log();
}

async function update() {
  p.intro("swarm update v" + VERSION);

  const s = p.spinner();
  s.start("Checking for updates...");

  const updateInfo = await checkForUpdates();

  if (!updateInfo) {
    s.stop("Failed to check for updates");
    p.log.error("Could not reach npm registry");
    p.outro("Try again later or update manually:");
    console.log("  " + cyan("npm install -g " + PACKAGE_NAME + "@latest"));
    process.exit(1);
  }

  if (!updateInfo.updateAvailable) {
    s.stop("Already on latest version");
    p.log.success("You're running " + VERSION);
    p.outro("No update needed!");
    return;
  }

  s.stop("Update available: " + VERSION + " → " + updateInfo.latest);

  const confirmUpdate = await p.confirm({
    message: "Update to v" + updateInfo.latest + "?",
    initialValue: true,
  });

  if (p.isCancel(confirmUpdate) || !confirmUpdate) {
    p.outro("Update cancelled");
    return;
  }

  const updateSpinner = p.spinner();
  updateSpinner.start("Updating to v" + updateInfo.latest + "...");

  const success = await runInstall(
    "npm install -g " + PACKAGE_NAME + "@latest",
  );

  if (success) {
    updateSpinner.stop("Updated to v" + updateInfo.latest);
    p.outro("Success! Restart your terminal to use the new version.");
  } else {
    updateSpinner.stop("Update failed");
    p.log.error("Failed to update via npm");
    p.log.message("Try manually:");
    console.log("  " + cyan("npm install -g " + PACKAGE_NAME + "@latest"));
    p.outro("Update failed");
    process.exit(1);
  }
}

async function help() {
  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log(getDecoratedBee());
  console.log(magenta("  " + getRandomMessage()));
  console.log(`
${cyan("Commands:")}
  swarm setup     Interactive installer - checks and installs dependencies
  swarm doctor    Health check - shows status of all dependencies
  swarm init      Initialize beads in current project
  swarm config    Show paths to generated config files
  swarm agents    Update AGENTS.md with skill awareness
  swarm update    Update to latest version
  swarm version   Show version and banner
  swarm tool      Execute a tool (for plugin wrapper)
  swarm help      Show this help

${cyan("Tool Execution:")}
  swarm tool --list                    List all available tools
  swarm tool <name>                    Execute tool with no args
  swarm tool <name> --json '<args>'    Execute tool with JSON args

${cyan("Usage in OpenCode:")}
  /swarm "Add user authentication with OAuth"
  @swarm-planner "Decompose this into parallel tasks"
  @swarm-worker "Execute this specific subtask"

${cyan("Customization:")}
  Edit the generated files to customize behavior:
  ${dim("~/.config/opencode/command/swarm.md")}       - /swarm command prompt
  ${dim("~/.config/opencode/agent/swarm-planner.md")}  - @swarm-planner (coordinator)
  ${dim("~/.config/opencode/agent/swarm-worker.md")}   - @swarm-worker (fast executor)
  ${dim("~/.config/opencode/plugin/swarm.ts")}        - Plugin loader

${dim("Docs: https://github.com/joelhooks/opencode-swarm-plugin")}
`);

  // Check for updates (non-blocking)
  const updateInfo = await checkForUpdates();
  if (updateInfo) showUpdateNotification(updateInfo);
}

// ============================================================================
// Tool Execution (for plugin wrapper)
// ============================================================================

/**
 * Execute a tool by name with JSON args
 *
 * This is the bridge between the plugin wrapper and the actual tool implementations.
 * The plugin wrapper shells out to `swarm tool <name> --json '<args>'` and this
 * function executes the tool and returns JSON.
 *
 * Exit codes:
 * - 0: Success
 * - 1: Tool execution error (error details in JSON output)
 * - 2: Unknown tool name
 * - 3: Invalid JSON args
 */
async function executeTool(toolName: string, argsJson?: string) {
  // Lazy import to avoid loading all tools on every CLI invocation
  const { allTools } = await import("../src/index");

  // Validate tool name
  if (!(toolName in allTools)) {
    const availableTools = Object.keys(allTools).sort();
    console.log(
      JSON.stringify({
        success: false,
        error: {
          code: "UNKNOWN_TOOL",
          message: `Unknown tool: ${toolName}`,
          available_tools: availableTools,
        },
      }),
    );
    process.exit(2);
  }

  // Parse args
  let args: Record<string, unknown> = {};
  if (argsJson) {
    try {
      args = JSON.parse(argsJson);
    } catch (e) {
      console.log(
        JSON.stringify({
          success: false,
          error: {
            code: "INVALID_JSON",
            message: `Invalid JSON args: ${e instanceof Error ? e.message : String(e)}`,
            raw_input: argsJson.slice(0, 200),
          },
        }),
      );
      process.exit(3);
    }
  }

  // Create mock context for tools that need sessionID
  // This mimics what OpenCode provides to plugins
  const mockContext = {
    sessionID: process.env.OPENCODE_SESSION_ID || `cli-${Date.now()}`,
    messageID: process.env.OPENCODE_MESSAGE_ID || `msg-${Date.now()}`,
    agent: process.env.OPENCODE_AGENT || "cli",
    abort: new AbortController().signal,
  };

  // Get the tool
  const toolDef = allTools[toolName as keyof typeof allTools];

  // Execute tool
  // Note: We cast args to any because the CLI accepts arbitrary JSON
  // The tool's internal Zod validation will catch type errors
  try {
    const result = await toolDef.execute(args as any, mockContext);

    // If result is already valid JSON, try to parse and re-wrap it
    // Otherwise wrap the string result
    try {
      const parsed = JSON.parse(result);
      // If it's already a success/error response, pass through
      if (typeof parsed === "object" && "success" in parsed) {
        console.log(JSON.stringify(parsed));
      } else {
        console.log(JSON.stringify({ success: true, data: parsed }));
      }
    } catch {
      // Result is a plain string, wrap it
      console.log(JSON.stringify({ success: true, data: result }));
    }
    process.exit(0);
  } catch (error) {
    console.log(
      JSON.stringify({
        success: false,
        error: {
          code: error instanceof Error ? error.name : "TOOL_ERROR",
          message: error instanceof Error ? error.message : String(error),
          details:
            error instanceof Error && "zodError" in error
              ? (error as { zodError?: unknown }).zodError
              : undefined,
        },
      }),
    );
    process.exit(1);
  }
}

/**
 * List all available tools
 */
async function listTools() {
  const { allTools } = await import("../src/index");
  const tools = Object.keys(allTools).sort();

  console.log(yellow(BANNER));
  console.log(dim("  " + TAGLINE + " v" + VERSION));
  console.log();
  console.log(cyan("Available tools:") + ` (${tools.length} total)`);
  console.log();

  // Group by prefix
  const groups: Record<string, string[]> = {};
  for (const tool of tools) {
    const prefix = tool.split("_")[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(tool);
  }

  for (const [prefix, toolList] of Object.entries(groups)) {
    console.log(green(`  ${prefix}:`));
    for (const t of toolList) {
      console.log(`    ${t}`);
    }
    console.log();
  }

  console.log(dim("Usage: swarm tool <name> [--json '<args>']"));
  console.log(dim("Example: swarm tool beads_ready"));
  console.log(
    dim('Example: swarm tool beads_create --json \'{"title": "Fix bug"}\''),
  );
}

// ============================================================================
// Agents Command - Update AGENTS.md with skill awareness
// ============================================================================

async function agents() {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  const agentsPath = join(home, ".config", "opencode", "AGENTS.md");

  p.intro(yellow(BANNER));

  // Check if AGENTS.md exists
  if (!existsSync(agentsPath)) {
    p.log.warn("No AGENTS.md found at " + agentsPath);
    p.log.message(
      dim("Create one first, then run this command to add skill awareness"),
    );
    p.outro("Aborted");
    return;
  }

  // Check if opencode is available
  const opencode = await checkCommand("opencode", ["--version"]);
  if (!opencode.available) {
    p.log.error("OpenCode not found");
    p.log.message(dim("Install: npm install -g opencode"));
    p.outro("Aborted");
    return;
  }

  const confirm = await p.confirm({
    message: "Update AGENTS.md with skill awareness?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Aborted");
    return;
  }

  const s = p.spinner();
  s.start("Updating AGENTS.md with skill awareness...");

  const prompt = `You are updating the user's AGENTS.md file to add swarm plugin awareness.

## Task
Read ~/.config/opencode/AGENTS.md and add sections for Skills, CASS, and Semantic Memory if they don't exist.

## What to Add

1. **Tool Preferences** - Add these tools to any tool_preferences section:
   - skills_list, skills_use, skills_read - knowledge injection
   - cass_search, cass_view, cass_expand - search past agent sessions
   - semantic-memory_find, semantic-memory_store - persistent learning

2. **Skills Section**:

### Skills (Knowledge Injection)

Skills are reusable knowledge packages. Load on-demand for specialized tasks.

**When to Use:** Before unfamiliar work, when you need domain patterns, for complex workflows.

\`\`\`
skills_list()                              # See available skills
skills_use(name="swarm-coordination")      # Load a skill
\`\`\`

**Bundled:** cli-builder, learning-systems, mcp-tool-authoring, skill-creator, swarm-coordination

3. **CASS Section**:

### CASS (Cross-Agent Session Search)

Search ALL your AI coding agent histories before solving from scratch.

**When to Use:** BEFORE implementing - check if solved before. When debugging - what worked last time?

\`\`\`
cass_search(query="auth token refresh", limit=5)  # Search all agents
cass_view(path="/path/from/search", line=42)      # View result
\`\`\`

4. **Semantic Memory Section**:

### Semantic Memory (Persistent Learning)

Store and retrieve learnings across sessions.

**When to Use:** After solving tricky problems, after architectural decisions, before starting work.

\`\`\`
semantic-memory_store(information="OAuth needs 5min buffer", metadata="auth")
semantic-memory_find(query="token refresh", limit=5)
\`\`\`

## Rules
- Preserve existing content and style
- Don't duplicate - update if sections exist
- Keep tone consistent

Edit the file now.`;

  try {
    const result = Bun.spawnSync(["opencode", "run", prompt], {
      stdio: ["inherit", "pipe", "pipe"],
      timeout: 120000, // 2 minute timeout
    });

    if (result.exitCode === 0) {
      s.stop("AGENTS.md updated with skill awareness");
      p.log.success("Skills section added to " + agentsPath);
      p.log.message(
        dim("Skills available: skills_list, skills_use, skills_read"),
      );
    } else {
      const stderr = result.stderr?.toString() || "";
      s.stop("Failed to update AGENTS.md");
      p.log.error(stderr || "Unknown error");
    }
  } catch (error) {
    s.stop("Failed to update AGENTS.md");
    p.log.error(String(error));
  }

  p.outro("Done");
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
  case "config":
    config();
    break;
  case "update":
    await update();
    break;
  case "tool": {
    const toolName = process.argv[3];
    if (!toolName || toolName === "--list" || toolName === "-l") {
      await listTools();
    } else {
      // Look for --json flag
      const jsonFlagIndex = process.argv.indexOf("--json");
      const argsJson =
        jsonFlagIndex !== -1 ? process.argv[jsonFlagIndex + 1] : undefined;
      await executeTool(toolName, argsJson);
    }
    break;
  }
  case "agents":
    await agents();
    break;
  case "version":
  case "--version":
  case "-v":
    await version();
    break;
  case "help":
  case "--help":
  case "-h":
    await help();
    break;
  case undefined:
    await setup();
    break;
  default:
    console.error("Unknown command: " + command);
    help();
    process.exit(1);
}
