# @swarmtools/evals

## 0.2.1

### Patch Changes

- Updated dependencies [[`012d21a`](https://github.com/joelhooks/swarm-tools/commit/012d21aefdea0ac275a02d3865c8a134ab507360)]:
  - opencode-swarm-plugin@0.44.2

## 0.2.0

### Minor Changes

- [`1d079da`](https://github.com/joelhooks/swarm-tools/commit/1d079da134c048df66db7d28890d1a8bb9908942) Thanks [@joelhooks](https://github.com/joelhooks)! - ## 🐝 Evals Break Free: The Great Extraction

  > _"Modularity does not necessarily bring uniformity to the design... but it does bring clarity to dependencies."_
  > — Eric Evans, Domain-Driven Design

  **The Problem:** PR #81 reported `Cannot find module 'evalite/runner'` on global install. The eval framework (evalite + vitest) was incorrectly bundled as devDependencies in the main plugin, causing runtime failures.

  **The Fix:** Rather than bloating the plugin with 20MB+ of test framework, we extracted evals to their own package.

  ### What Changed

  **New Package: `@swarmtools/evals`**

  - All eval files migrated from `opencode-swarm-plugin/evals/`
  - Owns evalite, vitest, and AI SDK dependencies
  - Peer-depends on plugin and swarm-mail for scoring utilities

  **opencode-swarm-plugin**

  - Removed evalite/vitest from devDependencies
  - Added `files` field to limit npm publish scope
  - Added subpath exports for eval-capture and compaction-prompt-scoring
  - Build script now generates all entry points

  ### Package Structure

  ```
  packages/
  ├── opencode-swarm-plugin/     # Main plugin (lean, no eval deps)
  ├── swarm-evals/               # @swarmtools/evals (internal)
  │   └── src/
  │       ├── *.eval.ts
  │       ├── scorers/
  │       ├── fixtures/
  │       └── lib/
  └── ...
  ```

  ### Verified

  - ✅ `example.eval.ts` - 100% pass
  - ✅ `compaction-resumption.eval.ts` - 100% pass (8 evals)
  - ✅ Plugin builds without eval deps
  - ✅ Global install no longer fails

  Thanks to @AlexMikhalev for the detailed bug report that led to this architectural improvement.

### Patch Changes

- Updated dependencies [[`1d079da`](https://github.com/joelhooks/swarm-tools/commit/1d079da134c048df66db7d28890d1a8bb9908942)]:
  - opencode-swarm-plugin@0.44.1
