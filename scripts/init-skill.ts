#!/usr/bin/env bun
/**
 * Skill Initializer - Creates a new skill from template
 *
 * Usage:
 *   bun scripts/init-skill.ts <skill-name> [--path <path>] [--global]
 *
 * Examples:
 *   bun scripts/init-skill.ts my-skill
 *   bun scripts/init-skill.ts my-skill --path .claude/skills
 *   bun scripts/init-skill.ts my-skill --global
 */

import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { parseArgs } from "util";

const SKILL_TEMPLATE = (name: string, title: string) => `---
name: ${name}
description: [TODO: Complete description of what this skill does and WHEN to use it. Be specific about scenarios that trigger this skill.]
tags:
  - [TODO: add tags]
---

# ${title}

## Overview

[TODO: 1-2 sentences explaining what this skill enables]

## When to Use This Skill

[TODO: List specific scenarios when this skill should be activated:
- When working on X type of task
- When files matching Y pattern are involved
- When the user asks about Z topic]

## Instructions

[TODO: Add actionable instructions for the agent. Use imperative form:
- "Read the configuration file first"
- "Check for existing patterns before creating new ones"
- "Always validate output before completing"]

## Examples

### Example 1: [TODO: Realistic scenario]

**User**: "[TODO: Example user request]"

**Process**:
1. [TODO: Step-by-step process]
2. [TODO: Next step]
3. [TODO: Final step]

## Resources

This skill may include additional resources:

### scripts/
Executable scripts for automation. Run with \`skills_execute\`.

### references/
Documentation loaded on-demand. Access with \`skills_read\`.

---
*Delete any unused sections and this line when skill is complete.*
`;

const EXAMPLE_SCRIPT = (name: string) => `#!/usr/bin/env bash
# Example helper script for ${name}
#
# This is a placeholder. Replace with actual implementation or delete.
#
# Usage: skills_execute(skill: "${name}", script: "example.sh")

echo "Hello from ${name} skill!"
echo "Project directory: $1"

# TODO: Add actual script logic
`;

const REFERENCE_TEMPLATE = (title: string) => `# Reference Documentation for ${title}

## Overview

[TODO: Detailed reference material for this skill]

## API Reference

[TODO: If applicable, document APIs, schemas, or interfaces]

## Detailed Workflows

[TODO: Complex multi-step workflows that don't fit in SKILL.md]

## Troubleshooting

[TODO: Common issues and solutions]
`;

function titleCase(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function initSkill(
  name: string,
  basePath: string,
  isGlobal: boolean
): Promise<void> {
  // Validate name
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error("❌ Error: Skill name must be lowercase with hyphens only");
    process.exit(1);
  }

  if (name.length > 64) {
    console.error("❌ Error: Skill name must be 64 characters or less");
    process.exit(1);
  }

  // Determine target directory
  let skillDir: string;
  if (isGlobal) {
    const home = process.env.HOME || process.env.USERPROFILE || "~";
    skillDir = join(home, ".config", "opencode", "skills", name);
  } else {
    skillDir = join(basePath, name);
  }

  // Check if exists
  if (existsSync(skillDir)) {
    console.error(`❌ Error: Skill directory already exists: ${skillDir}`);
    process.exit(1);
  }

  const title = titleCase(name);
  const createdFiles: string[] = [];

  try {
    // Create skill directory
    await mkdir(skillDir, { recursive: true });
    console.log(`✅ Created skill directory: ${skillDir}`);

    // Create SKILL.md
    const skillPath = join(skillDir, "SKILL.md");
    await writeFile(skillPath, SKILL_TEMPLATE(name, title));
    createdFiles.push("SKILL.md");
    console.log("✅ Created SKILL.md");

    // Create scripts/ directory with example
    const scriptsDir = join(skillDir, "scripts");
    await mkdir(scriptsDir, { recursive: true });
    const scriptPath = join(scriptsDir, "example.sh");
    await writeFile(scriptPath, EXAMPLE_SCRIPT(name), { mode: 0o755 });
    createdFiles.push("scripts/example.sh");
    console.log("✅ Created scripts/example.sh");

    // Create references/ directory with example
    const refsDir = join(skillDir, "references");
    await mkdir(refsDir, { recursive: true });
    const refPath = join(refsDir, "guide.md");
    await writeFile(refPath, REFERENCE_TEMPLATE(title));
    createdFiles.push("references/guide.md");
    console.log("✅ Created references/guide.md");

    console.log(`\n✅ Skill '${name}' initialized successfully at ${skillDir}`);
    console.log("\nNext steps:");
    console.log("  1. Edit SKILL.md to complete TODO placeholders");
    console.log("  2. Update the description in frontmatter");
    console.log("  3. Add specific 'When to Use' scenarios");
    console.log("  4. Delete unused sections and placeholder files");
    console.log("  5. Test with skills_use to verify it works");
  } catch (error) {
    console.error(
      `❌ Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// Parse arguments
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    path: { type: "string", default: ".opencode/skills" },
    global: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.help || positionals.length === 0) {
  console.log(`
Skill Initializer - Creates a new skill from template

Usage:
  bun scripts/init-skill.ts <skill-name> [options]

Options:
  --path <path>   Directory to create skill in (default: .opencode/skills)
  --global        Create in global ~/.config/opencode/skills directory
  -h, --help      Show this help message

Examples:
  bun scripts/init-skill.ts my-skill
  bun scripts/init-skill.ts my-skill --path .claude/skills
  bun scripts/init-skill.ts my-skill --global

Skill name requirements:
  - Lowercase letters, digits, and hyphens only
  - Max 64 characters
`);
  process.exit(values.help ? 0 : 1);
}

const skillName = positionals[0];
await initSkill(skillName, values.path!, values.global!);
