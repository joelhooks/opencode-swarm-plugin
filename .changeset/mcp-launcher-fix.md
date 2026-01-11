---
"opencode-swarm-plugin": patch
---

> "All you do is create each of these parts in turn which makes it easier to complete." — Jim Edwards, *Copywriting Secrets: How Everyone Can Use the Power of Words to Get More Clicks, Sales, and Profits*

## 🧭 MCP Launcher Fix

The MCP launcher now targets the bundled server artifact at runtime so marketplace installs no longer depend on repo-relative paths.

**What changed**
- Launcher resolves the `dist/mcp` bundle for MCP server startup
- Missing bundle errors surface earlier during setup

**Why it matters**
- Claude Code marketplace installs start MCP tools reliably
- Fewer "missing file" failures after upgrading

**Compatibility**
- No API changes
