/**
 * Opening: the claim, migration on a fresh file, the mode we get, and the facts
 * a second opener is told.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  type Database,
  DatabaseLockedError,
  extendClaim,
  MIGRATIONS,
  openDatabase,
  sqliteDriver,
} from '../src/index.ts';
import { FutureVersionError } from '../src/migrations.ts';
import { aDriverSpy, FIXED, later, openTestDatabase, sharedMemory, tempFile } from './support.ts';

const claimOf = (db: Database): { owner: string; takenAt: string } => {
  const row = db.tx.get('select owner, taken_at from db_lock where id = 1');
  return { owner: String(row?.['owner']), takenAt: String(row?.['taken_at']) };
};

describe('opening', () => {
  it('takes a per-launch token when the caller does not name one', () => {
    // The token is the identity the heartbeat extends; a PID is deliberately
    // not used, so the default has to be unique per launch.
    const db = openDatabase(':memory:');
    expect(db.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(claimOf(db).owner).toBe(db.token);
    db.close();
  });
  it('creates the schema on a fresh file and reports WAL', async () => {
    const { file, cleanup } = await tempFile('newspa-db-open-');
    const db = openTestDatabase({ file, token: 'first' });
    expect(db.file).toBe(file);
    expect(db.journalMode).toBe('wal');
    expect(db.version).toBe(MIGRATIONS.at(-1)?.version);
    expect(db.head).toBe(db.version);
    expect(db.migrations.map((m) => m.version)).toEqual([1, 2, 3, CURRENT_VERSION]);
    expect(db.owner.owner).toBe('first');
    expect(db.token).toBe('first');

    const names = db.tx
      .all("select name, type from sqlite_master where name not like 'sqlite_%' order by name")
      .map((r) => `${r['type']}:${r['name']}`);
    expect(names).toEqual([
      'table:db_lock',
      'table:item_events',
      'index:item_events_recent',
      'index:item_events_source',
      'table:items',
      'index:items_last_seen',
      'index:items_published',
      'index:items_section',
      'table:migrations',
      'table:snapshots',
      'index:snapshots_source',
      'table:source_validators',
      'table:sources',
      'index:sources_enabled',
    ]);
    expect(db.tx.get('pragma integrity_check')?.['integrity_check']).toBe('ok');
    db.close();
    await cleanup();
  });

  it('refuses the second opener, and names the owner that holds the claim', async () => {
    const { file, cleanup } = await tempFile('newspa-db-claim-');
    const holder = openTestDatabase({ file, token: 'keeper', now: () => FIXED });
    expect(claimOf(holder)).toEqual({ owner: 'keeper', takenAt: FIXED.toISOString() });

    expect(() => openTestDatabase({ file, token: 'greedy', now: () => later(FIXED, 1000) })).toThrow(
      DatabaseLockedError,
    );
    try {
      openTestDatabase({ file, token: 'greedy', now: () => later(FIXED, 1000) });
      expect.unreachable('the second opener was let in');
    } catch (cause) {
      expect(cause).toBeInstanceOf(DatabaseLockedError);
      const message = (cause as DatabaseLockedError).message;
      expect(message).toContain('keeper');
      expect(message).toContain(FIXED.toISOString());
    }

    holder.close();
    await cleanup();
  });

  it('lets one live claim move to a new connection, because SQLite permits it and we do not', async () => {
    const shared = sharedMemory('open-claim');
    const atOne = openTestDatabase({
      file: shared,
      token: 'one',
      now: () => FIXED,
      lockStaleAfterMs: 30_000,
    });
    expect(atOne.tx.get('select 1 as one')?.['one']).toBe(1);

    expect(() => openTestDatabase({ file: shared, token: 'two', now: () => later(FIXED, 1_000) })).toThrow(
      DatabaseLockedError,
    );
    atOne.tx.exec('pragma user_version = 1');
    atOne.close();

    const atTwo = openTestDatabase({ file: shared, token: 'two', now: () => later(FIXED, 61_000) });
    expect(claimOf(atTwo).owner).toBe('two');
    // The file was pushed back to version 1, so this open walks the rest of the way to head.
    expect(atTwo.version).toBe(CURRENT_VERSION);
    atTwo.close();
  });

  it('refuses a database whose version is ahead of this build, and releases its claim', async () => {
    const { file, cleanup } = await tempFile('newspa-db-future-');
    const atOne = openTestDatabase({ file, token: 'one', now: () => FIXED, migrations: MIGRATIONS.slice(0, 1) });
    expect(atOne.version).toBe(1);
    atOne.tx.exec('pragma user_version = 4242');
    atOne.close();

    expect(() => openTestDatabase({ file, token: 'future', now: () => later(FIXED, 1_000) })).toThrow(
      FutureVersionError,
    );
    // A failed open gives the claim back: the next attempt reports the same
    // real problem, not a lock left behind by a failure.
    expect(() => openTestDatabase({ file, token: 'way-future', now: () => later(FIXED, 2_000) })).toThrow(
      FutureVersionError,
    );
    await cleanup();
  });

  it('migrates a file created by an older build, recording what it did', async () => {
    const { file, cleanup } = await tempFile('newspa-db-migrate-');
    const older = openTestDatabase({ file, token: 'one', migrations: MIGRATIONS.slice(0, 1) });
    const validatorBefore = older.tx.all("select name from sqlite_master where name = 'source_validators'");
    expect(validatorBefore).toEqual([]);
    older.close();

    const upgraded = openTestDatabase({ file, token: 'two', now: () => later(FIXED, 60_000) });
    expect(upgraded.version).toBe(MIGRATIONS.at(-1)?.version);
    expect(upgraded.migrations.map((m) => m.version)).toEqual([2, 3, CURRENT_VERSION]);
    expect(upgraded.tx.get("select name from sqlite_master where name = 'source_validators'")?.['name']).toBe(
      'source_validators',
    );
    upgraded.close();
    await cleanup();
  });

  it('reports the journal mode that a :memory: database ignores', () => {
    const db = openTestDatabase();
    expect(db.journalMode).toBe('memory');
    expect(db.version).toBe(MIGRATIONS.at(-1)?.version);
    db.close();
  });

  it('applies the pragmas it promises, on a real connection', async () => {
    const { file, cleanup } = await tempFile('newspa-db-pragma-');
    const firstValue = (row: Record<string, unknown> | undefined): unknown => Object.values(row ?? {})[0];
    const db = openTestDatabase({ file, token: 'one' });
    expect(db.journalMode).toBe('wal');
    expect(db.tx.get('pragma foreign_keys')?.['foreign_keys']).toBe(1);
    expect(firstValue(db.tx.get('pragma busy_timeout'))).toBe(5000);
    expect(db.tx.get('pragma journal_mode')?.['journal_mode']).toBe('wal');
    expect(db.tx.get('pragma user_version')?.['user_version']).toBe(MIGRATIONS.at(-1)?.version);
    db.close();

    const second = sqliteDriver.open(file, { busyTimeoutMs: 1000 });
    try {
      // WAL is a property of the file, so a connection that never ran the
      // pragma sees it; `busy_timeout` is per-connection, which is why the
      // driver sets it on every open.
      expect(second.journalMode()).toBe('wal');
      expect(firstValue(second.prepare('pragma busy_timeout').get())).toBe(1000);
    } finally {
      second.close();
    }
    await cleanup();
  });

  it('closes once, and giving the claim back lets the next opener in', async () => {
    const shared = sharedMemory('open-close');
    const first = openTestDatabase({ file: shared, token: 'first', now: () => FIXED });
    first.close();
    first.close();

    const second = openTestDatabase({ file: shared, token: 'second', now: () => later(FIXED, 1_000) });
    expect(second.owner.owner).toBe('second');
    second.close();
  });

  it('extends a live claim, and refuses to extend one that is no longer ours', () => {
    const shared = sharedMemory('open-extend');
    const first = openTestDatabase({ file: shared, token: 'first', now: () => FIXED });
    expect(first.extendClaim()).toBe(true);
    expect(claimOf(first).takenAt).toBe(FIXED.toISOString());

    first.close();
    expect(first.extendClaim()).toBe(false);
  });

  it('extends a claim from the outside, and says no when the owner has changed', async () => {
    const { file, cleanup } = await tempFile('newspa-db-heartbeat-');
    const db = openTestDatabase({ file, token: 'owner' });
    expect(extendClaim(file, 'owner')).toBe(true);
    expect(extendClaim(file, 'imposter')).toBe(false);
    db.close();
    expect(extendClaim(file, 'owner')).toBe(false);
    await cleanup();
  });

  it('opens through an injected driver, and reports what it ran', () => {
    const spy = aDriverSpy(':memory:');
    const db = openTestDatabase({ driver: spy.driver, token: 'spy' });
    expect(db.version).toBe(MIGRATIONS.at(-1)?.version);
    const prepared = spy.connection.prepared.map((sql) => sql.split(' ')[0]);
    expect(new Set(prepared)).toEqual(new Set(['pragma', 'select', 'insert']));
    expect(spy.connection.prepared.filter((sql) => sql.startsWith('pragma user_version')).length).toBe(1);
    expect(spy.connection.runs.filter((sql) => /^pragma user_version = \d+$/.test(sql)).length).toBe(MIGRATIONS.length);
    expect(spy.connection.runs.filter((sql) => sql.startsWith('insert into migrations')).length).toBe(
      MIGRATIONS.length,
    );
    expect(spy.connection.runs.filter((sql) => sql.startsWith('create table')).length).toBeGreaterThan(
      MIGRATIONS.length,
    );
    expect(spy.connection.runs.some((sql) => sql.startsWith('insert into migrations'))).toBe(true);
    expect(spy.connection.closed).toBe(0);
    db.close();
    expect(spy.connection.closed).toBe(1);
  });

  it('closes the connection when the open fails', () => {
    const spy = aDriverSpy(':memory:', 99);
    expect(() => openTestDatabase({ driver: spy.driver, token: 'two' })).toThrow(FutureVersionError);
    expect(spy.connection.closed).toBe(1);
  });
});
