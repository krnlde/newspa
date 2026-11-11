import { parseSourceJson, type SourceSpec } from 'newspa-config';
import { type PickStatusResponse, pickStatusResponseSchema } from 'newspa-core';
import type { PickLaunchOptions, PickSessionResult } from 'newspa-fetch';
import { type PickRoutes, pickRoutes } from '../src/pickApi.ts';

/**
 * The pick fixtures (WP6), shared by `pick-routes.test.ts` (the job that works) and
 * `pick-faults.test.ts` (the five ways a pick writes nothing).
 *
 * The stub window's payload is a **real fingerprint** — the same shape the inspector
 * sends — and the bytes are a **real page**, so the derivation, the counts and the
 * merge are the shipped ones. Only the browser is a stub, and that is deliberate:
 * `packages/fetch/test/browser/` runs this same sequence in Edge, and the pre-commit
 * floor (rule 16) runs it here, on a machine that may have no browser at all.
 */

export const CARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Example World</title></head>
<body>
  <header><nav><ul><li class="nav-item"><a href="/">Home</a></li><li class="nav-item"><a href="/world">World</a></li></ul></nav></header>
  <main>
    <h1>World</h1>
    <ul class="news">
      <li class="card"><h2 class="title"><a href="/a1">First story</a></h2><p class="deck">The deck of the first story.</p></li>
      <li class="card"><h2 class="title"><a href="/a2">Second story</a></h2><p class="deck">The deck of the second story.</p></li>
      <li class="card"><h2 class="title"><a href="/a3">Third story</a></h2><p class="deck">The deck of the third story.</p></li>
      <li class="card"><h2 class="title"><a href="/a4">Fourth story</a></h2><p class="deck">The deck of the fourth story.</p></li>
    </ul>
  </main>
  <footer><ul><li><a href="/about">About</a></li></ul></footer>
</body></html>`;

/** The second card, as the inspector reports it: the payload a browser sends. */
export const cardFingerprint = {
  url: 'https://example.invalid/world',
  path: [
    { tag: 'html', index: 1 },
    { tag: 'body', index: 2 },
    { tag: 'main', index: 2 },
    { tag: 'ul', index: 2 },
    { tag: 'li', index: 2 },
  ],
  href: 'https://example.invalid/a2',
  outerHtml:
    '<li class="card"><h2 class="title"><a href="/a2">Second story</a></h2><p class="deck">The deck of the second story.</p></li>',
  text: 'Second story',
  siblings: 4,
};

/** A click on a list that is not in the bytes the poller fetches (D-007). */
export const shellFingerprint = {
  ...cardFingerprint,
  path: [...cardFingerprint.path.slice(0, 2), { tag: 'div', index: 3 }, { tag: 'li', index: 2 }],
};

export const sourceText = (over: Record<string, unknown> = {}): string =>
  `${JSON.stringify(
    {
      id: 'example-world',
      label: 'Example World',
      url: 'https://example.invalid/world',
      kind: 'html',
      list: 'ul.news > li',
      fields: { title: 'h2', link: 'a', summary: 'p.deck' },
      cadenceMinutes: 15,
      weight: 3,
      watchwords: ['iran'],
      section: 'world',
      notes: 'the reader’s own words',
      matchCount: 30,
      ...over,
    },
    null,
    2,
  )}\n`;

/** The loaded file, through the loader's own parser: the route narrows a real spec. */
export const specOf =
  (text: string): (() => Promise<{ ok: true; spec: SourceSpec; text: string } | { ok: false; message: string }>) =>
  async () => {
    const parsed = parseSourceJson(text, 'sources/example-world.json');
    if (!parsed.ok) throw new Error(parsed.issue.messages.join('; '));
    return { ok: true, spec: parsed.spec, text };
  };

export const refusedLaunch: Extract<PickSessionResult, { ok: false }> = {
  ok: false,
  reason: 'launch-refused',
  detail: 'no browser to pick in: ENOENT msedge',
};

export const picked = (navigated = 'https://example.invalid/world'): PickSessionResult => ({
  ok: true,
  payload: cardFingerprint,
  navigated,
});

export const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((inner) => {
    resolve = inner;
  });
  return { promise, resolve };
};

export interface Bag {
  readonly routes: PickRoutes;
  readonly logs: string[];
  readonly seen: PickLaunchOptions[];
  readonly fetched: { spec: SourceSpec; url: string }[];
}

export const bagOf = (over: Partial<Parameters<typeof pickRoutes>[0]> = {}): Bag => {
  const logs: string[] = [];
  const seen: PickLaunchOptions[] = [];
  const fetched: { spec: SourceSpec; url: string }[] = [];
  const routes = pickRoutes({
    specOf: specOf(sourceText()),
    fetchText: async (spec, url) => {
      fetched.push({ spec, url });
      return CARD_HTML;
    },
    launch: async (options) => {
      seen.push(options);
      return picked();
    },
    headless: true,
    log: (line) => logs.push(line),
    now: () => new Date('2026-11-11T10:00:00Z'),
    ...over,
  });
  return { routes, logs, seen, fetched };
};

/** The job settles in a `.then`, so a test waits for the state that is not `running`. */
export const settled = async (routes: PickRoutes, id: string): Promise<PickStatusResponse> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const report = pickStatusResponseSchema.parse(routes.status(id).body);
    if (report.state !== 'running') return report;
    await new Promise((resolveSleep) => {
      setTimeout(resolveSleep, 1);
    });
  }
  throw new Error('the pick job never settled: the page would watch "running" forever');
};

export const mergedSpec = (text: string): SourceSpec => {
  const parsed = parseSourceJson(text, 'merged.json');
  if (!parsed.ok) throw new Error(parsed.issue.messages.join('; '));
  return parsed.spec;
};
