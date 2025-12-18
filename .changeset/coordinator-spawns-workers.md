---
"opencode-swarm-plugin": patch
---

Enforce coordinator always spawns workers, never executes work directly

- Added "Coordinator Role Boundaries" section to /swarm command
- Coordinators now explicitly forbidden from editing code, running tests, or making "quick fixes"
- Updated Phase 5 to clarify coordinators NEVER reserve files (workers do)
- Updated Phase 6 with patterns for both parallel and sequential worker spawning
- Worker agent template now confirms it was spawned correctly and to report coordinator violations
