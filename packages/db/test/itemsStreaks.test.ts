/**
 * The disappearance ladder's storage (D-029): the read that is **not a page**,
 * the write that answers with a count, and migration 4's two columns.
 *
 * The pins are the ones the ladder's contract depends on: a fresh row is "never
 * missed"; the read sees every key of a source, because `items.list` is a page
 * of 200 and "not on this page" is not "gone" (rule 5, and the comment in
 * `packages/server/src/pollItems.ts`); and a write is scoped to its source,
 * because a key is only unique inside one.
 */
import { GONE_AFTER_POLLS, type GoneVerdict, goneVerdicts, type StoredKey } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  type Database,
  DEFAULT_ITEM_LIMIT,
  type ItemRecord,
  MIGRATIONS,
  RowShapeError,
  type StoredKeyRow,
  type StreakWrite,
} from '../src/index.ts';
import { anItem, FIXED, HTML_SPEC, JSON_SPEC, later, openTestDatabase, RSS_SPEC, seed, tempFile } from './support.ts';

const CREATED = '2026-11-01T00:00:00Z';
const STAMP = '2026-11-09T10:00:00Z';

const seededDb = (): Database => {
  const db = openTestDatabase();
  seed(db);
  return db;
};

/** Three sources, no items: a count of stored keys is then a count of writes. */
const oneSource = (): Database => {
  const db = openTestDatabase();
  db.sources.insert(RSS_SPEC, CREATED);
  db.sources.insert(HTML_SPEC, CREATED);
  db.sources.insert(JSON_SPEC, CREATED);
  return db;
};

const rowOf = (db: Database, sourceId: string, key: string): StoredKeyRow | undefined =>
  db.items.storedKeys(sourceId).find((row) => row.key === key);

/** `n` items in one source, all first seen at the same instant. */
const bulk = (db: Database, sourceId: string, kind: ItemRecord['kind'], n: number): void => {
  for (let index = 0; index < n; index += 1) {
    db.items.upsert({
      item: anItem({ key: `bulk-${String(index)}`, sourceId, kind, link: `https://one.example/${String(index)}` }),
      section: 'world',
    });
  }
};

describe('the ladder reads every stored key of a source', () => {
  it('reads a fresh row as never missed: streak 0, no gone stamp', () => {
    const db = seededDb();
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toEqual({
      key: 'rss-one:1',
      title: 'Central bank holds rates',
      link: 'https://one.example/a',
      scoreRealtime: 12,
      missingStreak: 0,
      goneAt: null,
    });
    db.close();
  });

  it('carries the fields a `gone` event needs, and never the scrape', () => {
    const db = seededDb();
    // Exactly these six keys: the event is built from `title`/`link`/`scoreRealtime`,
    // and `body` is the widest column in the database (rule 7).
    expect(db.items.storedKeys(RSS_SPEC.id).map((row) => Object.keys(row).sort())).toEqual([
      ['goneAt', 'key', 'link', 'missingStreak', 'scoreRealtime', 'title'],
    ]);
    expect(db.items.bodyOf(RSS_SPEC.id, 'rss-one:1')).toContain('Analysts expected a cut.');
    db.close();
  });

  it('is not a page: 250 stored keys, where the read side would return 200', () => {
    const db = oneSource();
    bulk(db, RSS_SPEC.id, 'rss', 250);
    expect(db.items.count({ sourceId: RSS_SPEC.id })).toBe(250);
    expect(db.items.list({ sourceId: RSS_SPEC.id }).length).toBe(DEFAULT_ITEM_LIMIT);
    const keys = db.items.storedKeys(RSS_SPEC.id).map((row) => row.key);
    expect(keys).toHaveLength(250);
    expect(new Set(keys).size).toBe(250);
    db.close();
  });

  it('is scoped to one source, and excludes another source’s rows', () => {
    const db = seededDb();
    expect(db.items.storedKeys(HTML_SPEC.id).map((row) => row.key)).toEqual(['html-two:1']);
    expect(db.items.storedKeys(JSON_SPEC.id)).toEqual([]);
    expect(db.items.storedKeys('no-such-source')).toEqual([]);
    db.close();
  });

  it('walks a stable order — first seen, then key — so a caller can assert a list', () => {
    const db = oneSource();
    for (const [key, at] of [
      ['k-b', '2026-11-09T06:00:00Z'],
      ['k-c', '2026-11-09T05:00:00Z'],
      ['k-a', '2026-11-09T06:00:00Z'],
    ] as [string, string][]) {
      db.items.upsert({ item: anItem({ key, link: `https://one.example/${key}`, firstSeenAt: at }), section: 'world' });
    }
    expect(db.items.storedKeys(RSS_SPEC.id).map((row) => row.key)).toEqual(['k-c', 'k-a', 'k-b']);
    db.close();
  });

  it('names the column and the key when a streak column holds a foreign shape', () => {
    const db = seededDb();
    const corrupt = (column: string, value: string): void => {
      db.tx.run(`update items set ${column} = ? where source_id = ? and key = ?`, value, RSS_SPEC.id, 'rss-one:1');
    };
    // Integer affinity does not reject text it cannot convert (measured), so the
    // decoder is the boundary, and it names the column and the key (rule 5).
    corrupt('missing_streak', 'not-a-number');
    expect(() => db.items.storedKeys(RSS_SPEC.id)).toThrow(RowShapeError);
    expect(() => db.items.storedKeys(RSS_SPEC.id)).toThrow(
      'column "missing_streak" for rss-one/rss-one:1 (missing_streak)',
    );
    corrupt('missing_streak', '0');
    corrupt('score_realtime', 'high');
    expect(() => db.items.storedKeys(RSS_SPEC.id)).toThrow(/score_realtime/);
    db.close();
  });
});

