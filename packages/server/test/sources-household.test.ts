/**
 * The household scope over the real file system (D-034, the W4 ruling): the privacy
 * claims, driven directly. Split from `sources-api.test.ts` at rule 1’s cap; the
 * harness is the same small one — a temp tree and an in-memory db.
 */
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourcesResponse } from 'newspa-core';
import { type Database, openInMemory } from 'newspa-db';
import { beforeEach, describe, expect, it } from 'vitest';
import { listSources, sourcesRoutesOf } from '../src/sourcesApi.ts';
import { addSource, anRssSpec } from './support.ts';

const T0 = new Date('2026-11-09T10:00:00Z');

const tempDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'newspa-household-'));

const writeSpecFile = async (dir: string, name: string, value: unknown): Promise<void> =>
  writeFile(join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const harness = (dir: string, db: Database = openInMemory({ now: () => T0, token: 'tok-household' })) => {
  const logs: string[] = [];
  const deps = { dir, db, now: () => T0, log: (line: string) => logs.push(line) };
  return { deps, db, logs, routes: sourcesRoutesOf(deps) };
};

const listBody = (answer: Awaited<ReturnType<typeof listSources>>): SourcesResponse => {
  if (answer.status !== 200) throw new Error(`list answered ${String(answer.status)}`);
  return answer.body as SourcesResponse;
};

/**
 * The household scope (D-034, the W4 ruling): a device on the LAN moves a source's
 * switches. The claims are the privacy ones, because they are the ones a bug breaks
 * silently: the list carries **no file text and no desk path**; a patch preserves the
 * words the peer never saw; a body of file text is refused (it is not the household's
 * request shape); and an add refuses to overwrite a file it cannot read.
 */
describe('the household scope', () => {
  let dir: string;
  let h: ReturnType<typeof harness>;

  const authored = () => ({
    ...anRssSpec({ id: 'bbc' }),
    watchwords: ['iran', 'ceasefire'],
    blockwords: ['lottery'],
    notes: 'the deck selector drifted in August',
    section: 'World',
    weight: 3,
  });

  beforeEach(async () => {
    dir = await tempDir();
    h = harness(dir);
    await writeSpecFile(dir, 'bbc.json', authored());
    addSource(h.db, anRssSpec());
  });

  it('the list names the knobs and carries no text, no path, no private field (rule 18)', async () => {
    const body = listBody(await listSources(h.deps, 'household'));
    expect(body.scope).toBe('household');
    if (body.scope !== 'household') return;
    expect(Object.keys(body)).not.toContain('dir');
    const file = body.files[0];
    if (file === undefined) throw new Error('no file');
    expect(file).toMatchObject({ id: 'bbc', label: anRssSpec().label, section: 'World', weight: 3, enabled: true });
    // The leak this scope exists to prevent, stated as a key sweep over the JSON:
    // nothing in the answer may name the file's private words, in any nesting.
    const wire = JSON.stringify(body).toLowerCase();
    for (const needle of ['watchword', 'ceasefire', 'lottery', 'deck selector', '"text"', '"headers"']) {
      expect(wire, needle).not.toContain(needle);
    }
  });

  it('moves a switch, and the file keeps every word the peer never saw', async () => {
    const answer = await h.routes.write(
      { id: 'bbc', patch: { weight: 1, enabled: false, section: 'News' } },
      'household',
    );
    expect(answer.status).toBe(200);
    const written = JSON.parse(await readFile(join(dir, 'bbc.json'), 'utf8')) as Record<string, unknown>;
    expect([written['weight'], written['enabled'], written['section']]).toEqual([1, false, 'News']);
    expect(written['watchwords']).toEqual(['iran', 'ceasefire']);
    expect(written['blockwords']).toEqual(['lottery']);
    expect(written['notes']).toBe('the deck selector drifted in August');
    expect(h.db.sources.get('bbc')?.spec.enabled).toBe(false);
  });

  it('a null section means the ladder routes the source again, and the key leaves the file', async () => {
    const answer = await h.routes.write({ id: 'bbc', patch: { section: null } }, 'household');
    expect(answer.status).toBe(200);
    const written = JSON.parse(await readFile(join(dir, 'bbc.json'), 'utf8')) as Record<string, unknown>;
    expect(written['section']).toBeUndefined();
  });

  it('refuses an empty patch, an unknown key alone, and a key out of range — writing nothing', async () => {
    const before = await readFile(join(dir, 'bbc.json'), 'utf8');
    for (const patch of [{}, { watchwords: ['x'] }, { weight: 9 }, { notes: 'new' }]) {
      const answer = await h.routes.write({ id: 'bbc', patch }, 'household');
      expect(answer.status, JSON.stringify(patch)).toBe(400);
    }
    expect(await readFile(join(dir, 'bbc.json'), 'utf8')).toBe(before);
  });

  it('refuses to patch a file that does not parse, and says the desk owns that fix', async () => {
    await writeSpecFile(dir, 'broken.json', { id: 'broken', kind: 'rss' });
    const answer = await h.routes.write({ id: 'broken', patch: { weight: 2 } }, 'household');
    expect(answer.status).toBe(400);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('desk');
  });

  it('refuses the desk body — file text is not a household request (rule 18)', async () => {
    const answer = await h.routes.write({ text: JSON.stringify(anRssSpec({ id: 'sneaky' })) }, 'household');
    expect(answer.status).toBe(400);
    expect(await readdir(dir)).toEqual(['bbc.json']);
  });

  it('adds an rss source by URL, with the file’s own defaults', async () => {
    const answer = await h.routes.write(
      { create: { id: 'guardian-uk', label: 'Guardian UK', url: 'https://www.theguardian.com/uk/rss', kind: 'rss' } },
      'household',
    );
    expect(answer.status).toBe(200);
    const written = JSON.parse(await readFile(join(dir, 'guardian-uk.json'), 'utf8')) as Record<string, unknown>;
    expect(written['kind']).toBe('rss');
    expect(written['weight']).toBe(1);
    expect(written['watchwords']).toEqual([]);
    expect(h.db.sources.get('guardian-uk')?.spec.label).toBe('Guardian UK');
  });

  it('refuses an add that would overwrite an existing file, keeping the file byte-identical', async () => {
    const before = await readFile(join(dir, 'bbc.json'), 'utf8');
    const answer = await h.routes.write(
      { create: { id: 'bbc', label: 'Clobber', url: 'https://bbc.example/news', kind: 'rss' } },
      'household',
    );
    expect(answer.status).toBe(400);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('bbc.json');
    expect(await readFile(join(dir, 'bbc.json'), 'utf8')).toBe(before);
  });

  it('refuses a json source: a selector contract is authoring, and authoring is the desk’s', async () => {
    const answer = await h.routes.write(
      { create: { id: 'api', label: 'API', url: 'https://x.test/data.json', kind: 'json' } },
      'household',
    );
    expect(answer.status).toBe(400);
    expect(await readdir(dir)).toEqual(['bbc.json']);
  });
});
