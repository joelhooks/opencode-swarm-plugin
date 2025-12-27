/**
 * Swarm Research Module - Tool discovery for documentation researchers
 *
 * Provides runtime detection of available documentation tools:
 * - Skills (via native discovery)
 * - MCP servers (next-devtools, context7, fetch, pdf-brain)
 * - CLI tools (semantic-memory via ollama)
 *
 * Researchers use this to discover HOW to fetch docs.
 * Coordinators provide WHAT to research (tech stack).
 *
 * @module swarm-research
 */

import { tool } from "@opencode-ai/plugin";
import type { ToolName } from "./tool-availability";
import { isToolAvailable } from "./tool-availability";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Version information for an installed package
 */
export interface VersionInfo {
  /** Package name */
  name: string;
  /** Installed version (semver) */
  version: string;
  /** Where version was discovered */
  source: "lockfile" | "package.json";
  /** Original constraint from package.json (e.g., "^1.2.3") */
  constraint?: string;
  /** Latest version from npm registry (only if checkUpgrades=true) */
  latest?: string;
  /** Whether an update is available (version !== latest) */
  updateAvailable?: boolean;
}

/**
 * Discovered tool with capabilities
 */
export interface DiscoveredTool {
  /** Tool name */
  name: string;
  /** Tool type: skill, MCP server, or CLI */
  type: "skill" | "mcp" | "cli";
  /** What this tool can do */
  capabilities: string[];
  /** Whether tool is available in this environment */
  available: boolean;
}

/**
 * Tool definitions with their capabilities
 */
const TOOL_DEFINITIONS: Omit<DiscoveredTool, "available">[] = [
  {
    name: "next-devtools",
    type: "mcp",
    capabilities: ["nextjs-docs", "version-lookup", "api-reference"],
  },
  {
    name: "context7",
    type: "mcp",
    capabilities: ["library-docs", "api-reference", "search"],
  },
  {
    name: "fetch",
    type: "mcp",
    capabilities: ["http-fetch", "markdown-conversion"],
  },
  {
    name: "pdf-brain",
    type: "mcp",
    capabilities: ["knowledge-base-search", "internal-docs"],
  },
  {
    name: "semantic-memory",
    type: "cli",
    capabilities: ["storage", "semantic-search", "persistence"],
  },
];

/**
 * Strip semver constraint from version string
 * Examples: "^3.22.4" → "3.22.4", "~1.2.3" → "1.2.3"
 */
function stripSemverConstraint(versionStr: string): string | undefined {
  // Match semver version pattern (X.Y.Z with optional pre-release/build)
  const match = versionStr.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?)/);
  return match?.[1];
}

/**
 * Fetch latest version of a package from npm registry
 * 
 * Uses npm registry API: https://registry.npmjs.org/{package}/latest
 * 
 * @param packageName - Package name (supports scoped packages like @types/node)
 * @returns Latest version string, or undefined if fetch fails
 */
export async function getLatestVersion(
  packageName: string,
): Promise<string | undefined> {
  try {
    const url = `https://registry.npmjs.org/${packageName}/latest`;
    const response = await fetch(url);
    
    if (!response.ok) {
      return undefined;
    }
    
    const data = await response.json() as { version?: string };
    return data.version;
  } catch {
    // Network error, invalid package name, etc.
    return undefined;
  }
}

/**
 * Parse npm package-lock.json
 */
async function parseNpmLockfile(
  lockfilePath: string,
  packages: string[],
): Promise<VersionInfo[]> {
  try {
    const content = await readFile(lockfilePath, "utf-8");
    const lockfile = JSON.parse(content);
    const versions: VersionInfo[] = [];

    for (const pkg of packages) {
      // npm v2/v3 format: packages."node_modules/<name>"
      const nodeModulesKey = `node_modules/${pkg}`;
      const pkgData = lockfile.packages?.[nodeModulesKey];

      if (pkgData?.version) {
        versions.push({
          name: pkg,
          version: pkgData.version,
          source: "lockfile",
        });
      }
    }

    return versions;
  } catch {
    return [];
  }
}

/**
 * Parse pnpm pnpm-lock.yaml
 */