describe('markStreaks writes the verdicts', () => {
  const oneVerdict = (): StreakWrite[] => [{ key: 'rss-one:1', streak: 3, goneAt: STAMP }];

  it('writes the streak and the stamp, reads them back, and returns the rows written', () => {
    const db = seededDb();
    expect(db.items.markStreaks(RSS_SPEC.id, oneVerdict())).toBe(1);
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toEqual({
      key: 'rss-one:1',
      title: 'Central bank holds rates',
      link: 'https://one.example/a',
      scoreRealtime: 12,
      missingStreak: 3,
      goneAt: STAMP,
    });
    db.close();
  });

  it('leaves a row it did not name, and the same key under another source', () => {
    const db = seededDb();
    // The same key in another source: `items` is keyed `(source_id, key)`, so an
    // unscoped update would write 2 rows and touch `html-two`.
    db.items.upsert({ item: anItem({ key: 'rss-one:1', sourceId: HTML_SPEC.id, kind: 'html' }), section: 'opinion' });
    db.items.upsert({ item: anItem({ key: 'rss-one:2', link: 'https://one.example/2' }), section: 'world' });
    expect(db.items.markStreaks(RSS_SPEC.id, [{ key: 'rss-one:1', streak: 1, goneAt: STAMP }])).toBe(1);
    expect(rowOf(db, HTML_SPEC.id, 'rss-one:1')).toMatchObject({ missingStreak: 0, goneAt: null });
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:2')).toMatchObject({ missingStreak: 0, goneAt: null });
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toMatchObject({ missingStreak: 1, goneAt: STAMP });
    db.close();
  });

  it('clears a stored stamp — the reopen arm of core’s ladder', () => {
    const db = seededDb();
    db.items.markStreaks(RSS_SPEC.id, oneVerdict());
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toMatchObject({ missingStreak: 3, goneAt: STAMP });
    expect(db.items.markStreaks(RSS_SPEC.id, [{ key: 'rss-one:1', streak: 0, goneAt: null }])).toBe(1);
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toMatchObject({ missingStreak: 0, goneAt: null });
    db.close();
  });

  it('survives the poll’s own upsert: re-seeing a key does not reset its streak', () => {
    const db = seededDb();
    db.items.markStreaks(RSS_SPEC.id, oneVerdict());
    // The upsert names 18 columns; the two streak columns are not among them, so
    // the ladder's state is not the write path's to clear (D-029).
    db.items.upsert({ item: anItem({ title: 'Central bank holds rates, again' }), section: 'world' });
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toMatchObject({
      title: 'Central bank holds rates, again',
      missingStreak: 3,
      goneAt: STAMP,
    });
    db.close();
  });

  it('writes nothing for an empty verdict list, and returns 0', () => {
    const db = seededDb();
    expect(db.items.markStreaks(RSS_SPEC.id, [])).toBe(0);
    expect(db.items.markStreaks('no-such-source', [])).toBe(0);
    expect(db.items.storedKeys(RSS_SPEC.id).map((row) => [row.missingStreak, row.goneAt])).toEqual([[0, null]]);
    db.close();
  });

  it('counts the rows it wrote, not the verdicts it was given', () => {
    const db = seededDb();
    const written = db.items.markStreaks(RSS_SPEC.id, [
      { key: 'rss-one:1', streak: 1, goneAt: null },
      { key: 'rss-one:404', streak: 1, goneAt: STAMP },
    ]);
    expect(written).toBe(1);
    expect(db.items.storedKeys(RSS_SPEC.id).map((row) => row.missingStreak)).toEqual([1]);
    db.close();
  });
});

