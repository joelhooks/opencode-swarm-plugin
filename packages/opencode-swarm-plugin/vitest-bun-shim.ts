/**
 * Shim that re-exports vitest APIs under bun:test names.
 * Used via resolve.alias in vitest.config.ts so that
 *   import { mock, spyOn } from "bun:test"
 * maps to vitest equivalents without touching source files.
 */
export {
  describe,
  test,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";

import { vi } from "vitest";

// bun:test exports `mock` as a function that creates mock fns (like vi.fn)
// and also has mock.module() and mock.restore()
export const mock: any = Object.assign(
  (implementation?: (...args: any[]) => any) => vi.fn(implementation),
  {
    module: (moduleName: string, factory: () => any) => {
      vi.mock(moduleName, factory);
    },
    restore: () => {
      vi.restoreAllMocks();
    },
  }
);

// bun:test exports spyOn directly
export const spyOn = vi.spyOn.bind(vi);
