---
"opencode-swarm-plugin": patch
---

## 🐝 Fix Missing Plugin Wrapper Template in Published Package

Fixed `swarm setup` failing with "Could not read plugin template" by adding missing directories to npm publish files.

**Problem:** The `examples/` and `global-skills/` directories weren't included in package.json `files` array, causing them to be excluded from npm publish. When users ran `swarm setup`, it couldn't find the plugin wrapper template and fell back to a minimal version.

**Solution:** Added `examples` and `global-skills` to the `files` array in package.json so they're included in published packages.

**What changed:**
- `examples/plugin-wrapper-template.ts` now available in installed packages
- `global-skills/` directory properly included for bundled skills
- `swarm setup` can read full template instead of falling back

**Before:** "Could not read plugin template from [path], using minimal wrapper"
**After:** Full plugin wrapper with all tools and proper OpenCode integration

No breaking changes - existing minimal wrappers continue working.