async function parsePnpmLockfile(
  lockfilePath: string,
  packages: string[],
): Promise<VersionInfo[]> {
  try {
    const content = await readFile(lockfilePath, "utf-8");
    const lockfile = parseYaml(content);
    const versions: VersionInfo[] = [];

    for (const pkg of packages) {
      // pnpm format: dependencies.pkg.version
      const version = lockfile.dependencies?.[pkg]?.version;

      if (version) {
        versions.push({
          name: pkg,
          version,
          source: "lockfile",
        });
      }
    }

    return versions;
  } catch {
    return [];
  }
}

/**
 * Parse yarn yarn.lock
 */
async function parseYarnLockfile(
  lockfilePath: string,
  packages: string[],
): Promise<VersionInfo[]> {
  try {
    const content = await readFile(lockfilePath, "utf-8");
    const versions: VersionInfo[] = [];

    for (const pkg of packages) {
      // yarn format: "pkg@^version:\n  version "X.Y.Z""
      const pattern = new RegExp(`${pkg}@[^:]+:\\s+version "([^"]+)"`, "m");
      const match = content.match(pattern);

      if (match?.[1]) {
        versions.push({
          name: pkg,
          version: match[1],
          source: "lockfile",
        });
      }
    }

    return versions;
  } catch {
    return [];
  }
}

/**
 * Parse package.json as fallback
 */
async function parsePackageJson(
  packageJsonPath: string,
  packages: string[],
): Promise<VersionInfo[]> {
  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(content);
    const versions: VersionInfo[] = [];

    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    for (const pkg of packages) {
      const constraint = allDeps[pkg];
      if (!constraint) continue;

      // Strip semver constraint to get base version
      const version = stripSemverConstraint(constraint);
      if (!version) continue; // Skip if can't parse (e.g., "latest", URLs)

      versions.push({
        name: pkg,
        version,
        source: "package.json",
        constraint,
      });
    }

    return versions;
  } catch {
    return [];
  }
}

/**
 * Get installed versions of packages from lockfile (preferred) or package.json
 *
 * Detection order:
 * 1. package-lock.json (npm)
 * 2. pnpm-lock.yaml (pnpm)
 * 3. yarn.lock (yarn)
 * 4. bun.lock → fallback to package.json (bun lockfile is binary)
 * 5. package.json (fallback)
 *
 * @param projectPath - Absolute path to project root
 * @param packages - Package names to look up
 * @param checkUpgrades - If true, fetch latest versions from npm registry and compare
 * @returns Array of version info for found packages
 */
export async function getInstalledVersions(
  projectPath: string,
  packages: string[],
  checkUpgrades = false,
): Promise<VersionInfo[]> {
  // Try lockfiles in order
  const npmLock = join(projectPath, "package-lock.json");
  let versions: VersionInfo[] = [];
  
  if (existsSync(npmLock)) {
    versions = await parseNpmLockfile(npmLock, packages);
  } else {
    const pnpmLock = join(projectPath, "pnpm-lock.yaml");
    if (existsSync(pnpmLock)) {
      versions = await parsePnpmLockfile(pnpmLock, packages);
    } else {
      const yarnLock = join(projectPath, "yarn.lock");
      if (existsSync(yarnLock)) {
        versions = await parseYarnLockfile(yarnLock, packages);
      } else {
        // bun.lock is binary, fallback to package.json
        // (same fallback for no lockfile at all)
        const packageJson = join(projectPath, "package.json");
        if (existsSync(packageJson)) {
          versions = await parsePackageJson(packageJson, packages);
        }
      }
    }
  }

  // Optionally check for upgrades
  if (checkUpgrades && versions.length > 0) {
    await Promise.all(
      versions.map(async (versionInfo) => {
        const latest = await getLatestVersion(versionInfo.name);
        if (latest) {
          versionInfo.latest = latest;
          versionInfo.updateAvailable = versionInfo.version !== latest;
        }
      }),
    );
  }

  return versions;
}

/**
 * Check if an MCP server tool is available
 *
 * MCP tools don't have runtime detection in OpenCode yet,
 * so we return true for known MCP servers (they're checked at runtime).
 */
