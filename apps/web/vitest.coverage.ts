import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
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
 * Mirrors this package's project config, so coverage measures the same tests.
 * `test/design/**` (real Edge, `vitest.design.config.ts`) stays out of the
 * coverage run: it asserts CSS, not code paths.
 */
const parsedPolicy: unknown = JSON.parse(readFileSync(new URL('../../vitest.coverage.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'test/unit/**/*.test.{ts,tsx}'],
    exclude: ['test/design/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    coverage: parsedPolicy as CoverageOptions,
  },
});
