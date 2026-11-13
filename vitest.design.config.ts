import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * The visual contract, enforced in a real browser.
 *
 * Synergy, not accident: `docs/design.md` specifies newspaper typography
 * (one typeface, 45-75 character measure, hairline rules, `--paper: #f4ecd8`,
 * grayscale images). Those claims are only checkable with a real layout
 * engine, so this run drives the **same Edge** the scraper and the picker use —
 * `playwright-core` + `channel: 'msedge'`, no browser download, 410 ms launch.
 *
 * Coverage is off: these tests assert computed CSS, and the code they mount is
 * already covered by the happy-dom project.
 */
export default defineConfig({
  test: {
    projects: [
      'apps/web/vitest.design.config.ts',
      'packages/fetch/vitest.browser.config.ts',
      'packages/server/vitest.browser.config.ts',
    ],
    reporters: ['default'],
    coverage: { enabled: false },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          // The Edge that is already installed. Never `playwright install`.
          channel: 'msedge',
        },
      }),
      instances: [{ browser: 'chromium', name: 'web-design' }],
      viewport: { width: 1280, height: 900 },
    },
  },
});
