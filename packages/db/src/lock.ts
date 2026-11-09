/**
 * The single-instance guarantee.
 *
 * `node:sqlite` does not stop a second opener: measured, two connections to
 * one file (in-process and across processes) both read and write, with SQLite
 * serialising the writes — a contended write fails after 1 ms with
 * `database is locked` at `busy_timeout 0` and waits out a 400 ms writer at
 * 3000 ms. The architecture's "one process, started by hand" therefore needs a
 * claim row, not a file lock: a PID file and `node:child_process` are ruled out
 * by the brief, and a row survives the owner's death because it is committed.
 *
 * The claim is one statement: `insert … on conflict do update … where
 * taken_at < :stale`, and `changes` is the verdict (measured: 1 when the row
 * was taken, 0 when the `where` refused it). A crashed owner is taken over
 * once its claim is older than `staleAfterMs`; `extendLock` is the heartbeat
 * that keeps a live owner's claim from ageing out.
 *
 * Every entry point creates the table first. The claim has to work on a
 * database that has not been migrated yet — that is exactly the state a second
 * process finds when the first one opens the file and starts migrating.
 */
import type { Tx } from './statement.ts';
import { RowShapeError } from './value.ts';

export const LOCK_TABLE = 'db_lock';

export const LOCK_TABLE_SQL = `create table if not exists ${LOCK_TABLE} (
  id integer primary key check (id = 1),
  owner text not null,
  taken_at text not null
)`;

export interface LockOwner {
  readonly owner: string;
  readonly takenAt: string;
}

export interface LockOptions {
  /** An opaque token, unique per process launch; it is not a PID. */
  readonly token: string;
  readonly now: () => Date;
  /** How old a claim has to be before another process may take it. */
  readonly staleAfterMs: number;
}

/**
 * The verdict of a claim. The owner is named in both arms: a process that was
 * refused has to say who to wait for, and for how long.
 */
export type LockResult =
  | { readonly ok: true; readonly owner: LockOwner }
  | { readonly ok: false; readonly owner: LockOwner };

/** The claim as a reader sees it: no table row, or an owner. */
export type LockState =
  | { readonly ok: true; readonly owner: LockOwner | null }
  | { readonly ok: false; readonly reason: string };

export class LockNotHeldError extends Error {
  constructor(owner: string) {
    super(`this process does not hold the lock (owner "${owner}")`);
    this.name = 'LockNotHeldError';
  }
}

/**
 * Text out of a row, naming the column when it is not text. The driver hands
 * back `Record<string, unknown>`: `node:sqlite` gives null-prototype objects,
 * `bigint` for an INTEGER above 2^53, and `Uint8Array` for a blob, so a claim
 * row written by some other build has to fail as a report, not as a
 * `TypeError` from a template literal.
 */
const textOf = (name: string, row: Record<string, unknown>): string => {
  const value = row[name];
  if (typeof value === 'string') return value;
  throw new RowShapeError(name, 'the lock row', `expected text, got ${value === null ? 'null' : typeof value}`);
};

const ownerOf = (row: Record<string, unknown> | undefined): LockOwner | null => {
  if (row === undefined) return null;
  return { owner: textOf('owner', row), takenAt: textOf('taken_at', row) };
};

/** The row a claim is supposed to have left behind. Its absence is a fault. */
const claimOwner = (row: Record<string, unknown> | undefined): LockOwner => {
  const owner = ownerOf(row);
  if (owner === null) throw new RowShapeError('owner', 'the lock table', 'no claim row after claiming');
  return owner;
};

const SELECT_CLAIM = `select owner, taken_at from ${LOCK_TABLE} where id = 1`;

/** Take the claim, or report the live owner that holds it. */
export const claimLock = (db: Tx, options: LockOptions): LockResult => {
  void db.exec(LOCK_TABLE_SQL);
  const takenAt = options.now().toISOString();
  const stale = new Date(options.now().getTime() - options.staleAfterMs).toISOString();
  const result = db.run(
    `insert into ${LOCK_TABLE} (id, owner, taken_at) values (1, ?, ?)
     on conflict (id) do update set owner = excluded.owner, taken_at = excluded.taken_at
     where ${LOCK_TABLE}.taken_at < ?`,
    options.token,
    takenAt,
    stale,
  );
  const owner = claimOwner(db.get(SELECT_CLAIM));
  // `changes === 1` is the measured verdict for "the `where` let us in";
  // comparing the owner covers the case where we already held it.
  if (result.changes === 1 || owner.owner === options.token) return { ok: true, owner };
  return { ok: false, owner };
};

/**
 * Report the claim, taking nothing. `status` uses this: the point is to tell a
 * human which process owns the file and when it last proved it was alive.
 */
export const readLock = (db: Tx): LockState => {
  void db.exec(LOCK_TABLE_SQL);
  return { ok: true, owner: ownerOf(db.get(SELECT_CLAIM)) };
};

/** The heartbeat: move our own claim's timestamp forward. `false` when it is not ours. */
export const extendLock = (db: Tx, token: string, now: () => Date): boolean => {
  void db.exec(LOCK_TABLE_SQL);
  return (
    db.run(`update ${LOCK_TABLE} set taken_at = ? where id = 1 and owner = ?`, now().toISOString(), token).changes === 1
  );
};

/** Give the claim back. `false` when it is not ours (or already gone). */
export const releaseLock = (db: Tx, token: string): boolean => {
  void db.exec(LOCK_TABLE_SQL);
  return db.run(`delete from ${LOCK_TABLE} where id = 1 and owner = ?`, token).changes === 1;
};
