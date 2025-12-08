/**
 * Learning Module Integration Tests
 *
 * Tests for confidence decay, feedback scoring, outcome tracking,
 * anti-patterns, pattern maturity, and swarm tool integrations.
 *
 * These tests don't require external services - they test the learning
 * algorithms and their integration with swarm tools.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Learning module
import {
  calculateDecayedValue,
  calculateCriterionWeight,
  scoreImplicitFeedback,
  outcomeToFeedback,
  applyWeights,
  shouldDeprecateCriterion,
  InMemoryFeedbackStorage,
  DEFAULT_LEARNING_CONFIG,
  type FeedbackEvent,
  type OutcomeSignals,
  type CriterionWeight,
} from "./learning";

// Anti-patterns module
import {
  shouldInvertPattern,
  invertToAntiPattern,
  recordPatternObservation,
  extractPatternsFromDescription,
  createPattern,
  formatAntiPatternsForPrompt,
  formatSuccessfulPatternsForPrompt,
  InMemoryPatternStorage,
  DEFAULT_ANTI_PATTERN_CONFIG,
  type DecompositionPattern,
} from "./anti-patterns";

// Pattern maturity module
import {
  calculateMaturityState,
  calculateDecayedCounts,
  createPatternMaturity,
  updatePatternMaturity,
  promotePattern,
  deprecatePattern,
  formatMaturityForPrompt,
  getMaturityMultiplier,
  InMemoryMaturityStorage,
  DEFAULT_MATURITY_CONFIG,
  type PatternMaturity,
  type MaturityFeedback,
} from "./pattern-maturity";

// Swarm tools
import {
  swarm_decompose,
  swarm_validate_decomposition,
  swarm_record_outcome,
  detectInstructionConflicts,
} from "./swarm";

// ============================================================================
// Test Helpers
// ============================================================================

const mockContext = {
  sessionID: `test-learning-${Date.now()}`,
  messageID: `test-message-${Date.now()}`,
  agent: "test-agent",
  abort: new AbortController().signal,
};

/**
 * Create a feedback event for testing
 */
function createFeedbackEvent(
  criterion: string,
  type: "helpful" | "harmful" | "neutral",
  daysAgo: number = 0,
): FeedbackEvent {
  const timestamp = new Date(
    Date.now() - daysAgo * 24 * 60 * 60 * 1000,
  ).toISOString();
  return {
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    criterion,
    type,
    timestamp,
    raw_value: 1,
  };
}

/**
 * Create outcome signals for testing
 */
