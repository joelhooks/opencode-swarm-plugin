---
"opencode-swarm-plugin": patch
---

## 🐝 Fix Migration Adapter Type Mismatch

> *"The compiler is your friend. Listen to it."*
> — Every TypeScript developer, eventually

Fixed a runtime error in `swarm setup` where the legacy memory migration was receiving a `SwarmMailAdapter` instead of a `DatabaseAdapter`.

**The Bug:**
```
targetDb.query is not a function
```

**Root Cause:**
`getSwarmMail()` returns a `SwarmMailAdapter` which has `getDatabase()` method, not a direct `query()` method. The migration code expected a `DatabaseAdapter`.

**The Fix:**
```typescript
// Before (wrong)
const targetDb = await getSwarmMail(cwd);

// After (correct)
const swarmMail = await getSwarmMail(cwd);
const targetDb = await swarmMail.getDatabase(cwd);
```

**Test Added:**
New test case verifies that passing an invalid adapter (without `query()`) fails gracefully with a descriptive error instead of crashing.
