import { describe, expect, it } from "vitest";
import {
  BeadSchema,
  BeadTypeSchema,
  BeadCreateArgsSchema,
  EpicCreateArgsSchema,
  EvaluationSchema,
  TaskDecompositionSchema,
  DecomposedSubtaskSchema,
  SwarmStatusSchema,
  ValidationResultSchema,
} from "./index";

describe("BeadSchema", () => {
  it("validates a complete bead", () => {
    const bead = {
      id: "bd-abc123",
      title: "Fix the thing",
      type: "bug",
      status: "open",
      priority: 1,
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    expect(() => BeadSchema.parse(bead)).not.toThrow();
  });

  it("rejects invalid priority", () => {
    const bead = {
      id: "bd-abc123",
      title: "Fix the thing",
      type: "bug",
      status: "open",
      priority: 5, // Invalid: max is 3
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-01T00:00:00Z",
    };
    expect(() => BeadSchema.parse(bead)).toThrow();
  });

  it("accepts all valid types", () => {
    const types = ["bug", "feature", "task", "epic", "chore"];
    for (const type of types) {
      expect(() => BeadTypeSchema.parse(type)).not.toThrow();
    }
  });
});

describe("BeadCreateArgsSchema", () => {
  it("validates minimal create args", () => {
    const args = { title: "New bead" };
    const result = BeadCreateArgsSchema.parse(args);
    expect(result.title).toBe("New bead");
    expect(result.type).toBe("task"); // default
    expect(result.priority).toBe(2); // default
  });

  it("rejects empty title", () => {
    const args = { title: "" };
    expect(() => BeadCreateArgsSchema.parse(args)).toThrow();
  });
});

describe("EpicCreateArgsSchema", () => {
  it("validates epic with subtasks", () => {
    const args = {
      epic_title: "Big feature",
      subtasks: [
        { title: "Part 1", priority: 2 },
        { title: "Part 2", priority: 3 },
      ],
    };
    expect(() => EpicCreateArgsSchema.parse(args)).not.toThrow();
  });

  it("requires at least one subtask", () => {
    const args = {
      epic_title: "Big feature",
      subtasks: [],
    };
    expect(() => EpicCreateArgsSchema.parse(args)).toThrow();
  });
});

describe("EvaluationSchema", () => {
  it("validates a passing evaluation", () => {
    const evaluation = {
      passed: true,
      criteria: {
        type_safe: { passed: true, feedback: "All types correct" },
        no_bugs: { passed: true, feedback: "No issues found" },
      },
      overall_feedback: "Good work",
      retry_suggestion: null,
    };
    expect(() => EvaluationSchema.parse(evaluation)).not.toThrow();
  });

  it("validates a failing evaluation with retry suggestion", () => {
    const evaluation = {
      passed: false,
      criteria: {
        type_safe: { passed: false, feedback: "Missing types on line 42" },
      },
      overall_feedback: "Needs work",
      retry_suggestion: "Add explicit types to the handler function",
    };
    expect(() => EvaluationSchema.parse(evaluation)).not.toThrow();
  });
});

describe("TaskDecompositionSchema", () => {
  it("validates a decomposition", () => {
    const decomposition = {
      task: "Add OAuth authentication",
      reasoning: "Breaking into provider setup and integration",
      subtasks: [
        {
          title: "Add OAuth provider",
          description: "Configure Google OAuth",
          files: ["src/auth/google.ts"],
          estimated_effort: "medium" as const,
        },
      ],
      dependencies: [],
      shared_context: "Using NextAuth.js",
    };
    expect(() => TaskDecompositionSchema.parse(decomposition)).not.toThrow();
  });

  it("validates subtask effort levels", () => {
    const efforts = ["trivial", "small", "medium", "large"];
    for (const effort of efforts) {
      const subtask = {
        title: "Test",
        description: "Test description",
        files: [],
        estimated_effort: effort,
      };
      expect(() => DecomposedSubtaskSchema.parse(subtask)).not.toThrow();
    }
  });
});

describe("SwarmStatusSchema", () => {
  it("validates swarm status", () => {
    const status = {
      epic_id: "bd-epic123",
      total_agents: 3,
      running: 1,
      completed: 1,
      failed: 0,
      blocked: 1,
      agents: [
        {
          bead_id: "bd-1",
          agent_name: "BlueLake",
          status: "completed" as const,
          files: ["src/a.ts"],
        },
        {
          bead_id: "bd-2",
          agent_name: "RedStone",
          status: "running" as const,
          files: ["src/b.ts"],
        },
        {
          bead_id: "bd-3",
          agent_name: "GreenCastle",
          status: "pending" as const,
          files: ["src/c.ts"],
        },
      ],
      last_update: "2025-01-01T00:00:00Z",
    };
    expect(() => SwarmStatusSchema.parse(status)).not.toThrow();
  });
});

describe("ValidationResultSchema", () => {
  it("validates success result", () => {
    const result = {
      success: true,
      data: { foo: "bar" },
      attempts: 1,
      extractionMethod: "direct",
    };
    expect(() => ValidationResultSchema.parse(result)).not.toThrow();
  });

  it("validates failure result with errors", () => {
    const result = {
      success: false,
      attempts: 2,
      errors: ["Missing required field: name", "Invalid type for age"],
    };
    expect(() => ValidationResultSchema.parse(result)).not.toThrow();
  });
});