function isMcpToolAvailable(_toolName: string): boolean {
  // TODO: Once OpenCode exposes MCP server list, check actual availability
  // For now, assume MCP tools are available (fail gracefully at runtime)
  return true;
}

/**
 * Discover available documentation tools
 *
 * Checks for:
 * - Skills (via skills discovery)
 * - MCP servers (next-devtools, context7, fetch, pdf-brain)
 * - CLI tools (semantic-memory)
 *
 * @returns List of discovered tools with availability status
 */
export async function discoverDocTools(): Promise<DiscoveredTool[]> {
  const tools: DiscoveredTool[] = [];

  // Check each tool definition
  for (const def of TOOL_DEFINITIONS) {
    let available = false;

    if (def.type === "cli") {
      // Check CLI tool availability
      available = await isToolAvailable(def.name as ToolName);
    } else if (def.type === "mcp") {
      // Check MCP server availability
      available = isMcpToolAvailable(def.name);
    }

    tools.push({
      ...def,
      available,
    });
  }

  return tools;
}

/**
 * Plugin tool for discovering available documentation tools
 */
export const swarm_discover_tools = tool({
  description:
    "Discover available documentation tools for researchers. Returns list of tools (skills, MCP servers, CLI) with capabilities and availability status.",
  args: {},
  async execute() {
    const tools = await discoverDocTools();

    return JSON.stringify(
      {
        tools,
        summary: {
          total: tools.length,
          available: tools.filter((t) => t.available).length,
          unavailable: tools.filter((t) => !t.available).length,
          by_type: {
            skill: tools.filter((t) => t.type === "skill").length,
            mcp: tools.filter((t) => t.type === "mcp").length,
            cli: tools.filter((t) => t.type === "cli").length,
          },
        },
        usage_hint:
          "Use 'available' tools first. If unavailable, either skip or provide alternative instructions.",
      },
      null,
      2,
    );
  },
});

/**
 * Plugin tool for getting installed package versions
 */
export const swarm_get_versions = tool({
  description:
    "Get installed versions of packages from lockfile (preferred) or package.json. Used by researchers to fetch docs for the correct version (not latest). Detects npm (package-lock.json), pnpm (pnpm-lock.yaml), yarn (yarn.lock), or falls back to package.json. Optionally compares to latest versions from npm registry.",
  args: {
    projectPath: tool.schema
      .string()
      .describe("Absolute path to project root directory"),
    packages: tool.schema
      .array(tool.schema.string())
      .describe("Package names to look up (e.g., ['zod', 'typescript'])"),
    checkUpgrades: tool.schema
      .boolean()
      .optional()
      .describe("If true, fetch latest versions from npm registry and compare to installed. Default: false"),
  },
  async execute(args: { projectPath: string; packages: string[]; checkUpgrades?: boolean }) {
    const versions = await getInstalledVersions(
      args.projectPath,
      args.packages,
      args.checkUpgrades ?? false,
    );

    const summary: {
      found: number;
      requested: number;
      missing: string[];
      sources: {
        lockfile: number;
        package_json: number;
      };
      upgrades?: {
        available: number;
        upToDate: number;
      };
    } = {
      found: versions.length,
      requested: args.packages.length,
      missing: args.packages.filter(
        (pkg) => !versions.find((v) => v.name === pkg),
      ),
      sources: {
        lockfile: versions.filter((v) => v.source === "lockfile").length,
        package_json: versions.filter((v) => v.source === "package.json")
          .length,
      },
    };

    if (args.checkUpgrades) {
      summary.upgrades = {
        available: versions.filter((v) => v.updateAvailable === true).length,
        upToDate: versions.filter((v) => v.updateAvailable === false).length,
      };
    }

    return JSON.stringify(
      {
        versions,
        summary,
        usage_hint:
          "Use 'version' field for doc lookups. If source is 'package.json', consider warning user that lockfile is missing (versions may be outdated)." +
          (args.checkUpgrades ? " When checkUpgrades=true, 'latest' and 'updateAvailable' fields show upgrade status." : ""),
      },
      null,
      2,
    );
  },
});

/**
 * Research tools for plugin registration
 */
export const researchTools = {
  swarm_discover_tools,
  swarm_get_versions,
};
