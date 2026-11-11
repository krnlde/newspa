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
    // `test/browser/` launches real Edge: it belongs to `pnpm test:design`, and
    // rule 16 keeps a browser out of the pre-commit floor on purpose.
    exclude: ['**/fixtures/**', '**/browser/**', 'node_modules/**'],
  },
});
