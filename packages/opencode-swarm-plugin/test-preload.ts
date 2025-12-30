/**
 * Test preload script - runs before each test file
 * Clears module mocks to prevent pollution between test files
 */
import { mock } from "bun:test";

// Clear any existing mocks before running tests
mock.restore();
