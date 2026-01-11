---
"swarm-mail": patch
---

> "This book is about writing cost-effective, maintainable, and pleasing code." — Sandi Metz & Katrina Owen, *99 Bottles of OOP*

## 🧪 Version Alignment Guard

The swarm-mail release now keeps the `SWARM_MAIL_VERSION` constant aligned with `package.json`, and the tarball packaging test asserts that alignment to catch drift early.

**What changed**
- Version constant stays in lockstep with `package.json`
- Tarball test fails fast if versions diverge

**Why it matters**
- Prevents shipping tarballs with stale version metadata
- Keeps runtime diagnostics consistent with published versions

**Compatibility**
- No API changes; internal consistency and tests only
