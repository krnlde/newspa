/**
 * The plan: when a source runs next, and which rule says so. Pure function, so
 * every rule in the policy is pinned here without a clock, a socket or a db —
 * the loop that reads these numbers is `scheduler.test.ts`.
 *
 * The instants are **local** (`new Date(y, m, d, h)`), because quiet hours and
 * cron are defined in local time (core's `inQuietHours` reads `getHours()`).
 * A UTC fixture here would assert a date the scheduler would never produce in a
 * non-UTC zone.
 */
import { describe, expect, it } from 'vitest';
import { type PlanInput, planNextRun } from '../src/schedulePlan.ts';
import { anHtmlSpec, anRssSpec } from './support.ts';

/** Local 2026-11-09 10:00. */
const morning = new Date(2026, 10, 9, 10, 0, 0);

/** The config the scheduler passes: a 6-hour backoff ceiling, pause at 6 failures. */
const caps = { capMinutes: 300, maxFailuresBeforePause: 6 };

const planOf = (input: Partial<PlanInput> & { spec?: PlanInput['spec'] } = {}) =>
  planNextRun({
    spec: input.spec ?? anRssSpec(),
    failures: input.failures ?? 0,
    now: input.now ?? morning,
    capMinutes: input.capMinutes ?? caps.capMinutes,
    maxFailuresBeforePause: input.maxFailuresBeforePause ?? caps.maxFailuresBeforePause,
  });

const minutesFrom = (at: Date, from: Date): number => Math.round((at.getTime() - from.getTime()) / 60_000);

describe('planNextRun: cadence', () => {
  it('gives the authored cadence, from the instant it was handed', () => {
    const plan = planOf({ spec: anRssSpec({ cadenceMinutes: 20 }) });
    expect(plan.minutes).toBe(20);
    expect(plan.nextRunAt).toEqual(new Date(morning.getTime() + 20 * 60_000));
    expect(plan.why).toBe('cadence');
  });

  it('plans from `now`, not from a clock it reads (a test must be able to pin the instant)', () => {
    const at = new Date(2026, 10, 9, 23, 30, 0);
    expect(planOf({ spec: anRssSpec({ cadenceMinutes: 5 }), now: at }).nextRunAt).toEqual(
      new Date(2026, 10, 9, 23, 35, 0),
    );
  });
});

describe('planNextRun: the rendered floor (D-033)', () => {
  it('refuses to poll a rendered source faster than 5 minutes', () => {
    const plan = planOf({ spec: anHtmlSpec({ render: true, cadenceMinutes: 1 }) });
    expect(plan.minutes).toBe(5);
    expect(plan.why).toBe('cadence + render floor 5 min');
  });

  it('applies the floor after the backoff, so a failing rendered source is never faster than the floor', () => {
    // 1 × 4 = 4 min of backoff, and the floor is still the binding rule.
    expect(planOf({ spec: anHtmlSpec({ render: true, cadenceMinutes: 1 }), failures: 1 }).minutes).toBe(5);
  });

  it('leaves a plain feed at 1 minute (the floor is about browser launches, not about cadence)', () => {
    expect(planOf({ spec: anRssSpec({ cadenceMinutes: 1 }) }).minutes).toBe(1);
  });
});

describe('planNextRun: backoff', () => {
  it('multiplies by 4 per consecutive failure, and names the rule', () => {
    const spec = anRssSpec({ cadenceMinutes: 15 });
    expect(planOf({ spec, failures: 1 })).toMatchObject({ minutes: 60, why: 'backoff after 1 failure(s)' });
    expect(planOf({ spec, failures: 2 })).toMatchObject({ minutes: 240, why: 'backoff after 2 failure(s)' });
  });

  it('stops at the ceiling', () => {
    // 15 × 4³ = 960, ceiling 300.
    expect(planOf({ spec: anRssSpec({ cadenceMinutes: 15 }), failures: 3 }).minutes).toBe(300);
  });

  it('pauses at `maxFailuresBeforePause`, which is the ceiling — and says so, not "backoff"', () => {
    const plan = planOf({ spec: anRssSpec({ cadenceMinutes: 15 }), failures: 6 });
    expect(plan.minutes).toBe(300);
    expect(plan.why).toBe('paused after 6 failure(s)');
  });

  it('never plans faster than the authored cadence, whatever the arithmetic', () => {
    // 10 080 min weekly source, cap 300: the author's interval is the slower one.
    expect(planOf({ spec: anRssSpec({ cadenceMinutes: 10_080 }), failures: 1 }).minutes).toBe(10_080);
  });
});

