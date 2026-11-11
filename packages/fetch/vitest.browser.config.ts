import { defineProject } from 'vitest/config';

/**
 * The pick loop, driven in real Edge (`pnpm test:design`, not the pre-commit
 * floor — rule 16: a hook that needs a browser cannot pass on every machine).
 *
 * This is a **node** project, not a vitest-browser project: the subject is a
 * browser *launched by* the code under test, so the test needs the driver side —
 * `playwright-core` with `channel: 'msedge'` (rule 8: the installed browser, no
 * download), a local `node:http` server, and the bytes that server sent. In
 * browser mode the test would run *inside* the page, and could not prove the one
 * claim that matters: that the DOM the click happened in and the DOM the poller
 * will fetch are, or are not, the same document (D-007).
 *
 * So the layers are: this project proves the window, the inspector and the click;
 * `test/pickSession.test.ts` proves the sequence with a stubbed window;
 * `test/pickDerive.test.ts` proves the selector against fixture bytes.
 */
export default defineProject({
  test: {
    name: 'fetch-pick',
    environment: 'node',
    include: ['test/browser/**/*.test.ts'],
    exclude: ['**/fixtures/**', 'node_modules/**'],
    browser: { enabled: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
