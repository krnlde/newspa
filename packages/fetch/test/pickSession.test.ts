import { describe, expect, it } from 'vitest';
import type { PickLaunchOptions, PickSessionResult } from '../src/pick/launch.ts';
import { describePickRun, runPick } from '../src/pick/pickSession.ts';
import type { PickFingerprint } from '../src/pick/types.ts';
import { fixture } from './support.ts';

/**
 * The pick sequence, with the window stubbed (WP6).
 *
 * `test/browser/` proves the same function against real Edge and real bytes; this
 * file proves the **sequence**, which is the part the server and the CLI call:
 * every stop is a named stage, nothing is written before a click is captured, and
 * one sentence describes the whole run. The stub exists so these claims are
 * checked on a machine with no browser — the pre-commit floor's rule (rule 16).
 */

const cardFingerprint: PickFingerprint = {
  url: 'https://example.invalid/world',
  path: [
    { tag: 'html', index: 1 },
    { tag: 'body', index: 2 },
    { tag: 'main', index: 2 },
    { tag: 'ul', index: 2 },
    { tag: 'li', index: 2 },
  ],
  href: 'https://example.invalid/a2',
  outerHtml: '<li class="card"><h2 class="title"><a href="/a2">Second story</a></h2></li>',
  text: 'Second story',
  siblings: 4,
};

const shellFingerprint: PickFingerprint = {
  url: 'https://example.invalid/shell',
  path: [
    { tag: 'html', index: 1 },
    { tag: 'body', index: 2 },
    { tag: 'div', index: 1 },
    { tag: 'ul', index: 1 },
    { tag: 'li', index: 2 },
  ],
  href: 'https://example.invalid/s2',
  outerHtml: '<li><a href="/s2">Story two</a></li>',
  text: 'Story two',
  siblings: 3,
};

const session =
  (result: PickSessionResult): typeof import('../src/pick/launch.ts').openPickSession =>
  async () =>
    result;

const cardBytes = () => Promise.resolve(fixture('pick-card-list.html'));

const deps = (over: Partial<import('../src/pick/pickSession.ts').PickDeps> = {}) => ({
  launch: session({ ok: true, payload: cardFingerprint, navigated: 'https://example.invalid/world' }),
  fetchText: cardBytes,
  headless: true,
  ...over,
});

const TARGET = { url: 'https://example.invalid/world', label: 'Example World' };

describe('a pick that ends in a selector', () => {
  it('derives from the bytes, and says so in one sentence', async () => {
    const run = await runPick(TARGET, deps());
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.stage).toBe('derived');
    expect(run.outcome.list).toBe('.card');
    expect(run.outcome.matchCount).toBe(4);

    const printed = describePickRun(run, TARGET);
    expect(printed).toContain('pick: Example World (https://example.invalid/world)');
    expect(printed).toContain('list       .card');
    expect(printed).toContain('matchCount 4 in the bytes the poller fetches');
    expect(printed).toContain('reads      "Second story"');
  });

  it('hands the browser tier exactly the options it was given, and no others', async () => {
    const seen: PickLaunchOptions[] = [];
    await runPick(TARGET, {
      launch: async (options) => {
        seen.push(options);
        return { ok: true, payload: cardFingerprint, navigated: options.url };
      },
      fetchText: cardBytes,
      headless: false,
      profileDir: 'profiles/example-world',
      budgetMs: 60_000,
      navTimeoutMs: 5_000,
      channel: 'msedge',
    });
    expect(seen[0]).toEqual({
      url: TARGET.url,
      headless: false,
      profileDir: 'profiles/example-world',
      budgetMs: 60_000,
      navTimeoutMs: 5_000,
      channel: 'msedge',
    });

    const bare: PickLaunchOptions[] = [];
    await runPick(TARGET, {
      launch: async (options) => {
        bare.push(options);
        return { ok: true, payload: cardFingerprint, navigated: options.url };
      },
      fetchText: cardBytes,
      headless: true,
    });
    expect(Object.keys(bare[0] ?? {}).sort()).toEqual(['headless', 'url']);
  });
});

describe('a pick that writes nothing, named by stage', () => {
  it('launch / a browser that is not there is a sentence, not an empty answer', async () => {
    const run = await runPick(TARGET, {
      ...deps(),
      launch: session({
        ok: false,
        reason: 'launch-refused',
        detail: 'no browser to pick in: ENOENT msedge',
      }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect([run.stage, run.reason]).toEqual(['launch', 'launch-refused']);
    expect(run.notes.join(' ')).toContain('writes nothing');
    expect(describePickRun(run, TARGET)).toContain(
      'pick wrote nothing for Example World (https://example.invalid/world): launch / launch-refused',
    );
  });

  it('launch / the reader pressed Esc', async () => {
    const run = await runPick(TARGET, {
      ...deps(),
      launch: session({ ok: false, reason: 'cancelled', detail: 'the reader pressed Esc' }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect([run.stage, run.reason]).toEqual(['launch', 'cancelled']);
  });

  it('fingerprint / a payload that is not one', async () => {
    const run = await runPick(TARGET, {
      ...deps(),
      launch: session({ ok: true, payload: 'a string', navigated: TARGET.url }),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect([run.stage, run.reason]).toEqual(['fingerprint', 'bad-fingerprint']);
  });

  it('fetch / the bytes the proof needs, missing', async () => {
    const run = await runPick(TARGET, {
      ...deps(),
      fetchText: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:80')),
    });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect([run.stage, run.reason]).toEqual(['fetch', 'fetch-failed']);
    expect(run.detail).toContain('ECONNREFUSED');
    expect(run.notes.join(' ')).toContain('fails in the poll too');
  });

  it('derive / the DOM that was clicked is not in the bytes (D-007)', async () => {
    const run = await runPick(
      { url: 'https://example.invalid/shell' },
      deps({
        launch: session({ ok: true, payload: shellFingerprint, navigated: 'https://example.invalid/shell' }),
        fetchText: () => Promise.resolve(fixture('pick-script-shell.html')),
      }),
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect([run.stage, run.reason]).toEqual(['derive', 'path-unmapped']);
    expect(describePickRun(run, { url: 'https://example.invalid/shell' })).toContain('render: true');
  });
});
