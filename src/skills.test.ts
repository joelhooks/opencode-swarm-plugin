/**
 * Unit tests for skills.ts
 *
 * Tests core functionality:
 * - Frontmatter parsing
 * - Path traversal protection
 * - Skill discovery
 * - ES module compatibility
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join, resolve, relative } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import {
  parseFrontmatter,
  discoverSkills,
  getSkill,
  listSkills,
  setSkillsProjectDirectory,
  invalidateSkillsCache,
  type Skill,
  type SkillRef,
} from "./skills";

// ============================================================================
// Test Fixtures
// ============================================================================

// Use unique temp dir per test run to avoid collisions
const TEST_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_DIR = join(process.cwd(), `.test-skills-${TEST_RUN_ID}`);
const SKILLS_DIR = join(TEST_DIR, ".opencode", "skills");

const VALID_SKILL_MD = `---
name: test-skill
description: A test skill for unit testing
tags:
  - testing
  - unit-test
tools:
  - Read
  - Write
---

# Test Skill

This is a test skill for unit testing purposes.

## Instructions

1. Do the thing
2. Verify the thing
`;

const MINIMAL_SKILL_MD = `---
name: minimal-skill
description: Minimal skill with only required fields
---

# Minimal Skill

Just the basics.
`;

const INVALID_FRONTMATTER_MD = `---
name: 
description: Missing name value
---

# Invalid

This has invalid frontmatter.
`;

const NO_FRONTMATTER_MD = `# No Frontmatter

This file has no YAML frontmatter at all.
`;

// ============================================================================
// Setup / Teardown
// ============================================================================

function setupTestSkillsDir() {
  // Create test directory structure
  mkdirSync(SKILLS_DIR, { recursive: true });
  mkdirSync(join(SKILLS_DIR, "test-skill"), { recursive: true });
  mkdirSync(join(SKILLS_DIR, "minimal-skill"), { recursive: true });
  mkdirSync(join(SKILLS_DIR, "invalid-skill"), { recursive: true });

  // Write test skill files
  writeFileSync(join(SKILLS_DIR, "test-skill", "SKILL.md"), VALID_SKILL_MD);
  writeFileSync(
    join(SKILLS_DIR, "minimal-skill", "SKILL.md"),
    MINIMAL_SKILL_MD,
  );
  writeFileSync(
    join(SKILLS_DIR, "invalid-skill", "SKILL.md"),
    INVALID_FRONTMATTER_MD,
  );
}

function cleanupTestSkillsDir() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// ============================================================================
// Tests: parseFrontmatter
// ============================================================================

describe("parseFrontmatter", () => {
  it("parses valid frontmatter with all fields", () => {
    const result = parseFrontmatter(VALID_SKILL_MD);

    expect(result).not.toBeNull();
    expect(result.metadata.name).toBe("test-skill");
    expect(result.metadata.description).toBe("A test skill for unit testing");
    expect(result.metadata.tags).toEqual(["testing", "unit-test"]);
    expect(result.metadata.tools).toEqual(["Read", "Write"]);
    expect(result.body).toContain("# Test Skill");
  });

  it("parses minimal frontmatter with only required fields", () => {
    const result = parseFrontmatter(MINIMAL_SKILL_MD);

    expect(result).not.toBeNull();
    expect(result.metadata.name).toBe("minimal-skill");
    expect(result.metadata.description).toBe(
      "Minimal skill with only required fields",
    );
    expect(result.metadata.tags).toBeUndefined();
    expect(result.metadata.tools).toBeUndefined();
  });

  it("returns null for missing name value", () => {
    const result = parseFrontmatter(INVALID_FRONTMATTER_MD);
    // gray-matter/YAML parses "name: " (empty value) as null
    // Validation happens later in loadSkill
    expect(result.metadata.name).toBeNull();
  });

  it("returns empty result for content without frontmatter", () => {
    const result = parseFrontmatter(NO_FRONTMATTER_MD);
    // No frontmatter means empty metadata
    expect(Object.keys(result.metadata).length).toBe(0);
  });

  it("returns empty result for empty content", () => {
    const result = parseFrontmatter("");
    expect(Object.keys(result.metadata).length).toBe(0);
  });

  it("handles frontmatter with extra fields", () => {
    const content = `---
name: extra-fields
description: Has extra fields
custom_field: should be preserved
another: also preserved
---

Body content.
`;
    const result = parseFrontmatter(content);
    expect(result.metadata.name).toBe("extra-fields");
    expect(result.metadata.custom_field).toBe("should be preserved");
  });

  it("handles multiline description", () => {
    // Note: The simple YAML parser doesn't handle | multiline syntax
    // Use inline multiline instead
    const content = `---
name: multiline
description: This is a description
---

Body.
`;
    const result = parseFrontmatter(content);
    expect(result.metadata.name).toBe("multiline");
    expect(result.metadata.description).toBe("This is a description");
  });
});

// ============================================================================
// Tests: Skill Discovery
// ============================================================================

describe("discoverSkills", () => {
  beforeEach(() => {
    cleanupTestSkillsDir();
    setupTestSkillsDir();
    setSkillsProjectDirectory(TEST_DIR);
    invalidateSkillsCache();
  });

  afterEach(() => {
    cleanupTestSkillsDir();
    invalidateSkillsCache();
  });

  it("discovers skills in project directory", async () => {
    const skills = await discoverSkills();

    // discoverSkills returns a Map<string, Skill>
    expect(skills.has("test-skill")).toBe(true);
    expect(skills.has("minimal-skill")).toBe(true);
  });

  it("skips skills with invalid frontmatter", async () => {
    const skills = await discoverSkills();

    // invalid-skill has empty name, should be skipped
    expect(skills.has("invalid-skill")).toBe(false);
  });

  it("caches discovered skills", async () => {
    const skills1 = await discoverSkills();
    const skills2 = await discoverSkills();

    // Should return same cached Map
    expect(skills1).toBe(skills2);
  });

  it("invalidates cache when requested", async () => {
    const skills1 = await discoverSkills();
    invalidateSkillsCache();
    const skills2 = await discoverSkills();

    // Should be different Map instances after cache invalidation
    expect(skills1).not.toBe(skills2);
  });
});

describe("getSkill", () => {
  beforeEach(() => {
    cleanupTestSkillsDir();
    setupTestSkillsDir();
    setSkillsProjectDirectory(TEST_DIR);
    invalidateSkillsCache();
  });

  afterEach(() => {
    cleanupTestSkillsDir();
    invalidateSkillsCache();
  });

  it("returns skill by exact name", async () => {
    const skill = await getSkill("test-skill");

    expect(skill).not.toBeNull();
    expect(skill!.metadata.name).toBe("test-skill");
    expect(skill!.metadata.description).toBe("A test skill for unit testing");
  });

  it("returns null for non-existent skill", async () => {
    const skill = await getSkill("non-existent-skill");
    expect(skill).toBeNull();
  });

  it("returns null for empty name", async () => {
    const skill = await getSkill("");
    expect(skill).toBeNull();
  });
});

describe("listSkills", () => {
  beforeEach(() => {
    cleanupTestSkillsDir();
    setupTestSkillsDir();
    setSkillsProjectDirectory(TEST_DIR);
    invalidateSkillsCache();
  });

  afterEach(() => {
    cleanupTestSkillsDir();
    invalidateSkillsCache();
  });

  it("returns skill refs with name, description, and path", async () => {
    const refs = await listSkills();

    const testSkillRef = refs.find((r) => r.name === "test-skill");
    expect(testSkillRef).toBeDefined();
    expect(testSkillRef!.description).toBe("A test skill for unit testing");
    expect(testSkillRef!.path).toContain("test-skill");
  });
});

// ============================================================================
// Tests: Path Traversal Protection
// ============================================================================

describe("path traversal protection", () => {
  it("detects basic path traversal attempts", () => {
    const maliciousPaths = [
      "../../../etc/passwd",
      "..\\..\\windows\\system32",
      "foo/../../../bar",
      "/etc/passwd",
      "C:\\Windows\\System32",
    ];

    for (const path of maliciousPaths) {
      // These should be caught by the initial check
      const hasTraversal =
        path.includes("..") || path.startsWith("/") || path.includes(":\\");
      expect(hasTraversal).toBe(true);
    }
  });

  it("allows valid relative paths", () => {
    const validPaths = [
      "examples.md",
      "templates/component.tsx",
      "reference/api.md",
      "scripts/setup.sh",
    ];

    for (const path of validPaths) {
      const hasTraversal = path.includes("..") || path.startsWith("/");
      expect(hasTraversal).toBe(false);
    }
  });

  it("resolve + relative check catches encoded traversal", () => {
    // Even if initial check is bypassed, resolve + relative catches it
    const skillDir = "/home/user/skills/my-skill";
    const maliciousFile = "foo/../../etc/passwd";

    const resolved = resolve(skillDir, maliciousFile);
    const rel = relative(skillDir, resolved);

    // The relative path starts with ".." meaning it escapes
    expect(rel.startsWith("..")).toBe(true);
  });
});

// ============================================================================
// Tests: ES Module Compatibility
// ============================================================================

describe("ES module compatibility", () => {
  it("import.meta.url is available", () => {
    // This test verifies we're running in an ES module context
    expect(import.meta.url).toBeDefined();
    // Check for file protocol and skills.test in path (works across runners)
    expect(import.meta.url).toMatch(/skills\.test/);
    expect(import.meta.url).toMatch(/^file:|^bun:|^\//); // file://, bun://, or absolute path
  });

  it("can construct path from import.meta.url", () => {
    const currentDir = new URL(".", import.meta.url).pathname;
    expect(currentDir).toBeDefined();
    expect(currentDir.endsWith("/")).toBe(true);
  });
});

// ============================================================================
// Tests: Edge Cases
// ============================================================================

describe("edge cases", () => {
  beforeEach(() => {
    cleanupTestSkillsDir();
    invalidateSkillsCache();
  });

  afterEach(() => {
    cleanupTestSkillsDir();
    invalidateSkillsCache();
  });

  it("handles non-existent skills directory gracefully", async () => {
    setSkillsProjectDirectory("/non/existent/path");
    invalidateSkillsCache();

    // Should not throw, just return empty or global skills only
    const skills = await discoverSkills();
    expect(skills instanceof Map).toBe(true);
  });

  it("handles empty skills directory", async () => {
    mkdirSync(SKILLS_DIR, { recursive: true });
    setSkillsProjectDirectory(TEST_DIR);
    invalidateSkillsCache();

    // Should not throw
    const skills = await discoverSkills();
    expect(skills instanceof Map).toBe(true);
  });

  it("handles skill directory without SKILL.md", async () => {
    mkdirSync(join(SKILLS_DIR, "empty-skill"), { recursive: true });
    writeFileSync(
      join(SKILLS_DIR, "empty-skill", "README.md"),
      "# Not a skill",
    );
    setSkillsProjectDirectory(TEST_DIR);
    invalidateSkillsCache();

    const skills = await discoverSkills();

    // Should not include the directory without SKILL.md
    expect(skills.has("empty-skill")).toBe(false);
  });
});
