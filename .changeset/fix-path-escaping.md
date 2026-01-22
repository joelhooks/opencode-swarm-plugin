---
"opencode-swarm-plugin": patch
"claude-code-swarm-plugin": patch
---

fix: auto-normalize escaped paths in swarmmail tools

- Added path normalization to `swarmmail_reserve` and `swarmmail_release`
- LLMs escaping `[slug]` and `(content)` now auto-corrected
- Added worker prompt guidance about Next.js path handling
- Fixes P0 failures from session analysis (30-50% worker failures)