describe('the ladder, driven by core’s own arithmetic', () => {
  const stored = (db: Database): StoredKey[] => db.items.storedKeys(RSS_SPEC.id);
  const mark = (db: Database, verdicts: readonly GoneVerdict[], stamp: string | null): number =>
    db.items.markStreaks(
      RSS_SPEC.id,
      verdicts.map((verdict) => ({ key: verdict.key, streak: verdict.streak, goneAt: stamp })),
    );

  it('counts absent polls to the stamp, and clears it on the poll that sees the key again', () => {
    const db = seededDb();
    // The read is a legal input to core's ladder: `StoredKeyRow` is a `StoredKey`.
    for (let poll = 1; poll < GONE_AFTER_POLLS; poll += 1) {
      const verdicts = goneVerdicts(stored(db), new Set<string>());
      expect(verdicts.map((v) => [v.streak, v.newlyGone, v.reopened])).toEqual([[poll, false, false]]);
      expect(mark(db, verdicts, null)).toBe(1);
    }
    expect(stored(db).map((row) => [row.missingStreak, row.goneAt])).toEqual([[GONE_AFTER_POLLS - 1, null]]);

    // The poll that reaches K is the one that says so, and it stamps exactly once.
    const third = goneVerdicts(stored(db), new Set<string>());
    expect(third.map((v) => [v.streak, v.newlyGone])).toEqual([[GONE_AFTER_POLLS, true]]);
    expect(mark(db, third, STAMP)).toBe(1);
    expect(rowOf(db, RSS_SPEC.id, 'rss-one:1')).toMatchObject({ missingStreak: GONE_AFTER_POLLS, goneAt: STAMP });

    // Still absent: the streak counts on, and no second event fires for one door.
    const fourth = goneVerdicts(stored(db), new Set<string>());
    expect(fourth.map((v) => [v.streak, v.newlyGone, v.reopened])).toEqual([[GONE_AFTER_POLLS + 1, false, false]]);

    // Back on the list: core says `reopened`, and the write clears the stamp.
    const back = goneVerdicts(stored(db), new Set(['rss-one:1']));
    expect(back).toEqual([{ key: 'rss-one:1', streak: 0, newlyGone: false, reopened: true }]);
    expect(mark(db, back, null)).toBe(1);
    expect(stored(db).map((row) => [row.missingStreak, row.goneAt])).toEqual([[0, null]]);
    db.close();
  });

  it('moves only the keys the poll moved, so a quiet day writes nothing', () => {
    const db = oneSource();
    for (const key of ['k-a', 'k-b', 'k-c']) {
      db.items.upsert({ item: anItem({ key, link: `https://one.example/${key}` }), section: 'world' });
    }
    // A poll that published every key: `goneVerdicts` returns no rows at all.
    const seen = new Set(db.items.storedKeys(RSS_SPEC.id).map((row) => row.key));
    expect(mark(db, goneVerdicts(stored(db), seen), null)).toBe(0);
    // A poll that lost one: one row written, the others keep their 0.
    const verdicts = goneVerdicts(stored(db), new Set(['k-a', 'k-b']));
    expect(verdicts.map((v) => v.key)).toEqual(['k-c']);
    expect(mark(db, verdicts, null)).toBe(1);
    expect(stored(db).map((row) => [row.key, row.missingStreak])).toEqual([
      ['k-a', 0],
      ['k-b', 0],
      ['k-c', 1],
    ]);
    db.close();
  });
});

describe('migration 4: disappearance', () => {
  it('walks a file written at version 3, and reports its pre-migration row as never missed', async () => {
    const { file, cleanup } = await tempFile('newspa-db-gone-');
    const atThree = openTestDatabase({ file, token: 'three', now: () => FIXED, migrations: MIGRATIONS.slice(0, 3) });
    expect(atThree.version).toBe(3);
    atThree.sources.insert(RSS_SPEC, CREATED);
    atThree.items.upsert({ item: anItem(), section: 'world' });
    const columnsAtThree = atThree.tx.all('pragma table_info (items)').map((row) => String(row['name']));
    expect(columnsAtThree).not.toContain('missing_streak');
    expect(columnsAtThree).not.toContain('gone_at');
    atThree.close();

    const atHead = openTestDatabase({ file, token: 'four', now: () => later(FIXED, 60_000) });
    expect(atHead.version).toBe(CURRENT_VERSION);
    expect(atHead.migrations.map((m) => m.name)).toEqual(['disappearance']);
    const columns = atHead.tx.all('pragma table_info (items)').map((row) => String(row['name']));
    expect(columns.slice(-2)).toEqual(['missing_streak', 'gone_at']);
    // The row a pre-migration build wrote is the ladder's "never missed" state.
    expect(atHead.items.count()).toBe(1);
    expect(atHead.items.storedKeys(RSS_SPEC.id)).toEqual([
      {
        key: 'rss-one:1',
        title: 'Central bank holds rates',
        link: 'https://one.example/a',
        scoreRealtime: 12,
        missingStreak: 0,
        goneAt: null,
      },
    ]);
    expect(atHead.items.markStreaks(RSS_SPEC.id, [{ key: 'rss-one:1', streak: 3, goneAt: STAMP }])).toBe(1);
    expect(atHead.tx.get('pragma integrity_check')?.['integrity_check']).toBe('ok');
    atHead.close();
    await cleanup();
  });
});
