import { existsSync } from 'node:fs';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Running } from '../../src/start.ts';
import { bootOnce, writeJson } from '../startSupport.ts';
import { anRssSpec } from '../support.ts';

/**
 * The worker, registered for real, in real Edge (WP16, D-039's acceptance).
 *
 * The claim under test is the one a reader meets on a train: **the paper opens
 * with the server gone, and says it is the last edition.** Nothing less than a
 * registration proves it. Reading `sw.js` as text proves the file exists; a
 * happy-dom test cannot register a worker, cache a response, or serve a
 * navigation — and the rules that make the difference (which requests the worker
 * touches, what it stamps, what it leaves alone) are invisible to a text scan.
 *
 * So: the **built** app (`apps/web/dist`, the real `index.html` that registers,
 * the real `sw.js`), served by the real boot on a loopback port, in an ephemeral
 * Edge context. Then the server is closed, the page is reloaded, and the page
 * itself is the witness.
 *
 * Three claims, one per browser context, because a context is where a service
 * worker lives:
 *
 *  1. with the server **up**, the edition lands in the cache **stamped** — the
 *     stamp is the whole offline honesty of the page;
 *  2. with the server **closed**, a reload prints the paper and the label: the
 *     dateline strip carries `cached <time>`, and the failure panel does not;
 *  3. with the server closed and **no** cached edition, the worker answers
 *     `503` with a sentence (rule 5: no silent zero), and the reading list is
 *     never served out of a cache (rule 18: the sources are the reader's files,
 *     and a copy of them on a phone is a copy the machine cannot revoke).
 *
 * `pnpm test:design` runs this file (rule 16: a browser stays out of the
 * pre-commit floor), and it needs `pnpm build` — said by name below, not skipped.
 */
const DIST = new URL('../../../../apps/web/dist', import.meta.url).pathname.slice(1);
const EDITION_CACHE = 'newspa-edition-v2';

let browser: Browser;

beforeAll(async () => {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error(`the built app is absent: ${DIST} — run \`pnpm build\` (this file drives the real bundle)`);
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

afterAll(async () => {
  await browser.close();
});

/**
 * A root that boots with the built app in the place `boot` looks for it, and one
 * source in the watchlist.
 *
 * The source is not decoration: with an empty watchlist the paper prints the
 * onboarding panel, and the claim under test is about an **edition** — the strip
 * that carries the freshness label is the strip of a paper with news. The poll
 * never runs (`schedule: false`), so the row is the source's own and the edition
 * is what a first boot prints.
 */
const rootWithBuiltApp = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'newspa-offline-'));
  await cp(DIST, join(root, 'apps', 'web', 'dist'), { recursive: true });
  await writeJson(join(root, 'config.json'), { server: { host: '127.0.0.1', openBrowser: false } });
  await writeJson(join(root, 'sources', 'bbc.json'), anRssSpec());
  return root;
};

const pageAt = async (origin: string): Promise<Page> => {
  // An ephemeral context: no service worker, no cache, no permissions carried over
  // from the arm before it. Each arm starts as a reader who has never seen this.
  const context = await browser.newContext({ baseURL: origin });
  const page = await context.newPage();
  // The worker's own `console.warn` lines (a skipped precache, a failed prime) are
  // the diagnosis of a page that did not go offline, so they reach the test's
  // output instead of dying in the browser.
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') console.warn(`page: ${message.text()}`);
  });
  return page;
};

const waitForWorker = (page: Page): Promise<unknown> =>
  page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration !== undefined && registration.active !== null;
  });

/** The cached edition's stamp — the fact the page's freshness label is built from. */
const stampOfCachedEdition = (page: Page): Promise<string | null> =>
  page.evaluate(async (cacheName: string) => {
    const store = await caches.open(cacheName);
    const hit = await store.match('/api/state');
    return hit === undefined ? null : hit.headers.get('newspa-cached-at');
  }, EDITION_CACHE);

const fetchFromPage = (page: Page, path: string): Promise<{ status: number; body: string; stamped: string | null }> =>
  page.evaluate(async (target: string) => {
    try {
      const response = await fetch(target);
      return {
        status: response.status,
        body: (await response.text()).slice(0, 200),
        stamped: response.headers.get('newspa-cached-at'),
      };
    } catch (cause) {
      return { status: 0, body: `network: ${(cause as Error).message}`, stamped: null };
    }
  }, path);

