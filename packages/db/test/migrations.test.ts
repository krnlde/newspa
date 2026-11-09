/**
 * Migrations: forward-only, one transaction each, and an audit row for what
 * this build did. Every case here is a state a real file can be in, because a
 * user's `newspa.db` is the file some other build wrote.
 */

import { sourceSchema } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import {
  appliedOf,
  CURRENT_VERSION,
  FutureVersionError,
  MAX_MIGRATION_VERSION,
  MIGRATIONS,
  type Migration,
  MigrationFailedError,
  migrate,
  versionOf,
} from '../src/index.ts';
import { FIXED, openTestDatabase, tempFile } from './support.ts';

const BASE: readonly Migration[] = [MIGRATIONS[0] as Migration];
const ALL: readonly Migration[] = MIGRATIONS;

const audit = (db: ReturnType<typeof openTestDatabase>): unknown[] =>
  db.tx.all('select version, name, applied_at from migrations order by version');

describe('migrations: 0 to head', () => {
  it('applies the package’s own migrations when the caller names none', () => {
    const db = openTestDatabase({ migrations: [] });
    expect(versionOf(db.tx)).toBe(0);
    expect(migrate(db.tx, { now: () => FIXED }).map((record) => record.name)).toEqual(['base', 'validator-state']);
    expect(versionOf(db.tx)).toBe(CURRENT_VERSION);
    expect(db.tx.get("select name from sqlite_master where name = 'source_validators'")?.['name']).toBe(
      'source_validators',
    );
    db.close();
  });
  it('runs every migration once, in order, and records each one', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    expect(versionOf(db.tx)).toBe(0);
    expect(appliedOf(db.tx)).toEqual([]);

    const applied = migrate(db.tx, { now: () => FIXED, migrations: ALL });
    expect(applied.map((m) => [m.version, m.name])).toEqual([
      [1, 'base'],
      [2, 'validator-state'],
    ]);
    expect(versionOf(db.tx)).toBe(CURRENT_VERSION);
    expect(db.tx.all('select version, name, applied_at from migrations order by version')).toEqual([
      { version: 1, name: 'base', applied_at: FIXED.toISOString() },
      { version: 2, name: 'validator-state', applied_at: FIXED.toISOString() },
    ]);
    expect(appliedOf(db.tx).map((m) => m.version)).toEqual([1, 2]);
    db.close();
  });

  it('is a no-op the second time, and the second time is the normal case', () => {
    const db = openTestDatabase({ now: () => FIXED });
    expect(migrate(db.tx, { now: () => FIXED, migrations: ALL })).toEqual([]);
    expect(audit(db)).toHaveLength(ALL.length);
    expect(versionOf(db.tx)).toBe(CURRENT_VERSION);
    db.close();
  });

  it('creates the tables the repositories write to', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    migrate(db.tx, { now: () => FIXED, migrations: ALL });
    const tables = db.tx
      .all("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .map((r) => String(r['name']));
    expect(tables).toEqual([
      'db_lock',
      'item_events',
      'items',
      'migrations',
      'snapshots',
      'source_validators',
      'sources',
    ]);
    expect(db.tx.get('pragma integrity_check')?.['integrity_check']).toBe('ok');
    expect(db.tx.get('pragma foreign_keys')?.['foreign_keys']).toBe(1);
    db.close();
  });

  it('walks a file written by an older build up to this one', async () => {
    const { file, cleanup } = await tempFile('newspa-db-walk-');
    const older = openTestDatabase({ file, token: 'older', now: () => FIXED, migrations: BASE });
    expect(older.version).toBe(1);
    expect(older.migrations.map((m) => m.version)).toEqual([1]);
    older.close();

    const now = new Date(FIXED.getTime() + 60_000);
    const newer = openTestDatabase({ file, token: 'newer', now: () => now });
    expect(newer.version).toBe(CURRENT_VERSION);
    expect(newer.migrations.map((m) => m.version)).toEqual([2]);

    const rows = (
      newer.tx.all('select version, name, applied_at from migrations order by version') as {
        version: number;
        applied_at: string;
      }[]
    ).map((r) => [r.version, r.applied_at]);
    expect(rows).toEqual([
      [1, FIXED.toISOString()],
      [2, now.toISOString()],
    ]);
    newer.close();
    await cleanup();
  });
});

