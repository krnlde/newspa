/**
 * The composed path, from events to the read budget: the parts of `stateOf`'s
 * output that come from folding the event, snapshot and count rows it read.
 *
 * The budget test is the one that keeps rule 4 honest: the repositories are real
 * and wrapped to count, so a query per item shows up as a number, and opening
 * the stored body (`bodyOf`) shows up as a number too (D-017).
 */

import { stateResponseSchema } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { stateOf } from '../src/state.ts';
import {
  addEvent,
  addItem,
  addSnapshot,
  addSource,
  aJsonSpec,
  anEvent,
  anHtmlSpec,
  anItemRecord,
  anRssSpec,
  aSnapshot,
  DECK,
  FIXED,
  healthOfSource,
  openDb,
  stateOfDb,
  wireItem,
} from './support.ts';
import { countedDeps } from './supportReads.ts';

const sourceIdOf = (key: string): string => key.slice(0, key.indexOf(':'));

describe('events', () => {
  it('reports no event as three nulls, not as a fabricated `new`', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addItem(db, anItemRecord({ key: 'bbc:silent', summary: DECK }));
    const view = wireItem(stateOfDb(db), 'bbc', 'bbc:silent');
    expect([view.lastEventKind, view.lastEventAt, view.lastReport]).toEqual([null, null, null]);
    db.close();
  });

  it('reports the newest event, with the report decoded out of the JSON column', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addItem(db, anItemRecord({ key: 'bbc:moved', summary: DECK, editCount: 1, lastChangedAt: '2026-11-09T08:00:00Z' }));
    addEvent(db, anEvent({ itemKey: 'bbc:moved', kind: 'new', at: '2026-11-09T06:05:00Z' }));
    addEvent(
      db,
      anEvent({
        itemKey: 'bbc:moved',
        kind: 'edited',
        at: '2026-11-09T08:00:00Z',
        report: {
          ops: [
            { type: 'delete', text: 'hold' },
            { type: 'insert', text: 'cut' },
          ],
          added: 4,
          removed: 2,
          similarity: 0.75,
          meaningful: true,
        },
      }),
    );
    const view = wireItem(stateOfDb(db), 'bbc', 'bbc:moved');
    expect(view.lastEventKind).toBe('edited');
    expect(view.lastEventAt).toBe('2026-11-09T08:00:00Z');
    expect(view.lastReport?.added).toBe(4);
    expect(view.lastReport?.removed).toBe(2);
    expect(view.lastReport?.similarity).toBe(0.75);
    expect(view.lastReport?.ops).toHaveLength(2);
    db.close();
  });
});

describe('sections, the lead and the stats', () => {
  it('prints the declared section, routes the ladder, leads with the highest score, counts the strip', () => {
    const db = openDb();
    addSource(db, anRssSpec({ section: 'Software' }), { health: 'ok', lastPolledAt: FIXED.toISOString() });
    addSource(db, anHtmlSpec({ id: 'globe', label: 'Globe World' }), {
      health: 'blocked',
      lastPolledAt: FIXED.toISOString(),
    });
    addSource(db, aJsonSpec({ id: 'api', label: 'API' }), { health: 'no-matches' });
    addItem(db, anItemRecord({ key: 'bbc:soft', summary: DECK, scoreRealtime: 14 }));
    addItem(
      db,
      anItemRecord({
        key: 'globe:1',
        sourceId: 'globe',
        kind: 'html',
        link: 'https://globe.example/1',
        summary: DECK,
        scoreRealtime: 6,
        editCount: 1,
      }),
    );
    const state = stateOfDb(db);
    expect(state.edition.sections.map((section) => [section.id, section.title])).toEqual([
      ['software', 'Software'],
      ['world', 'World'],
    ]);
    expect(state.edition.lead?.key).toBe('bbc:soft');
    expect(state.edition.edited.map((item) => item.key)).toEqual(['globe:1']);
    expect(state.edition.stats).toEqual({
      items: 2,
      newItems: 1,
      editedItems: 1,
      sourcesFetched: 2,
      // Rule 5: `blocked` and `no-matches` are counted, `ok` is not.
      sourcesUnhealthy: 2,
      cycles: 0,
    });
    db.close();
  });

  it('counts cycles from the snapshot table, and a 304 poll as no match count', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addSnapshot(db, aSnapshot());
    addSnapshot(db, aSnapshot({ takenAt: '2026-11-09T06:20:00Z', outcome: 'not-modified', bytes: 0, itemCount: null }));
    const state = stateOfDb(db);
    expect(state.edition.stats.cycles).toBe(2);
    expect(state.edition.stats.cycles).toBe(db.snapshots.count());
    // A 304 counted nothing, so `matchCount` says so instead of inventing a zero.
    expect(healthOfSource(state, 'bbc').matchCount).toBeNull();
    db.close();
  });
});

