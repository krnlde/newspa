import { defineProject } from 'vitest/config';

/**
 * The installable paper, driven in real Edge (`pnpm test:design`, not the
 * pre-commit floor — rule 16: a hook that needs a browser cannot pass on every
 * machine).
 *
 * A **node** project, like `packages/fetch/vitest.browser.config.ts`: the subject
 * is a browser the test launches, not a test that runs inside a page. The claims
 * here are about a registration, a cache, and a navigation served while the
 * server is dead — none of which exist in happy-dom, and all of which are
 * invisible to reading `sw.js` as text.
 *
 * Needs `pnpm build`: the subject is the **built** app, because the built
 * `index.html` is what registers the worker and the built bundle is what the
 * reader installs. The test says so by name when `dist` is absent; a browser
 * project that skips silently is a browser project that tests nothing.
 */
export default defineProject({
  test: {
    name: 'server-install',
    environment: 'node',
    include: ['test/browser/**/*.test.ts'],
    exclude: ['node_modules/**'],
    pool: 'forks',
    // Launching real Edge, loading a 450 kB bundle, registering a worker and
    // reloading it offline is seconds of wall clock, not milliseconds. Vitest's
    // 5 s default kills the slower arm mid-navigation, and a browser test that
    // times out on the timeout teaches nothing about the paper.
    testTimeout: 45_000,
  },
});
