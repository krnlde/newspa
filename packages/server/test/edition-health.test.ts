/**
 * The stats strip and the per-source health view: what the paper prints when a
 * source is quiet, blocked, switched off, or has never answered.
 *
 * Rule 5 is the theme — a silent zero is a bug, so every absence is a number
 * (`0`) or a `null` that says "not measured", and a source that is off is on the
 * list. `lastChangeAt` is derived, because the `sources` table has no such column.
 */
import { describe, expect, it } from 'vitest';
import {
  addItem,
  addSnapshot,
  addSource,
  aJsonSpec,
  anHtmlSpec,
  anItemRecord,
  anRssSpec,
  aSnapshot,
  build,
  DECK,
  FIXED,
  healthOfSource,
  openDb,
  rowsOf,
  seeded,
} from './support.ts';

describe('the stats strip', () => {
  it('counts items, new items, edited items, fetched sources, unhealthy sources and cycles', () => {
    const db = openDb();
    addSource(db, anRssSpec(), { health: 'ok', lastPolledAt: FIXED.toISOString() });
    addSource(db, anHtmlSpec({ id: 'globe', label: 'Globe' }), {
      health: 'blocked',
      lastPolledAt: FIXED.toISOString(),
    });
    addSource(db, aJsonSpec({ id: 'api', label: 'API' }), { health: 'no-matches' });
    addSource(db, aJsonSpec({ id: 'off', label: 'Off', url: 'https://off.example/api', enabled: false }));
    addItem(db, anItemRecord({ key: 'bbc:a', summary: DECK }));
    addItem(db, anItemRecord({ key: 'bbc:b', summary: DECK, editCount: 2 }));
    addSnapshot(db, aSnapshot());
    addSnapshot(db, aSnapshot({ sourceId: 'globe' }));

    const state = build(rowsOf(db));
    expect(state.edition.stats).toEqual({
      items: 2,
      newItems: 1,
      editedItems: 1,
      // "fetched" is `last_polled_at`: two sources have answered, two never have.
      sourcesFetched: 2,
      // Rule 5: `blocked`, `no-matches` and the never-polled `unknown` all count.
      sourcesUnhealthy: 3,
      cycles: 2,
    });
    expect(state.sources).toHaveLength(4);
    // Rule 5: a source that is switched off is on the list, marked off.
    expect(healthOfSource(state, 'off').enabled).toBe(false);
    db.close();
  });
});

describe('source health', () => {
  it('reports a source with no items as 0, and no snapshot as a null match count', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    const state = build(rowsOf(db));
    expect(healthOfSource(state, 'bbc')).toMatchObject({
      id: 'bbc',
      label: 'BBC World',
      kind: 'rss',
      url: 'https://bbc.example/world.xml',
      state: 'unknown',
      lastStatus: null,
      lastFetchAt: null,
      lastChangeAt: null,
      itemCount: 0,
      expectedMatchCount: null,
      matchCount: null,
      note: null,
      enabled: true,
    });
    expect(healthOfSource(state, 'bbc').cadenceMinutes).toBe(20);
    db.close();
  });

  it('takes the newest snapshot’s numbers, the stored health, and the declared match count', () => {
    const db = openDb();
    addSource(db, anRssSpec({ matchCount: 12 }), {
      health: 'restructured',
      note: 'selector matched 3 of 12',
      lastStatus: 200,
      lastPolledAt: '2026-11-09T09:00:00Z',
    });
    addSnapshot(db, aSnapshot({ takenAt: '2026-11-09T06:00:00Z', itemCount: 12 }));
    addSnapshot(db, aSnapshot({ takenAt: '2026-11-09T09:00:00Z', itemCount: 3 }));
    addItem(db, anItemRecord({ key: 'bbc:old', lastChangedAt: '2026-11-08T06:00:00Z' }));
    addItem(db, anItemRecord({ key: 'bbc:new', link: 'https://bbc.example/n', lastChangedAt: '2026-11-09T07:30:00Z' }));
    addItem(db, anItemRecord({ key: 'bbc:untouched' }));

    const state = build(rowsOf(db));
    expect(healthOfSource(state, 'bbc')).toMatchObject({
      state: 'restructured',
      note: 'selector matched 3 of 12',
      lastStatus: 200,
      lastFetchAt: '2026-11-09T09:00:00Z',
      expectedMatchCount: 12,
      matchCount: 3,
      itemCount: 3,
      // Derived: `sources` has no `last_change_at` column, so the newest
      // `lastChangedAt` among the source's items is the answer.
      lastChangeAt: '2026-11-09T07:30:00Z',
    });

    // The fold keeps the newest numbers whichever order the caller hands the rows.
    const both = db.snapshots.list('bbc');
    expect(both).toHaveLength(2);
    for (const snapshots of [both, [...both].reverse()])
      expect(healthOfSource(build(rowsOf(db, { snapshots })), 'bbc').matchCount).toBe(3);
    db.close();
  });

  it('reports no change instant for a source whose items have never changed', () => {
    const db = seeded([anRssSpec()], [anItemRecord()]);
    expect(healthOfSource(build(rowsOf(db)), 'bbc').lastChangeAt).toBeNull();
    db.close();
  });

  it('marks a 304 poll as no match count, instead of inventing a zero', () => {
    const db = openDb();
    addSource(db, anRssSpec({ matchCount: 30 }));
    addSnapshot(db, aSnapshot({ outcome: 'not-modified', bytes: 0, itemCount: null }));
    expect(healthOfSource(build(rowsOf(db)), 'bbc').matchCount).toBeNull();
    db.close();
  });
});
