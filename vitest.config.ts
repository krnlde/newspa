import { defineConfig } from 'vitest/config';

/**
 * Coverage is a build gate, not a report: `pnpm check` runs `pnpm coverage` and
 * a number below 95 on any metric fails the build. The policy — thresholds,
 * `all: true`, the complete exclusion list with its reasons — is one document,
 * **vitest.coverage.json**, read by every package's `vitest.coverage.ts`; the
 * exclusions are explained in docs/testing.md. `all: true` is the part that
 * means anything: a file with no tests counts as uncovered, so a new module
 * cannot hide.
 *
 * Coverage is **not** configured here, and not in the project configs: vitest
 * allows it only at a root config (a project config's `test` type omits
 * `coverage`), and a root-level coverage run resolves `include` per project
 * root — it matched nothing, printed a confident 0% and passed. So
 * `pnpm coverage` runs vitest once per package, each with its own root config
 * (`vitest run --config vitest.coverage.ts`), where `src/**` resolves.
 * `scripts/check-coverage-policy.mjs` fails the build if that drifts.
 *
 * Two test layers, deliberately:
 *  - here: node packages + `web` in **happy-dom** (fast, real enough for
 *    components/hooks, and covered by the v8 provider);
 *  - `vitest.design.config.ts`: the visual contract in **real Edge** through the
 *    same playwright-core + `channel: 'msedge'` the scraper uses. Not covered
 *    here, because it asserts CSS, not code paths.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/web/vitest.config.ts'],
    restoreMocks: true,
    unstubEnvs: true,
    sequence: { shuffle: true },
    reporters: ['default'],
    coverage: { enabled: false },
  },
});
