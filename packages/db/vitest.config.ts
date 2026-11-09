import { defineProject } from 'vitest/config';

/** `node:sqlite` in `:memory:`: schema, migrations, FTS5 search, retention. */
export default defineProject({
  test: {
    name: 'db',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
