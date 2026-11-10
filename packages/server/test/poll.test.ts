/**
 * The slow path, end to end: a captured feed, fetched from an injected socket,
 * written to a real database, read back as the `StateResponse` the paper
 * consumes. This is WP2's acceptance, so the assertions are the row counts and
 * the wire shape — not the call graph.
 *
 * The clock is the harness's `FIXED`, so every `takenAt` is a date a test chose;
 * the `fetch` is injected, so nothing here reaches the network.
 */
import type { Database } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { pollOne } from '../src/poll.ts';
import { fixture, okResponse, pollHarness, storedState, TAKEN_AT } from './pollSupport.ts';
import { anRssSpec, healthOfSource, stateOfDb, wireItems } from './support.ts';

const spec = anRssSpec({ watchwords: ['inflation', 'central bank'], section: 'World Desk' });
const frontPage = () => pollHarness(spec, () => okResponse(fixture('feed-bbc-world.xml')));

describe('one poll of a real feed, written through the repositories', () => {
  it('stores the parsed items, one snapshot, and a `new` event for every item', async () => {
    const h = frontPage();
    const result = await h.poll();

    expect(result.outcome).toBe('changed');
    const items = h.db.items.list({ sourceId: 'bbc' });
    expect(items.length).toBeGreaterThan(3);
    expect(result.itemCount).toBe(items.length);
    expect(result.newItems).toBe(items.length);
    expect(result.editedItems).toBe(0);
    expect(result.newKeys).toHaveLength(items.length);

    expect(h.db.snapshots.count('bbc')).toBe(1);
    const snapshot = h.db.snapshots.last('bbc');
    expect(snapshot?.snapshot.outcome).toBe('changed');
    expect(snapshot?.snapshot.status).toBe(200);
    expect(snapshot?.snapshot.bytes).toBeGreaterThan(1_000);
    expect(snapshot?.snapshot.itemCount).toBe(items.length);
    expect(snapshot?.snapshot.errorKind).toBeNull();
    expect(h.db.itemEvents.count({ sourceId: 'bbc', kind: 'new' })).toBe(items.length);
  });

  it('stamps every row with the instant the poll was handed, never the moment it ran', async () => {
    const h = frontPage();
    await h.poll();

    expect(h.db.snapshots.last('bbc')?.snapshot.takenAt).toBe(TAKEN_AT);
    for (const item of h.db.items.list({ sourceId: 'bbc' })) {
      expect(item.firstSeenAt).toBe(TAKEN_AT);
      expect(item.lastSeenAt).toBe(TAKEN_AT);
      expect(item.lastChangedAt).toBeNull();
    }
    for (const event of h.db.itemEvents.listRecent({ sourceId: 'bbc' })) expect(event.at).toBe(TAKEN_AT);
  });

  it('scores with the source’s own knobs, and routes a declared section to its slug', async () => {
    const serve = () => okResponse(fixture('feed-bbc-world.xml'));
    const boosted = pollHarness(anRssSpec({ watchwords: ['austerity'] }), serve);
    await boosted.poll();
    const plain = pollHarness(anRssSpec({ watchwords: [] }), serve);
    await plain.poll();

    const titled = (db: Database, pattern: RegExp) =>
      db.items.list({ sourceId: 'bbc' }).find((item) => pattern.test(item.title));

    // `watchwords` is the reader's slider: the same story, one poll each, the
    // watched one scores higher. `weight: 3` is the other slider, already in
    // every row of both, so it cannot be what moved.
    const story = titled(boosted.db, /austerity/iu);
    expect(story).toBeDefined();
    expect(story?.scoreRealtime).toBeGreaterThan(titled(plain.db, /austerity/iu)?.scoreRealtime ?? 0);

    const blocked = pollHarness(anRssSpec({ blockwords: ['austerity'] }), serve);
    await blocked.poll();
    expect(titled(blocked.db, /austerity/iu)?.scoreRealtime).toBeLessThan(story?.scoreRealtime ?? 0);

    // `section` is a column of its own, not a field of `ItemRecord`: the
    // repository hands it beside the row (`read`), and `list` cannot show it.
    const sectionsOf = (db: Database): (string | null | undefined)[] =>
      db.items.list({ sourceId: 'bbc' }).map((item) => db.items.read('bbc', item.key).section);

    // With no declared section, core's keyword ladder routes the feed: every row
    // gets a slug, never an empty box.
    const routed = sectionsOf(boosted.db);
    expect(routed.length).toBeGreaterThan(3);
    expect(routed.every((section) => typeof section === 'string' && section.length > 0)).toBe(true);
    expect(boosted.db.items.list({ sourceId: 'bbc' }).every((item) => item.scoreDigest === 0)).toBe(true);

    // A declared section (the reader's knob) wins for every story of that source,
    // and lands as a slug: `sectionTitleFor` is typography's job, not storage's.
    const declared = pollHarness(anRssSpec({ section: 'World Desk' }), serve);
    await declared.poll();
    expect(new Set(sectionsOf(declared.db))).toEqual(new Set(['world-desk']));
  });

  it('publishes the paper: the read side prints the stories the poll wrote', async () => {
    const h = frontPage();
    const result = await h.poll();
    const state = stateOfDb(h.db);
    const count = result.itemCount;
    if (count === null) throw new Error('a poll that parsed items must report how many it wrote');

    expect(state.edition.stats.items).toBe(count);
    expect(state.edition.stats.newItems).toBe(result.newItems);
    expect(state.edition.stats.editedItems).toBe(0);
    const lead = state.edition.lead;
    expect(lead).toBeTruthy();
    expect(lead?.title.length).toBeGreaterThan(10);
    const wire = wireItems(state);
    expect(wire).toHaveLength(count);
    // D-017: the stored scrape has no door onto the wire.
    expect(wire.every((item) => !('body' in item))).toBe(true);
  });

  it('records the baseline the next poll runs against, and the payload’s own signals', async () => {
    const h = frontPage();
    await h.poll();

    const state = storedState(h.db, 'bbc');
    expect(state.etag).toBe('"cap-1"');
    expect(state.bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(state.weakEtag).toBe(false);
    expect(state.declaredModifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(state.generator).toBe('RSS for Node');
    expect(state.ttlMinutes).toBe(15);
    // The first poll had to parse, so the fast path is a miss — and the counter
    // exists, which is the only way an inert ladder is ever visible.
    expect(state.fastPathMisses).toBe(1);
    expect(state.fastPathHits).toBe(0);
  });

  it('reports health the paper can print, with this poll’s count as the evidence', async () => {
    const h = frontPage();
    const result = await h.poll();

    expect(result.health).toBe('ok');
    const source = h.db.sources.find('bbc');
    expect(source.health).toBe('ok');
    expect(source.lastStatus).toBe(200);
    expect(source.lastPolledAt).toBe(TAKEN_AT);
    expect(source.lastSuccessAt).toBe(TAKEN_AT);
    expect(source.note).toContain('parsed');

    const view = healthOfSource(stateOfDb(h.db), 'bbc');
    expect(view.state).toBe('ok');
    expect(view.matchCount).toBe(result.itemCount);
    expect(view.itemCount).toBe(result.itemCount);
  });

  it('answers a poll of an unregistered source by throwing, not by writing nothing', async () => {
    const h = frontPage();
    const rogue = anRssSpec({ id: 'never-registered', label: 'Ghost feed' });

    // `items` and `snapshots` have a foreign key to `sources`, and the CLI owns
    // authoring, so a poll of a source that is not registered is a defect, not a
    // quiet result. The whole poll rolls back: no half-written rows.
    await expect(pollOne(rogue, h.deps)).rejects.toThrow(/foreign key constraint failed/iu);
    expect(h.db.items.count()).toBe(0);
    expect(h.db.snapshots.count()).toBe(0);
  });
});
