import { defineProject } from 'vitest/config';

/**
 * The React paper, mounted in happy-dom: markup, hierarchy, aria, formatter
 * helpers. Layout, media queries, columns and print rules are asserted in
 * real Edge by `apps/web/vitest.design.config.ts` - happy-dom has no layout
 * engine, so it cannot check the claims in docs/design.md.
 */
export default defineProject({
  test: {
    name: 'paper',
    environment: 'happy-dom',
    include: ['test/**/*.test.tsx'],
  },
});
