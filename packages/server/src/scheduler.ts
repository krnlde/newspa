/**
 * The scheduler (WP3, MVP): a loop that polls the sources that are due, one at a
 * time, and plans the next instant for each (the policy itself is
 * `schedulePlan.ts`, so this file is the loop and nothing else).
 *
 * The four things the roadmap asks for, and how MVP spends them:
 *
 *  - **one poll at a time, process-wide**, and the db lock is how a *second*
 *    process is refused: `claimLock` at start, `extendLock` after every batch,
 *    `releaseLock` on stop. A refused claim is a report with a name in it, not a
 *    silent exit — two pollers writing one paper is the same failure as a poll
 *    that lied. `AppConfig.scheduler.maxConcurrentFetches` is **not used** by
 *    MVP: parallel polls interleave at their `await`s, and the write budget here
 *    is one transaction at a time, so the knob is a WP3-follow-up, named in
 *    `docs/roadmap.md` rather than honoured by a comment.
 *  - **a crashed tick does not stop the loop.** `pollOne` deliberately never
 *    catches — "the exception belongs to the scheduler that called us" — so this
 *    is the place that catches it. The catch is a *report*: the cause goes to the
 *    log, the failure count advances (which relaxes the cadence, the same way a
 *    `5xx` does), and the source is planned. A swallowed exception is rule 5's
 *    silent zero with a stack trace attached.
 *  - **a bounded catch-up batch, not all at once**: `dueSources(now, limit)`,
 *    never-scheduled first, so a fresh database polls everything and a 200-source
 *    list is polled in batches.
 *  - **every tick's decisions are observable**: `tally()` counts batches, polls,
 *    failures and deferrals, and each source gets one log line naming the rule
 *    that planned it. An optimization that never fires is invisible (D-020); a
 *    scheduler that never fires has to be, too.
 *
 * The clock and the sleep are injected, so the whole loop runs under fake timers
 * in a test, and a 20-minute cadence costs no wall time. Jitter is `random()`, so
 * a test pins the starts instead of racing them.
 */
import type { SourceSpec } from 'newspa-config';
import type { Database, LockResult } from 'newspa-db';
import { claimLock, extendLock, releaseLock } from 'newspa-db';
import type { PollResult } from './pollTypes.ts';
import { planNextRun } from './schedulePlan.ts';

/** One minute, in the unit the plan is expressed in. */
const MINUTE_MS = 60_000;
/** How long between batches. The plan, not the tick, decides when a source runs. */
export const DEFAULT_TICK_MS = 60_000;
/** The sources one batch takes. The db binds this ceiling; the default is smaller. */
export const DEFAULT_BATCH_LIMIT = 24;

export interface SchedulerConfig {
  readonly jitterSpanMs: number;
  readonly backoffMaxMs: number;
  readonly maxFailuresBeforePause: number;
}

export interface SchedulerDeps {
  readonly db: Database;
  /** The poll. `pollOne(spec, pollDepsOf(db, …))` in production; a stub in a test. */
  readonly poll: (spec: SourceSpec) => Promise<PollResult>;
  readonly config: SchedulerConfig;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
  /** An opaque token, unique per process launch (the lock's, not a PID). */
  readonly token: string;
  readonly random?: () => number;
  readonly tickMs?: number;
  readonly batchLimit?: number;
  /** Called after every batch: the SSE hook (`cycle:complete`), and a test's spy. */
  readonly onCycle?: (tally: SchedulerTally) => void;
}

/** The loop's own counters. Mutated by the batch, read by `tally()`. */
export interface SchedulerTally {
  batches: number;
  polled: number;
  failed: number;
  planned: number;
  lastBatchAt: string | null;
}

export interface Scheduler {
  /** Run one bounded batch. The loop calls it; a test calls it directly. */
  readonly tick: () => Promise<SchedulerTally>;
  /** Stop the loop and release the claim. Idempotent. */
  readonly stop: () => void;
  readonly tally: () => SchedulerTally;
  readonly running: () => boolean;
  /** The claim this process made at start, so `start` can report who holds it. */
  readonly claim: LockResult;
}

/** The claim's stale window: a batch's work, with room. A live process extends it. */
const staleAfterMsOf = (backoffMaxMs: number): number => Math.min(backoffMaxMs, 10 * MINUTE_MS);

