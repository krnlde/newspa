import { createServer, type Server } from 'node:http';
import type { Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { derivePick } from '../../src/pick/derivePick.ts';
import { parseFingerprint } from '../../src/pick/fingerprint.ts';
import { openPickSession } from '../../src/pick/launch.ts';
import { describePickRun, runPick } from '../../src/pick/pickSession.ts';
import { fixture } from '../support.ts';

/**
 * The pick loop, in real Edge, against bytes from a real server (`pnpm test:design`
 * only — rule 16 keeps a browser out of the pre-commit floor).
 *
 * This is the file that proves WP6's claim end to end, because both sides of the
 * claim are present: a **browser DOM** the click happens in, and **the served
 * bytes** the poller will read. Nothing here mocks the browser — the inspector is
 * the string that ships, injected as an init script, and the page is a fixture
 * this file's own server sent, so the fingerprint, the derivation and the counts
 * are all the real ones.
 *
 * Five claims, and each is a promise made to a reader (D-036):
 *
 *  - a real cursor (`page.mouse`) captures the card, and the page **never
 *    navigates**: the click is cancelled, so the publisher's page does not move
 *    under the reader's hand;
 *  - **Up** walks to the parent, so a hover on the anchor picks the **card**;
 *  - **Esc** cancels and reports `cancelled` — not a timeout, not an empty answer;
 *  - a budget with no click is `timed-out`, and a page that will not load is
 *    `nav-refused`, naming the address;
 *  - a list a **script** built is refused by name (`path-unmapped`) with the render
 *    answer: the DOM clicked is not the DOM fetched (D-007), and nothing is written.
 */

const bodies = new Map<string, string>([
  ['/world', fixture('pick-card-list.html')],
  ['/shell', fixture('pick-script-shell.html')],
]);

let server: Server;
let origin = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    const body = bodies.get(request.url ?? '');
    if (body === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('nothing here');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  origin = `http://127.0.0.1:${String(address === null || typeof address === 'string' ? 0 : address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

const fetchText = async (url: string): Promise<string> => (await fetch(url)).text();

/** The scripted click: the same code path a cursor takes, driven by a selector. */
const pickAt =
  (selector: string) =>
  async (page: Page): Promise<void> => {
    // `globalThis` is the page's `window` once playwright serialises this function
    // into it, and it is typed in the node project, where `window` is not.
    const found = await page.evaluate(
      (target: string) =>
        (globalThis as unknown as { __newspaPickAt?: (s: string) => boolean }).__newspaPickAt?.(target) ?? false,
      selector,
    );
    if (!found) throw new Error(`the scripted click found nothing at '${selector}'`);
  };

const headless = { headless: true, navTimeoutMs: 20_000, budgetMs: 30_000 } as const;

describe('the loop: a click, the bytes, a proved selector', () => {
  it('captures the second card and derives a list the poller can read', async () => {
    const run = await runPick(
      { url: `${origin}/world`, label: 'Example World' },
      { ...headless, launch: openPickSession, fetchText, onArmed: pickAt('ul.news > li:nth-child(2)') },
    );

    expect(run.ok, run.ok ? '' : `${run.stage}/${run.reason}: ${run.detail}`).toBe(true);
    if (!run.ok) return;
    expect(run.outcome.list).toBe('.card');
    expect(run.outcome.matchCount).toBe(4);
    expect(run.outcome.sample.title).toBe('Second story');
    // The sample is what the parser reads, so it is the attribute as published:
    // the poller resolves it against the link base (D-030), the picker does not.
    expect(run.outcome.sample.link).toBe('/a2');
    expect(describePickRun(run, { url: `${origin}/world` })).toContain('matchCount 4 in the bytes the poller fetches');
  });

  it('the derived selector is re-read by the parser on the served bytes', async () => {
    const run = await runPick(
      { url: `${origin}/world` },
      { ...headless, launch: openPickSession, fetchText, onArmed: pickAt('ul.news > li:nth-child(4)') },
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    const reparsed = derivePick(run.fp, await fetchText(`${origin}/world`));
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.list).toBe(run.outcome.list);
    expect(reparsed.matchCount).toBe(run.outcome.matchCount);
  });
});

describe('the affordance, in a real cursor', () => {
  it('a real click captures the node under the cursor, and the page never navigates', async () => {
    const url = `${origin}/world`;
    const session = await openPickSession({
      ...headless,
      url,
      onArmed: async (page: Page) => {
        const box = await page.locator('ul.news > li').nth(1).boundingBox();
        if (box === null) throw new Error('the card has no box to click');
        await page.mouse.move(box.x + 8, box.y + 8);
        await page.mouse.click(box.x + 8, box.y + 8);
      },
    });

    expect(session.ok, session.ok ? '' : session.detail).toBe(true);
    if (!session.ok) return;
    // The card's whole face is the anchor in this fixture, so a click at 8,8 is a
    // click on `<a>` — the measured point of D-036's parent step, proven below.
    expect(session.navigated).toBe(url);
    const parsed = parseFingerprint(session.payload);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fp.path.at(-1)?.tag).toBe('a');
    expect(parsed.fp.href).toBe(`${origin}/a2`);
  });

  it('two Up steps walk from the anchor to the card, and Enter captures at that depth', async () => {
    const session = await openPickSession({
      ...headless,
      url: `${origin}/world`,
      onArmed: async (page: Page) => {
        const box = await page.locator('ul.news > li:nth-child(3) a').first().boundingBox();
        if (box === null) throw new Error('the anchor has no box to hover');
        await page.mouse.move(box.x + 4, box.y + 4);
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
      },
    });

    expect(session.ok, session.ok ? '' : session.detail).toBe(true);
    if (!session.ok) return;
    const parsed = parseFingerprint(session.payload);
    if (!parsed.ok) throw new Error(parsed.detail);
    // The hover was on the anchor: a, h2, li — the parent step is what turns the
    // click the cursor makes into the item the reader meant.
    expect(parsed.fp.path.at(-1)?.tag).toBe('li');
    expect(parsed.fp.href).toBe(`${origin}/a3`);
    expect(parsed.fp.siblings).toBe(4);
  });

  it('Esc cancels, and says so', async () => {
    const session = await openPickSession({
      ...headless,
      url: `${origin}/world`,
      onArmed: async (page: Page) => {
        await page.keyboard.press('Escape');
      },
    });
    expect(session.ok).toBe(false);
    if (session.ok) return;
    expect(session.reason).toBe('cancelled');
  });

  it('a budget with no click is a timeout, not an empty answer', async () => {
    const session = await openPickSession({ url: `${origin}/world`, headless: true, budgetMs: 1_500 });
    expect(session.ok).toBe(false);
    if (session.ok) return;
    expect(session.reason).toBe('timed-out');
  });

  it('a page that will not load is named, with the address', async () => {
    const session = await openPickSession({ url: 'http://127.0.0.1:9/nothing', headless: true, navTimeoutMs: 5_000 });
    expect(session.ok).toBe(false);
    if (session.ok) return;
    expect(session.reason).toBe('nav-refused');
    expect(session.detail).toContain('http://127.0.0.1:9/nothing');
  });
});

describe('the page a script builds, in a real browser', () => {
  it('the click exists in the DOM, and the bytes refuse it by name (D-007)', async () => {
    const run = await runPick(
      { url: `${origin}/shell`, label: 'Example Shell' },
      { ...headless, launch: openPickSession, fetchText, onArmed: pickAt('#app ul li:nth-child(2)') },
    );

    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect([run.stage, run.reason]).toEqual(['derive', 'path-unmapped']);
    expect(run.detail).toContain('ul');
    expect(run.notes.join(' ')).toContain('render: true');
    expect(describePickRun(run, { url: `${origin}/shell` })).toContain('pick wrote nothing');
  });
});
