/**
 * Tests for coordinator-discipline scorers
 */
import { describe, expect, it } from "bun:test";
import type { CoordinatorSession } from "../../src/eval-capture.js";
import {
	overallDiscipline,

	reviewThoroughness,
	spawnEfficiency,
	timeToFirstSpawn,
	violationCount,
} from "./coordinator-discipline.js";

describe("violationCount", () => {
	it("scores 1.0 for zero violations", async () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			end_time: "2025-01-01T01:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "strategy_selected",
					payload: { strategy: "file-based" },
				},
			],
		};

		const result = await violationCount({
			output: JSON.stringify(session),
			expected: {},
			input: undefined,
		});

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("0 violations");
	});

	it("decreases score by 0.2 per violation", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			end_time: "2025-01-01T01:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "VIOLATION",
					violation_type: "coordinator_edited_file",
					payload: { file: "test.ts" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:20Z",
					event_type: "VIOLATION",
					violation_type: "coordinator_ran_tests",
					payload: { command: "bun test" },
				},
			],
		};

		const result = violationCount.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0.6); // 1.0 - 0.2 * 2
		expect(result.message).toContain("2 violations");
	});

	it("floors score at 0.0 for many violations", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: Array.from({ length: 10 }, (_, i) => ({
				session_id: "test-session",
				epic_id: "test-epic",
				timestamp: `2025-01-01T00:00:${String(i).padStart(2, "0")}Z`,
				event_type: "VIOLATION" as const,
				violation_type: "coordinator_edited_file" as const,
				payload: { file: `test${i}.ts` },
			})),
		};

		const result = violationCount.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0.0);
		expect(result.message).toContain("10 violations");
	});
});

describe("spawnEfficiency", () => {
	it("scores 1.0 when all subtasks have workers spawned", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "decomposition_complete",
					payload: { subtask_count: 3 },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:20Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-2" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:30Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-3" },
				},
			],
		};

		const result = spawnEfficiency.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("3/3");
	});

	it("scores less than 1.0 when some workers not spawned", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "decomposition_complete",
					payload: { subtask_count: 4 },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:20Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-2" },
				},
			],
		};

		const result = spawnEfficiency.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0.5); // 2/4
		expect(result.message).toContain("2/4");
	});

	it("returns 0 when no decomposition event found", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-1" },
				},
			],
		};

		const result = spawnEfficiency.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0);
		expect(result.message).toContain("No decomposition");
	});
});

describe("reviewThoroughness", () => {
	it("scores 1.0 when all workers have reviews", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: { bead_id: "bd-2" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:20Z",
					event_type: "DECISION",
					decision_type: "review_completed",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:30Z",
					event_type: "DECISION",
					decision_type: "review_completed",
					payload: { bead_id: "bd-2" },
				},
			],
		};

		const result = reviewThoroughness.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("2/2");
	});

	it("scores less than 1.0 when some workers missing reviews", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: { bead_id: "bd-2" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:20Z",
					event_type: "DECISION",
					decision_type: "review_completed",
					payload: { bead_id: "bd-1" },
				},
			],
		};

		const result = reviewThoroughness.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0.5); // 1/2
		expect(result.message).toContain("1/2");
	});

	it("returns 1.0 when no workers finished", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "strategy_selected",
					payload: { strategy: "file-based" },
				},
			],
		};

		const result = reviewThoroughness.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(1.0);
		expect(result.message).toContain("No finished workers");
	});
});

describe("timeToFirstSpawn", () => {
	it("normalizes time to 0-1 range (faster is better)", () => {
		// 30 seconds to first spawn
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "decomposition_complete",
					payload: { subtask_count: 3 },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:30Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-1" },
				},
			],
		};

		const result = timeToFirstSpawn.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		// 30s should score around 0.95 (fast spawn)
		expect(result.score).toBeGreaterThan(0.9);
		expect(result.message).toContain("30000ms");
	});

	it("returns 0 when no worker spawned", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "decomposition_complete",
					payload: { subtask_count: 3 },
				},
			],
		};

		const result = timeToFirstSpawn.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0);
		expect(result.message).toContain("No worker spawned");
	});

	it("returns 0 when no decomposition event", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-1" },
				},
			],
		};

		const result = timeToFirstSpawn.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.score).toBe(0);
		expect(result.message).toContain("No decomposition");
	});
});

describe("overallDiscipline", () => {
	it("computes weighted composite score", () => {
		// Perfect session
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "decomposition_complete",
					payload: { subtask_count: 2 },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:10Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:20Z",
					event_type: "DECISION",
					decision_type: "worker_spawned",
					payload: { bead_id: "bd-2" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:10:00Z",
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:10:10Z",
					event_type: "OUTCOME",
					outcome_type: "subtask_success",
					payload: { bead_id: "bd-2" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:10:20Z",
					event_type: "DECISION",
					decision_type: "review_completed",
					payload: { bead_id: "bd-1" },
				},
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:10:30Z",
					event_type: "DECISION",
					decision_type: "review_completed",
					payload: { bead_id: "bd-2" },
				},
			],
		};

		const result = overallDiscipline.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		// Perfect session should score very high (close to 1.0)
		expect(result.score).toBeGreaterThan(0.95);
		expect(result.message).toContain("Overall");
	});

	it("includes breakdown in message", () => {
		const session: CoordinatorSession = {
			session_id: "test-session",
			epic_id: "test-epic",
			start_time: "2025-01-01T00:00:00Z",
			events: [
				{
					session_id: "test-session",
					epic_id: "test-epic",
					timestamp: "2025-01-01T00:00:00Z",
					event_type: "DECISION",
					decision_type: "strategy_selected",
					payload: { strategy: "file-based" },
				},
			],
		};

		const result = overallDiscipline.scorer({
			output: JSON.stringify(session),
			expected: {},
		});

		expect(result.message).toContain("Violations:");
		expect(result.message).toContain("Spawn:");
		expect(result.message).toContain("Review:");
		expect(result.message).toContain("Speed:");
	});
});

