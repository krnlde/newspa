/**
 * One batch (WP3): `runBatch` picks the sources that are due, polls them in the
 * db's order, and writes each one's plan. The loop, the claim and what the loop
 * survives are in `scheduler-loop.test.ts`; the plan's arithmetic is pinned in
 * `schedulePlan.test.ts`, so nothing here depends on a time zone.
 */

import type { SourceSpec } from 'newspa-config';
import { type ServerEvent, serverEventSchema } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import type { PollResult } from '../src/pollTypes.ts';
import { DEFAULT_BATCH_LIMIT, runBatch } from '../src/scheduler.ts';
import {
  aResult,
  config,
  emptyTally,
  harness,
  isoAt,
  oneSource,
  openSchedDb,
  scheduleOf,
  T0,
} from './schedulerSupport.ts';
import { addSource, anHtmlSpec, anRssSpec } from './support.ts';

describe('runBatch: what it polls', () => {
  it('polls every source of a fresh database, once, in id order, and plans each at its cadence', async () => {
    const db = openSchedDb();
    for (const id of ['bb', 'aa', 'cc']) addSource(db, anRssSpec({ id, cadenceMinutes: 20 }));
    const h = harness(db);

    expect(await runBatch(h.deps, emptyTally())).toMatchObject({ batches: 1, polled: 3, failed: 0, planned: 3 });
    expect(h.calls).toEqual(['aa', 'bb', 'cc']);
    expect(db.sources.dueSources(isoAt(19), 10)).toEqual([]);
    expect(db.sources.dueSources(isoAt(20), 10).map((source) => source.spec.id)).toEqual(['aa', 'bb', 'cc']);
    expect(scheduleOf(db, 'aa')).toEqual({ nextRunAt: isoAt(20), failures: 0 });
  });

  it('is a no-op batch when nothing is due — and still counts the batch', async () => {
    const db = oneSource(20);
    const h = harness(db);
    await runBatch(h.deps, emptyTally());
    expect(await runBatch(h.deps, emptyTally())).toMatchObject({
      batches: 1,
      polled: 0,
      planned: 0,
      lastBatchAt: T0.toISOString(),
    });
    expect(h.calls).toEqual(['xx']);
  });

  it('takes a bounded batch, so 30 sources are caught up in 24 + 6', async () => {
    const db = openSchedDb();
    for (let i = 0; i < 30; i += 1) addSource(db, anRssSpec({ id: `s${String(i).padStart(2, '0')}` }));
    const h = harness(db);
    expect((await runBatch(h.deps, emptyTally())).polled).toBe(DEFAULT_BATCH_LIMIT);
    expect(db.sources.dueSources(T0.toISOString(), 200)).toHaveLength(30 - DEFAULT_BATCH_LIMIT);
    expect((await runBatch(h.deps, emptyTally())).polled).toBe(6);
    expect(db.sources.dueSources(T0.toISOString(), 200)).toEqual([]);
  });

  it('leaves a disabled source alone — not polled, not planned, countdown untouched', async () => {
    const db = openSchedDb();
    addSource(db, anRssSpec({ id: 'on' }));
    addSource(db, anRssSpec({ id: 'off' }));
    db.sources.setEnabled('off', false);
    const h = harness(db);
    await runBatch(h.deps, emptyTally());
    expect(h.calls).toEqual(['on']);
    // Raw SQL on purpose: a disabled source is invisible to `dueSources` — that is
    // the filter — and `StoredSource` has no schedule fields by design, so this is
    // the only read left that can prove the countdown was never written.
    expect(db.tx.get('select next_run_at, consecutive_failures from sources where id = ?', 'off')).toEqual({
      next_run_at: null,
      consecutive_failures: 0,
    });
  });

  it('applies the rendered floor through the loop (D-033: 1 min becomes 5)', async () => {
    const db = openSchedDb();
    addSource(db, anHtmlSpec({ id: 'rr', render: true, cadenceMinutes: 1 }));
    await runBatch(harness(db).deps, emptyTally());
    expect(scheduleOf(db, 'rr').nextRunAt).toBe(isoAt(5));
  });

  it('sleeps the jitter once per batch, not once per source, and uses the caller’s random', async () => {
    const db = openSchedDb();
    for (const id of ['aa', 'bb', 'cc']) addSource(db, anRssSpec({ id }));
    const h = harness(db, { config: { ...config, jitterSpanMs: 120_000 }, random: () => 0.5 });
    await runBatch(h.deps, emptyTally());
    expect(h.slept).toEqual([60_000]);
    expect(h.calls).toHaveLength(3);
  });

  it('jitters within the span when the caller gives no random (production has none)', async () => {
    const db = openSchedDb();
    for (const id of ['aa', 'bb', 'cc']) addSource(db, anRssSpec({ id }));
    const h = harness(db, { config: { ...config, jitterSpanMs: 120_000 } });
    await runBatch(h.deps, emptyTally());
    expect(h.slept).toHaveLength(1);
    const ms = h.slept[0] ?? -1;
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThan(120_000);
  });
});

