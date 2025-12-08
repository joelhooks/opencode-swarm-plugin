/**
 * Bead schemas for type-safe beads operations
 *
 * These schemas validate all data from the `bd` CLI to ensure
 * type safety and catch malformed responses early.
 */
import { z } from "zod";

/** Valid bead statuses */
export const BeadStatusSchema = z.enum([
  "open",
  "in_progress",
  "blocked",
  "closed",
]);
export type BeadStatus = z.infer<typeof BeadStatusSchema>;

/** Valid bead types */
export const BeadTypeSchema = z.enum([
  "bug",
  "feature",
  "task",
  "epic",
  "chore",
]);
export type BeadType = z.infer<typeof BeadTypeSchema>;

/** Dependency relationship between beads */
export const BeadDependencySchema = z.object({
  id: z.string(),
  type: z.enum(["blocks", "blocked-by", "related", "discovered-from"]),
});
export type BeadDependency = z.infer<typeof BeadDependencySchema>;

/**
 * Core bead schema - validates bd CLI JSON output
 *
 * ID format:
 * - Standard: `{project}-{hash}` (e.g., `opencode-swarm-plugin-1i8`)
 * - Subtask: `{project}-{hash}.{index}` (e.g., `opencode-swarm-plugin-1i8.1`)
 */
export const BeadSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+-[a-z0-9]+(\.\d+)?$/, "Invalid bead ID format"),
  title: z.string().min(1, "Title required"),
  description: z.string().optional().default(""),
  status: BeadStatusSchema.default("open"),
  priority: z.number().int().min(0).max(3).default(2),
  issue_type: BeadTypeSchema.default("task"),
  created_at: z.string(), // ISO-8601
  updated_at: z.string().optional(),
  closed_at: z.string().optional(),
  parent_id: z.string().optional(),
  dependencies: z.array(BeadDependencySchema).optional().default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Bead = z.infer<typeof BeadSchema>;

/** Arguments for creating a bead */
export const BeadCreateArgsSchema = z.object({
  title: z.string().min(1, "Title required"),
  type: BeadTypeSchema.default("task"),
  priority: z.number().int().min(0).max(3).default(2),
  description: z.string().optional(),
  parent_id: z.string().optional(),
});
export type BeadCreateArgs = z.infer<typeof BeadCreateArgsSchema>;

/** Arguments for updating a bead */
export const BeadUpdateArgsSchema = z.object({
  id: z.string(),
  status: BeadStatusSchema.optional(),
  description: z.string().optional(),
  priority: z.number().int().min(0).max(3).optional(),
});
export type BeadUpdateArgs = z.infer<typeof BeadUpdateArgsSchema>;

/** Arguments for closing a bead */
export const BeadCloseArgsSchema = z.object({
  id: z.string(),
  reason: z.string().min(1, "Reason required"),
});
export type BeadCloseArgs = z.infer<typeof BeadCloseArgsSchema>;

/** Arguments for querying beads */
export const BeadQueryArgsSchema = z.object({
  status: BeadStatusSchema.optional(),
  type: BeadTypeSchema.optional(),
  ready: z.boolean().optional(),
  limit: z.number().int().positive().default(20),
});
export type BeadQueryArgs = z.infer<typeof BeadQueryArgsSchema>;

/**
 * Subtask specification for epic decomposition
 *
 * Used when creating an epic with subtasks in one operation.
 * The `files` array is used for Agent Mail file reservations.
 */
export const SubtaskSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  files: z.array(z.string()).default([]),
  dependencies: z.array(z.number().int().min(0)).default([]), // Indices of other subtasks
  estimated_complexity: z.number().int().min(1).max(5).default(3),
});
export type SubtaskSpec = z.infer<typeof SubtaskSpecSchema>;

/**
 * Bead tree for swarm decomposition
 *
 * Represents an epic with its subtasks, ready for spawning agents.
 */
export const BeadTreeSchema = z.object({
  epic: z.object({
    title: z.string().min(1),
    description: z.string().optional().default(""),
  }),
  subtasks: z.array(SubtaskSpecSchema).min(1).max(10),
});
export type BeadTree = z.infer<typeof BeadTreeSchema>;

/** Arguments for creating an epic with subtasks */
export const EpicCreateArgsSchema = z.object({
  epic_title: z.string().min(1),
  epic_description: z.string().optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string().min(1),
        priority: z.number().int().min(0).max(3).default(2),
        files: z.array(z.string()).optional().default([]),
      }),
    )
    .min(1)
    .max(10),
});
export type EpicCreateArgs = z.infer<typeof EpicCreateArgsSchema>;

/**
 * Result of epic creation
 *
 * Contains the created epic and all subtasks with their IDs.
 */
export const EpicCreateResultSchema = z.object({
  success: z.boolean(),
  epic: BeadSchema,
  subtasks: z.array(BeadSchema),
  rollback_hint: z.string().optional(),
});
export type EpicCreateResult = z.infer<typeof EpicCreateResultSchema>;
