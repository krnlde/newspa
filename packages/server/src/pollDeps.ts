/**
 * The composition seam for a poll: a `Database` in, the `PollDeps` out.
 *
 * `packages/server` has no build step and no framework, so the wiring is a
 * function, not a container. The CLI (`src/cli.ts`) passes the `Database`
 * `openDatabase` hands back; a test passes `openInMemory()` and overrides the
 * `fetch`, the clock and the sleep. The read side's equivalent is `state.ts`'s
 * `StateDeps`, wired by hand in `apps/web/dev/apiPlugin.ts` — same style.
 *
 * The one thing worth reading is `inTx`: it is `db.tx.transaction`, the same
 * statement cache and transaction scope every repository shares
 * (`statement.ts` nests a nested call as a `SAVEPOINT`). Passing anything else —
 * `(work) => work()` — is a test's choice, and a poll whose writes must be
 * atomic is not: a paper that shows items with no events, or a snapshot with no
 * health, is half a poll.
 */
import type { Database } from 'newspa-db';
import type { PollDeps } from './pollTypes.ts';

/** The pipeline's deps, wired from an open database, with the test seams overridable. */
export const pollDepsOf = (db: Database, over: Partial<PollDeps> = {}): PollDeps => ({
  sources: db.sources,
  items: db.items,
  itemEvents: db.itemEvents,
  snapshots: db.snapshots,
  validators: db.validators,
  inTx: <T>(work: () => T): T => db.tx.transaction(() => work()),
  ...over,
});
