/**
 * The sources routes (WP14), driven **directly**: the facts here are a directory and
 * a database, and the socket adds nothing to them (`http-app.test.ts` covers the
 * routing, the body limits and the address guard).
 *
 * What each test pins is the rule the route exists to enforce: **the file is the
 * truth** (D-011) — a write writes `sources/<id>.json` and names it; **the schema is
 * the validator** (D-014) — a bad body is the zod issues, with nothing written; **the
 * peer's scope decides what is sent** (D-034, W4) — a household device sees the
 * switches and never the file; and **a disappearance is a report** (rule 5) — a file
 * that does not parse is listed with its issues, and a deleted source is disabled and
 * stays in the paper.
 */
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SourcesResponse } from 'newspa-core';
import { type Database, openInMemory } from 'newspa-db';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteSource, listSources, sourcesRoutesOf, writeSourceText } from '../src/sourcesApi.ts';
import { addItem, addSource, anHtmlSpec, anItemRecord, anRssSpec } from './support.ts';

const T0 = new Date('2026-11-09T10:00:00Z');

const tempDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'newspa-sources-'));

const writeSpecFile = async (dir: string, name: string, value: unknown): Promise<void> =>
  writeFile(join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');

const dbOf = (): Database => openInMemory({ now: () => T0, token: 'tok-sources' });

const harness = (dir: string, db: Database = dbOf()) => {
  const logs: string[] = [];
  const deps = { dir, db, now: () => T0, log: (line: string) => logs.push(line) };
  return { deps, db, logs, routes: sourcesRoutesOf(deps) };
};

const listBody = (answer: Awaited<ReturnType<typeof listSources>>): SourcesResponse => {
  if (answer.status !== 200) throw new Error(`list answered ${String(answer.status)}`);
  return answer.body as SourcesResponse;
};

/** The desk's answer, narrowed: the tests below read `text`, which the household scope never sends. */
const fullBody = (body: SourcesResponse): Extract<SourcesResponse, { scope: 'full' }> => {
  if (body.scope !== 'full') throw new Error(`list answered scope "${body.scope}"`);
  return body;
};

describe('listSources', () => {
  let dir: string;
  let h: ReturnType<typeof harness>;

  beforeEach(async () => {
    dir = await tempDir();
    h = harness(dir);
  });

  it('lists every file with its own text, so the editor edits the file and not a copy of it', async () => {
    await writeSpecFile(dir, 'bbc.json', anRssSpec());
    await writeSpecFile(dir, 'cards.json', anHtmlSpec());
    const body = fullBody(listBody(await listSources(h.deps, 'full')));
    expect(body.dir).toBe(dir);
    expect(body.files.map((file) => file.file)).toEqual(['bbc.json', 'cards.json']);
    const first = body.files[0];
    if (first === undefined) throw new Error('no file');
    expect(JSON.parse(first.text).id).toBe('bbc');
    expect(first.id).toBe('bbc');
    expect(first.kind).toBe('rss');
    expect(first.label).toBe('BBC World');
    expect(first.issues).toEqual([]);
  });

  it('lists a file that does not parse, with the loader’s issues (rule 5: no silent disappearance)', async () => {
    await writeSpecFile(dir, 'good.json', anRssSpec({ id: 'good' }));
    await writeSpecFile(dir, 'broken.json', { id: 'broken', kind: 'rss' });
    await writeFile(join(dir, 'not-json.json'), '{\n', 'utf8');
    const body = fullBody(listBody(await listSources(h.deps, 'full')));
    const broken = body.files.find((file) => file.file === 'broken.json');
    const notJson = body.files.find((file) => file.file === 'not-json.json');
    expect(broken?.id).toBeNull();
    expect(broken?.issues.join(' ')).toContain('url');
    expect(notJson?.issues.join(' ')).not.toBe('');
    expect(notJson?.text).toBe('{\n');
    expect(body.files.find((file) => file.file === 'good.json')?.id).toBe('good');
  });

  it('says so when a file names a different id than its own name (D-011: the filename is the id)', async () => {
    await writeSpecFile(dir, 'other-name.json', anRssSpec({ id: 'bbc' }));
    const body = fullBody(listBody(await listSources(h.deps, 'full')));
    expect(body.files[0]?.id).toBeNull();
    expect(body.files[0]?.issues.join(' ')).toContain('filename');
  });

  it('carries the row’s health and enabled flag, and the peer’s writable fact', async () => {
    await writeSpecFile(dir, 'bbc.json', anRssSpec());
    addSource(h.db, anRssSpec());
    h.db.sources.setEnabled('bbc', false);
    const body = fullBody(listBody(await listSources(h.deps, 'full')));
    // `writable` is true in both scopes (D-034, W4): the guard answers a LAN peer in
    // the household scope, and a peer the guard refuses never reaches this list.
    expect(body.writable).toBe(true);
    expect(body.files[0]).toMatchObject({ id: 'bbc', enabled: false, state: 'unknown' });
  });

  it('an empty directory is a listed zero, with the count the paper will show', async () => {
    const body = fullBody(listBody(await listSources(h.deps, 'full')));
    expect(body.files).toEqual([]);
    expect(body.writable).toBe(true);
    expect(h.logs.join('\n')).toContain('the directory is empty');
  });

  it('a directory that is not there is a listed zero too, and says so (ENOENT is not a crash)', async () => {
    const missing = harness(join(await tempDir(), 'no-such-dir'));
    const body = fullBody(listBody(await listSources(missing.deps, 'full')));
    expect(body.files).toEqual([]);
    expect(missing.logs.join('\n')).toContain('the directory is empty');
  });
});

describe('writeSourceText', () => {
  let dir: string;
  let h: ReturnType<typeof harness>;

  beforeEach(async () => {
    dir = await tempDir();
    h = harness(dir);
  });

  it('writes sources/<id>.json, refreshes the row, and makes the source due at once', async () => {
    const answer = await writeSourceText(h.deps, { text: JSON.stringify(anRssSpec({ id: 'reuters' })) });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, file: join(dir, 'reuters.json') });
    const text = await readFile(join(dir, 'reuters.json'), 'utf8');
    expect(JSON.parse(text).id).toBe('reuters');
    expect(h.db.sources.get('reuters')?.spec.label).toBe(anRssSpec().label);
    // The whole point of upserting here: the paper shows the source and the next
    // batch polls it, without a restart.
    expect(h.db.sources.dueSources(T0.toISOString(), 10).map((row) => row.spec.id)).toEqual(['reuters']);
    expect(h.logs.join('\n')).toContain('wrote');
  });

  it('refuses text that is not JSON, writes nothing, and says why', async () => {
    const answer = await writeSourceText(h.deps, { text: '{ "id": ' });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ ok: false, file: null });
    expect((answer.body as { messages: string[] }).messages.join(' ')).not.toBe('');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a source the schema rejects, with the zod issue that names the field', async () => {
    const answer = await writeSourceText(h.deps, { text: JSON.stringify({ id: 'x1', kind: 'rss', label: 'No url' }) });
    expect(answer.status).toBe(400);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('url');
    expect(await readdir(dir)).toEqual([]);
  });

  it('checks a posted filename, and never obeys one that would invent a second name for an id', async () => {
    const answer = await writeSourceText(h.deps, {
      text: JSON.stringify(anRssSpec({ id: 'bbc' })),
      filename: 'evil.json',
    });
    expect(answer.status).toBe(400);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('bbc.json');
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('evil.json');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a body that is not the request shape, naming the missing field', async () => {
    const answer = await writeSourceText(h.deps, { text: 42 });
    expect(answer.status).toBe(400);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('text');
  });

  it('writes a `render: true` source and says the transport will refuse it (WP6, rule 5)', async () => {
    const spec = { ...anHtmlSpec({ id: 'js-wall' }), render: true };
    const answer = await writeSourceText(h.deps, { text: JSON.stringify(spec) });
    expect(answer.status).toBe(200);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain('WP6');
  });

  it('the route bag answers the same three facts as the functions', async () => {
    const listed = await h.routes.list('full');
    expect(listed.status).toBe(200);
    const written = await h.routes.write({ text: JSON.stringify(anRssSpec({ id: 'ap' })) }, 'full');
    expect(written.status).toBe(200);
    const removed = await h.routes.remove('ap');
    expect(removed.status).toBe(200);
  });
});

