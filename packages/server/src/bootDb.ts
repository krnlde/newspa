/**
 * The boot's database: the file, the claim, and the words about them (WP4, D-041).
 *
 * Split out of `start.ts` at the 300-line cap (rule 1), on the repo's own seam —
 * `start.ts` is the order of the boot, this is one step in it. The step keeps its
 * three promises here, and the tests that check them (`startLock.test.ts`) run
 * through `boot`, so the words are the ones a reader reads:
 *
 *  - `data/` is **created** first. SQLite will not make a directory, and a first run
 *    with no `data/` is a fresh clone, which is exactly the case boot owns;
 *  - the open **is** the claim (`db_lock`), so a second `pnpm start` is refused here,
 *    by name, before it can interleave a write — and the refusal is printed, because
 *    a stack trace that says `SQLITE_BUSY` does not say "your other server is running";
 *  - a claim **taken from a dead process** is announced (D-041). Silent, it reads as
 *    "my old server is still running", and the reader goes looking for a process that
 *    is already gone.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Database, DatabaseLockedError, openDatabase } from 'newspa-db';
import { ownerIsAlive } from './lockOwner.ts';

/** The stale window: a claim older than this, from a process that is not running. */
const LOCK_STALE_AFTER_MS = 10 * 60_000;

export const openBootDb = async (
  root: string,
  token: string,
  now: () => Date,
  log: (line: string) => void,
): Promise<Database> => {
  let db: Database;
  try {
    await mkdir(join(root, 'data'), { recursive: true });
    db = openDatabase(join(root, 'data', 'newspa.db'), {
      token,
      now,
      lockStaleAfterMs: LOCK_STALE_AFTER_MS,
      ownerIsAlive,
    });
  } catch (cause) {
    if (cause instanceof DatabaseLockedError) {
      // The claim is the boundary, and it is spoken: one process polls one paper.
      log(`not starting: ${cause.message}`);
    }
    throw cause;
  }
  log(`db: ${db.file}, version ${String(db.version)} (${db.journalMode}), claim ${token.slice(0, 8)}`);
  if (db.tookOver !== null) {
    // Spoken, not swallowed: a claim is a promise about a process, and this one
    // found the process gone.
    log(
      `db: took the claim from "${db.tookOver.owner}" (taken at ${db.tookOver.takenAt}) — that process is not running, so this is a force-killed server's claim, not a second server`,
    );
  }
  return db;
};
