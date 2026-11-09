import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

/**
 * Fast layer: components, hooks, and the pure helpers in `src/lib`, in
 * happy-dom. Sub-second, and covered by the root v8 coverage gate.
 *
 * Design/layout assertions live in `vitest.design.config.ts` (real Edge), because
 * happy-dom does not do layout, media queries, `getComputedStyle` cascade,
 * columns, or print media — i.e. exactly the things docs/design.md promises.
 */
export default defineProject({
  plugins: [react()],
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'test/unit/**/*.test.{ts,tsx}'],
    exclude: ['test/design/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./test/setup.ts'],
  },
});
