import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineProject } from 'vitest/config';

/**
 * Design-contract project: real Edge, real CSS, real media queries.
 * Shares the scraper's browser story (playwright-core + `channel: 'msedge'`).
 * Run by `pnpm test:design`; excluded from the coverage run (docs/testing.md).
 */
export default defineProject({
  plugins: [react()],
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