/** `429`-style relaxation is capped by the config's ceiling, in the plan's unit. */
const capMinutesOf = (backoffMaxMs: number): number => Math.max(1, Math.round(backoffMaxMs / MINUTE_MS));

/**
 * One bounded batch: poll everything due, in the db's order, planning each source
 * as it finishes. The tally is **mutated and returned** — one object for the
 * process's life, so `tally()` is a view of the loop, not an event log.
 *
 * A source is planned **after** its own poll, so a long batch cannot leave a
 * source's plan computed against an instant that is minutes stale — and the plan
 * is written even when the poll threw, because a source with no plan is a source
 * the next batch picks up immediately, which is how a fault becomes a hammer.
 *
 * `health: 'ok'` clears the failure count; anything else advances it. That is
 * deliberate, and it is the polite direction for the states that are *our*
 * problem: a `no-matches` page is not asking to be re-read sooner.
 */
export const runBatch = async (deps: SchedulerDeps, tally: SchedulerTally): Promise<SchedulerTally> => {
  const { db, config } = deps;
  const span = config.jitterSpanMs;
  if (span > 0) await deps.sleep(Math.floor(span * (deps.random?.() ?? Math.random())));
  const due = db.sources.dueSources(deps.now().toISOString(), deps.batchLimit ?? DEFAULT_BATCH_LIMIT);

  for (const source of due) {
    let failures = source.consecutiveFailures;
    try {
      const result = await deps.poll(source.spec);
      failures = result.health === 'ok' ? 0 : failures + 1;
      if (result.health === 'ok') tally.polled += 1;
      else tally.failed += 1;
    } catch (cause) {
      failures = source.consecutiveFailures + 1;
      tally.failed += 1;
      deps.log(`${source.spec.id}: poll threw — ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const plan = planNextRun({
      spec: source.spec,
      failures,
      now: deps.now(),
      capMinutes: capMinutesOf(config.backoffMaxMs),
      maxFailuresBeforePause: config.maxFailuresBeforePause,
    });
    db.sources.setSchedule(source.spec.id, plan.nextRunAt.toISOString(), failures);
    tally.planned += 1;
    deps.log(`${source.spec.id}: ${plan.why} → ${plan.nextRunAt.toISOString()} (+${String(plan.minutes)} min)`);
  }

  tally.batches += 1;
  tally.lastBatchAt = deps.now().toISOString();
  return tally;
};

/**
 * Start the loop. It claims first: a process that cannot claim does not poll, and
 * says who holds the paper. The returned `tick` is exposed so a test (and the
 * `start` entry point's first catch-up pass) can drive a batch on demand.
 */
export const startScheduler = (deps: SchedulerDeps): Scheduler => {
  let tally: SchedulerTally = { batches: 0, polled: 0, failed: 0, planned: 0, lastBatchAt: null };
  let stopped = false;
  const claim = claimLock(deps.db.tx, {
    token: deps.token,
    now: deps.now,
    staleAfterMs: staleAfterMsOf(deps.config.backoffMaxMs),
  });
  if (claim.ok === false) {
    deps.log(`not polling: the lock is held by "${claim.owner.owner}" since ${claim.owner.takenAt}`);
    return {
      tick: async () => tally,
      stop: () => {
        stopped = true;
      },
      tally: () => tally,
      running: () => false,
      claim,
    };
  }

  const tick = async (): Promise<SchedulerTally> => {
    tally = await runBatch(deps, tally);
    extendLock(deps.db.tx, deps.token, deps.now);
    deps.onCycle?.(tally);
    return tally;
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await tick();
      } catch (cause) {
        // A batch that threw is a report, not an exit: the loop survives, because
        // a paper that stopped updating is the louder failure.
        deps.log(`batch failed — ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      if (stopped) break;
      await deps.sleep(deps.tickMs ?? DEFAULT_TICK_MS);
    }
  };
  void loop();

  return {
    tick,
    stop: () => {
      if (stopped) return;
      stopped = true;
      releaseLock(deps.db.tx, deps.token);
      deps.log(
        `scheduler stopped: ${String(tally.batches)} batch(es), ${String(tally.polled)} ok, ${String(tally.failed)} failed`,
      );
    },
    tally: () => tally,
    running: () => !stopped,
    claim,
  };
};
