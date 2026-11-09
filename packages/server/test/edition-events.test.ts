/**
 * The newest event per item, the sections, and the lead: the three things the
 * assembler derives by folding rows (one map per table, never a query per item).
 *
 * A missing event stays a missing event — three nulls, never a fabricated `new`.
 */

import type { Database } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import {
  addEvent,
  addItem,
  addSource,
  anEvent,
  anItemRecord,
  anRssSpec,
  build,
  DECK,
  openDb,
  rowsOf,
  seeded,
  wireItem,
} from './support.ts';

describe('the newest event per item', () => {
  const newThenEdited = (): Database => {
    const db = openDb();
    addSource(db, anRssSpec());
    addItem(
      db,
      anItemRecord({ key: 'bbc:edited', summary: DECK, editCount: 1, lastChangedAt: '2026-11-09T08:00:00Z' }),
    );
    addEvent(db, anEvent({ itemKey: 'bbc:edited', kind: 'new', at: '2026-11-09T06:05:00Z' }));
    addEvent(
      db,
      anEvent({
        itemKey: 'bbc:edited',
        kind: 'edited',
        at: '2026-11-09T08:00:00Z',
        report: {
          ops: [
            { type: 'equal', text: 'A' },
            { type: 'insert', text: 'B' },
          ],
          added: 3,
          removed: 1,
          similarity: 0.8,
          meaningful: true,
        },
      }),
    );
    return db;
  };

  it('is null on all three fields when the item has no event row', () => {
    const db = seeded([anRssSpec()], [anItemRecord({ key: 'bbc:none' })]);
    const view = wireItem(build(rowsOf(db)), 'bbc', 'bbc:none');
    expect([view.lastEventKind, view.lastEventAt, view.lastReport]).toEqual([null, null, null]);
    db.close();
  });

  it('wins with the newest event, decoded report and all, in either row order', () => {
    const db = newThenEdited();
    // `listRecent` is newest-first; `listForItem(...).reverse()` is oldest-first.
    // The fold must produce the same winner from both, because a caller is allowed
    // to hand rows in any order (retention deletes rows; a poll writes two events).
    const oldestFirst = db.itemEvents.listForItem('bbc', 'bbc:edited').reverse();
    for (const events of [db.itemEvents.listRecent(), oldestFirst]) {
      const view = wireItem(build(rowsOf(db, { events })), 'bbc', 'bbc:edited');
      expect(view.lastEventKind).toBe('edited');
      expect(view.lastEventAt).toBe('2026-11-09T08:00:00Z');
      expect(view.lastReport?.added).toBe(3);
      expect(view.lastReport?.removed).toBe(1);
      expect(view.lastReport?.ops.map((op) => op.text)).toEqual(['A', 'B']);
    }
    db.close();
  });

  it('breaks a tie on `at` by id, so two events at one instant still order', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addItem(db, anItemRecord({ key: 'bbc:tie', summary: DECK, editCount: 1 }));
    addEvent(db, anEvent({ itemKey: 'bbc:tie', kind: 'new', at: '2026-11-09T07:00:00Z' }));
    addEvent(db, anEvent({ itemKey: 'bbc:tie', kind: 'edited', at: '2026-11-09T07:00:00Z' }));
    const ascending = db.itemEvents.listForItem('bbc', 'bbc:tie').reverse();
    expect(wireItem(build(rowsOf(db, { events: ascending })), 'bbc', 'bbc:tie').lastEventKind).toBe('edited');
    expect(wireItem(build(rowsOf(db)), 'bbc', 'bbc:tie').lastEventKind).toBe('edited');
    db.close();
  });

  it('keys an event by source and item, so the same key in two sources stays two items', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addSource(db, anRssSpec({ id: 'wire', label: 'World Wire', url: 'https://wire.example/feed.xml' }));
    addItem(db, anItemRecord({ key: 'shared', sourceId: 'bbc' }));
    addItem(db, anItemRecord({ key: 'shared', sourceId: 'wire', link: 'https://wire.example/shared' }));
    addEvent(db, anEvent({ sourceId: 'bbc', itemKey: 'shared', kind: 'gone', at: '2026-11-09T07:00:00Z' }));
    const state = build(rowsOf(db));
    expect(wireItem(state, 'bbc', 'shared').lastEventKind).toBe('gone');
    expect(wireItem(state, 'wire', 'shared').lastEventKind).toBeNull();
    db.close();
  });
});

describe('sections, and the lead', () => {
  it('prints a declared section under the reader’s own words', () => {
    const db = seeded([anRssSpec({ section: 'Software' })], [anItemRecord({ summary: DECK })]);
    const state = build(rowsOf(db));
    expect(state.edition.sections.map((section) => [section.id, section.title])).toEqual([['software', 'Software']]);
    expect(state.edition.sections[0]?.blurb).toBe(DECK);
    expect(state.edition.lead?.key).toBe('bbc:h1');
    db.close();
  });

  it('routes an undeclared source by the ladder, and leads with the highest score', () => {
    const db = seeded(
      [anRssSpec({ id: 'wire', label: 'World Wire', url: 'https://wire.example/feed.xml' })],
      [
        anItemRecord({ key: 'wire:low', sourceId: 'wire', scoreRealtime: 3, summary: DECK }),
        anItemRecord({ key: 'wire:high', sourceId: 'wire', scoreRealtime: 14, summary: DECK }),
      ],
    );
    const state = build(rowsOf(db));
    expect(state.edition.sections.map((section) => [section.id, section.title])).toEqual([['world', 'World']]);
    expect(state.edition.lead?.key).toBe('wire:high');
    expect(state.edition.sections[0]?.items.map((item) => item.score)).toEqual([14, 3]);
    db.close();
  });

  it('orders sections by the score they carry, and puts every edited item in `edited`', () => {
    const db = seeded(
      [
        anRssSpec({ section: 'Software' }),
        anRssSpec({ id: 'wire', label: 'World Wire', url: 'https://wire.example/feed.xml' }),
      ],
      [
        anItemRecord({ key: 'bbc:soft', summary: DECK, scoreRealtime: 5 }),
        anItemRecord({
          key: 'wire:top',
          sourceId: 'wire',
          link: 'https://wire.example/top',
          scoreRealtime: 16,
          summary: DECK,
          editCount: 2,
        }),
      ],
    );
    const state = build(rowsOf(db));
    expect(state.edition.sections.map((section) => section.title)).toEqual(['World', 'Software']);
    expect(state.edition.lead?.sourceId).toBe('wire');
    expect(state.edition.edited.map((item) => item.key)).toEqual(['wire:top']);
    db.close();
  });
});