describe('source health', () => {
  it('reports every source, counts items per source, and derives `lastChangeAt`', () => {
    const db = openDb();
    addSource(db, anRssSpec({ matchCount: 12 }), {
      health: 'no-matches',
      note: 'selector matched 0 of 12',
      lastStatus: 200,
      lastPolledAt: '2026-11-09T09:00:00Z',
    });
    addSource(db, anHtmlSpec({ id: 'off', label: 'Off', url: 'https://off.example/page', enabled: false }));
    addItem(db, anItemRecord({ key: 'bbc:old', summary: DECK, lastChangedAt: '2026-11-08T06:00:00Z' }));
    addItem(
      db,
      anItemRecord({
        key: 'bbc:new',
        summary: DECK,
        link: 'https://bbc.example/n',
        lastChangedAt: '2026-11-09T07:30:00Z',
      }),
    );
    addSnapshot(db, aSnapshot({ takenAt: '2026-11-09T06:00:00Z', itemCount: 12 }));
    addSnapshot(db, aSnapshot({ takenAt: '2026-11-09T09:00:00Z', itemCount: 0 }));

    const state = stateOfDb(db);
    expect(state.sources.map((source) => source.id)).toEqual(['bbc', 'off']);
    expect(healthOfSource(state, 'bbc')).toMatchObject({
      state: 'no-matches',
      note: 'selector matched 0 of 12',
      lastStatus: 200,
      lastFetchAt: '2026-11-09T09:00:00Z',
      expectedMatchCount: 12,
      // The newest snapshot's own count, not the older poll's 12.
      matchCount: 0,
      itemCount: 2,
      // Derived: `sources` has no `last_change_at` column.
      lastChangeAt: '2026-11-09T07:30:00Z',
    });
    // Rule 5: a source that is switched off is on the list, marked off.
    expect(healthOfSource(state, 'off')).toMatchObject({ enabled: false, itemCount: 0, state: 'unknown' });
    db.close();
  });
});

describe('the event-loop budget (rule 4)', () => {
  it('reads each table once, `last()` once per source, and the body never', () => {
    const db = openDb();
    for (const spec of [anRssSpec(), anHtmlSpec(), aJsonSpec()]) addSource(db, spec);
    for (const key of ['bbc:1', 'bbc:2', 'cards:1', 'hn:1'])
      addItem(
        db,
        anItemRecord({
          key,
          sourceId: sourceIdOf(key),
          link: `https://${sourceIdOf(key)}.example/${key}`,
          summary: DECK,
        }),
      );
    for (const key of ['bbc:1', 'cards:1', 'hn:1']) addEvent(db, anEvent({ itemKey: key, sourceId: sourceIdOf(key) }));
    for (const sourceId of ['bbc', 'cards', 'hn']) addSnapshot(db, aSnapshot({ sourceId }));

    const { deps, reads } = countedDeps(db);
    expect(stateResponseSchema.safeParse(stateOf(deps)).success).toBe(true);
    expect(reads()).toEqual({
      sources: 1,
      items: 1,
      bodyOf: 0,
      events: 1,
      itemCounts: 1,
      snapshotLast: 3,
      cycles: 1,
    });
    db.close();
  });
});
