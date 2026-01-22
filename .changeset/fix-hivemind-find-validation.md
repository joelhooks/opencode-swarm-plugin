---
"opencode-swarm-plugin": patch
"swarm-mail": patch
---

fix(hivemind): add input validation for hivemind_find query parameter

Fixes TypeError when Claude calls hivemind_find with empty input `{}`.

**Root cause**: The MCP tool schema's `(required)` in description doesn't enforce
at runtime, so undefined query passed through to `ftsSearch()` which called
`.replace()` on undefined.

**Fix (defense in depth)**:
- **hivemind-tools.ts**: Early validation returns user-friendly error JSON
- **memory.ts**: Throws at adapter boundary (fail fast)
- **store.ts**: Returns empty array (graceful degradation, last line of defense)

> "Functions are a reusable unit of validation logic" — Forms Handbook

Added 3 test cases for missing/empty/whitespace query parameters.
