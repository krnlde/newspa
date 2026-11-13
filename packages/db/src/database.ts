/**
 * Opening the database: connection, pragmas, the single-instance claim,
 * migrations, repositories, one close.
 *
 * The order is the contract. The claim comes **before** any write, because two
 * processes interleaving writes is the failure the architecture names ("a
 * double start cannot interleave writes"), and it is the only guarantee:
 * `node:sqlite` lets a second connection read and write the same file.
 * Migration comes before the repositories hand out statements, and a failure
 * closes the connection, because `node:sqlite` has no `DISPOSABLE` safety net
 * here — `close()` is the only thing that releases the file.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseLike, Driver } from './driver.ts';
import { type ItemEventsRepository, itemEventsRepository } from './itemEvents.ts';
import { type ItemsRepository, itemsRepository } from './items.ts';
import { claimLock, extendLock, type LockOwner, releaseLock } from './lock.ts';
import { MIGRATIONS } from './migrationHistory.ts';
import { type AppliedMigration, migrate, versionOf } from './migrations.ts';
import { sqliteDriver } from './nodeDriver.ts';
import type { Migration } from './schema.ts';
import { type SnapshotRepository, snapshotsRepository } from './snapshots.ts';
import { type SourcesRepository, sourcesRepository } from './sources.ts';
import { type Statements, statementsOf } from './statement.ts';
import { type ValidatorRepository, validatorRepository } from './validators.ts';

/** A contended write at `busy_timeout 0` fails in ~1 ms (measured); 5 s covers a poll's own writes. */
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/** A claim older than this is a crashed owner, and takeable (docs/architecture.md). */
export const DEFAULT_LOCK_STALE_MS = 15 * 60 * 1000;

export class DatabaseLockedError extends Error {
  /**
   * `staleAfterMs` is the window **in force**, not the default: the server boots with
   * 10 minutes (`bootDb.ts`) and the message used to print the 15-minute default, so a
   * reader told to wait 15 minutes was waiting for a rule the running server does not
   * use (docs/architecture.md says 10). A refusal that names a number the code does not
   * obey is a dead end, not an explanation.
   */
  constructor(owner: LockOwner, staleAfterMs: number) {
    super(
      `another process holds this database (claim "${owner.owner}" taken at ${owner.takenAt}); ` +
        `it is takeable after ${staleAfterMs} ms of silence, at once if the caller can prove that owner is not running`,
    );
    this.name = 'DatabaseLockedError';
  }
}

export interface Database {
  readonly file: string;
  /** `wal` for a file; `memory` for `:memory:` (measured: WAL is ignored there). */
  readonly journalMode: string;
  readonly version: number;
  readonly head: number;
  readonly migrations: readonly AppliedMigration[];
  readonly owner: LockOwner;
  /**
   * The claim this process **took from an owner that is not running**, or null.
   * The boot prints it: a takeover that happens quietly is how a second server
   * starts polling the same paper while the first one is a stopped process in
   * another terminal.
   */
  readonly tookOver: LockOwner | null;
  /** This process's claim token: the identity the heartbeat extends. */
  readonly token: string;
  /** The heartbeat: keep a live owner's claim from ageing out. `false` when it is not ours. */
  readonly extendClaim: () => boolean;
  readonly sources: SourcesRepository;
  readonly items: ItemsRepository;
  readonly itemEvents: ItemEventsRepository;
  readonly snapshots: SnapshotRepository;
  readonly validators: ValidatorRepository;
  /** The statement cache and transaction scope every repository shares. */
  readonly tx: Statements;
  /** The connection. Reach for it in tests; `close()` is the normal way out. */
  readonly connection: DatabaseLike;
  readonly close: () => void;
}

export interface OpenOptions {
  readonly busyTimeoutMs?: number;
  readonly lockStaleAfterMs?: number;
  /**
   * Is an owner text a running process? The caller wrote the text, so the
   * caller answers (`lock.ts: LockOptions.isAlive`); the db layer never touches
   * `node:process`. Answer `false` and a claim is reclaimed at once instead of
   * after `lockStaleAfterMs`.
   */
  readonly ownerIsAlive?: (owner: string) => boolean;
  /** Per-launch token; a PID is deliberately not used. */
  readonly token?: string;
  readonly now?: () => Date;
  /** The seam: tests open a shared in-memory database through the same driver shape. */
  readonly driver?: Driver;
  readonly migrations?: readonly Migration[];
}

export const openDatabase = (file: string, options: OpenOptions = {}): Database => {
  const now = options.now ?? ((): Date => new Date());
  const driver = options.driver ?? sqliteDriver;
  const migrations = options.migrations ?? MIGRATIONS;
  const head = migrations.at(-1)?.version ?? 0;
  const db = driver.open(file, { busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS });
  const tx = statementsOf(db);
  const token = options.token ?? randomUUID();

  try {
    const staleAfterMs = options.lockStaleAfterMs ?? DEFAULT_LOCK_STALE_MS;
    const claim = claimLock(tx, {
      token,
      now,
      staleAfterMs,
      ...(options.ownerIsAlive === undefined ? {} : { isAlive: options.ownerIsAlive }),
    });
    if (!claim.ok) throw new DatabaseLockedError(claim.owner, staleAfterMs);

    const applied = migrate(tx, { now, migrations });
    let open = true;
    return {
      file,
      connection: db,
      journalMode: db.journalMode(),
      version: versionOf(tx),
      head,
      migrations: applied,
      owner: claim.owner,
      tookOver: claim.tookOver ?? null,
      token,
      extendClaim: () => (open ? extendLock(tx, token, now) : false),
      sources: sourcesRepository(tx),
      items: itemsRepository(tx),
      itemEvents: itemEventsRepository(tx),
      snapshots: snapshotsRepository(tx),
      validators: validatorRepository(tx),
      tx,
      /**
       * Closing **gives the claim back**. A crash and a clean exit look the same
       * from the file, so a claim that survives is only collected when it goes
       * stale — the right price for a crash, the wrong price for a shutdown.
       * Measured: a claim row written by a process that then died stays visible
       * to the next opener until `taken_at` is past the stale window.
       */
      close: () => {
        if (!open) return;
        open = false;
        releaseLock(tx, token);
        tx.close();
      },
    };
  } catch (cause) {
    // The claim is ours and the caller never receives the handle, so releasing
    // it here is the difference between one clear error and every later attempt
    // being told to wait. Releasing must not mask the real cause.
    try {
      releaseLock(tx, token);
    } catch {
      // A connection that cannot release its claim cannot do anything else
      // either; the claim ages out through the stale window.
    }
    tx.close();
    throw cause;
  }
};

/**
 * A private in-memory database. `:memory:` is per-connection, so a second
 * `openDatabase(':memory:')` is a second database and is never contended.
 */
export const openInMemory = (options: OpenOptions = {}): Database => openDatabase(':memory:', options);

/**
 * Re-check a claim from the outside: the scheduler's heartbeat needs to know
 * that it is still the owner, and a claim taken over by a newcomer is the
 * signal to stop writing.
 */
/** The heartbeat's options: a clock, a timeout, the seam. */
export interface ClaimOptions {
  readonly now?: () => Date;
  readonly busyTimeoutMs?: number;
  readonly driver?: Driver;
}

export const extendClaim = (file: string, token: string, options: ClaimOptions = {}): boolean => {
  const now = options.now ?? ((): Date => new Date());
  const db = (options.driver ?? sqliteDriver).open(file, {
    busyTimeoutMs: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
  });
  try {
    return extendLock(statementsOf(db), token, now);
  } finally {
    db.close();
  }
};
