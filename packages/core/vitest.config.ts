import { defineProject } from 'vitest/config';

/** Pure logic, node environment: this is the code that decides what is news. */
export default defineProject({
  test: {
    name: 'core',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
