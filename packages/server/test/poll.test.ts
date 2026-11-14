/**
 * The slow path, end to end: a captured feed, fetched from an injected socket,
 * written to a real database, read back as the `StateResponse` the paper
 * consumes. This is WP2's acceptance, so the assertions are the row counts and
 * the wire shape — not the call graph.
 *
 * The clock is the harness's `FIXED`, so every `takenAt` is a date a test chose;
 * the `fetch` is injected, so nothing here reaches the network.
 */

import { defaultFreshness, scoreItem } from 'newspa-core';
import type { Database } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { pollOne } from '../src/poll.ts';
import { rulesOf } from '../src/pollItems.ts';
import { fixture, okResponse, pollHarness, storedState, TAKEN_AT } from './pollSupport.ts';
import { anRssSpec, FIXED, healthOfSource, stateOfDb, wireItems } from './support.ts';

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

  it('scores an undated story from the sighting the card prints, not from a guessed age (D-047)', async () => {
    // The item declares no `pubDate`, so the paper's sighting is the only instant it
    // has. The scorer invented 72 hours while the meta line printed the sighting — one
    // story, two clocks, and a card that read "seen just now" while ranking mid-list.
    // Two polls, 50 hours apart, are where the two numbers cannot agree by accident.
    const page = (title: string): string =>
      `<rss><channel><title>Wire</title><item><title>${title}</title><link>https://bbc.example/bridge</link><description>The trams run again.</description></item></channel></rss>`;
    const spec = anRssSpec({ watchwords: [] });
    const h = pollHarness(spec, (call) =>
      okResponse(page(call === 1 ? 'Harbour bridge reopens' : 'Harbour bridge reopens, the trams run again')),
    );
    await h.poll();
    const seen = h.db.items.list({ sourceId: 'bbc' })[0];
    if (seen === undefined) throw new Error('the poll wrote no row');
    expect(seen.publishedAt).toBeNull();
    expect(seen.firstSeenAt).toBe(TAKEN_AT);

    // The identity the fix is about: the stored score is what scoring the **printed**
    // instant produces, at the instant the poll was handed. The title is the row's,
    // because the score is the poll's reading of the story as it stands that day.
    const at = (row: { title: string; summary: string | null }, now: Date): number =>
      scoreItem(
        {
          title: row.title,
          summary: row.summary,
          publishedAt: null,
          firstSeenAt: TAKEN_AT,
          sourceLabel: spec.label,
        },
        rulesOf(spec),
        now,
      ).total;
    expect(seen.scoreRealtime).toBe(at(seen, FIXED));

    const later = new Date(FIXED.getTime() + 50 * 3_600_000);
    await h.pollAt(later);
    const aged = h.db.items.list({ sourceId: 'bbc' })[0];
    if (aged === undefined) throw new Error('the second poll lost the row');
    expect(aged.firstSeenAt, 'the sighting is the first sighting, not the last poll').toBe(TAKEN_AT);
    expect(aged.scoreRealtime).toBe(at(aged, later));
    expect(aged.scoreRealtime).toBeLessThan(seen.scoreRealtime);
  });

  it('publishes the paper: the read side prints the stories the poll wrote, capped per section', async () => {
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
    // D-048: a section is an index of the day, not an archive. The stats count the
    // whole poll; the page prints the cap's worth, newest-ranked first.
    expect(wire.length).toBe(Math.min(count, defaultFreshness().sectionMaxItems));
    expect(count).toBeGreaterThan(defaultFreshness().sectionMaxItems);
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
