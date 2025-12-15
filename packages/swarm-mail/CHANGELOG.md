# swarm-mail

## 0.1.3

### Patch Changes

- [`22befbf`](https://github.com/joelhooks/opencode-swarm-plugin/commit/22befbfa120a37a585cfec0709597172efda92a4) Thanks [@joelhooks](https://github.com/joelhooks)! - fix: mark @electric-sql/pglite as external in build to fix WASM file resolution

  PGLite requires its WASM data file (pglite.data) at runtime. When bundled into swarm-mail, the path resolution broke because it looked for the file relative to the bundle location instead of the installed @electric-sql/pglite package location.

  This caused "ENOENT: no such file or directory" errors when initializing the database.

## 0.1.2

### Patch Changes

- [`2d0fe9f`](https://github.com/joelhooks/opencode-swarm-plugin/commit/2d0fe9fc6278874ea6c4a92f0395cbdd11c4e994) Thanks [@joelhooks](https://github.com/joelhooks)! - Add repository field for npm provenance verification and ASCII art README

  - Add repository, author, license fields to package.json (required for npm provenance)
  - Add sick ASCII art banner to README

## 0.1.1

### Patch Changes

- [`9c4e4f9`](https://github.com/joelhooks/opencode-swarm-plugin/commit/9c4e4f9511672ab8598c7202850c87acf1bfd4b7) Thanks [@joelhooks](https://github.com/joelhooks)! - Fix swarm-mail package to include dist folder

  - Add files field to swarm-mail package.json to explicitly include dist/
  - Previous publish was missing build output, causing "Cannot find module" errors
