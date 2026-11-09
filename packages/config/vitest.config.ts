import { defineProject } from 'vitest/config';

/** Schemas and file loading. Every invalid source file must produce an issue, not a crash. */
export default defineProject({
  test: {
    name: 'config',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
