/**
 * Fixtures for the scheduler's two test files: `scheduler.test.ts` (one batch)
 * and `scheduler-loop.test.ts` (the loop, the claim, what it survives).
 *
 * Two conventions worth knowing before reading a test:
 *
 *  - **The db is real** (`openInMemory`, migrations and all). The scheduler's
 *    whole job is two columns, so a mock repository would prove the mock;
 *  - **Opening a database claims the lock** (`DatabaseLockedError` is what a
 *    second process sees), so the scheduler's token is the db's token: the loop
 *    extends the claim the open already made. A refused claim is a db opened by
 *    someone else.
 *
 * The clock is injected and fixed, the sleep records, and the plan arithmetic is
 * **not** exercised here — `schedulePlan.test.ts` pins it. The fixtures use plain
 * UTC cadences, with no cron and no quiet hours, so no expectation here depends
 * on the machine's time zone.
 */
import type { Database } from 'newspa-db';
import { openInMemory } from 'newspa-db';
import type { PollResult } from '../src/pollTypes.ts';
import type { Scheduler, SchedulerConfig, SchedulerDeps } from '../src/scheduler.ts';
import { addSource, anRssSpec } from './support.ts';

export const T0 = new Date('2026-11-09T10:00:00Z');
/** The instant `n` minutes after the fixture's start, as the db stores it. */
export const isoAt = (n: number): string => new Date(T0.getTime() + n * 60_000).toISOString();

/** The config schema's defaults for the two knobs the MVP scheduler uses, pause at 6. */
export const config: SchedulerConfig = { jitterSpanMs: 0, backoffMaxMs: 3_600_000, maxFailuresBeforePause: 6 };

export const emptyTally = () => ({
  batches: 0,
  polled: 0,
  failed: 0,
  planned: 0,
  newItems: 0,
  editedItems: 0,
  lastBatchAt: null,
});

/** A poll's report: the shape is `pollTypes.ts`'s; the scheduler reads only `health`. */
export const aResult = (sourceId: string, over: Partial<PollResult> = {}): PollResult => ({
  sourceId,
  takenAt: T0.toISOString(),
  outcome: 'changed',
  status: 200,
  bytes: 1_200,
  durationMs: 5,
  itemCount: 1,
  newItems: 1,
  editedItems: 0,
  newKeys: ['k'],
  editedKeys: [],
  goneItems: 0,
  goneKeys: [],
  health: 'ok',
  errorKind: null,
  note: 'stub poll',
  ...over,
});

/** Deps around a real db, with every effect recorded, and each seam overridable. */
export const harness = (db: Database, over: Partial<SchedulerDeps> = {}) => {
  const calls: string[] = [];
  const logs: string[] = [];
  const slept: number[] = [];
  const deps: SchedulerDeps = {
    db,
    poll: async (spec) => {
      calls.push(spec.id);
      return aResult(spec.id);
    },
    config,
    now: () => T0,
    // The sleep records, and yields a **macrotask**: a seam that yields only a
    // microtask lets a runaway `while (!stopped)` spin the event loop so tightly
    // that a test timeout can never fire, which turns a bug into a hang.
    sleep: async (ms) => {
      slept.push(ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
    log: (line) => {
      logs.push(line);
    },
    debug: (line) => {
      logs.push(line);
    },
    token: 'tok-a',
    ...over,
  };
  return { deps, calls, logs, slept };
};

/** A db at the fixture's instant, claimed by `token` — see the header. */
export const openSchedDb = (token = 'tok-a'): Database => openInMemory({ now: () => T0, token });

/**
 * The schedule as the loop sees it. `dueSources` is the only read of these two
 * columns, so tests reach for it at an instant far enough ahead that the plan
 * cannot matter; a **disabled** source is invisible here, by design.
 */
export const scheduleOf = (db: Database, id: string): { nextRunAt: string | null; failures: number } => {
  const row = db.sources.dueSources('9999-12-31T23:59:59Z', 200).find((source) => source.spec.id === id);
  if (row === undefined) throw new Error(`no source ${id} in dueSources`);
  return { nextRunAt: row.nextRunAt, failures: row.consecutiveFailures };
};

/** A source that is due at `T0`, at `cadenceMinutes`, plus the harness around it. */
export const oneSource = (cadenceMinutes = 10, id = 'xx') => {
  const db = openSchedDb();
  addSource(db, anRssSpec({ id, cadenceMinutes }));
  return db;
};

/**
 * Drive the loop to a stop. Every test stops it from inside a seam (the sleep,
 * `publish`, the poll), so `drain` only has to let the turns run: each turn yields
 * a **macrotask** (see `breathe` in the loop's file), and a real `sleep` would need
 * fake timers for a 20-minute cadence, which none of this needs.
 */
export const drain = async (sched: Scheduler): Promise<void> => {
  for (let i = 0; i < 100 && sched.running(); i += 1) await new Promise((resolve) => setImmediate(resolve));
};

/** Let a batch that is already past its stop point finish. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
