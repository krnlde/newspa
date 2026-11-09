import { defineProject } from 'vitest/config';

/**
 * Scheduler, pipeline, routes on an ephemeral port, SSE, toast command
 * building. No network, no Edge: both are behind interfaces the tests fake,
 * which is the point of splitting them out.
 */
export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Ports and single-instance locks are process-global; forks isolate them.
    pool: 'forks',
  },
});
