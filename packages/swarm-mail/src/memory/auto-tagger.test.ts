/**
 * Auto-Tagger Tests
 *
 * Tests for automatic tag and keyword generation using LLM.
 * Requires AI_GATEWAY_API_KEY environment variable AND working API.
 * 
 * These tests are skipped in CI or when the API is unavailable/rate-limited.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { generateTags } from "./auto-tagger.js";

const HAS_API_KEY = Boolean(process.env.AI_GATEWAY_API_KEY);

// Check if we're in CI environment
const IS_CI = Boolean(process.env.CI);

// Skip LLM tests unless explicitly enabled via RUN_LLM_TESTS=1
// These tests require external API access and are flaky due to rate limits
const RUN_LLM_TESTS = Boolean(process.env.RUN_LLM_TESTS);
const SKIP_LLM_TESTS = !RUN_LLM_TESTS || !HAS_API_KEY || IS_CI;

describe("generateTags", () => {
  // Config for tests - requires real API key
  const testConfig = {
    model: "anthropic/claude-haiku-4-5",
    apiKey: process.env.AI_GATEWAY_API_KEY || "",
  };

  test.skipIf(SKIP_LLM_TESTS)("generates valid AutoTagResult structure", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions";
    
    const result = await generateTags(content, undefined, testConfig);
    
    expect(result).toHaveProperty("tags");
    expect(result).toHaveProperty("keywords");
    expect(result).toHaveProperty("category");
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.keywords)).toBe(true);
    expect(typeof result.category).toBe("string");
  });

  test.skipIf(SKIP_LLM_TESTS)("generates tags in expected range (3-5 tags)", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions";
    
    const result = await generateTags(content, undefined, testConfig);
    
    expect(result.tags.length).toBeGreaterThanOrEqual(3);
    expect(result.tags.length).toBeLessThanOrEqual(5);
    expect(result.tags.every(tag => typeof tag === "string")).toBe(true);
    expect(result.tags.every(tag => tag.length > 0)).toBe(true);
  });

  test.skipIf(SKIP_LLM_TESTS)("generates keywords in expected range (5-10 keywords)", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions";
    
    const result = await generateTags(content, undefined, testConfig);
    
    expect(result.keywords.length).toBeGreaterThanOrEqual(5);
    expect(result.keywords.length).toBeLessThanOrEqual(10);
    expect(result.keywords.every(kw => typeof kw === "string")).toBe(true);
    expect(result.keywords.every(kw => kw.length > 0)).toBe(true);
  });

  test.skipIf(SKIP_LLM_TESTS)("incorporates existing user-provided tags", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions";
    const existingTags = ["auth", "tokens"];
    
    const result = await generateTags(content, existingTags, testConfig);
    
    // Should include or reference existing tags
    const allTags = result.tags.join(" ").toLowerCase();
    expect(allTags.includes("auth") || allTags.includes("oauth") || allTags.includes("authentication")).toBe(true);
    expect(allTags.includes("token")).toBe(true);
  });

  test.skipIf(SKIP_LLM_TESTS)("extracts relevant keywords from content", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions";
    
    const result = await generateTags(content, undefined, testConfig);
    
    const allKeywords = result.keywords.join(" ").toLowerCase();
    // Should extract key domain terms from content
    expect(
      allKeywords.includes("refresh") || 
      allKeywords.includes("expiry") || 
      allKeywords.includes("buffer") ||
      allKeywords.includes("race")
    ).toBe(true);
  });

  test.skipIf(SKIP_LLM_TESTS)("assigns appropriate category", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry to avoid race conditions";
    
    const result = await generateTags(content, undefined, testConfig);
    
    // Should categorize as auth-related
    const category = result.category.toLowerCase();
    expect(
      category.includes("auth") ||
      category.includes("security") ||
      category.includes("api") ||
      category.includes("authentication")
    ).toBe(true);
  });

  test("handles LLM errors gracefully - returns empty result without throwing", async () => {
    const content = "Test content";
    const badConfig = {
      model: "invalid-model",
      apiKey: "invalid-key",
    };
    
    // Should not throw - graceful degradation
    const result = await generateTags(content, undefined, badConfig);
    
    expect(result).toHaveProperty("tags");
    expect(result).toHaveProperty("keywords");
    expect(result).toHaveProperty("category");
    expect(Array.isArray(result.tags)).toBe(true);
    expect(Array.isArray(result.keywords)).toBe(true);
    expect(typeof result.category).toBe("string");
    // Empty result on error
    expect(result.tags.length).toBe(0);
    expect(result.keywords.length).toBe(0);
    expect(result.category).toBe("");
  });

  test.skipIf(SKIP_LLM_TESTS)("different content produces different tags", async () => {
    const content1 = "OAuth refresh tokens need 5min buffer";
    const content2 = "Database connection pool exhausted under load";
    
    const result1 = await generateTags(content1, undefined, testConfig);
    const result2 = await generateTags(content2, undefined, testConfig);
    
    // Should have different categories at minimum
    expect(result1.category).not.toBe(result2.category);
    
    // Should have different tags
    const tags1 = result1.tags.join(",");
    const tags2 = result2.tags.join(",");
    expect(tags1).not.toBe(tags2);
  });

  test.skipIf(SKIP_LLM_TESTS)("tags are lowercase and single words", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry";
    
    const result = await generateTags(content, undefined, testConfig);
    
    result.tags.forEach(tag => {
      expect(tag).toBe(tag.toLowerCase());
      expect(tag.includes(" ")).toBe(false); // No spaces
    });
  });

  test.skipIf(SKIP_LLM_TESTS)("category is lowercase", async () => {
    const content = "OAuth refresh tokens need 5min buffer before expiry";
    
    const result = await generateTags(content, undefined, testConfig);
    
    expect(result.category).toBe(result.category.toLowerCase());
  });
});
