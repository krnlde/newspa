import { defineProject } from 'vitest/config';

/**
 * Scheduler, pipeline, routes on an ephemeral port, SSE.
 * No network, no Edge: both are behind interfaces the tests fake,
 * which is the point of splitting them out.
 */
export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // `test/browser/` drives real Edge: it belongs to `pnpm test:design`, and
    // rule 16 keeps a browser out of the pre-commit floor on purpose.
    exclude: ['**/browser/**', 'node_modules/**'],
    // Ports and single-instance locks are process-global; forks isolate them.
    pool: 'forks',
  },
});
