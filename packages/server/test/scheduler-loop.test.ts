/**
 * The loop (WP3): `startScheduler` claims, runs bounded batches, extends the
 * claim every turn, survives what a batch throws, and gives the claim back.
 *
 * Each test stops the loop from **inside a seam** — the sleep, `publish`, the
 * poll — and the injected sleep records instead of waiting, so a 20-minute
 * cadence costs no wall time and no fake timers are needed. Two conventions
 * that are not obvious and cost a debugging session each:
 *
 *  - a seam touches the scheduler **after** `await breathe()`: `runBatch` reaches
 *    its first `await` without yielding, so a `poll` stub that calls `stop()`
 *    synchronously runs before the caller's assignment finished (a TDZ error,
 *    which the per-poll catch swallows into a "failed poll" and the loop spins);
 *  - every seam yields a **macrotask**, so a loop that fails to stop is a test
 *    timeout with a report, not a hung worker.
 */
import type { ServerEvent } from 'newspa-core';
import { claimLock, type LockState, readLock } from 'newspa-db';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BATCH_LIMIT, type Scheduler, type SchedulerDeps, startScheduler } from '../src/scheduler.ts';
import { aResult, drain, emptyTally, flush, harness, oneSource, openSchedDb, T0 } from './schedulerSupport.ts';
import { addSource, anRssSpec } from './support.ts';

/** Every scheduler this file starts, so `afterEach` can always reach the loop. */
const started: Scheduler[] = [];

afterEach(() => {
  for (const sched of started) sched.stop();
  started.length = 0;
});

/** `startScheduler`, tracked. The loop begins on the spot, so `breathe()` first. */
const start = (deps: SchedulerDeps): Scheduler => {
  const sched = startScheduler(deps);
  started.push(sched);
  return sched;
};

/** Yield a **macrotask**, so a runaway loop is a timeout with a report, not a hang. */
const breathe = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('startScheduler: the claim', () => {
  it('claims, extends the claim every batch, and releases it on stop', async () => {
    const db = oneSource(20);
    const live: LockState[] = [];
    let sched: Scheduler;
    const h = harness(db, {
      sleep: async () => {
        live.push(readLock(db.tx));
        await breathe();
        sched.stop();
      },
    });
    sched = start(h.deps);
    expect(sched.claim.ok).toBe(true);
    await drain(sched);
    expect(h.calls).toEqual(['xx']);
    // The claim is live and ours at the end of the batch: that is the heartbeat,
    // and it is what keeps a long-running process out of the stale window.
    expect(live).toEqual([{ ok: true, owner: { owner: 'tok-a', takenAt: T0.toISOString() } }]);
    expect(sched.tally().batches).toBe(1);
    sched.stop();
    sched.stop();
    expect(h.logs.filter((line) => line.includes('scheduler stopped'))).toHaveLength(1);
    expect(h.logs.at(-1)).toContain('scheduler stopped: 1 batch(es), 1 ok, 0 failed');
    // `stop()` gave it back, so the next process is in.
    expect(readLock(db.tx)).toEqual({ ok: true, owner: null });
    expect(claimLock(db.tx, { token: 'tok-b', now: () => T0, staleAfterMs: 1 }).ok).toBe(true);
  });

  it('a refused claim polls nothing, names the owner, and leaves the claim alone', async () => {
    const db = openSchedDb('tok-b');
    const h = harness(db);
    const sched = start(h.deps);
    expect(sched.claim.ok).toBe(false);
    expect(sched.running()).toBe(false);
    expect(h.logs).toEqual(['not polling: the lock is held by "tok-b" since 2026-11-09T10:00:00.000Z']);
    expect([sched.tally(), await sched.tick()]).toEqual([emptyTally(), emptyTally()]);
    sched.stop();
    expect(readLock(db.tx)).toEqual({ ok: true, owner: { owner: 'tok-b', takenAt: T0.toISOString() } });
  });

  it('runs one bounded batch per turn, publishes the cycle, and stops on stop()', async () => {
    const db = openSchedDb();
    for (let i = 0; i < 40; i += 1) addSource(db, anRssSpec({ id: `s${String(i).padStart(2, '0')}` }));
    const published: ServerEvent[] = [];
    let sched: Scheduler;
    const h = harness(db, {
      tickMs: 1,
      publish: (event) => {
        published.push(event);
      },
      sleep: async () => {
        await breathe();
        sched.stop();
      },
    });
    sched = start(h.deps);
    await drain(sched);
    expect(sched.running()).toBe(false);
    // The wire the app reads: an open cycle, then a closed one with this batch's
    // counts. `cycle:done` is what makes the paper refetch.
    expect(published.map((event) => event.type)).toEqual(['cycle:start', 'cycle:done']);
    expect(published[1]).toMatchObject({ fetched: DEFAULT_BATCH_LIMIT, newItems: 24, editedItems: 0 });
    expect(sched.tally().polled).toBe(DEFAULT_BATCH_LIMIT);
    expect(db.sources.dueSources(T0.toISOString(), 200)).toHaveLength(40 - DEFAULT_BATCH_LIMIT);
  });

  it('ends the loop when stop() is called inside a batch: the batch finishes, and no sleep follows', async () => {
    const db = oneSource(20);
    let sched: Scheduler;
    const h = harness(db, {
      poll: async (spec) => {
        const result = aResult(spec.id);
        await breathe();
        sched.stop();
        return result;
      },
    });
    sched = start(h.deps);
    await drain(sched);
    await flush();
    expect(h.slept).toEqual([]);
    expect(h.logs.some((line) => line.includes('scheduler stopped'))).toBe(true);
    // The batch completed: the plan was written, so a stopped process leaves no
    // source unplanned — the difference between "stopped" and "about to be hammered".
    expect(h.logs.some((line) => line.includes('xx: cadence →'))).toBe(true);
    expect(sched.tally().batches).toBe(1);
  });
});

describe('startScheduler: what a batch may throw', () => {
  /**
   * Both tests count `batches: 1`, not 2: the publish throws **inside** the first
   * batch, so that batch never reaches its own counter. The lost count is the
   * evidence that the batch died mid-flight, and the loop is alive anyway — which
   * is the point.
   */
  const throwingHub = (cause: unknown) => {
    const db = oneSource(20);
    let first = true;
    let sleeps = 0;
    let sched: Scheduler;
    const h = harness(db, {
      // The SSE hub is the honest candidate: it is called inside the batch, after
      // the polls wrote, and a socket that throws must not stop the paper.
      publish: () => {
        if (first) {
          first = false;
          throw cause;
        }
      },
      sleep: async () => {
        sleeps += 1;
        await breathe();
        if (sleeps >= 2) sched.stop();
      },
    });
    sched = start(h.deps);
    return { db, h, sched: () => sched };
  };

  it('survives a batch that throws, and says so — a paper that stops updating is the louder failure', async () => {
    const { h, sched } = throwingHub(new Error('sse gone'));
    await drain(sched());
    expect(h.logs.filter((line) => line.includes('batch failed — sse gone'))).toHaveLength(1);
    expect(h.calls).toEqual(['xx']);
    expect(sched().tally()).toMatchObject({ batches: 1, polled: 1, planned: 1 });
  });

  it('names a batch failure that is not an Error by its string form, and keeps the loop alive', async () => {
    const { h, sched } = throwingHub('a string, not an Error');
    await drain(sched());
    expect(h.logs.filter((line) => line.includes('batch failed — a string, not an Error'))).toHaveLength(1);
    expect(sched().running()).toBe(false);
    expect(sched().tally()).toMatchObject({ batches: 1, polled: 1, planned: 1 });
  });
});
