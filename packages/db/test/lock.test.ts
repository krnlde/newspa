/**
 * The claim row: taken in one statement, extended by the owner, taken over when
 * it goes stale, given back on close. `node:sqlite` lets a second connection
 * write the same file, so this row is the guarantee, and these are the cases
 * the scheduler depends on.
 */
import { describe, expect, it } from 'vitest';
import {
  claimLock,
  DatabaseLockedError,
  extendClaim,
  extendLock,
  LOCK_TABLE_SQL,
  LockNotHeldError,
  type LockOwner,
  openDatabase,
  openInMemory,
  readLock,
  releaseLock,
  type Statements,
  statementsOf,
} from '../src/index.ts';
import { FIXED, later, sharedMemory, tempFile } from './support.ts';

const at =
  (ms: number): (() => Date) =>
  (): Date =>
    later(FIXED, ms);

const ownerOf = (db: Statements): LockOwner | null => {
  const state = readLock(db);
  return state.ok ? state.owner : null;
};

describe('the claim row', () => {
  it('lets the owner claim again while it already holds the claim', () => {
    // The heartbeat's sibling: a scheduler that re-claims on each poll must not
    // be told "someone else has it" by its own live claim.
    const shared = sharedMemory('lock-self');
    const db = openDatabase(shared, { token: 'first', now: () => FIXED, lockStaleAfterMs: 60_000 });
    expect(claimLock(db.tx, { token: 'first', now: at(30_000), staleAfterMs: 60_000 })).toEqual({
      ok: true,
      owner: { owner: 'first', takenAt: FIXED.toISOString() },
    });
    // The stale window refused the write, so the timestamp did not move: the
    // owner is not told someone else holds it, and `extendLock` is the heartbeat.
    expect(ownerOf(db.tx)?.takenAt).toBe(FIXED.toISOString());
    db.close();
  });
  it('creates the table it claims, on a database that has none', () => {
    const db = openInMemory({ token: 'first', now: () => FIXED });
    expect(db.tx.all('select id, owner, taken_at from db_lock order by id')).toEqual([
      { id: 1, owner: 'first', taken_at: FIXED.toISOString() },
    ]);
    expect(LOCK_TABLE_SQL).toContain('check (id = 1)');
    db.close();
  });

  it('refuses a second claim while the first is live, and says who holds it', () => {
    const shared = sharedMemory('lock-live');
    const first = openDatabase(shared, { token: 'first', now: () => FIXED, lockStaleAfterMs: 60_000 });
    expect(claimLock(first.tx, { token: 'second', now: at(1_000), staleAfterMs: 60_000 })).toEqual({
      ok: false,
      owner: { owner: 'first', takenAt: FIXED.toISOString() },
    });
    expect(first.tx.all('select owner from db_lock').map((r) => r['owner'])).toEqual(['first']);
    first.close();
  });

  it('takes over a claim that has gone stale, and moves the timestamp', () => {
    const shared = sharedMemory('lock-stale');
    const first = openDatabase(shared, { token: 'first', now: () => FIXED, lockStaleAfterMs: 60_000 });
    first.close();

    const taken = later(FIXED, 61_000);
    const db = openDatabase(shared, { token: 'second', now: () => taken, lockStaleAfterMs: 60_000 });
    expect(db.owner).toEqual({ owner: 'second', takenAt: taken.toISOString() });
    expect(ownerOf(db.tx)).toEqual({ owner: 'second', takenAt: taken.toISOString() });
    expect(db.tx.all('select owner from db_lock')).toHaveLength(1);
    db.close();
  });

  it('extends its own claim, and refuses to extend anyone else’s', () => {
    const shared = sharedMemory('lock-extend');
    const db = openDatabase(shared, { token: 'owner', now: () => FIXED, lockStaleAfterMs: 60_000 });
    expect(extendLock(db.tx, 'owner', at(30_000))).toBe(true);
    expect(ownerOf(db.tx)?.takenAt).toBe(later(FIXED, 30_000).toISOString());
    expect(extendLock(db.tx, 'imposter', at(40_000))).toBe(false);
    expect(ownerOf(db.tx)?.takenAt).toBe(later(FIXED, 30_000).toISOString());
    db.close();
  });

  it('gives the claim back on close, and says so when it is not held', () => {
    const db = openInMemory({ token: 'owner' });
    expect(releaseLock(db.tx, 'owner')).toBe(true);
    expect(ownerOf(db.tx)).toBeNull();
    expect(releaseLock(db.tx, 'owner')).toBe(false);
    expect(extendLock(db.tx, 'owner', () => FIXED)).toBe(false);
    expect(ownerOf(db.tx)).toBeNull();
    db.close();
  });

  it('claims inside a transaction, where the row is committed with the rest', () => {
    const db = openInMemory({ token: 'owner' });
    const inside = db.tx.transaction((tx) => claimLock(tx, { token: 'other', now: at(2_000), staleAfterMs: 60_000 }));
    expect(inside.ok).toBe(false);
    expect(ownerOf(db.tx)?.owner).toBe('owner');
    db.close();
  });

  it('names the owner, the timestamp and the stale window a caller must wait for', () => {
    const shared = sharedMemory('lock-error');
    const holder = openDatabase(shared, { token: 'keeper', now: () => FIXED, lockStaleAfterMs: 30_000 });
    try {
      openDatabase(shared, { token: 'greedy', now: at(1_000), lockStaleAfterMs: 30_000 });
      expect.unreachable('a second opener was let in');
    } catch (cause) {
      expect(cause).toBeInstanceOf(DatabaseLockedError);
      const message = (cause as DatabaseLockedError).message;
      expect(message).toContain('keeper');
      expect(message).toContain(FIXED.toISOString());
      // The window **this opener was given**, not the library default: the message
      // printed 900000 always, and this assertion accepted either number — which is
      // how the defect survived. A reader told to wait 15 minutes for a 10-minute rule
      // re-runs the command for nothing.
      expect(message).toContain('30000 ms');
    }
    holder.close();
  });

  it('names the window the server boots with, so the wait the reader is told is the real one', () => {
    const shared = sharedMemory('lock-window');
    const boot = 600_000; // `bootDb.ts`: 10 minutes, the number docs/architecture.md states.
    const holder = openDatabase(shared, { token: 'keeper', now: () => FIXED, lockStaleAfterMs: boot });
    try {
      openDatabase(shared, { token: 'greedy', now: at(1_000), lockStaleAfterMs: boot });
      expect.unreachable('a second opener was let in');
    } catch (cause) {
      expect(cause).toBeInstanceOf(DatabaseLockedError);
      expect((cause as DatabaseLockedError).message).toContain(`${boot} ms of silence`);
    }
    holder.close();
  });

  it('extends from the outside, on a connection that opens and closes the file', async () => {
    const { file, cleanup } = await tempFile('newspa-db-ext-');
    const db = openDatabase(file, { token: 'owner', now: () => FIXED });
    expect(extendClaim(file, 'owner', { now: at(5_000) })).toBe(true);
    expect(ownerOf(db.tx)?.takenAt).toBe(later(FIXED, 5_000).toISOString());
    expect(extendClaim(file, 'imposter', { now: at(9_000) })).toBe(false);
    db.close();
    expect(extendClaim(file, 'owner')).toBe(false);
    await cleanup();
  });

  it('is the one row the table allows, and names the owner it did not find', () => {
    const db = openInMemory({ token: 'owner' });
    expect(() =>
      db.tx.run('insert into db_lock (id, owner, taken_at) values (2, ?, ?)', 'two', FIXED.toISOString()),
    ).toThrow(/CHECK constraint/i);
    expect(new LockNotHeldError('someone-else').message).toContain('someone-else');
    expect(db.tx.all('select owner from db_lock').map((r) => r['owner'])).toEqual(['owner']);
    db.close();
  });

  it('answers a database with no claim table, and makes the table it reads', () => {
    const fresh = openInMemory({ token: 'seed' });
    fresh.tx.exec('drop table db_lock');
    const bare = statementsOf(fresh.connection);
    expect(readLock(bare)).toEqual({ ok: true, owner: null });
    expect(bare.all('select name from sqlite_master where name = ?', 'db_lock')).toEqual([{ name: 'db_lock' }]);
    // One connection: `bare.close()` closes the handle `fresh.tx` shares.
    bare.close();
  });
});
