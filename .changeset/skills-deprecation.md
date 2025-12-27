---
"opencode-swarm-plugin": patch
---

## 🎓 Skills Grow Up: Discovery Moves to OpenCode

> *"The best code is no code at all. Every new line of code you willingly bring into the world is code that has to be debugged, code that has to be read and understood, code that has to be supported."*
> — Jeff Atwood

Skills outgrew the plugin nest. OpenCode is shipping native skills support following the [Agent Skills spec](https://spec.agentskills.com/), and our discovery tools are now redundant. Time to deprecate the scaffolding and let the platform handle what it does best.

### What Changed

**Deprecated Tools** (soft deprecation with console warnings):
- \`skills_list\` - OpenCode will handle discovery natively
- \`skills_use\` - OpenCode will handle loading via \`use skill <name>\` syntax
- \`skills_read\` - OpenCode will handle resource access transparently
- \`skills_execute\` - OpenCode will handle script execution in skill context

**Authoring Tools Kept** (fully functional, no changes):
- \`skills_create\` - Create new skills with SKILL.md template
- \`skills_update\` - Update existing skill content
- \`skills_init\` - Initialize skills directory in projects
- \`skills_add_script\` - Add executable scripts to skills
- \`skills_delete\` - Remove project skills

**Bundled Skills** - All 6 global skills remain intact and spec-compliant:
- \`testing-patterns\` - Feathers seams + Beck's 4 rules
- \`swarm-coordination\` - Multi-agent task orchestration
- \`cli-builder\` - Command-line interface patterns
- \`learning-systems\` - Confidence decay, pattern maturity
- \`skill-creator\` - Meta-skill for authoring new skills
- \`system-design\` - Architecture decision frameworks

### Why It Matters

**Before:** Two overlapping skill systems causing confusion. Agents could use plugin tools OR OpenCode's native syntax, with different behavior and semantics.

**After:** One canonical path. OpenCode owns discovery and loading. Plugin owns authoring and validation. Clean separation of concerns.

**Benefits:**
- No tool conflicts between plugin and platform
- Native OpenCode syntax (\`use skill testing-patterns\`) works seamlessly
- Simpler mental model for users
- Authoring tools remain for creating spec-compliant skills

### Migration Path

**For Discovery/Loading:**
\`\`\`typescript
// OLD (deprecated, still works but warns)
skills_list()
skills_use(name="testing-patterns")

// NEW (OpenCode native syntax)
use skill testing-patterns
\`\`\`

**For Authoring** (no change needed):
\`\`\`typescript
// Still fully supported
skills_create(name="my-skill", description="Domain expertise")
skills_update(name="my-skill", content="Updated SKILL.md")
\`\`\`

### Backward Compatibility

**Yes, with warnings.** Deprecated tools continue to function but emit console warnings directing users to OpenCode's native syntax. No breaking changes in this release.

Future major version (v1.0) will remove deprecated discovery tools entirely. Authoring tools remain permanent.

### What This Means for Bundled Skills

Nothing changes. All 6 global skills ship with plugin and are accessible via OpenCode's native \`use skill <name>\` syntax. They follow the [Agent Skills spec](https://spec.agentskills.com/) and work identically whether loaded via deprecated plugin tools or native OpenCode syntax.

The \`global-skills/\` directory remains the canonical source for our curated skill library.
