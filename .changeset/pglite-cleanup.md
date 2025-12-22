---
"swarm-mail": patch
---

## 🧹 PGLite Exorcism Complete

The last vestiges of PGLite runtime code have been swept away. What remains is only the migration machinery—kept for users upgrading from the old world.

**Removed:**
- `pglite.ts` - The `wrapPGlite()` shim that nobody was importing
- `leader-election.ts` - PGLite-specific file locking (libSQL handles this natively)
- Associated test files

**Added:**
- `pglite-remnants.regression.test.ts` - 9 tests ensuring array parameter handling works correctly in libSQL (the `IN()` vs `ANY()` saga)

**Updated:**
- JSDoc examples now show libSQL patterns instead of PGLite
- Migration test inlines the `wrapPGlite` helper it needs

**What's left of PGLite:**
- `migrate-pglite-to-libsql.ts` - Dynamic import, only loads when migrating
- `memory/migrate-legacy.ts` - Same pattern, migration-only
- Comments explaining the differences (documentation, not code)

> "The best code is no code at all." — Jeff Atwood

The swarm flies lighter now. 🐝
