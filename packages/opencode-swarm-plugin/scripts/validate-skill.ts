#!/usr/bin/env bun
/**
 * Skill Validator - Validates skill structure and content
 *
 * Usage:
 *   bun scripts/validate-skill.ts <path/to/skill>
 *
 * Examples:
 *   bun scripts/validate-skill.ts .opencode/skill/my-skill
 *   bun scripts/validate-skill.ts global-skills/debugging
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { parseFrontmatter } from "../src/skills.js";

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

async function validateSkill(skillPath: string): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    info: [],
  };

  const skillName = basename(skillPath);

  // Check directory exists
  if (!existsSync(skillPath)) {
    result.errors.push(`Skill directory does not exist: ${skillPath}`);
    result.valid = false;
    return result;
  }

  // Check SKILL.md exists
  const skillMdPath = join(skillPath, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    result.errors.push("Missing required SKILL.md file");
    result.valid = false;
    return result;
  }

  // Read and parse SKILL.md
  const content = await readFile(skillMdPath, "utf-8");

  // Check frontmatter
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    result.errors.push("SKILL.md must start with YAML frontmatter (---)");
    result.valid = false;
    return result;
  }

  const { metadata: frontmatter, body } = parseFrontmatter(content);
  if (Object.keys(frontmatter).length === 0) {
    result.errors.push("Invalid YAML frontmatter format");
    result.valid = false;
    return result;
  }

  // Validate required fields
  if (!frontmatter.name) {
    result.errors.push("Missing required 'name' field in frontmatter");
    result.valid = false;
  } else if (frontmatter.name !== skillName) {
    result.warnings.push(
      `Frontmatter name '${frontmatter.name}' doesn't match directory name '${skillName}'`,
    );
  }

  if (!frontmatter.description) {
    result.errors.push("Missing required 'description' field in frontmatter");
    result.valid = false;
  } else {
    const desc = String(frontmatter.description);
    if (desc.includes("[TODO")) {
      result.warnings.push("Description contains TODO placeholder");
    }
    if (desc.length < 20) {
      result.warnings.push("Description is very short (< 20 chars)");
    }
    if (desc.length > 500) {
      result.warnings.push("Description is very long (> 500 chars)");
    }
  }

  // Check for TODO placeholders in body
  const todoCount = (body.match(/\[TODO/g) || []).length;
  if (todoCount > 0) {
    result.warnings.push(`Found ${todoCount} TODO placeholder(s) in body`);
  }

  // Check body length (body is already extracted by parseFrontmatter)
  const lineCount = body.split("\n").length;
  if (lineCount > 500) {
    result.warnings.push(
      `SKILL.md body is ${lineCount} lines (recommended < 500)`,
    );
  }

  // Check for optional directories
  const scriptsDir = join(skillPath, "scripts");
  const refsDir = join(skillPath, "references");
  const assetsDir = join(skillPath, "assets");

  if (existsSync(scriptsDir)) {
    const scripts = await readdir(scriptsDir);
    result.info.push(`Found ${scripts.length} script(s) in scripts/`);

    // Check for example placeholders
    if (scripts.includes("example.sh") || scripts.includes("example.py")) {
      result.warnings.push("Contains placeholder example script");
    }
  }

  if (existsSync(refsDir)) {
    const refs = await readdir(refsDir);
    result.info.push(`Found ${refs.length} reference(s) in references/`);
  }

  if (existsSync(assetsDir)) {
    const assets = await readdir(assetsDir);
    result.info.push(`Found ${assets.length} asset(s) in assets/`);
  }

  // Check for unwanted files
  const unwantedFiles = [
    "README.md",
    "CHANGELOG.md",
    "INSTALLATION.md",
    "CONTRIBUTING.md",
  ];
  for (const file of unwantedFiles) {
    if (existsSync(join(skillPath, file))) {
      result.warnings.push(
        `Found ${file} - skills should only contain SKILL.md and resources (scripts/, references/, assets/)`,
      );
    }
  }

  return result;
}

// Main
const skillPath = process.argv[2];

if (!skillPath) {
  console.log(`
Skill Validator - Validates skill structure and content

Usage:
  bun scripts/validate-skill.ts <path/to/skill>

Examples:
  bun scripts/validate-skill.ts .opencode/skill/my-skill
  bun scripts/validate-skill.ts global-skills/debugging
`);
  process.exit(1);
}

console.log(`Validating skill: ${skillPath}\n`);

const result = await validateSkill(skillPath);

// Print results
if (result.errors.length > 0) {
  console.log("❌ Errors:");
  for (const error of result.errors) {
    console.log(`   - ${error}`);
  }
  console.log();
}

if (result.warnings.length > 0) {
  console.log("⚠️  Warnings:");
  for (const warning of result.warnings) {
    console.log(`   - ${warning}`);
  }
  console.log();
}

if (result.info.length > 0) {
  console.log("ℹ️  Info:");
  for (const info of result.info) {
    console.log(`   - ${info}`);
  }
  console.log();
}

if (result.valid) {
  console.log("✅ Skill is valid!");
  if (result.warnings.length > 0) {
    console.log("   (but consider addressing warnings above)");
  }
} else {
  console.log("❌ Skill validation failed");
  process.exit(1);
}
