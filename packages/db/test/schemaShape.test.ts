/**
 * The shape of the schema: the DDL text SQLite kept, the indexes it built, and
 * the style the DDL is written in. These are assertions about **this build's**
 * schema — a file written by another build is tested by its own migration
 * audit (test/migrations.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { CURRENT_VERSION, MIGRATIONS } from '../src/index.ts';
import { HTML_SPEC, openTestDatabase, seed } from './support.ts';

const schemaOf = (db: ReturnType<typeof openTestDatabase>, name: string): string =>
  String(db.tx.get('select sql from sqlite_master where name = ?', name)?.['sql']);

const seeded = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  seed(db);
  return db;
};

describe('the shape of the schema', () => {
  it('stores items without a rowid, keyed by the pair the paper uses', () => {
    const db = seeded();
    expect(schemaOf(db, 'items')).toContain('without rowid');
    expect(
      db.tx
        .all("select name from pragma_index_list ('items')")
        .map((r) => String(r['name']))
        .sort(),
    ).toEqual(['items_last_seen', 'items_published', 'items_section', 'sqlite_autoindex_items_1']);
    expect(db.tx.get('select count(*) as c from items')).toEqual({ c: 2 });
    db.close();
  });

  it('gives the two logs an autoincrement id, so an id never comes back', () => {
    const db = seeded();
    expect(schemaOf(db, 'item_events')).toContain('autoincrement');
    expect(schemaOf(db, 'snapshots')).toContain('autoincrement');
    const ids = db.tx.all('select id from item_events').map((r) => Number(r['id']));
    db.tx.run('delete from item_events');
    const next = db.itemEvents.insert({
      sourceId: HTML_SPEC.id,
      itemKey: 'html-two:1',
      kind: 'gone',
      at: '2026-11-09T12:00:00Z',
      title: 't',
      link: 'https://two.example/x',
      score: 1,
      report: null,
    });
    expect(next).toBeGreaterThan(Math.max(...ids));
    db.close();
  });

  it('indexes the access paths, and writes the audit table with a keyed version', () => {
    const db = seeded();
    expect(
      db.tx
        .all("select name from sqlite_master where type = 'index' and name not like 'sqlite_%' order by name")
        .map((r) => String(r['name'])),
    ).toEqual([
      'item_events_recent',
      'item_events_source',
      'items_last_seen',
      'items_published',
      'items_section',
      'snapshots_source',
      'sources_enabled',
    ]);
    expect(schemaOf(db, 'migrations')).toContain('primary key');
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, CURRENT_VERSION]);
    db.close();
  });

  it('is lowercase SQL, so the style of the DDL is one style', () => {
    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) {
        expect(statement).toBe(statement.toLowerCase());
        expect(statement).toMatch(/^(create|pragma) /);
      }
    }
  });
});
