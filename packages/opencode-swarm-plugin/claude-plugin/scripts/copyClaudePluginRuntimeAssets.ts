/**
 * Claude plugin runtime asset copy CLI entrypoint.
 */
import { copyClaudePluginRuntimeAssets } from "../../src/claude-plugin/claude-plugin-assets";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Resolve the package root that owns the Claude plugin assets.
 */
export function resolveClaudePluginPackageRoot({
  currentDir = dirname(fileURLToPath(import.meta.url)),
  cwd = process.cwd(),
}: {
  currentDir?: string;
  cwd?: string;
} = {}): string {
  const candidates = [cwd, currentDir];

  for (const candidate of candidates) {
    const resolved = findClaudePluginPackageRoot(candidate);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    "Unable to locate the package root containing claude-plugin assets.",
  );
}

function findClaudePluginPackageRoot(startDir: string): string | null {
  let current = resolve(startDir);

  while (true) {
    const manifestPath = join(current, "package.json");
    const pluginDir = join(current, "claude-plugin");

    if (existsSync(manifestPath) && existsSync(pluginDir)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }

    current = parent;
  }
}

/**
 * Ensure claude-plugin/dist exists before copying runtime assets.
 */
export function assertClaudePluginDistExists({
  packageRoot,
}: {
  packageRoot: string;
}): void {
  const pluginDistPath = join(packageRoot, "claude-plugin", "dist");

  if (!existsSync(pluginDistPath)) {
    throw new Error(
      `[swarm-mcp] Missing claude-plugin/dist directory at ${pluginDistPath}. ` +
        "Build the package so claude-plugin/dist is populated.",
    );
  }
}

/**
 * Run the runtime asset copy using the package root.
 */
export function runCopyClaudePluginRuntimeAssets(): void {
  const packageRoot = resolveClaudePluginPackageRoot();
  assertClaudePluginDistExists({ packageRoot });
  copyClaudePluginRuntimeAssets({ packageRoot });
}

export { copyClaudePluginRuntimeAssets };

if (import.meta.main) {
  runCopyClaudePluginRuntimeAssets();
}
