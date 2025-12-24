/**
 * OpenCode Plugin Entry Point
 *
 * CRITICAL: Only export the plugin function as DEFAULT from this file.
 *
 * OpenCode's plugin loader calls ALL exports as functions during initialization.
 * If you export both named AND default pointing to the same function, the plugin
 * gets registered TWICE, causing hooks to fire multiple times.
 *
 * If you need to export utilities for external use, add them to src/index.ts instead.
 *
 * @example
 * // ✅ CORRECT - only default export
 * export default SwarmPlugin;
 *
 * // ❌ WRONG - causes double registration
 * export { SwarmPlugin };
 * export default SwarmPlugin;
 */
import SwarmPlugin from "./index";

// Only default export - no named exports!
export default SwarmPlugin;
