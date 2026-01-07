---
"swarm-mail": patch
---

## Fix: Remove stale `created_at` column references

Fixes `SQLITE_ERROR: table events has no column named created_at` that occurred during database migrations.

**What happened:** The events table schema was updated to remove `created_at`, but migration code and schema checks still referenced it.

**Fixed locations:**
- `auto-migrate.ts` - migration column checks
- `libsql-schema.ts` - required columns validation
- `streams.ts` - schema definitions

No data migration needed - the column never existed in production databases.
