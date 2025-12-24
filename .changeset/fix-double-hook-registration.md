---
"opencode-swarm-plugin": patch
---

## Fix Double Hook Registration

The compaction hook was firing twice per compaction event because OpenCode's plugin loader
calls ALL exports as plugin functions. We were exporting `SwarmPlugin` as both:

1. Named export: `export const SwarmPlugin`
2. Default export: `export default SwarmPlugin`

This caused the plugin to register twice, doubling all hook invocations.

**Fix:** Changed to default-only export pattern:
- `src/index.ts`: `const SwarmPlugin` (no export keyword)
- `src/plugin.ts`: `export default SwarmPlugin` (no named re-export)

**Impact:** Compaction hooks now fire once. LLM calls during compaction reduced by 50%.
