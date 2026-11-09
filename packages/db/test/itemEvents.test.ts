/**
 * The event log: ids that never come back, a batch that is all-or-nothing, and
 * an edit report that survives JSON.
 */

import type { EditReport } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_LIMIT, ItemEventError, MAX_EVENT_LIMIT, RowShapeError } from '../src/index.ts';
import { anEvent, openTestDatabase, RSS_SPEC, seed } from './support.ts';

const REPORT: EditReport = {
  ops: [
    { type: 'equal', text: 'The bank ' },
    { type: 'delete', text: 'kept' },
    { type: 'insert', text: 'cut' },
    { type: 'equal', text: ' rates' },
  ],
  added: 1,
  removed: 1,
  similarity: 0.78,
  meaningful: true,
};

const seeded = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  seed(db);
  return db;
};

const withEvents = (): ReturnType<typeof openTestDatabase> => {
  const db = seeded();
  db.itemEvents.insert(
    anEvent({ kind: 'edited', at: '2026-11-09T07:30:00Z', title: 'Central bank cuts rates', report: REPORT }),
  );
  db.itemEvents.insert(
    anEvent({
      itemKey: 'html-two:1',
      sourceId: 'html-two',
      kind: 'gone',
      at: '2026-11-09T08:00:00Z',
      link: 'https://two.example/x',
      score: 4,
      report: null,
    }),
  );
  return db;
};

describe('item_events: writing', () => {
  it('returns the id of the row it wrote', () => {
    const db = seeded();
    expect(db.itemEvents.insert(anEvent())).toBe(2);
    expect(db.itemEvents.count()).toBe(2);
    db.close();
  });

  it('reads the event back with every field, in newest-first order', () => {
    const db = withEvents();
    const recent = db.itemEvents.listRecent();
    expect(recent.map((e) => e.at)).toEqual(['2026-11-09T08:00:00Z', '2026-11-09T07:30:00Z', '2026-11-09T06:05:00Z']);
    expect(recent[0]).toEqual({
      id: 3,
      sourceId: 'html-two',
      itemKey: 'html-two:1',
      kind: 'gone',
      at: '2026-11-09T08:00:00Z',
      title: 'Central bank holds rates',
      link: 'https://two.example/x',
      score: 4,
      report: null,
    });
    expect(recent[1]?.report).toEqual(REPORT);
    expect(recent[1]?.id).toBe(2);
    db.close();
  });

  it('gives ids that never come back, even after the log is emptied', () => {
    const db = withEvents();
    expect(db.itemEvents.listRecent().map((e) => e.id)).toEqual([3, 2, 1]);
    db.tx.run('delete from item_events');
    expect(db.itemEvents.count()).toBe(0);
    expect(db.itemEvents.insert(anEvent())).toBeGreaterThan(3);
    expect(db.itemEvents.insert(anEvent({ at: '2026-11-09T09:00:00Z' }))).toBeGreaterThan(4);
    db.close();
  });

  it('names the source, the item and the constraint when a write fails', () => {
    const db = seeded();
    expect(() => db.itemEvents.insert(anEvent({ sourceId: 'nosuch', itemKey: 'nosuch:1' }))).toThrow(ItemEventError);
    expect(() => db.itemEvents.insert(anEvent({ sourceId: 'nosuch', itemKey: 'nosuch:1' }))).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
    expect(() => db.itemEvents.insert(anEvent({ kind: 'removed' as never }))).toThrow(/CHECK constraint/i);
    try {
      db.itemEvents.insert(anEvent({ sourceId: 'nosuch', itemKey: 'nosuch:1' }));
      expect.unreachable('an event without an item was accepted');
    } catch (cause) {
      const error = cause as ItemEventError;
      expect(error.name).toBe('ItemEventError');
      expect(error.message).toContain('nosuch');
      expect(error.message).toContain('FOREIGN KEY');
    }
    db.close();
  });

  it('writes a batch, and leaves nothing behind when one event in it fails', () => {
    const db = seeded();
    const ids = db.itemEvents.insertMany([
      anEvent({ kind: 'new' }),
      anEvent({ kind: 'edited', at: '2026-11-09T07:30:00Z', report: REPORT }),
    ]);
    expect(ids).toEqual([2, 3]);

    expect(() =>
      db.itemEvents.insertMany([
        anEvent({ kind: 'gone', at: '2026-11-09T08:00:00Z' }),
        anEvent({ sourceId: 'nosuch', itemKey: 'nosuch:1', at: '2026-11-09T08:05:00Z' }),
      ]),
    ).toThrow(ItemEventError);
    expect(db.itemEvents.count()).toBe(3);
    expect(db.itemEvents.insertMany([])).toEqual([]);
    db.close();
  });
});

