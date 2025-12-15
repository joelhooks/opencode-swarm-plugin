---
"opencode-swarm-plugin": patch
---

Fix workspace:* protocol resolution using bun pack + npm publish

Uses bun pack to create tarball (which resolves workspace:* to actual versions) then npm publish for OIDC trusted publisher support.
