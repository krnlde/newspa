import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineProject } from 'vitest/config';

/**
 * Design-contract project: real Edge, real CSS, real media queries.
 * Shares the scraper's browser story (playwright-core + `channel: 'msedge'`).
 * Run by `pnpm test:design`; excluded from the coverage run (docs/testing.md).
 *
 * `tailwindcss()` is listed here as well as in `vite.config.ts` because a Vitest
 * **project** inherits no plugin from the root config: without it
 * `@import 'tailwindcss'` reaches Edge as literal text, every utility computes to
 * its initial value, and the suite measures a page with no styling — a contract
 * that passes on `position: static` and `Times New Roman` measures nothing.
 */
export default defineProject({
  plugins: [react(), tailwindcss()],
  test: {
    name: 'web-design',
    include: ['test/design/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: { channel: 'msedge' },
      }),
      instances: [{ browser: 'chromium', name: 'web-design' }],
      viewport: { width: 1280, height: 900 },
    },
  },
});