describe('planNextRun: cron', () => {
  const at0700 = anRssSpec({ cadenceCron: '0 7 * * *', cadenceMinutes: 20 });

  it('is the earliest allowed time, honoured exactly, at zero failures', () => {
    const plan = planOf({ spec: at0700 });
    expect(plan.nextRunAt).toEqual(new Date(2026, 10, 10, 7, 0, 0));
    expect(plan.why).toBe('cron 0 7 * * *');
  });

  it('outranks the cadence (a 07:00 publisher is read at 07:01, not 20 minutes later)', () => {
    expect(minutesFrom(planOf({ spec: at0700 }).nextRunAt, morning)).toBe(1_260);
  });

  it('yields to the backoff at one failure — a cron-anchored source must not re-hammer a 429', () => {
    const plan = planOf({ spec: at0700, failures: 1 });
    expect(plan.minutes).toBe(80); // 20 × 4
    expect(plan.why).toBe('backoff after 1 failure(s)');
  });

  it('yields to a pause, and returns on the first success', () => {
    expect(planOf({ spec: at0700, failures: 6 }).why).toBe('paused after 6 failure(s)');
    expect(planOf({ spec: at0700, failures: 0 }).why).toBe('cron 0 7 * * *');
  });
});

describe('planNextRun: quiet hours', () => {
  it('pushes an instant inside a daytime window to the window end, and says both rules', () => {
    const spec = anRssSpec({ cadenceMinutes: 15, quietHours: { startHour: 6, endHour: 23 } });
    const plan = planOf({ spec });
    expect(plan.nextRunAt).toEqual(new Date(2026, 10, 9, 23, 0, 0));
    expect(plan.why).toBe('cadence + quiet hours');
    expect(plan.minutes).toBe(780);
  });

  it('leaves an instant outside the window alone (no push, no note)', () => {
    const spec = anRssSpec({ cadenceMinutes: 15, quietHours: { startHour: 6, endHour: 9 } });
    expect(planOf({ spec }).why).toBe('cadence');
  });

  it('is end-exclusive: an instant at the end hour is pollable', () => {
    const spec = anRssSpec({ cadenceMinutes: 15, quietHours: { startHour: 6, endHour: 23 } });
    const at2250 = new Date(2026, 10, 9, 22, 50, 0);
    expect(planOf({ spec, now: at2250 })).toMatchObject({
      nextRunAt: new Date(2026, 10, 9, 23, 5, 0),
      why: 'cadence',
    });
  });

  it('pushes a window that wraps past midnight to tomorrow', () => {
    const spec = anRssSpec({ cadenceMinutes: 15, quietHours: { startHour: 23, endHour: 7 } });
    const at2250 = new Date(2026, 10, 9, 22, 50, 0);
    const plan = planOf({ spec, now: at2250 });
    expect(plan.nextRunAt).toEqual(new Date(2026, 10, 10, 7, 0, 0));
    expect(plan.minutes).toBe(490);
    expect(plan.why).toBe('cadence + quiet hours');
  });

  it('pushes a cron instant too (the window is the reader’s decision, not the cadence’s)', () => {
    const spec = anRssSpec({ cadenceCron: '30 8 * * *', quietHours: { startHour: 6, endHour: 23 } });
    expect(planOf({ spec })).toMatchObject({
      nextRunAt: new Date(2026, 10, 10, 23, 0, 0),
      why: 'cron 30 8 * * * + quiet hours',
    });
  });
});
