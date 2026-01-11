---
"opencode-swarm-plugin": patch
---

> "When you improve code, you have to test to verify that it still works." — Martin Fowler, Refactoring

## 🛡️ MCP Packaging Hardening

Marketplace installs now fail fast and loudly when the Claude MCP runtime bundle is missing, and CI validates tarballs before publish.

**What changed**
- MCP runtime resolution requires `claude-plugin/dist` (actionable error if missing)
- Claude plugin asset copy now guards against missing `dist`
- CI/publish verify packed artifacts for `opencode-swarm-plugin` and `swarm-mail`

**Why it matters**
- Prevents silent MCP failures in marketplace installs
- Catches broken tarballs before release

**Compatibility**
- No API changes; existing installs keep working once rebuilt