describe('item_events: the paper’s reads', () => {
  it('filters by source, kind and time, and the limit is a ceiling', () => {
    const db = withEvents();
    expect(db.itemEvents.listRecent({ sourceId: RSS_SPEC.id }).map((e) => e.itemKey)).toEqual([
      'rss-one:1',
      'rss-one:1',
    ]);
    expect(db.itemEvents.listRecent({ kind: 'gone' })).toHaveLength(1);
    expect(db.itemEvents.listRecent({ kind: 'new' })).toHaveLength(1);
    expect(db.itemEvents.listRecent({ since: '2026-11-09T07:31:00Z' })).toHaveLength(1);
    expect(db.itemEvents.listRecent({ limit: 2 })).toHaveLength(2);
    expect(db.itemEvents.listRecent({ limit: 10_000 })).toHaveLength(3);
    expect(db.itemEvents.listRecent({ limit: 0 })).toHaveLength(1);
    expect(db.itemEvents.count({ sourceId: RSS_SPEC.id })).toBe(2);
    expect(db.itemEvents.count({ kind: 'edited' })).toBe(1);
    expect(db.itemEvents.count({ sourceId: RSS_SPEC.id, kind: 'new', since: '2026-11-09T06:00:00Z' })).toBe(1);
    expect(db.itemEvents.count()).toBe(3);
    db.close();
  });

  it('answers “what happened to this item?” with its own newest-first order', () => {
    const db = withEvents();
    const history = db.itemEvents.listForItem(RSS_SPEC.id, 'rss-one:1');
    expect(history.map((e) => e.kind)).toEqual(['edited', 'new']);
    expect(history[0]?.report).toEqual(REPORT);
    expect(db.itemEvents.listForItem(RSS_SPEC.id, 'rss-one:1', 1).map((e) => e.kind)).toEqual(['edited']);
    expect(db.itemEvents.listForItem(RSS_SPEC.id, 'nothing')).toEqual([]);
    db.close();
  });

  it('publishes the limit the brief sets, and clamps to it', () => {
    expect(DEFAULT_EVENT_LIMIT).toBe(100);
    expect(MAX_EVENT_LIMIT).toBe(200);
    const db = openTestDatabase();
    seed(db);
    for (let i = 0; i < 5; i += 1) {
      db.itemEvents.insert(anEvent({ at: `2026-11-09T0${i}:00:00Z` }));
    }
    expect(db.itemEvents.listRecent({ limit: 2.5 })).toHaveLength(2);
    expect(db.itemEvents.listRecent({ limit: 600 })).toHaveLength(6);
    db.close();
  });

  it('reports a report the schema refuses, and names the column and the event', () => {
    const db = seeded();
    const id = db.itemEvents.insert(anEvent({ report: REPORT }));
    db.tx.run('update item_events set report_json = ? where id = ?', '{}', id);
    expect(() => db.itemEvents.listRecent()).toThrow(RowShapeError);
    expect(() => db.itemEvents.listRecent()).toThrow(/report_json/i);
    expect(() => db.itemEvents.listForItem(RSS_SPEC.id, 'rss-one:1')).toThrow(/report_json/i);
    // The door keeps non-JSON and non-objects out, so a row that reaches the
    // reader is JSON; a reader failure is a schema failure, and it is reported.
    expect(() => db.tx.run('update item_events set report_json = ? where id = ?', 'not json', id)).toThrow(
      /CHECK constraint/i,
    );
    expect(() => db.tx.run('update item_events set report_json = ? where id = ?', '[1,2]', id)).toThrow(
      /CHECK constraint/i,
    );
    db.close();
  });

  it('deletes an item’s events with the item, and the item with its source', () => {
    const db = withEvents();
    expect(db.itemEvents.count()).toBe(3);
    db.tx.run('delete from items where source_id = ? and key = ?', RSS_SPEC.id, 'rss-one:1');
    expect(db.itemEvents.listForItem(RSS_SPEC.id, 'rss-one:1')).toEqual([]);
    expect(db.itemEvents.count()).toBe(1);
    db.tx.run('delete from sources where id = ?', RSS_SPEC.id);
    expect(db.itemEvents.count()).toBe(1);
    expect(db.itemEvents.listRecent({ sourceId: 'html-two' })).toHaveLength(1);
    db.close();
  });
});
