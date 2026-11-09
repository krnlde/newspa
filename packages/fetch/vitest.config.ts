import { defineProject } from 'vitest/config';

/**
 * Parsers read fixtures, never the live web (docs/testing.md). The HTTP policy
 * is tested against a local `node:http` stub started by the test itself.
 */
export default defineProject({
  test: {
    name: 'fetch',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['**/fixtures/**', 'node_modules/**'],
  },
});