describe('the paper with the server gone', () => {
  let running: Running | null = null;
  let page: Page | null = null;

  afterEach(async () => {
    // The context first: a service worker belongs to it, and a worker left running
    // against a closed port answers the next arm's requests from a dead cache.
    if (page !== null) await page.context().close();
    page = null;
    if (running !== null) await running.close();
    running = null;
  });

  it('serves the last edition, labelled, and never the failure panel', async () => {
    const root = await rootWithBuiltApp();
    const booted = await bootOnce(root);
    running = booted.running;
    const origin = `http://127.0.0.1:${String(booted.running.port)}`;
    page = await pageAt(origin);
    const view = page;

    await view.goto(`${origin}/`, { waitUntil: 'load' });
    await waitForWorker(view);
    // The reader's first visit is the one that **installs** the worker, and a page
    // is not controlled by a worker it registered on that same load: the app's own
    // `/api/state` goes past it. So the sequence here is the reader's, not a
    // priming trick — open, then open again. The second load is the first the
    // worker sees, and the edition lands in its cache, stamped.
    await view.reload({ waitUntil: 'load' });
    await view.waitForSelector("[data-part='dateline-strip']");
    const stamp = await stampOfCachedEdition(view);
    expect(stamp, 'the edition was never cached, so nothing can be labelled').toMatch(/\d{4}-\d{2}-\d{2}T/);

    // The reader's act, in full: the train goes quiet, and the page is re-opened.
    await booted.running.close();
    running = null;
    await view.reload({ waitUntil: 'load' });

    // The locator's own waiting, not a sleep: the page is live, and the strip
    // prints when the query settles. A fixed pause would be a number that passes on
    // this machine and fails on the board. (`playwright-core` has no `expect` —
    // that lives in the test runner — so the wait is the locator's `waitFor` and
    // the assertion is vitest's.)
    const summary = view.locator("[data-part='summary']");
    await summary.filter({ hasText: 'cached' }).waitFor({ timeout: 15_000 });
    const text = (await summary.textContent()) ?? '';
    // The stamp the label prints **is** the stamp the worker wrote: the time on the
    // page and the time in the cache are one fact, not two renderings of a guess.
    const offlineStamp = await stampOfCachedEdition(view);
    expect(offlineStamp, 'the label printed with no stamp behind it').toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).toContain('cached');
    expect(await view.locator("[data-part='sheet']").count()).toBe(1);
    // The failure panel is the app's answer to "no edition at all". Serving a cached
    // edition and printing the panel would be the same lie in the other direction.
    expect(await view.locator("[data-part='onboarding']").count()).toBe(0);
  });

  it('answers 503 with a sentence when there is no edition, and never caches the reading list', async () => {
    const root = await rootWithBuiltApp();
    const booted = await bootOnce(root);
    running = booted.running;
    const origin = `http://127.0.0.1:${String(booted.running.port)}`;
    page = await pageAt(origin);
    const view = page;
    await view.goto(`${origin}/`, { waitUntil: 'load' });
    await waitForWorker(view);

    // The worker's cache, emptied: this is the first install on a fresh device, and
    // the offline answer has to be a report, not a blank page (rule 5).
    await view.evaluate(async (cacheName: string) => {
      await caches.delete(cacheName);
    }, EDITION_CACHE);
    await booted.running.close();
    running = null;

    const offline = await fetchFromPage(view, '/api/state');
    expect(offline.status).toBe(503);
    expect(offline.body).toContain('newspa is offline');

    // Rule 18, at the worker: `/api/sources` is the reader's files, and a cached
    // copy of them on a phone is a copy the machine cannot revoke. The worker is
    // told to leave every other `/api/*` on the wire, so with the server gone it
    // fails — and a failure is the honest answer, not a stale one.
    const sources = await fetchFromPage(view, '/api/sources');
    expect(sources.status, 'the reading list came out of a cache').toBe(0);
    expect(sources.body).toContain('network');
  });
});
