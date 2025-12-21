/**
 * Tests for swarm-prompts.ts
 *
 * Validates that prompt templates contain required sections and emphasis
 * for memory usage, coordination, and TDD workflow.
 */

import { describe, expect, test } from "bun:test";
import {
  formatSubtaskPromptV2,
  SUBTASK_PROMPT_V2,
} from "./swarm-prompts";

describe("SUBTASK_PROMPT_V2", () => {
  describe("memory query emphasis", () => {
    test("Step 2 is semantic-memory_find and marked MANDATORY", () => {
      expect(SUBTASK_PROMPT_V2).toContain("### Step 2:");
      expect(SUBTASK_PROMPT_V2).toContain("semantic-memory_find");
      // Must have MANDATORY in the step header
      expect(SUBTASK_PROMPT_V2).toMatch(/### Step 2:.*MANDATORY/i);
    });

    test("memory query step has visual emphasis (emoji or caps)", () => {
      // Should have emoji or CRITICAL/ALWAYS in caps
      const step2Match = SUBTASK_PROMPT_V2.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      const step2Content = step2Match[0];
      
      // Must have at least one of: emoji, CRITICAL, ALWAYS, MANDATORY
      const hasEmphasis = 
        /🧠|⚠️|CRITICAL|ALWAYS|MANDATORY/.test(step2Content);
      expect(hasEmphasis).toBe(true);
    });

    test("memory query step includes query examples by task type", () => {
      const step2Match = SUBTASK_PROMPT_V2.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      const step2Content = step2Match[0];
      
      // Should have examples for different task types
      expect(step2Content).toContain("Bug fix");
      expect(step2Content).toContain("New feature");
      expect(step2Content).toContain("Refactor");
    });

    test("memory query step explains WHY it's mandatory", () => {
      const step2Match = SUBTASK_PROMPT_V2.match(/### Step 2:[\s\S]*?### Step 3:/);
      expect(step2Match).not.toBeNull();
      if (!step2Match) return;
      const step2Content = step2Match[0];
      
      // Should explain consequences of skipping
      expect(step2Content).toMatch(/skip|waste|repeat|already.solved/i);
    });
  });

  describe("memory storage emphasis", () => {
    test("has a dedicated section for storing learnings", () => {
      // Should have a prominent section about storing memories
      expect(SUBTASK_PROMPT_V2).toMatch(/##.*STORE.*LEARNING|### Step.*Store.*Learning/i);
    });

    test("storage section lists triggers for when to store", () => {
      // Should mention triggers: bugs, gotchas, patterns, failed approaches
      expect(SUBTASK_PROMPT_V2).toContain("bug");
      expect(SUBTASK_PROMPT_V2).toMatch(/gotcha|quirk|workaround/i);
      expect(SUBTASK_PROMPT_V2).toMatch(/pattern|domain/i);
    });

    test("storage section emphasizes WHY not just WHAT", () => {
      expect(SUBTASK_PROMPT_V2).toMatch(/WHY.*not.*WHAT|why.*matters/i);
    });

    test("storage section warns against generic knowledge", () => {
      expect(SUBTASK_PROMPT_V2).toMatch(/don't store.*generic|generic knowledge/i);
    });
  });

  describe("checklist order", () => {
    test("Step 1 is swarmmail_init", () => {
      expect(SUBTASK_PROMPT_V2).toMatch(/### Step 1:[\s\S]*?swarmmail_init/);
    });

    test("Step 2 is semantic-memory_find (before skills)", () => {
      const step2Pos = SUBTASK_PROMPT_V2.indexOf("### Step 2:");
      const step3Pos = SUBTASK_PROMPT_V2.indexOf("### Step 3:");
      const memoryFindPos = SUBTASK_PROMPT_V2.indexOf("semantic-memory_find");
      const skillsPos = SUBTASK_PROMPT_V2.indexOf("skills_list");
      
      // Memory find should be in Step 2, before skills in Step 3
      expect(memoryFindPos).toBeGreaterThan(step2Pos);
      expect(memoryFindPos).toBeLessThan(step3Pos);
      expect(skillsPos).toBeGreaterThan(step3Pos);
    });

    test("semantic-memory_store comes before swarm_complete", () => {
      const storePos = SUBTASK_PROMPT_V2.indexOf("semantic-memory_store");
      const completePos = SUBTASK_PROMPT_V2.lastIndexOf("swarm_complete");
      
      expect(storePos).toBeGreaterThan(0);
      expect(storePos).toBeLessThan(completePos);
    });

    test("final step is swarm_complete (not hive_close)", () => {
      // Find the last "### Step N:" pattern
      const stepMatches = [...SUBTASK_PROMPT_V2.matchAll(/### Step (\d+):/g)];
      expect(stepMatches.length).toBeGreaterThan(0);
      
      const lastStepNum = Math.max(...stepMatches.map(m => parseInt(m[1])));
      const lastStepMatch = SUBTASK_PROMPT_V2.match(
        new RegExp(`### Step ${lastStepNum}:[\\s\\S]*?(?=## \\[|$)`)
      );
      expect(lastStepMatch).not.toBeNull();
      if (!lastStepMatch) return;
      
      const lastStepContent = lastStepMatch[0];
      expect(lastStepContent).toContain("swarm_complete");
      expect(lastStepContent).toMatch(/NOT.*hive_close|DO NOT.*hive_close/i);
    });
  });

  describe("critical requirements section", () => {
    test("lists memory query as non-negotiable", () => {
      const criticalSection = SUBTASK_PROMPT_V2.match(/\[CRITICAL REQUIREMENTS\][\s\S]*?Begin now/);
      expect(criticalSection).not.toBeNull();
      if (!criticalSection) return;
      
      expect(criticalSection[0]).toMatch(/semantic-memory_find|memory.*MUST|Step 2.*MUST/i);
    });

    test("lists consequences of skipping memory steps", () => {
      const criticalSection = SUBTASK_PROMPT_V2.match(/\[CRITICAL REQUIREMENTS\][\s\S]*?Begin now/);
      expect(criticalSection).not.toBeNull();
      if (!criticalSection) return;
      
      // Should mention consequences for skipping memory
      expect(criticalSection[0]).toMatch(/repeat|waste|already.solved|mistakes/i);
    });
  });
});

describe("formatSubtaskPromptV2", () => {
  test("substitutes all placeholders correctly", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "test-project-abc123-bead456",
      epic_id: "test-project-abc123-epic789",
      subtask_title: "Test Subtask",
      subtask_description: "Do the test thing",
      files: ["src/test.ts", "src/test.test.ts"],
      shared_context: "This is shared context",
      project_path: "/path/to/project",
    });

    expect(result).toContain("test-project-abc123-bead456");
    expect(result).toContain("test-project-abc123-epic789");
    expect(result).toContain("Test Subtask");
    expect(result).toContain("Do the test thing");
    expect(result).toContain("src/test.ts");
    expect(result).toContain("/path/to/project");
  });

  test("includes memory query step with MANDATORY emphasis", () => {
    const result = formatSubtaskPromptV2({
      bead_id: "test-project-abc123-def456",
      epic_id: "test-project-abc123-ghi789",
      subtask_title: "Test",
      subtask_description: "",
      files: [],
    });

    expect(result).toMatch(/Step 2:.*MANDATORY/i);
    expect(result).toContain("semantic-memory_find");
  });
});

describe("swarm_spawn_subtask tool", () => {
  test("returns post_completion_instructions field in JSON response", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      subtask_description: "Add feature X to the system",
      files: ["src/feature.ts", "src/feature.test.ts"],
      shared_context: "Epic context here",
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("post_completion_instructions");
    expect(typeof parsed.post_completion_instructions).toBe("string");
  });

  test("post_completion_instructions contains mandatory review steps", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      files: ["src/feature.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    const instructions = parsed.post_completion_instructions;
    
    // Should contain all 5 steps
    expect(instructions).toContain("Step 1: Check Swarm Mail");
    expect(instructions).toContain("swarmmail_inbox()");
    expect(instructions).toContain("Step 2: Review the Work");
    expect(instructions).toContain("swarm_review");
    expect(instructions).toContain("Step 3: Evaluate Against Criteria");
    expect(instructions).toContain("Step 4: Send Feedback");
    expect(instructions).toContain("swarm_review_feedback");
    expect(instructions).toContain("Step 5: ONLY THEN Continue");
  });

  test("post_completion_instructions substitutes placeholders", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      files: ["src/feature.ts", "src/feature.test.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    const instructions = parsed.post_completion_instructions;
    
    // Placeholders should be replaced
    expect(instructions).toContain("/Users/joel/Code/project");
    expect(instructions).toContain("test-project-abc123-epic1");
    expect(instructions).toContain("test-project-abc123-task1");
    expect(instructions).toContain('"src/feature.ts"');
    expect(instructions).toContain('"src/feature.test.ts"');
    
    // Placeholders should NOT remain
    expect(instructions).not.toContain("{project_key}");
    expect(instructions).not.toContain("{epic_id}");
    expect(instructions).not.toContain("{task_id}");
    expect(instructions).not.toContain("{files_touched}");
  });

  test("post_completion_instructions emphasizes mandatory nature", async () => {
    const { swarm_spawn_subtask } = await import("./swarm-prompts");
    
    const result = await swarm_spawn_subtask.execute({
      bead_id: "test-project-abc123-task1",
      epic_id: "test-project-abc123-epic1",
      subtask_title: "Implement feature X",
      files: ["src/feature.ts"],
      project_path: "/Users/joel/Code/project",
    });

    const parsed = JSON.parse(result);
    const instructions = parsed.post_completion_instructions;
    
    // Should have strong language
    expect(instructions).toMatch(/⚠️|MANDATORY|NON-NEGOTIABLE|DO NOT skip/i);
    expect(instructions).toContain("DO THIS IMMEDIATELY");
  });
});
