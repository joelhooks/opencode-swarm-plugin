---
"opencode-swarm-plugin": patch
"claude-code-swarm-plugin": patch
---

fix(decompose): handle object and double-stringified response in swarm_validate_decomposition

MCP server may pass response as already-parsed object (not string) when Claude provides the decomposition. Now handles both string and object inputs, plus the edge case of double-stringified JSON.
