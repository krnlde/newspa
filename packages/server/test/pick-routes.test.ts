/**
 * The pick routes (WP6, D-036), driven directly: the job registry, the refusals,
 * the merge in the answer.
 *
 * The claims here are the ones a route that **launches a browser** has to earn:
 *
 *  - `POST` answers **at once** with `running`, and the reader's wait is spent
 *    reading `GET` reports — a request that waits for a cursor is a request that
 *    dies in a proxy;
 *  - **one window at a time.** A second start while one is open is a 409 that names
 *    the running source;
 *  - **the answer carries the merged text and nothing is written.** `PickApiDeps`
 *    has no write function, so a click cannot put D-011's truth under a mouse — the
 *    reader presses SAVE;
 *  - the source types a pick cannot describe (rss, json, a page) are refused
 *    **before** a window opens, so no browser appears for a source with no list.
 *
 * `pick-faults.test.ts` is the twin: the five ways a pick writes nothing. The
 * fixtures are in `pickSupport.ts`.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bagOf, deferred, mergedSpec, picked, settled, sourceText, specOf } from './pickSupport.ts';

describe('a pick started by the route', () => {
  it('answers at once with running, and the report ends in a selector that validates', async () => {
    const bag = bagOf();
    const started = await bag.routes.start('example-world');
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ state: 'running' });

    const done = await settled(bag.routes, 'example-world');
    expect(done.state).toBe('picked');
    expect(done.finishedAt).toBe('2026-11-11T10:00:00.000Z');
    expect(done.sentence).toContain('pick: Example World (https://example.invalid/world)');
    expect(done.sentence).toContain('list       .card');
    expect(done.sentence).toContain('matchCount 4 in the bytes the poller fetches');

    const merged = mergedSpec(done.text ?? '');
    expect(merged.kind).toBe('html');
    if (merged.kind !== 'html') return;
    expect(merged.list).toBe('.card');
    expect(merged.matchCount).toBe(4);
    // The reader's own keys survive a merge (config/pickMerge.test.ts is the suite
    // for the merge; here the claim is that the route hands over that text).
    expect(merged.weight).toBe(3);
    expect(merged.watchwords).toEqual(['iran']);
    expect(merged.notes).toBe('the reader’s own words');
    expect(bag.logs.join('\n')).toContain("pick: example-world -> '.card'");
  });

  it('hands the browser tier the source’s url, and fetches the bytes the window ended on', async () => {
    const bag = bagOf({
      launch: async (options) => {
        bag.seen.push(options);
        return picked('https://example.invalid/world?page=2');
      },
    });
    await bag.routes.start('example-world');
    const done = await settled(bag.routes, 'example-world');
    expect(done.state).toBe('picked');
    expect(bag.seen[0]?.url).toBe('https://example.invalid/world');
    expect(bag.seen[0]?.headless).toBe(true);
    expect(bag.fetched[0]?.url).toBe('https://example.invalid/world?page=2');
    expect(bag.fetched[0]?.spec.id).toBe('example-world');
  });

  it('gives the window a profile directory only for a source that declared one (rule 17)', async () => {
    const plain = bagOf({ profilesDir: 'profiles' });
    await plain.routes.start('example-world');
    await settled(plain.routes, 'example-world');
    expect(plain.seen[0]).not.toHaveProperty('profileDir');

    const bagged = bagOf({
      profilesDir: 'profiles',
      specOf: specOf(sourceText({ profile: true })),
    });
    await bagged.routes.start('example-world');
    await settled(bagged.routes, 'example-world');
    expect(bagged.seen[0]?.profileDir).toBe(join('profiles', 'example-world'));
  });

  it('a second start while a window is open is a 409 that names the running source', async () => {
    const gate = deferred();
    const bag = bagOf({
      launch: async () => {
        await gate.promise;
        return picked();
      },
    });
    const first = await bag.routes.start('example-world');
    expect(first.status).toBe(202);

    const second = await bag.routes.start('example-world');
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain('a pick window is already open for');

    gate.resolve();
    expect((await settled(bag.routes, 'example-world')).state).toBe('picked');
    // The window is shut, so the next pick is allowed: the gate is one window, not one pick.
    expect((await bag.routes.start('example-world')).status).toBe(202);
    await settled(bag.routes, 'example-world');
  });
});

describe('a source a pick cannot describe is refused before a window opens', () => {
  const refusedWith = async (over: Record<string, unknown>, phrase: string): Promise<void> => {
    const bag = bagOf({ specOf: specOf(sourceText(over)) });
    const answer = await bag.routes.start('example-world');
    expect(answer.status).toBe(400);
    expect(JSON.stringify(answer.body)).toContain(phrase);
    expect(bag.seen).toEqual([]);
  };

  it('a feed has no list and no fields to pick', async () => {
    await refusedWith({ kind: 'rss', list: undefined, fields: undefined }, "'rss'");
  });

  it('a page source is the item, and says so with D-028', async () => {
    await refusedWith({ list: null }, 'D-028');
  });

  it('a file that is not there is a 404 naming the path it tried', async () => {
    const bag = bagOf({ specOf: async () => ({ ok: false, message: 'sources/gone.json could not be read: ENOENT' }) });
    const answer = await bag.routes.start('gone');
    expect(answer.status).toBe(404);
    expect(JSON.stringify(answer.body)).toContain('ENOENT');
  });

  it('a report for a source nobody picked is a 404 that says how to start one', async () => {
    const bag = bagOf();
    const answer = bag.routes.status('never-picked');
    expect(answer.status).toBe(404);
    expect(JSON.stringify(answer.body)).toContain('POST /api/pick');
  });
});