describe('deleteSource', () => {
  let dir: string;
  let h: ReturnType<typeof harness>;

  beforeEach(async () => {
    dir = await tempDir();
    h = harness(dir);
    await writeSpecFile(dir, 'bbc.json', anRssSpec());
    addSource(h.db, anRssSpec());
    addItem(h.db, anItemRecord({ sourceId: 'bbc', key: 'bbc:1' }));
  });

  it('removes the file and disables the row, and keeps the items', async () => {
    const answer = await deleteSource(h.deps, 'bbc');
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, file: join(dir, 'bbc.json') });
    expect(await readdir(dir)).toEqual([]);
    expect(h.db.sources.get('bbc')?.spec.enabled).toBe(false);
    expect(h.db.items.countBySource().find((row) => row.sourceId === 'bbc')?.count).toBe(1);
    expect(h.logs.join('\n')).toContain('the row is disabled, its items stay');
  });

  it('is a 404 that names the directory when there is no such file', async () => {
    const answer = await deleteSource(h.deps, 'nosuch');
    expect(answer.status).toBe(404);
    expect((answer.body as { messages: string[] }).messages.join(' ')).toContain(dir);
  });

  it('refuses an id that is not an id — the shape is the traversal guard', async () => {
    for (const raw of ['..%2fx', '../../etc/passwd', 'A', 'a b', '']) {
      const answer = await deleteSource(h.deps, raw);
      expect(answer.status, raw).toBe(400);
    }
    expect(await readdir(dir)).toEqual(['bbc.json']);
  });
});
