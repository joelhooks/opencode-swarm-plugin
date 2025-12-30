/**
 * Compaction Event Capture Tests
 * 
 * Tests for prompt_generated event emission during compaction.
 * Separated from main compaction-hook.test.ts to avoid conflicts.
 * 
 * TDD: Write failing tests first, then implement event capture wiring.
 * 
 * IMPORTANT: All spyOn() calls MUST be restored in afterEach to prevent
 * pollution of other test files. Bun's spies persist globally.
 */
import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { createCompactionHook } from "./compaction-hook";
import * as evalCapture from "./eval-capture";

// Spy on captureCompactionEvent
let captureCompactionEventSpy: ReturnType<typeof spyOn>;

describe("prompt_generated event capture", () => {
  beforeEach(() => {
    // Spy on captureCompactionEvent to track calls
    captureCompactionEventSpy = spyOn(evalCapture, "captureCompactionEvent").mockResolvedValue(undefined);
  });

  afterEach(() => {
    // CRITICAL: Restore spy to prevent pollution of other test files
    captureCompactionEventSpy.mockRestore();
  });

  test("RED: should capture prompt_generated when full swarm context is injected", async () => {
    // This test will fail until we wire captureCompactionEvent into compaction-hook.ts
    
    const sessionID = "session-test-123";
    const output = { context: [] };
    
    // Create hook and execute (will trigger detection + injection)
    const hook = createCompactionHook(undefined);
    await hook({ sessionID }, output);
    
    // Assert: captureCompactionEvent was called with prompt_generated
    const calls = captureCompactionEventSpy.mock.calls;
    const promptGeneratedCall = calls.find(
      call => call[0]?.compaction_type === "prompt_generated"
    );
    
    // This will FAIL until we add the capture call to compaction-hook.ts
    expect(promptGeneratedCall).toBeDefined();
    
    if (promptGeneratedCall) {
      const params = promptGeneratedCall[0];
      expect(params.session_id).toBe(sessionID);
      expect(params.payload.full_prompt).toBeDefined();
      expect(params.payload.context_type).toMatch(/full|fallback|none/);
    }
  });

  test("RED: prompt_generated should include full prompt, not truncated", async () => {
    const sessionID = "session-test-789";
    const output = { context: [] };
    
    const hook = createCompactionHook(undefined);
    await hook({ sessionID }, output);
    
    const calls = captureCompactionEventSpy.mock.calls;
    const promptGeneratedCall = calls.find(
      call => call[0]?.compaction_type === "prompt_generated"
    );
    
    // This will FAIL until we add the capture call
    expect(promptGeneratedCall).toBeDefined();
    
    if (promptGeneratedCall) {
      const params = promptGeneratedCall[0];
      
      // Should NOT be truncated
      expect(params.payload.full_prompt).toBeDefined();
      expect(params.payload.full_prompt.length).toBeGreaterThan(100);
      
      // Should contain coordinator identity markers (for eval scoring)
      expect(params.payload.full_prompt).toContain("COORDINATOR");
      expect(params.payload.prompt_length).toBe(params.payload.full_prompt.length);
    }
  });

  test("RED: should include context_type in payload", async () => {
    const sessionID = "session-ctx-type";
    const output = { context: [] };
    
    const hook = createCompactionHook(undefined);
    await hook({ sessionID }, output);
    
    const calls = captureCompactionEventSpy.mock.calls;
    const promptGeneratedCall = calls.find(
      call => call[0]?.compaction_type === "prompt_generated"
    );
    
    // This will FAIL until we add the capture call
    expect(promptGeneratedCall).toBeDefined();
    
    if (promptGeneratedCall) {
      expect(promptGeneratedCall[0].payload.context_type).toMatch(/full|fallback|none/);
    }
  });

  test("RED: should NOT emit prompt_generated if context_type is 'none'", async () => {
    // When detectSwarm returns confidence="none", no prompt is generated
    // So no prompt_generated event should be emitted
    
    // This is a negative test - we should NOT call captureCompactionEvent
    // when confidence is "none"
    
    // For now, just document the expectation
    expect(true).toBe(true); // Will be enforced in compaction-hook.ts logic
  });
});

describe("detection_complete event ordering", () => {
  beforeEach(() => {
    captureCompactionEventSpy = spyOn(evalCapture, "captureCompactionEvent").mockResolvedValue(undefined);
  });

  afterEach(() => {
    // CRITICAL: Restore spy to prevent pollution of other test files
    captureCompactionEventSpy.mockRestore();
  });

  test("RED: detection_complete should be emitted before prompt_generated", async () => {
    const sessionID = "session-order-test";
    const output = { context: [] };
    
    const hook = createCompactionHook(undefined);
    await hook({ sessionID }, output);
    
    const calls = captureCompactionEventSpy.mock.calls;
    const eventTypes = calls.map(call => call[0]?.compaction_type);
    
    // This will FAIL until we add the capture calls
    const detectionIndex = eventTypes.indexOf("detection_complete");
    const promptIndex = eventTypes.indexOf("prompt_generated");
    
    // Both events should exist
    expect(detectionIndex).toBeGreaterThanOrEqual(0);
    expect(promptIndex).toBeGreaterThanOrEqual(0);
    
    // detection_complete should come before prompt_generated
    expect(detectionIndex).toBeLessThan(promptIndex);
  });
});

describe("Integration with compaction-hook", () => {
  test("RED: compaction-hook should call captureCompactionEvent with correct params", async () => {
    // This test requires importing the actual hook and mocking dependencies
    // Will implement once we add the capture call to compaction-hook.ts
    
    // Expected behavior:
    // 1. Hook detects swarm (detectSwarm())
    // 2. Builds dynamic context (buildDynamicSwarmState())
    // 3. Injects to output.context[]
    // 4. Calls captureCompactionEvent({ session_id, epic_id, compaction_type: "prompt_generated", payload: {...} })
    
    expect(true).toBe(true); // Placeholder - will implement after wiring
  });
});
