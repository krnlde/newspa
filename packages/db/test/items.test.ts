/**
 * The items repository: the upsert that must not lose `first_seen_at` or the
 * read marker, the additive edit count, and the server-only body.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ITEM_LIMIT, ItemKeyError, type ItemRecord, MAX_ITEM_LIMIT } from '../src/index.ts';
import { anItem, HTML_SPEC, openTestDatabase, RSS_SPEC, seed } from './support.ts';

const withItems = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  seed(db);
  return db;
};

const edited = (over: Partial<ItemRecord> = {}): ItemRecord =>
  anItem({
    key: 'rss-one:1',
    sourceId: RSS_SPEC.id,
    title: 'Central bank cuts rates',
    body: 'The bank cut rates by 25bp. Analysts expected a hold.',
    lastSeenAt: '2026-11-09T07:30:00Z',
    lastChangedAt: '2026-11-09T07:30:00Z',
    editCount: 1,
    scoreRealtime: 18,
    scoreDigest: 14,
    ...over,
  });

describe('items: the round trip', () => {
  it('reads a section column that is NULL as null, not as an empty string', () => {
    // The column is nullable: a row written before sections existed, or by an
    // older build, has to read back as "no section", never as ''.
    const db = withItems();
    db.tx.exec('update items set section = null');
    expect(db.items.read(RSS_SPEC.id, 'rss-one:1')).toEqual({ key: 'rss-one:1', item: anItem(), section: null });
    expect(db.items.count({ section: 'world' })).toBe(0);
    db.close();
  });
  it('returns the record it was given, section and all', () => {
    const db = withItems();
    expect(db.items.itemOf(RSS_SPEC.id, 'rss-one:1')).toEqual(anItem());
    expect(db.items.read(RSS_SPEC.id, 'rss-one:1')).toEqual({ key: 'rss-one:1', item: anItem(), section: 'world' });
    expect(db.items.find(RSS_SPEC.id, 'rss-one:1').title).toBe('Central bank holds rates');
    expect(db.items.count()).toBe(2);
    expect(db.items.count({ sourceId: RSS_SPEC.id })).toBe(1);
    expect(db.items.count({ section: 'opinion' })).toBe(1);
    expect(db.items.countBySource()).toEqual([
      { sourceId: HTML_SPEC.id, count: 1 },
      { sourceId: RSS_SPEC.id, count: 1 },
    ]);
    db.close();
  });

  it('keeps `body` off the record the browser gets, and reachable only through `bodyOf`', () => {
    const db = withItems();
    expect(db.items.bodyOf(RSS_SPEC.id, 'rss-one:1')).toContain('Analysts expected a cut.');
    expect(db.items.itemOf(RSS_SPEC.id, 'rss-one:1')?.body).toContain('Analysts expected a cut.');
    const columns = db.tx.all("select name from pragma_table_info ('items')").map((r) => String(r['name']));
    expect(columns).toContain('body');
    expect(columns).toContain('section');
    expect(columns).toContain('read_at');
    expect(Object.keys(db.items.find(RSS_SPEC.id, 'rss-one:1')).sort()).toEqual(
      [
        'author',
        'body',
        'editCount',
        'firstSeenAt',
        'image',
        'key',
        'kind',
        'lastChangedAt',
        'lastSeenAt',
        'link',
        'publishedAt',
        'readAt',
        'scoreDigest',
        'scoreRealtime',
        'sourceId',
        'summary',
        'title',
      ].sort(),
    );
    db.close();
  });

  it('answers the three-way read, and keeps `section` out of the JSON', () => {
    const db = withItems();
    expect(db.items.read(RSS_SPEC.id, 'nope')).toEqual({ key: 'nope', item: undefined, section: undefined });
    db.items.setSection(RSS_SPEC.id, 'rss-one:1', '');
    expect(db.items.read(RSS_SPEC.id, 'rss-one:1')).toEqual({ key: 'rss-one:1', item: anItem(), section: '' });
    db.items.setSection(RSS_SPEC.id, 'rss-one:1', 'business');
    expect(db.items.read(RSS_SPEC.id, 'rss-one:1')?.section).toBe('business');
    expect(db.items.list({ section: 'business' }).map((i) => i.key)).toEqual(['rss-one:1']);
    expect(db.items.list({ section: 'world' })).toEqual([]);
    db.close();
  });

  it('names the item, and both keys, when a lookup finds nothing', () => {
    const db = withItems();
    expect(db.items.itemOf(RSS_SPEC.id, 'nope')).toBeUndefined();
    expect(() => db.items.find(RSS_SPEC.id, 'nope')).toThrow(ItemKeyError);
    expect(() => db.items.find(RSS_SPEC.id, 'nope')).toThrow('item "nope" of source "rss-one": no such item');
    expect(() => db.items.bodyOf(RSS_SPEC.id, 'nope')).toThrow(ItemKeyError);
    expect(() => db.items.setRead(RSS_SPEC.id, 'nope', '2026-11-09T08:00:00Z')).toThrow(ItemKeyError);
    expect(() => db.items.isRead(RSS_SPEC.id, 'nope')).toThrow(ItemKeyError);
    db.close();
  });
});

describe('items: re-seen, edited, read', () => {
  it('keeps `first_seen_at` and `read_at` across an upsert, and moves the rest', () => {
    const db = withItems();
    db.items.setRead(RSS_SPEC.id, 'rss-one:1', '2026-11-09T08:00:00Z');
    db.items.upsert({ item: edited(), section: 'world' });

    const stored = db.items.find(RSS_SPEC.id, 'rss-one:1');
    expect(stored.firstSeenAt).toBe('2026-11-09T06:05:00Z');
    expect(stored.readAt).toBe('2026-11-09T08:00:00Z');
    expect(stored.lastSeenAt).toBe('2026-11-09T07:30:00Z');
    expect(stored.title).toBe('Central bank cuts rates');
    expect(stored.scoreRealtime).toBe(18);
    expect(db.items.count()).toBe(2);
    db.close();
  });

  it('adds the edit count, and never clears the moment an item changed', () => {
    const db = withItems();
    expect(db.items.find(RSS_SPEC.id, 'rss-one:1').editCount).toBe(0);
    expect(db.items.find(RSS_SPEC.id, 'rss-one:1').lastChangedAt).toBeNull();

    db.items.upsert({ item: edited(), section: 'world' });
    expect(db.items.find(RSS_SPEC.id, 'rss-one:1').editCount).toBe(1);
    expect(db.items.find(RSS_SPEC.id, 'rss-one:1').lastChangedAt).toBe('2026-11-09T07:30:00Z');

    db.items.upsert({
      item: edited({ lastChangedAt: null, editCount: 2, lastSeenAt: '2026-11-09T09:00:00Z' }),
      section: 'world',
    });
    const stored = db.items.find(RSS_SPEC.id, 'rss-one:1');
    expect(stored.editCount).toBe(3);
    expect(stored.lastChangedAt).toBe('2026-11-09T07:30:00Z');
    expect(stored.lastSeenAt).toBe('2026-11-09T09:00:00Z');
    db.close();
  });

  it('marks read, unreads, and answers the question the paper asks', () => {
    const db = withItems();
    expect(db.items.isRead(RSS_SPEC.id, 'rss-one:1')).toBe(false);
    db.items.setRead(RSS_SPEC.id, 'rss-one:1', '2026-11-09T08:00:00Z');
    expect(db.items.isRead(RSS_SPEC.id, 'rss-one:1')).toBe(true);
    expect(db.items.list({ unreadOnly: true }).map((i) => i.key)).toEqual(['html-two:1']);
    db.items.setRead(RSS_SPEC.id, 'rss-one:1', null);
    expect(db.items.isRead(RSS_SPEC.id, 'rss-one:1')).toBe(false);
    expect(db.items.list({ unreadOnly: true }).length).toBe(2);
    db.close();
  });

  it('filters and pages by the columns it has, newest seen first', () => {
    const db = withItems();
    expect(db.items.list().map((i) => i.key)).toEqual(['html-two:1', 'rss-one:1']);
    expect(db.items.list({ sourceId: RSS_SPEC.id }).map((i) => i.key)).toEqual(['rss-one:1']);
    expect(db.items.list({ since: '2026-11-09T06:10:00Z' }).map((i) => i.key)).toEqual(['html-two:1']);
    expect(db.items.list({ limit: 1 }).map((i) => i.key)).toEqual(['html-two:1']);
    expect(db.items.list({ limit: 1, offset: 1 }).map((i) => i.key)).toEqual(['rss-one:1']);
    expect(db.items.list({ limit: 5_000 }).length).toBe(2);
    expect(db.items.list({ offset: -3 }).length).toBe(2);
    db.close();
  });

  it('publishes the limits the paper is built around, and clamps to them', () => {
    expect(DEFAULT_ITEM_LIMIT).toBe(200);
    expect(MAX_ITEM_LIMIT).toBe(500);
    const db = openTestDatabase();
    seed(db);
    for (let i = 0; i < 3; i += 1) {
      db.items.upsert({
        item: anItem({ key: `rss-one:${10 + i}`, link: `https://one.example/${10 + i}`, publishedAt: null }),
        section: 'world',
      });
    }
    expect(db.items.list({ limit: 0 }).length).toBe(1);
    expect(db.items.list({ limit: 2.7 }).length).toBe(2);
    db.close();
  });

  it('wraps a constraint failure with both keys, and keeps the cause', () => {
    const db = withItems();
    expect(() => db.items.upsert({ item: anItem({ sourceId: 'nosuch', key: 'nosuch:1' }), section: 'world' })).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
    // The CHECK is the boundary; `ItemRecord.kind` cannot spell 'atom', so the
    // foreign kind enters the way a bad row would: through a cast at the edge.
    const foreign = { ...anItem(), kind: 'atom' } as unknown as ItemRecord;
    expect(() => db.items.upsert({ item: foreign, section: 'world' })).toThrow(/CHECK constraint/i);
    try {
      db.items.upsert({ item: anItem({ sourceId: 'nosuch', key: 'nosuch:1' }), section: 'world' });
      expect.unreachable('an item without a source was accepted');
    } catch (cause) {
      const error = cause as ItemKeyError;
      expect(error.name).toBe('ItemKeyError');
      expect(error.message).toContain('nosuch:1');
      expect(error.message).toContain('FOREIGN KEY');
    }
    db.close();
  });

  it('deletes an item with its source, because the paper can drop a source', () => {
    const db = withItems();
    db.tx.run('delete from sources where id = ?', RSS_SPEC.id);
    expect(db.items.count()).toBe(1);
    expect(db.items.list({ sourceId: RSS_SPEC.id })).toEqual([]);
    db.close();
  });
});