describe('runBatch: the events the paper reads', () => {
  it('publishes cycle:start then cycle:done, with this batch’s own counts, on the wire schema', async () => {
    const db = openSchedDb();
    addSource(db, anRssSpec({ id: 'aa', cadenceMinutes: 20 }));
    addSource(db, anRssSpec({ id: 'bb', cadenceMinutes: 20 }));
    const published: ServerEvent[] = [];
    const h = harness(db, {
      publish: (event) => {
        published.push(event);
      },
      poll: async (spec) => aResult(spec.id, { newItems: spec.id === 'aa' ? 3 : 1, editedItems: 2 }),
    });

    await runBatch(h.deps, emptyTally());
    expect(published).toEqual([
      { type: 'cycle:start', at: T0.toISOString() },
      { type: 'cycle:done', at: T0.toISOString(), fetched: 2, newItems: 4, editedItems: 4 },
    ]);
    // Contract test, the roadmap's rule: an event that fails its own schema is a
    // failing test here, not a client that silently ignores every push.
    for (const event of published) expect(serverEventSchema.parse(event).type).toBe(event.type);
    expect(serverEventSchema.parse(published[1] ?? {}).type).toBe('cycle:done');
  });

  it('publishes nothing for a batch with no work — a flash every 60 seconds is noise, not a cycle', async () => {
    const db = oneSource(20);
    const published: ServerEvent[] = [];
    const h = harness(db, {
      publish: (event) => {
        published.push(event);
      },
    });
    await runBatch(h.deps, emptyTally());
    published.length = 0;
    await runBatch(h.deps, emptyTally());
    expect(published).toEqual([]);
  });

  it('counts a poll that skipped the item pass as nothing new, and closes the cycle anyway', async () => {
    const db = oneSource(20);
    const published: ServerEvent[] = [];
    const h = harness(db, {
      publish: (event) => {
        published.push(event);
      },
      poll: async (spec) => aResult(spec.id, { outcome: 'not-modified', itemCount: null, newItems: 0 }),
    });
    await runBatch(h.deps, emptyTally());
    expect(published[1]).toEqual({ type: 'cycle:done', at: T0.toISOString(), fetched: 1, newItems: 0, editedItems: 0 });
  });

  it('a poll that throws leaves the cycle closed, with the work that did happen counted', async () => {
    const db = openSchedDb();
    addSource(db, anRssSpec({ id: 'aa', cadenceMinutes: 20 }));
    addSource(db, anRssSpec({ id: 'bb', cadenceMinutes: 20 }));
    const published: ServerEvent[] = [];
    const h = harness(db, {
      publish: (event) => {
        published.push(event);
      },
      poll: async (spec) => {
        if (spec.id === 'bb') throw new Error('socket died');
        return aResult(spec.id, { newItems: 5 });
      },
    });
    await runBatch(h.deps, emptyTally());
    expect(published[1]).toMatchObject({ fetched: 1, newItems: 5 });
  });
});

describe('runBatch: failure, and the report that comes with it', () => {
  /** One source at 10 min, cap 60: backoff at 1 is 40, a pause is the cap. */
  const failing = (poll: (spec: SourceSpec) => Promise<PollResult>) => {
    const db = oneSource();
    return { db, h: harness(db, { poll }) };
  };

  it('counts a non-ok health and plans the ×4 backoff it implies', async () => {
    const { db, h } = failing(async (spec) => aResult(spec.id, { health: 'blocked' }));
    expect(await runBatch(h.deps, emptyTally())).toMatchObject({ polled: 0, failed: 1, planned: 1 });
    expect(scheduleOf(db, 'xx')).toEqual({ nextRunAt: isoAt(40), failures: 1 });
    expect(h.logs).toEqual(['xx: backoff after 1 failure(s) → 2026-11-09T10:40:00.000Z (+40 min)']);
  });

  it('pauses at `maxFailuresBeforePause`, and says "paused", not "backoff"', async () => {
    const { db, h } = failing(async (spec) => aResult(spec.id, { health: 'error' }));
    db.sources.setSchedule('xx', T0.toISOString(), config.maxFailuresBeforePause - 1);
    await runBatch(h.deps, emptyTally());
    expect(scheduleOf(db, 'xx')).toEqual({ nextRunAt: isoAt(60), failures: 6 });
    expect(h.logs[0]).toContain('paused after 6 failure(s)');
  });

  it('a poll that throws is a report, a counted failure and a plan — the loop never sees it', async () => {
    const { db, h } = failing(async () => {
      throw new Error('socket died');
    });
    expect(await runBatch(h.deps, emptyTally())).toMatchObject({ polled: 0, failed: 1, planned: 1 });
    expect(h.logs[0]).toContain('xx: poll threw — socket died');
    expect(scheduleOf(db, 'xx')).toEqual({ nextRunAt: isoAt(40), failures: 1 });
  });

  it('names a thrown value that is not an Error by its string form, and plans both sources', async () => {
    const db = openSchedDb();
    addSource(db, anRssSpec({ id: 'xx', cadenceMinutes: 10 }));
    addSource(db, anRssSpec({ id: 'yy', cadenceMinutes: 10 }));
    const h = harness(db, {
      poll: async (spec) => {
        throw spec.id === 'xx' ? new Error('socket died') : 'a string, not an Error';
      },
    });
    expect(await runBatch(h.deps, emptyTally())).toMatchObject({ polled: 0, failed: 2, planned: 2 });
    expect(h.logs.filter((line) => line.includes('poll threw'))).toEqual([
      'xx: poll threw — socket died',
      'yy: poll threw — a string, not an Error',
    ]);
    expect(scheduleOf(db, 'yy')).toEqual({ nextRunAt: isoAt(40), failures: 1 });
  });

  it('clears the count on `health: "ok"` — the backoff is a streak, not a lifetime', async () => {
    const { db, h } = failing(async (spec) => aResult(spec.id));
    db.sources.setSchedule('xx', T0.toISOString(), 5);
    await runBatch(h.deps, emptyTally());
    expect(scheduleOf(db, 'xx')).toEqual({ nextRunAt: isoAt(10), failures: 0 });
    expect(h.logs[0]).toContain('xx: cadence →');
  });
});
