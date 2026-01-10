---
"opencode-swarm-plugin": minor
---

> "How we can design tools that achieve these goals is explained in the rest of this paper, through a description of design patterns and case studies that tested them." — *Casual Creators: Design Patterns for Autotelic Creativity Tools*

             .-.
            (o o)
            | O |   Claude Code, meet Swarm.
             '-'

## 🐝 Claude Code Plugin, Fully Wired

This release ships the complete Claude Code plugin experience: the plugin bundle, MCP auto-launch, CLI helpers, hooks, agents/skills, and tests—ready for marketplace install or local dev.

**What changed**
- Added bundled Claude Code plugin assets (`.claude-plugin`, commands, agents, skills, hooks, MCP/LSP configs).
- Implemented MCP server entrypoint + packaging so Claude auto-launches the tools.
- Added `swarm claude` CLI helpers and debug-only `swarm mcp-serve`.
- Added tests for MCP wiring, hooks, and CLI behavior.
- Documented `/plugin` install and `--plugin-dir` dev flow in READMEs.

**Why it matters**
- One install path for Claude Code + OpenCode without extra manual setup.
- Auto-launched MCP servers make the plugin feel native and frictionless.
- Hooks provide consistent session context for swarm coordination.

**Backward compatible**: Existing OpenCode workflows remain unchanged; Claude features are additive only.
