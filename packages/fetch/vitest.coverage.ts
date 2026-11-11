import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import type { CoverageOptions } from 'vitest/node';

/**
 * Coverage run for **this package** (`pnpm coverage` → `vitest run --config
 * vitest.coverage.ts --coverage`). A second config, not a key in
 * `vitest.config.ts`, because vitest allows `coverage` only at the **root**
 * config: a project config's `test` type omits it (tsc rejects it) and a
 * root-level coverage run resolves `include` per project root, matched nothing,
 * and printed a confident 0% while passing (docs/testing.md).
 *
 * So: one JSON policy at the repo root, read from a **module-relative URL**
 * (a cwd-relative path breaks when vitest is started from the repo root), and
 * this file is the root config of a run whose root is this package directory —
 * which is why the policy names its sources package-relative (src/**), not repo-relative.
 * `scripts/check-coverage-policy.mjs` fails the build if a package stops
 * reading the policy, so seven packages cannot drift apart.
 *
 * Mirrors this package's project config (fixtures are payloads, never tests),
 * so coverage measures the same tests.
 */
const parsedPolicy: unknown = JSON.parse(readFileSync(new URL('../../vitest.coverage.json', import.meta.url), 'utf8'));

export default defineConfig({
  test: {
    name: 'fetch',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Mirrors `vitest.config.ts`, and for the same reason: `test/browser/` drives
    // real Edge (`pnpm test:design`), and under this root config it inherits the
    // 5 s default timeout a browser launch cannot meet.
    exclude: ['**/fixtures/**', '**/browser/**', 'node_modules/**'],
    restoreMocks: true,
    unstubEnvs: true,
    coverage: parsedPolicy as CoverageOptions,
  },
});