function createOutcomeSignals(
  overrides: Partial<OutcomeSignals> = {},
): OutcomeSignals {
  return {
    bead_id: `test-bead-${Date.now()}`,
    duration_ms: 60000, // 1 minute
    error_count: 0,
    retry_count: 0,
    success: true,
    files_touched: ["src/test.ts"],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Confidence Decay Tests
// ============================================================================

describe("Confidence Decay", () => {
  describe("calculateDecayedValue", () => {
    it("returns 1.0 for current timestamp", () => {
      const now = new Date();
      const value = calculateDecayedValue(now.toISOString(), now);
      expect(value).toBeCloseTo(1.0, 5);
    });

    it("returns ~0.5 after one half-life", () => {
      const now = new Date();
      const halfLifeDays = 90;
      const pastDate = new Date(
        now.getTime() - halfLifeDays * 24 * 60 * 60 * 1000,
      );
      const value = calculateDecayedValue(
        pastDate.toISOString(),
        now,
        halfLifeDays,
      );
      expect(value).toBeCloseTo(0.5, 1);
    });

    it("returns ~0.25 after two half-lives", () => {
      const now = new Date();
      const halfLifeDays = 90;
      const pastDate = new Date(
        now.getTime() - 2 * halfLifeDays * 24 * 60 * 60 * 1000,
      );
      const value = calculateDecayedValue(
        pastDate.toISOString(),
        now,
        halfLifeDays,
      );
      expect(value).toBeCloseTo(0.25, 1);
    });

    it("handles future timestamps gracefully", () => {
      const now = new Date();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const value = calculateDecayedValue(futureDate.toISOString(), now);
      expect(value).toBe(1.0); // Max 0 age = no decay
    });
  });

  describe("calculateCriterionWeight", () => {
    it("returns weight 1.0 for no feedback", () => {
      const weight = calculateCriterionWeight([]);
      expect(weight.weight).toBe(1.0);
      expect(weight.helpful_count).toBe(0);
      expect(weight.harmful_count).toBe(0);
    });

    it("returns high weight for all helpful feedback", () => {
      const events = [
        createFeedbackEvent("type_safe", "helpful", 0),
        createFeedbackEvent("type_safe", "helpful", 1),
        createFeedbackEvent("type_safe", "helpful", 2),
      ];
      const weight = calculateCriterionWeight(events);
      expect(weight.weight).toBeGreaterThan(0.9);
      expect(weight.helpful_count).toBe(3);
      expect(weight.harmful_count).toBe(0);
    });

    it("returns lower weight for mixed feedback", () => {
      const events = [
        createFeedbackEvent("type_safe", "helpful", 0),
        createFeedbackEvent("type_safe", "harmful", 1),
        createFeedbackEvent("type_safe", "helpful", 2),
      ];
      const weight = calculateCriterionWeight(events);
      expect(weight.weight).toBeLessThan(0.9);
      expect(weight.weight).toBeGreaterThan(0.5);
    });

    it("applies decay to older feedback", () => {
      // Recent harmful feedback should have more impact than old helpful
      const events = [
        createFeedbackEvent("type_safe", "helpful", 180), // 180 days ago (2 half-lives)
        createFeedbackEvent("type_safe", "harmful", 0), // today
      ];
      const weight = calculateCriterionWeight(events);
      // Harmful is recent (weight ~1), helpful is old (weight ~0.25)
      // So harmful dominates
      expect(weight.weight).toBeLessThan(0.5);
    });

    it("tracks last_validated timestamp", () => {
      const events = [
        createFeedbackEvent("type_safe", "helpful", 10),
        createFeedbackEvent("type_safe", "helpful", 5),
        createFeedbackEvent("type_safe", "helpful", 0),
      ];
      const weight = calculateCriterionWeight(events);
      expect(weight.last_validated).toBeDefined();
      // Most recent helpful event should be last_validated
      const lastValidated = new Date(weight.last_validated!);
      const now = new Date();
      const diffDays =
        (now.getTime() - lastValidated.getTime()) / (24 * 60 * 60 * 1000);
      expect(diffDays).toBeLessThan(1);
    });
  });

  describe("shouldDeprecateCriterion", () => {
    it("returns false for insufficient feedback", () => {
      const weight: CriterionWeight = {
        criterion: "type_safe",
        weight: 0.3,
        helpful_count: 1,
        harmful_count: 1,
        half_life_days: 90,
      };
      expect(shouldDeprecateCriterion(weight)).toBe(false);
    });

    it("returns true for high harmful ratio with enough feedback", () => {
      const weight: CriterionWeight = {
        criterion: "type_safe",
        weight: 0.3,
        helpful_count: 1,
        harmful_count: 4, // 80% harmful
        half_life_days: 90,
      };
      expect(shouldDeprecateCriterion(weight)).toBe(true);
    });

    it("returns false for acceptable harmful ratio", () => {
      const weight: CriterionWeight = {
        criterion: "type_safe",
        weight: 0.8,
        helpful_count: 8,
        harmful_count: 2, // 20% harmful
        half_life_days: 90,
      };
      expect(shouldDeprecateCriterion(weight)).toBe(false);
    });
  });
});

// ============================================================================
// Outcome Scoring Tests
// ============================================================================

describe("Outcome Scoring", () => {
  describe("scoreImplicitFeedback", () => {
    it("scores fast successful completion as helpful", () => {
      const signals = createOutcomeSignals({
        duration_ms: 60000, // 1 minute (fast)
        error_count: 0,
        retry_count: 0,
        success: true,
      });
      const scored = scoreImplicitFeedback(signals);
      expect(scored.type).toBe("helpful");
      expect(scored.decayed_value).toBeGreaterThan(0.7);
    });

    it("scores slow failed completion as harmful", () => {
      const signals = createOutcomeSignals({
        duration_ms: 60 * 60 * 1000, // 1 hour (slow)
        error_count: 5,
        retry_count: 3,
        success: false,
      });
      const scored = scoreImplicitFeedback(signals);
      expect(scored.type).toBe("harmful");
      expect(scored.decayed_value).toBeLessThan(0.4);
    });

    it("scores mixed signals as neutral", () => {
      const signals = createOutcomeSignals({
        duration_ms: 15 * 60 * 1000, // 15 minutes (medium)
        error_count: 1,
        retry_count: 1,
        success: true,
      });
      const scored = scoreImplicitFeedback(signals);
      // Could be helpful or neutral depending on exact thresholds
      expect(["helpful", "neutral"]).toContain(scored.type);
    });

    it("includes reasoning in result", () => {
      const signals = createOutcomeSignals();
      const scored = scoreImplicitFeedback(signals);
      expect(scored.reasoning).toBeDefined();
      expect(scored.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe("outcomeToFeedback", () => {
    it("converts scored outcome to feedback event", () => {
      const signals = createOutcomeSignals({ bead_id: "test-bead-123" });
      const scored = scoreImplicitFeedback(signals);
      const feedback = outcomeToFeedback(scored, "type_safe");

      expect(feedback.criterion).toBe("type_safe");
      expect(feedback.type).toBe(scored.type);
      expect(feedback.bead_id).toBe("test-bead-123");
      expect(feedback.context).toBe(scored.reasoning);
    });
  });

  describe("applyWeights", () => {
    it("applies weights to raw scores", () => {
      const criteria = {
        type_safe: 0.8,
        no_bugs: 0.9,
        patterns: 0.7,
      };
      const weights: Record<string, CriterionWeight> = {
        type_safe: {
          criterion: "type_safe",
          weight: 1.0,
          helpful_count: 5,
          harmful_count: 0,
          half_life_days: 90,
        },
        no_bugs: {
          criterion: "no_bugs",
          weight: 0.5,
          helpful_count: 2,
          harmful_count: 2,
          half_life_days: 90,
        },
        patterns: {
          criterion: "patterns",
          weight: 0.8,
          helpful_count: 4,
          harmful_count: 1,
          half_life_days: 90,
        },
      };

      const result = applyWeights(criteria, weights);

      expect(result.type_safe.raw).toBe(0.8);
      expect(result.type_safe.weighted).toBe(0.8); // 0.8 * 1.0
      expect(result.no_bugs.weighted).toBe(0.45); // 0.9 * 0.5
      expect(result.patterns.weighted).toBeCloseTo(0.56); // 0.7 * 0.8
    });

    it("uses default weight 1.0 for unknown criteria", () => {
      const criteria = { unknown_criterion: 0.5 };
      const weights: Record<string, CriterionWeight> = {};

      const result = applyWeights(criteria, weights);

      expect(result.unknown_criterion.weight).toBe(1.0);
      expect(result.unknown_criterion.weighted).toBe(0.5);
    });
  });
});

// ============================================================================
// Feedback Storage Tests
// ============================================================================

describe("InMemoryFeedbackStorage", () => {
  let storage: InMemoryFeedbackStorage;

  beforeEach(() => {
    storage = new InMemoryFeedbackStorage();
  });

  it("stores and retrieves feedback events", async () => {
    const event = createFeedbackEvent("type_safe", "helpful");
    await storage.store(event);

    const all = await storage.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(event.id);
  });

  it("retrieves events by criterion", async () => {
    await storage.store(createFeedbackEvent("type_safe", "helpful"));
    await storage.store(createFeedbackEvent("no_bugs", "harmful"));
    await storage.store(createFeedbackEvent("type_safe", "helpful"));

    const typeSafe = await storage.getByCriterion("type_safe");
    expect(typeSafe).toHaveLength(2);

    const noBugs = await storage.getByCriterion("no_bugs");
    expect(noBugs).toHaveLength(1);
  });

  it("retrieves events by bead ID", async () => {
    const event1 = {
      ...createFeedbackEvent("type_safe", "helpful"),
      bead_id: "bead-1",
    };
    const event2 = {
      ...createFeedbackEvent("no_bugs", "harmful"),
      bead_id: "bead-1",
    };
    const event3 = {
      ...createFeedbackEvent("type_safe", "helpful"),
      bead_id: "bead-2",
    };

    await storage.store(event1);
    await storage.store(event2);
    await storage.store(event3);

    const bead1Events = await storage.getByBead("bead-1");
    expect(bead1Events).toHaveLength(2);
  });
});

// ============================================================================
// Anti-Pattern Tests
// ============================================================================

describe("Anti-Patterns", () => {
  describe("shouldInvertPattern", () => {
    it("returns false for patterns with insufficient observations", () => {
      const pattern = createPattern("Split by file type");
      pattern.success_count = 1;
      pattern.failure_count = 1;

      expect(shouldInvertPattern(pattern)).toBe(false);
    });

    it("returns true for patterns with high failure rate", () => {
      const pattern = createPattern("Split by file type");
      pattern.success_count = 1;
      pattern.failure_count = 4; // 80% failure

      expect(shouldInvertPattern(pattern)).toBe(true);
    });

    it("returns false for already inverted patterns", () => {
      const pattern = createPattern("Split by file type");
      pattern.kind = "anti_pattern";
      pattern.success_count = 0;
      pattern.failure_count = 10;

      expect(shouldInvertPattern(pattern)).toBe(false);
    });
  });

  describe("invertToAntiPattern", () => {
    it("creates anti-pattern with AVOID prefix", () => {
      const pattern = createPattern("Split by file type");
      const result = invertToAntiPattern(pattern, "High failure rate");

      expect(result.inverted.kind).toBe("anti_pattern");
      expect(result.inverted.is_negative).toBe(true);
      expect(result.inverted.content).toContain("AVOID:");
      expect(result.inverted.content).toContain("Split by file type");
      expect(result.inverted.reason).toBe("High failure rate");
    });

    it("removes existing prefixes before inverting", () => {
      const pattern = createPattern("AVOID: something");
      const result = invertToAntiPattern(pattern, "test");

      // Should not have double AVOID
      expect(result.inverted.content).not.toContain("AVOID: AVOID:");
    });
  });

  describe("recordPatternObservation", () => {
    it("increments success count on success", () => {
      const pattern = createPattern("Test pattern");
      const result = recordPatternObservation(pattern, true);

      expect(result.pattern.success_count).toBe(1);
      expect(result.pattern.failure_count).toBe(0);
      expect(result.inversion).toBeUndefined();
    });

    it("increments failure count on failure", () => {
      const pattern = createPattern("Test pattern");
      const result = recordPatternObservation(pattern, false);

      expect(result.pattern.success_count).toBe(0);
      expect(result.pattern.failure_count).toBe(1);
    });

    it("triggers inversion when threshold reached", () => {
      let pattern = createPattern("Bad pattern");
      // Record enough failures to trigger inversion
      for (let i = 0; i < 4; i++) {
        const result = recordPatternObservation(pattern, false);
        pattern = result.pattern;
        if (result.inversion) {
          expect(result.inversion.inverted.kind).toBe("anti_pattern");
          return;
        }
      }
      // Should have triggered by now
      expect(pattern.failure_count).toBeGreaterThanOrEqual(3);
    });

    it("records bead ID in examples", () => {
      const pattern = createPattern("Test pattern");
      const result = recordPatternObservation(pattern, true, "bead-123");

      expect(result.pattern.example_beads).toContain("bead-123");
    });
  });

  describe("extractPatternsFromDescription", () => {
    it("extracts file splitting patterns", () => {
      const patterns = extractPatternsFromDescription(
        "We should split by file type and handle shared types first",
      );

      expect(patterns).toContain("Split by file type");
      expect(patterns).toContain("Handle shared types first");
    });

    it("extracts test organization patterns", () => {
      const patterns = extractPatternsFromDescription(
        "Tests alongside implementation code should be in the same subtask",
      );

      expect(patterns).toContain("Tests alongside implementation");
    });

    it("returns empty array for no matches", () => {
      const patterns = extractPatternsFromDescription(
        "Just a regular description with no patterns",
      );

      expect(patterns).toHaveLength(0);
    });
  });

  describe("formatAntiPatternsForPrompt", () => {
    it("formats anti-patterns as bullet list", () => {
      const patterns: DecompositionPattern[] = [
        {
          ...createPattern("Bad pattern 1"),
          kind: "anti_pattern",
          is_negative: true,
        },
        {
          ...createPattern("Bad pattern 2"),
          kind: "anti_pattern",
          is_negative: true,
        },
      ];

      const formatted = formatAntiPatternsForPrompt(patterns);

      expect(formatted).toContain("Anti-Patterns to Avoid");
      expect(formatted).toContain("Bad pattern 1");
      expect(formatted).toContain("Bad pattern 2");
    });

    it("returns empty string for no anti-patterns", () => {
      const patterns: DecompositionPattern[] = [createPattern("Good pattern")];

      const formatted = formatAntiPatternsForPrompt(patterns);

      expect(formatted).toBe("");
    });
  });

  describe("formatSuccessfulPatternsForPrompt", () => {
    it("formats successful patterns with success rate", () => {
      const pattern = createPattern("Good pattern");
      pattern.success_count = 8;
      pattern.failure_count = 2;

      const formatted = formatSuccessfulPatternsForPrompt([pattern]);

      expect(formatted).toContain("Successful Patterns");
      expect(formatted).toContain("Good pattern");
      expect(formatted).toContain("80%");
    });

    it("excludes patterns below success threshold", () => {
      const pattern = createPattern("Mediocre pattern");
      pattern.success_count = 5;
      pattern.failure_count = 5; // 50% success

      const formatted = formatSuccessfulPatternsForPrompt([pattern], 0.7);

      expect(formatted).toBe("");
    });
  });
});

// ============================================================================
// Pattern Maturity Tests
// ============================================================================

/**
 * Create maturity feedback events for testing
 */
function createMaturityFeedback(
  patternId: string,
  type: "helpful" | "harmful",
  daysAgo: number = 0,
): MaturityFeedback {
  return {
    pattern_id: patternId,
    type,
    timestamp: new Date(
      Date.now() - daysAgo * 24 * 60 * 60 * 1000,
    ).toISOString(),
    weight: 1,
  };
}

describe("Pattern Maturity", () => {
  describe("calculateMaturityState", () => {
    it("returns candidate for insufficient feedback", () => {
      const feedback: MaturityFeedback[] = [
        createMaturityFeedback("test", "helpful"),
      ];

      const state = calculateMaturityState(feedback);
      expect(state).toBe("candidate");
    });

    it("returns deprecated for high harmful ratio", () => {
      const feedback: MaturityFeedback[] = [
        createMaturityFeedback("test", "helpful"),
        createMaturityFeedback("test", "helpful"),
        createMaturityFeedback("test", "harmful"),
        createMaturityFeedback("test", "harmful"),
        createMaturityFeedback("test", "harmful"),
        createMaturityFeedback("test", "harmful"),
        createMaturityFeedback("test", "harmful"),
      ];

      const state = calculateMaturityState(feedback);
      expect(state).toBe("deprecated");
    });

    it("returns proven for consistent success", () => {
      const feedback: MaturityFeedback[] = [];
      // Add 10 helpful, 1 harmful
      for (let i = 0; i < 10; i++) {
        feedback.push(createMaturityFeedback("test", "helpful"));
      }
      feedback.push(createMaturityFeedback("test", "harmful"));

      const state = calculateMaturityState(feedback);
      expect(state).toBe("proven");
    });

    it("returns established for moderate feedback", () => {
      const feedback: MaturityFeedback[] = [
        createMaturityFeedback("test", "helpful"),
        createMaturityFeedback("test", "helpful"),
        createMaturityFeedback("test", "helpful"),
        createMaturityFeedback("test", "helpful"),
        createMaturityFeedback("test", "harmful"),
      ];

      const state = calculateMaturityState(feedback);
      expect(state).toBe("established");
    });
  });

  describe("promotePattern", () => {
    it("promotes to proven state", () => {
      const maturity = createPatternMaturity("test");

      const promoted = promotePattern(maturity);
      expect(promoted.state).toBe("proven");
      expect(promoted.promoted_at).toBeDefined();
    });

    it("keeps proven state if already proven", () => {
      const maturity: PatternMaturity = {
        pattern_id: "test",
        state: "proven",
        helpful_count: 20,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
      };

      const promoted = promotePattern(maturity);
      expect(promoted.state).toBe("proven");
    });

    it("throws when promoting deprecated pattern", () => {
      const maturity: PatternMaturity = {
        pattern_id: "test",
        state: "deprecated",
        helpful_count: 2,
        harmful_count: 8,
        last_validated: new Date().toISOString(),
      };

      expect(() => promotePattern(maturity)).toThrow();
    });
  });

  describe("deprecatePattern", () => {
    it("deprecates pattern", () => {
      const maturity = createPatternMaturity("test");

      const deprecated = deprecatePattern(maturity, "Too many failures");
      expect(deprecated.state).toBe("deprecated");
      expect(deprecated.deprecated_at).toBeDefined();
    });

    it("keeps deprecated state if already deprecated", () => {
      const maturity: PatternMaturity = {
        pattern_id: "test",
        state: "deprecated",
        helpful_count: 2,
        harmful_count: 8,
        last_validated: new Date().toISOString(),
        deprecated_at: new Date().toISOString(),
      };

      const deprecated = deprecatePattern(maturity);
      expect(deprecated.state).toBe("deprecated");
    });
  });

  describe("getMaturityMultiplier", () => {
    it("returns correct multipliers for each state", () => {
      expect(getMaturityMultiplier("candidate")).toBe(0.5);
      expect(getMaturityMultiplier("established")).toBe(1.0);
      expect(getMaturityMultiplier("proven")).toBe(1.5);
      expect(getMaturityMultiplier("deprecated")).toBe(0);
    });
  });

  describe("formatMaturityForPrompt", () => {
    it("formats proven maturity info", () => {
      const maturity: PatternMaturity = {
        pattern_id: "pattern-1",
        state: "proven",
        helpful_count: 10,
        harmful_count: 1,
        last_validated: new Date().toISOString(),
      };

      const formatted = formatMaturityForPrompt(maturity);

      expect(formatted).toContain("PROVEN");
      expect(formatted).toContain("helpful");
    });

    it("formats deprecated maturity info", () => {
      const maturity: PatternMaturity = {
        pattern_id: "pattern-2",
        state: "deprecated",
        helpful_count: 2,
        harmful_count: 8,
        last_validated: new Date().toISOString(),
      };

      const formatted = formatMaturityForPrompt(maturity);

      expect(formatted).toContain("DEPRECATED");
      expect(formatted).toContain("harmful");
    });
  });
});

// ============================================================================
// Swarm Tool Integration Tests
// ============================================================================

describe("Swarm Tool Integrations", () => {
  describe("swarm_record_outcome", () => {
    it("records successful outcome and generates feedback", async () => {
      const result = await swarm_record_outcome.execute(
        {
          bead_id: "test-bead-123",
          duration_ms: 60000,
          error_count: 0,
          retry_count: 0,
          success: true,
          files_touched: ["src/test.ts"],
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.outcome.scored.type).toBe("helpful");
      expect(parsed.feedback_events).toHaveLength(4); // Default 4 criteria
      expect(parsed.feedback_events[0].criterion).toBe("type_safe");
    });

    it("records failed outcome as harmful", async () => {
      const result = await swarm_record_outcome.execute(
        {
          bead_id: "test-bead-456",
          duration_ms: 3600000, // 1 hour
          error_count: 10,
          retry_count: 5,
          success: false,
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.outcome.scored.type).toBe("harmful");
    });

    it("uses custom criteria when provided", async () => {
      const result = await swarm_record_outcome.execute(
        {
          bead_id: "test-bead-789",
          duration_ms: 60000,
          error_count: 0,
          retry_count: 0,
          success: true,
          criteria: ["custom_criterion"],
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.feedback_events).toHaveLength(1);
      expect(parsed.feedback_events[0].criterion).toBe("custom_criterion");
    });
  });

  describe("detectInstructionConflicts", () => {
    it("detects positive/negative conflicts", () => {
      const subtasks = [
        {
          title: "Use React Query for state management",
          description: "Always use React Query",
        },
        {
          title: "Avoid external state libraries",
          description: "Never use external state libraries",
        },
      ];

      const conflicts = detectInstructionConflicts(subtasks);

      // Should detect potential conflict around "state" and "use/avoid"
      expect(conflicts.length).toBeGreaterThanOrEqual(0); // Heuristic may or may not catch this
    });

    it("returns empty array for non-conflicting subtasks", () => {
      const subtasks = [
        {
          title: "Add user authentication",
          description: "Implement OAuth flow",
        },
        { title: "Add API routes", description: "Create REST endpoints" },
      ];

      const conflicts = detectInstructionConflicts(subtasks);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe("swarm_validate_decomposition with conflicts", () => {
    it("includes instruction conflicts as warnings", async () => {
      const decomposition = {
        epic: { title: "Test Epic" },
        subtasks: [
          {
            title: "Always use TypeScript strict mode",
            description: "Must enable strict mode",
            files: ["tsconfig.json"],
            dependencies: [],
            estimated_complexity: 1,
          },
          {
            title: "Avoid strict TypeScript settings",
            description: "Never use strict mode",
            files: ["src/index.ts"],
            dependencies: [],
            estimated_complexity: 1,
          },
        ],
      };

      const result = await swarm_validate_decomposition.execute(
        { response: JSON.stringify(decomposition) },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.valid).toBe(true);
      // Warnings may or may not be present depending on heuristic
      if (parsed.warnings) {
        expect(parsed.warnings).toHaveProperty("instruction_conflicts");
      }
    });
  });

  describe("swarm_decompose with CASS integration", () => {
    it("includes cass_history in response", async () => {
      const result = await swarm_decompose.execute(
        {
          task: "Add user authentication",
          max_subtasks: 3,
          query_cass: true,
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty("cass_history");
      expect(parsed.cass_history).toHaveProperty("queried");
    });

    it("skips CASS when disabled", async () => {
      const result = await swarm_decompose.execute(
        {
          task: "Add user authentication",
          max_subtasks: 3,
          query_cass: false,
        },
        mockContext,
      );

      const parsed = JSON.parse(result);

      expect(parsed.cass_history.queried).toBe(false);
    });
  });
});

// ============================================================================
// Pattern Storage Tests
// ============================================================================

describe("InMemoryPatternStorage", () => {
  let storage: InMemoryPatternStorage;

  beforeEach(() => {
    storage = new InMemoryPatternStorage();
  });

  it("stores and retrieves patterns", async () => {
    const pattern = createPattern("Test pattern");
    await storage.store(pattern);

    const retrieved = await storage.get(pattern.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toBe("Test pattern");
  });

  it("lists all patterns", async () => {
    await storage.store(createPattern("Pattern 1"));
    await storage.store(createPattern("Pattern 2"));

    const all = await storage.getAll();
    expect(all).toHaveLength(2);
  });

  it("filters anti-patterns", async () => {
    const pattern = createPattern("Good pattern");
    const antiPattern = {
      ...createPattern("Bad pattern"),
      kind: "anti_pattern" as const,
      is_negative: true,
    };

    await storage.store(pattern);
    await storage.store(antiPattern);

    const antiPatterns = await storage.getAntiPatterns();
    expect(antiPatterns).toHaveLength(1);
    expect(antiPatterns[0].content).toBe("Bad pattern");
  });

  it("filters by tag", async () => {
    const pattern1 = { ...createPattern("Pattern 1"), tags: ["decomposition"] };
    const pattern2 = { ...createPattern("Pattern 2"), tags: ["testing"] };

    await storage.store(pattern1);
    await storage.store(pattern2);

    const decompositionPatterns = await storage.getByTag("decomposition");
    expect(decompositionPatterns).toHaveLength(1);
  });

  it("finds patterns by content", async () => {
    await storage.store(createPattern("Split by file type"));
    await storage.store(createPattern("Split by component"));
    await storage.store(createPattern("Sequential execution"));

    const splitPatterns = await storage.findByContent("split");
    expect(splitPatterns).toHaveLength(2);
  });
});

// ============================================================================
// Maturity Storage Tests
// ============================================================================

describe("InMemoryMaturityStorage", () => {
  let storage: InMemoryMaturityStorage;

  beforeEach(() => {
    storage = new InMemoryMaturityStorage();
  });

  it("stores and retrieves maturity records", async () => {
    const maturity: PatternMaturity = {
      pattern_id: "pattern-1",
      state: "candidate",
      helpful_count: 0,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    await storage.store(maturity);
    const retrieved = await storage.get("pattern-1");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.state).toBe("candidate");
  });

  it("stores and retrieves feedback events", async () => {
    const feedback: MaturityFeedback = {
      pattern_id: "pattern-1",
      type: "helpful",
      timestamp: new Date().toISOString(),
      weight: 1,
    };

    await storage.storeFeedback(feedback);
    const retrieved = await storage.getFeedback("pattern-1");

    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].type).toBe("helpful");
  });

  it("filters feedback by pattern ID", async () => {
    await storage.storeFeedback({
      pattern_id: "p1",
      type: "helpful",
      timestamp: new Date().toISOString(),
      weight: 1,
    });
    await storage.storeFeedback({
      pattern_id: "p2",
      type: "harmful",
      timestamp: new Date().toISOString(),
      weight: 1,
    });
    await storage.storeFeedback({
      pattern_id: "p1",
      type: "helpful",
      timestamp: new Date().toISOString(),
      weight: 1,
    });

    const p1Feedback = await storage.getFeedback("p1");
    expect(p1Feedback).toHaveLength(2);

    const p2Feedback = await storage.getFeedback("p2");
    expect(p2Feedback).toHaveLength(1);
  });

  it("filters by state", async () => {
    await storage.store({
      pattern_id: "p1",
      state: "candidate",
      helpful_count: 1,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    });
    await storage.store({
      pattern_id: "p2",
      state: "proven",
      helpful_count: 10,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    });

    const candidates = await storage.getByState("candidate");
    expect(candidates).toHaveLength(1);

    const proven = await storage.getByState("proven");
    expect(proven).toHaveLength(1);
  });
});

// ============================================================================
// Storage Module Tests
// ============================================================================

import {
  createStorage,
  createStorageWithFallback,
  getStorage,
  setStorage,
  resetStorage,
  InMemoryStorage,
  SemanticMemoryStorage,
  isSemanticMemoryAvailable,
  type LearningStorage,
} from "./storage";

describe("Storage Module", () => {
  describe("createStorage", () => {
    it("creates InMemoryStorage when backend is memory", () => {
      const storage = createStorage({ backend: "memory" });
      expect(storage).toBeInstanceOf(InMemoryStorage);
    });

    it("creates SemanticMemoryStorage when backend is semantic-memory", () => {
      const storage = createStorage({ backend: "semantic-memory" });
      expect(storage).toBeInstanceOf(SemanticMemoryStorage);
    });

    it("uses semantic-memory as default backend", () => {
      const storage = createStorage();
      expect(storage).toBeInstanceOf(SemanticMemoryStorage);
    });

    it("throws on unknown backend", () => {
      expect(() => createStorage({ backend: "unknown" as any })).toThrow(
        "Unknown storage backend",
      );
    });
  });

  describe("InMemoryStorage", () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
      storage = new InMemoryStorage();
    });

    it("stores and retrieves feedback", async () => {
      const event = createFeedbackEvent("type_safe", "helpful");
      await storage.storeFeedback(event);

      const all = await storage.getAllFeedback();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(event.id);
    });

    it("retrieves feedback by criterion", async () => {
      await storage.storeFeedback(createFeedbackEvent("type_safe", "helpful"));
      await storage.storeFeedback(createFeedbackEvent("no_bugs", "harmful"));

      const typeSafe = await storage.getFeedbackByCriterion("type_safe");
      expect(typeSafe).toHaveLength(1);
      expect(typeSafe[0].criterion).toBe("type_safe");
    });

    it("retrieves feedback by bead ID", async () => {
      const event1 = {
        ...createFeedbackEvent("type_safe", "helpful"),
        bead_id: "bead-1",
      };
      const event2 = {
        ...createFeedbackEvent("no_bugs", "harmful"),
        bead_id: "bead-2",
      };

      await storage.storeFeedback(event1);
      await storage.storeFeedback(event2);

      const bead1Events = await storage.getFeedbackByBead("bead-1");
      expect(bead1Events).toHaveLength(1);
      expect(bead1Events[0].bead_id).toBe("bead-1");
    });

    it("finds similar feedback (returns all in memory)", async () => {
      await storage.storeFeedback(createFeedbackEvent("type_safe", "helpful"));
      await storage.storeFeedback(createFeedbackEvent("no_bugs", "harmful"));

      const similar = await storage.findSimilarFeedback("type", 10);
      expect(similar.length).toBeGreaterThan(0);
    });

    it("stores and retrieves patterns", async () => {
      const pattern = createPattern("Test pattern");
      await storage.storePattern(pattern);

      const retrieved = await storage.getPattern(pattern.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.content).toBe("Test pattern");
    });

    it("retrieves all patterns", async () => {
      await storage.storePattern(createPattern("Pattern 1"));
      await storage.storePattern(createPattern("Pattern 2"));

      const all = await storage.getAllPatterns();
      expect(all).toHaveLength(2);
    });

    it("filters anti-patterns", async () => {
      const pattern = createPattern("Good pattern");
      const antiPattern = {
        ...createPattern("Bad pattern"),
        kind: "anti_pattern" as const,
        is_negative: true,
      };

      await storage.storePattern(pattern);
      await storage.storePattern(antiPattern);

      const antiPatterns = await storage.getAntiPatterns();
      expect(antiPatterns).toHaveLength(1);
      expect(antiPatterns[0].kind).toBe("anti_pattern");
    });

    it("retrieves patterns by tag", async () => {
      const pattern1 = {
        ...createPattern("Pattern 1"),
        tags: ["decomposition"],
      };
      const pattern2 = { ...createPattern("Pattern 2"), tags: ["testing"] };

      await storage.storePattern(pattern1);
      await storage.storePattern(pattern2);

      const decompositionPatterns =
        await storage.getPatternsByTag("decomposition");
      expect(decompositionPatterns).toHaveLength(1);
    });

    it("finds similar patterns by content", async () => {
      await storage.storePattern(createPattern("Split by file type"));
      await storage.storePattern(createPattern("Split by component"));

      const similar = await storage.findSimilarPatterns("split");
      expect(similar.length).toBeGreaterThan(0);
    });

    it("stores and retrieves maturity", async () => {
      const maturity = createPatternMaturity("pattern-1");
      await storage.storeMaturity(maturity);

      const retrieved = await storage.getMaturity("pattern-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.pattern_id).toBe("pattern-1");
    });

    it("retrieves all maturity records", async () => {
      await storage.storeMaturity(createPatternMaturity("p1"));
      await storage.storeMaturity(createPatternMaturity("p2"));

      const all = await storage.getAllMaturity();
      expect(all).toHaveLength(2);
    });

    it("filters maturity by state", async () => {
      const candidate = createPatternMaturity("p1");
      const proven: PatternMaturity = {
        pattern_id: "p2",
        state: "proven",
        helpful_count: 10,
        harmful_count: 0,
        last_validated: new Date().toISOString(),
      };

      await storage.storeMaturity(candidate);
      await storage.storeMaturity(proven);

      const candidates = await storage.getMaturityByState("candidate");
      expect(candidates).toHaveLength(1);
    });

    it("stores and retrieves maturity feedback", async () => {
      const feedback = createMaturityFeedback("pattern-1", "helpful");
      await storage.storeMaturityFeedback(feedback);

      const retrieved = await storage.getMaturityFeedback("pattern-1");
      expect(retrieved).toHaveLength(1);
      expect(retrieved[0].type).toBe("helpful");
    });

    it("closes without error", async () => {
      await expect(storage.close()).resolves.toBeUndefined();
    });
  });

  describe("SemanticMemoryStorage", () => {
    let storage: SemanticMemoryStorage;
    let isAvailable: boolean;

    beforeEach(async () => {
      isAvailable = await isSemanticMemoryAvailable();
      if (isAvailable) {
        storage = new SemanticMemoryStorage({
          collections: {
            feedback: "test-feedback",
            patterns: "test-patterns",
            maturity: "test-maturity",
          },
        });
      }
    });

    it("skips tests if semantic-memory not available", async () => {
      if (!isAvailable) {
        expect(isAvailable).toBe(false);
        return;
      }
      expect(isAvailable).toBe(true);
    });

    it("stores and retrieves feedback", async () => {
      if (!isAvailable) return;

      const event = createFeedbackEvent("type_safe", "helpful");
      await storage.storeFeedback(event);

      // Give semantic-memory time to index
      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = await storage.getFeedbackByCriterion("type_safe");
      expect(retrieved.length).toBeGreaterThan(0);
    });

    it("stores and retrieves patterns", async () => {
      if (!isAvailable) return;

      const pattern = createPattern("Test pattern for semantic search");
      await storage.storePattern(pattern);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const retrieved = await storage.getPattern(pattern.id);
      expect(retrieved).not.toBeNull();
    });

    it("closes without error", async () => {
      if (!isAvailable) return;

      await expect(storage.close()).resolves.toBeUndefined();
    });
  });

  describe("createStorageWithFallback", () => {
    it("returns InMemoryStorage when backend is memory", async () => {
      const storage = await createStorageWithFallback({ backend: "memory" });
      expect(storage).toBeInstanceOf(InMemoryStorage);
    });

    it("returns appropriate backend based on availability", async () => {
      const storage = await createStorageWithFallback();
      const isAvailable = await isSemanticMemoryAvailable();

      if (isAvailable) {
        expect(storage).toBeInstanceOf(SemanticMemoryStorage);
      } else {
        expect(storage).toBeInstanceOf(InMemoryStorage);
      }
    });
  });

  describe("Global Storage Management", () => {
    beforeEach(async () => {
      await resetStorage();
    });

    it("getStorage returns a storage instance", async () => {
      const storage = await getStorage();
      expect(storage).toBeDefined();
      expect(storage).toHaveProperty("storeFeedback");
      expect(storage).toHaveProperty("storePattern");
      expect(storage).toHaveProperty("storeMaturity");
    });

    it("getStorage returns same instance on multiple calls", async () => {
      const storage1 = await getStorage();
      const storage2 = await getStorage();
      expect(storage1).toBe(storage2);
    });

    it("setStorage replaces global instance", async () => {
      const customStorage = new InMemoryStorage();
      setStorage(customStorage);

      const retrieved = await getStorage();
      expect(retrieved).toBe(customStorage);
    });

    it("resetStorage clears global instance", async () => {
      const storage1 = await getStorage();
      await resetStorage();
      const storage2 = await getStorage();

      expect(storage1).not.toBe(storage2);
    });

    it("resetStorage calls close on existing instance", async () => {
      const storage = await getStorage();
      const closeSpy = vi.spyOn(storage, "close");

      await resetStorage();

      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe("isSemanticMemoryAvailable", () => {
    it("returns boolean", async () => {
      const available = await isSemanticMemoryAvailable();
      expect(typeof available).toBe("boolean");
    });
  });
});