describe('migrations: the version in the file', () => {
  it('refuses a database from a newer build, and says what it found', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    db.tx.exec('pragma user_version = 7');
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: ALL })).toThrow(FutureVersionError);
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: ALL })).toThrow(/7/);
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: ALL })).toThrow(String(CURRENT_VERSION));
    expect(versionOf(db.tx)).toBe(7);
    expect(appliedOf(db.tx)).toEqual([]);
    db.close();
  });

  it('refuses a version above the ceiling the brief sets', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    db.tx.exec(`pragma user_version = ${MAX_MIGRATION_VERSION + 1}`);
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: ALL })).toThrow(FutureVersionError);
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: ALL })).toThrow(String(MAX_MIGRATION_VERSION + 1));
    expect(appliedOf(db.tx)).toEqual([]);
    db.close();
  });

  it('refuses a list that is not ascending, before running a statement of it', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: ALL.slice().reverse() })).toThrow(MigrationFailedError);
    db.tx.exec('pragma user_version = 0');
    expect(() =>
      migrate(db.tx, { now: () => FIXED, migrations: [MIGRATIONS[0] as Migration, MIGRATIONS[0] as Migration] }),
    ).toThrow(/ascending/);
    expect(versionOf(db.tx)).toBe(0);
    db.close();
  });
});

describe('migrations: all of it, or none of it', () => {
  it('rolls a failed migration back to the version it started at', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    migrate(db.tx, { now: () => FIXED, migrations: BASE });
    const broken: readonly Migration[] = [
      MIGRATIONS[0] as Migration,
      {
        version: 2,
        name: 'broken',
        statements: ['create table half_written (a primary key)', 'insert into no_such_table (a) values (1)'],
      },
    ];

    expect(() => migrate(db.tx, { now: () => FIXED, migrations: broken })).toThrow(MigrationFailedError);
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: broken })).toThrow('broken');
    expect(versionOf(db.tx)).toBe(1);
    expect(appliedOf(db.tx).map((m) => m.version)).toEqual([1]);
    expect(db.tx.get("select name from sqlite_master where name = 'half_written'")).toBeUndefined();
    expect(db.tx.inTransaction()).toBe(false);
    db.close();
  });

  it('keeps the rows a migration wrote before it failed, out of the database', () => {
    const db = openTestDatabase({ now: () => FIXED });
    db.sources.insert(
      sourceSchema.parse({
        id: 'seeded-one',
        kind: 'rss',
        label: 'Seeded',
        url: 'https://seeded.example/feed.xml',
        cadenceMinutes: 30,
        weight: 1,
      }),
      FIXED.toISOString(),
    );
    const failing: readonly Migration[] = [
      {
        version: 3,
        name: 'writes-then-fails',
        statements: [
          "insert into sources (id, kind, label, url, group_name, enabled, cadence_minutes, weight, source_json, time_spec_json, health, created_at) values ('in-flight','rss','x','https://x.example','x',1,30,1,'{}','{}','unknown','2026-11-09T00:00:00Z')",
          'select * from no_such_view',
        ],
      },
    ];
    expect(() => migrate(db.tx, { now: () => FIXED, migrations: failing })).toThrow(MigrationFailedError);
    expect(db.sources.ids()).toEqual(['seeded-one']);
    expect(versionOf(db.tx)).toBe(CURRENT_VERSION);
    expect(appliedOf(db.tx).map((m) => m.version)).toEqual([1, 2]);
    db.close();
  });

  it('names the migration, the version and the statement that failed', () => {
    const db = openTestDatabase({ now: () => FIXED, migrations: [] });
    const bad: readonly Migration[] = [
      { version: 1, name: 'syntax', statements: ['create table ok (a primary key)', 'create table ok ('] },
    ];
    try {
      migrate(db.tx, { now: () => FIXED, migrations: bad });
      expect.unreachable('a migration with broken SQL was accepted');
    } catch (cause) {
      const error = cause as MigrationFailedError;
      expect(error.name).toBe('MigrationFailedError');
      expect(error.version).toBe(1);
      expect(error.message).toContain('syntax');
      expect(error.message).toMatch(/near "|syntax/i);
    }
    expect(versionOf(db.tx)).toBe(0);
    expect(db.tx.get("select name from sqlite_master where name = 'ok'")).toBeUndefined();
    db.close();
  });
});
