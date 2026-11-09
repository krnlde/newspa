/**
 * A driver that fails.
 *
 * `node:sqlite` throws `Error`s, and every repository quotes the cause inside
 * its own error type. A driver is an **interface**, and an interface lets a
 * non-`Error` through, answers `undefined` where a row was promised, and keeps
 * a pragma it was told to run. These are the paths where a repository has to
 * build a message out of something that is not an `Error`, and where the claim
 * statement leaves no row behind: each one is a report, never a silent zero.
 */
import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  type DatabaseLike,
  DatabaseLockedError,
  type Driver,
  extendClaim,
  ItemEventError,
  ItemKeyError,
  MIGRATIONS,
  MigrationFailedError,
  openDatabase,
  type Row,
  RowShapeError,
  SnapshotError,
  SourceKeyError,
  type SqlValue,
  type StatementLike,
} from '../src/index.ts';
import { anEvent, anItem, aSnapshot, aValidatorState, FIXED, RSS_SPEC } from './support.ts';

/** What the fake throws: a string, which is what an `Error`-less driver gives. */
const NOT_AN_ERROR = 'the driver said no';

interface FakeOptions {
  /** SQL whose statements fail with `NOT_AN_ERROR`. */
  readonly failsOn?: RegExp;
  /** Answer the claim's `select` with no row at all. */
  readonly noClaimRow?: boolean;
  /** `pragma user_version` reads this, whatever the migrations were told to set. */
  readonly version?: number;
  /** What every `run` reports as `changes`: 0 is a statement that did nothing. */
  readonly changes?: number;
}

/**
 * The fake records nothing and applies nothing: it exists to make the failure
 * paths of the real modules reachable, which the real driver cannot do.
 */
const fakeDriver = (options: FakeOptions = {}): Driver => {
  const { failsOn = /(?!)/, noClaimRow = false, version = 0, changes = 1 } = options;
  const fail = (sql: string): void => {
    if (failsOn.test(sql)) throw NOT_AN_ERROR;
  };
  const answer = (sql: string): Row | undefined => {
    if (sql === 'pragma user_version') return { user_version: version };
    if (sql === 'pragma journal_mode') return { journal_mode: 'memory' };
    if (sql.startsWith('select owner, taken_at from db_lock')) {
      return noClaimRow ? undefined : { owner: 'keeper', taken_at: FIXED.toISOString() };
    }
    return undefined;
  };
  const statementOf = (sql: string): StatementLike => ({
    run: (..._params: SqlValue[]) => {
      fail(sql);
      return { changes, lastInsertRowid: 1 };
    },
    get: (..._params: SqlValue[]) => {
      fail(sql);
      return answer(sql);
    },
    all: (..._params: SqlValue[]) => {
      fail(sql);
      return [];
    },
  });
  const connection: DatabaseLike = {
    exec: (sql: string) => {
      fail(sql);
    },
    prepare: (sql: string) => statementOf(sql),
    journalMode: () => 'memory',
    isTransaction: false,
    close: () => {},
  };
  return { open: () => connection };
};

const openWith = (options: FakeOptions): ReturnType<typeof openDatabase> =>
  openDatabase(':memory:', { driver: fakeDriver(options), token: 'owner', now: () => FIXED });

describe('a driver that fails', () => {
  it('reports a claim statement that left no row as a fault', () => {
    expect(() => openWith({ noClaimRow: true })).toThrow(RowShapeError);
    expect(() => openWith({ noClaimRow: true })).toThrow('no claim row after claiming');
  });

  it('wraps a migration whose cause is not an Error, naming the migration', () => {
    try {
      openWith({ failsOn: /create table items/ });
      expect.unreachable('a migration that failed was let through');
    } catch (cause) {
      expect(cause).toBeInstanceOf(MigrationFailedError);
      const message = (cause as MigrationFailedError).message;
      expect(message).toContain('migration 1 (base) failed');
      expect(message).toContain(NOT_AN_ERROR);
    }
  });

  it('refuses a file whose version the migrations did not move', () => {
    // The fake applies the DDL and ignores `pragma user_version`, which is the
    // one state where the audit rows and the version disagree.
    expect(() => openWith({ version: 0 })).toThrow(/expected 2, got 0/);
    expect(CURRENT_VERSION).toBe(MIGRATIONS.at(-1)?.version);
  });

  it('quotes a non-Error cause in each repository’s own error type', () => {
    // One open per statement: the fake fails only the SQL a pattern names, so
    // each repository is seen failing on its own write.
    const openOn = (pattern: RegExp): ReturnType<typeof openDatabase> => openWith({ version: 2, failsOn: pattern });
    expect(() => openOn(/insert into snapshots/).snapshots.record(aSnapshot())).toThrow(SnapshotError);
    expect(() => openOn(/insert into snapshots/).snapshots.record(aSnapshot())).toThrow(NOT_AN_ERROR);
    expect(() => openOn(/insert into items/).items.upsert({ item: anItem(), section: 'world' })).toThrow(ItemKeyError);
    expect(() => openOn(/insert into items/).items.upsert({ item: anItem(), section: 'world' })).toThrow(NOT_AN_ERROR);
    expect(() => openOn(/insert into item_events/).itemEvents.insert(anEvent())).toThrow(ItemEventError);
    expect(() => openOn(/insert into item_events/).itemEvents.insert(anEvent())).toThrow(NOT_AN_ERROR);
    expect(() => openOn(/insert into sources/).sources.insert(RSS_SPEC, FIXED.toISOString())).toThrow(SourceKeyError);
    expect(() => openOn(/insert into sources/).sources.insert(RSS_SPEC, FIXED.toISOString())).toThrow(NOT_AN_ERROR);
  });

  it('reports an un-writable validator state as an outcome, not a throw', () => {
    const db = openWith({ version: 2, failsOn: /source_validators/ });
    expect(db.validators.write(RSS_SPEC.id, aValidatorState())).toEqual({ ok: false, reason: NOT_AN_ERROR });
    db.close();
  });

  it('refuses a second opener whose claim was refused, and names the keeper', () => {
    const db = openWith({ version: 2 });
    const refused = (): unknown =>
      openDatabase(':memory:', { driver: fakeDriver({ version: 2, changes: 0 }), token: 'other', now: () => FIXED });
    expect(refused).toThrow(DatabaseLockedError);
    expect(refused).toThrow(/keeper/);
    // The heartbeat: `changes` is the verdict, so a claim that is not ours is
    // reported as `false`, and the scheduler stops writing.
    expect(extendClaim(':memory:', 'keeper', { driver: fakeDriver({ version: 2 }), now: () => FIXED })).toBe(true);
    expect(
      extendClaim(':memory:', 'keeper', { driver: fakeDriver({ version: 2, changes: 0 }), now: () => FIXED }),
    ).toBe(false);
    db.close();
  });
});
