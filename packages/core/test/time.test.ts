import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  editionDate,
  editionIdFor,
  editionWindow,
  isDue,
  jitterMs,
  nowIso,
  type RelativeParts,
  relativeParts,
} from '../src/time.ts';

const iso = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string =>
  new Date(year, month - 1, day, hour, minute, second, 0).toISOString();

const due = (over: Partial<Parameters<typeof isDue>[0]> = {}) => ({
  lastFetchAt: iso(2026, 11, 8, 10, 0),
  lastSuccessAt: iso(2026, 11, 8, 10, 0),
  cadenceMinutes: 20,
  attempts: 0,
  seed: 'npr-world',
  jitterSpanMs: 0,
  backoffBaseMs: 60_000,
  backoffMaxMs: 3_600_000,
  ...over,
});

describe('editionIdFor', () => {
  it('cuts the paper at dayStartHour, not at midnight', () => {
    expect(editionIdFor(new Date(2026, 10, 8, 7, 0), 7)).toBe('2026-11-08');
    expect(editionIdFor(new Date(2026, 10, 8, 6, 59), 7)).toBe('2026-11-07');
    expect(editionIdFor(new Date(2026, 10, 8, 23, 59), 7)).toBe('2026-11-08');
  });

  it('walks back over a month and a year boundary', () => {
    expect(editionIdFor(new Date(2026, 10, 1, 3, 0), 7)).toBe('2026-10-31');
    expect(editionIdFor(new Date(2027, 0, 1, 3, 0), 7)).toBe('2026-12-31');
  });

  it('is stable for a whole edition, padded to two digits', () => {
    expect(editionIdFor(new Date(2026, 8, 9, 12, 0), 7)).toBe('2026-09-09');
  });
});

describe('editionDate', () => {
  it('is local midnight of the edition', () => {
    const d = editionDate('2026-11-08');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 8, 0, 0]);
  });

  it('is an invalid date for an id that is not one, so the masthead shows the raw text', () => {
    expect(Number.isNaN(editionDate('yesterday').getTime())).toBe(true);
    expect(Number.isNaN(editionDate('').getTime())).toBe(true);
    expect(Number.isNaN(editionDate('2026-ab-01').getTime())).toBe(true);
  });

  it('rolls an impossible month over, the way Date does', () => {
    const d = editionDate('2026-13-01');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe('editionWindow', () => {
  it('starts at dayStartHour and ends at the same wall-clock hour the next day', () => {
    const { start, end } = editionWindow('2026-11-08', 7);
    const a = new Date(start);
    const b = new Date(end);
    expect([a.getHours(), a.getMinutes()]).toEqual([7, 0]);
    expect([b.getHours(), b.getMinutes()]).toEqual([7, 0]);
    expect(b.getDate()).toBe(a.getDate() + 1);
    expect(b.getMonth()).toBe(a.getMonth());
  });

  it('is 24 hours on a day with no DST change', () => {
    const { start, end } = editionWindow('2026-11-08', 7);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(86_400_000);
  });

  it('is the empty window for a malformed id', () => {
    expect(editionWindow('nope', 7)).toEqual({ start: '', end: '' });
  });
});

describe('jitterMs', () => {
  it('is deterministic per seed, inside the span', () => {
    const a = jitterMs('bbc-news', 120_000);
    expect(jitterMs('bbc-news', 120_000)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(120_000);
  });

  it('spreads sources across the span', () => {
    const values = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => jitterMs(seed, 120_000)));
    expect(values.size).toBeGreaterThan(3);
  });

  it('is 0 when there is no span', () => {
    expect(jitterMs('x', 0)).toBe(0);
    expect(jitterMs('x', -5)).toBe(0);
  });
});

describe('backoffMs', () => {
  it('is 0 before the first failure', () => {
    expect(backoffMs(0, 60_000, 3_600_000)).toBe(0);
    expect(backoffMs(-1, 60_000, 3_600_000)).toBe(0);
  });

  it('doubles per attempt and stops at the cap', () => {
    expect(backoffMs(1, 60_000, 3_600_000)).toBe(60_000);
    expect(backoffMs(2, 60_000, 3_600_000)).toBe(120_000);
    expect(backoffMs(3, 60_000, 3_600_000)).toBe(240_000);
    expect(backoffMs(6, 60_000, 3_600_000)).toBe(1_920_000);
    expect(backoffMs(7, 60_000, 3_600_000)).toBe(3_600_000);
  });

  it('never shifts by more than 10, so a long outage cannot overflow', () => {
    expect(backoffMs(40, 60_000, Number.MAX_SAFE_INTEGER)).toBe(60_000 * 2 ** 10);
  });
});

describe('isDue', () => {
  it('is due the first time, and when the stored timestamp is unusable', () => {
    const now = new Date(2026, 10, 8, 12, 0);
    expect(isDue(due({ lastFetchAt: null }), now)).toBe(true);
    expect(isDue(due({ lastFetchAt: 'not a timestamp' }), now)).toBe(true);
  });

  it('is not due before the cadence has passed', () => {
    expect(isDue(due(), new Date(2026, 10, 8, 10, 19, 59))).toBe(false);
    expect(isDue(due(), new Date(2026, 10, 8, 10, 20))).toBe(true);
  });

  it('adds deterministic jitter to the due time', () => {
    const base = new Date(2026, 10, 8, 10, 20).getTime();
    const jitter = jitterMs('npr-world', 120_000);
    const input = due({ jitterSpanMs: 120_000 });
    expect(jitter).toBeGreaterThan(0);
    expect(isDue(input, new Date(base + jitter - 1))).toBe(false);
    expect(isDue(input, new Date(base + jitter))).toBe(true);
  });

  it('adds the failure backoff on top of the cadence', () => {
    // attempts 3 with a 60 s base is a 240 s penalty: 20 + 4 = 24 minutes.
    expect(backoffMs(3, 60_000, 3_600_000)).toBe(240_000);
    const input = due({ attempts: 3 });
    expect(isDue(input, new Date(2026, 10, 8, 10, 23, 59))).toBe(false);
    expect(isDue(input, new Date(2026, 10, 8, 10, 24))).toBe(true);
  });
});

describe('relativeParts', () => {
  const now = new Date(2026, 10, 8, 12, 0, 0, 0);
  const parts = (minutesAgo: number): RelativeParts => relativeParts(iso(2026, 11, 8, 12, 0 - minutesAgo), now);

  it('is an unformattable part for a missing or unparsable instant', () => {
    for (const input of [null, 'yesterday', '']) {
      const result = relativeParts(input, now);
      expect(result.unit).toBeNull();
      expect(result.delta).toBe(0);
      expect(Number.isNaN(result.at.getTime())).toBe(true);
    }
  });

  it('counts minutes while it is today, in the past as a negative delta', () => {
    expect(parts(0)).toMatchObject({ unit: 'minute', delta: 0 });
    expect(parts(1)?.unit).toBe('minute');
    expect(parts(1)?.delta).toBe(-1);
    expect(parts(44)).toMatchObject({ unit: 'minute', delta: -44 });
    // Under 30 seconds rounds to a 0-minute delta; `Intl` cannot phrase that
    // ("in 0 minutes"), so the app renders its own "just now". And it must be
    // `0`, not `-0`: `Object.is(-0, 0)` is false, so a `-0` breaks equality
    // checks in adapters and gives a memo two keys for one state.
    const moment = relativeParts(iso(2026, 11, 8, 11, 59, 40), now);
    expect(moment).toMatchObject({ unit: 'minute', delta: 0 });
    expect(Object.is(moment.delta, 0)).toBe(true);
  });

  it('switches to hours past 45 minutes, so the number never gets silly', () => {
    expect(parts(45)).toMatchObject({ unit: 'hour', delta: -1 });
    expect(parts(180)).toMatchObject({ unit: 'hour', delta: -3 });
  });

  it('counts days, then weeks', () => {
    const days = (n: number): RelativeParts => relativeParts(iso(2026, 11, 8 - n, 12, 0), now);
    expect(days(1)).toMatchObject({ unit: 'day', delta: -1 });
    expect(days(6)).toMatchObject({ unit: 'day', delta: -6 });
    expect(days(7)).toMatchObject({ unit: 'week', delta: -1 });
    expect(days(12)).toMatchObject({ unit: 'week', delta: -2 });
  });

  it('counts months, then gives up and asks for an absolute date', () => {
    const days = (n: number): RelativeParts => relativeParts(iso(2026, 11, 8 - n, 12, 0), now);
    expect(days(13)).toMatchObject({ unit: 'month', delta: -1 });
    expect(days(20)).toMatchObject({ unit: 'month', delta: -1 });
    expect(days(29)).toMatchObject({ unit: 'month', delta: -1 });
    expect(days(31)).toMatchObject({ unit: null, delta: 0 });
  });

  it('counts years for a caller that asks for relative text beyond a month', () => {
    const parts365 = relativeParts(iso(2026, 11, 8 - 400, 12, 0), now, 500);
    expect(parts365).toMatchObject({ unit: 'year', delta: -1 });
    expect(relativeParts(iso(2026, 11, 8 - 400, 12, 0), now, 50).unit).toBeNull();
  });

  it('is a positive delta for the future, which is what RelativeTimeFormat renders as "in n"', () => {
    const future = relativeParts(iso(2026, 11, 8, 15, 0), now);
    expect(future).toMatchObject({ unit: 'hour', delta: 3 });
  });

  it('returns the instant it was given, unparsed twice', () => {
    const result = relativeParts(iso(2026, 11, 8, 11, 30), now);
    expect(result.at.toISOString()).toBe(iso(2026, 11, 8, 11, 30));
  });
});

describe('nowIso', () => {
  it('is a timestamp the parsers accept', () => {
    const value = nowIso();
    expect(Number.isNaN(Date.parse(value))).toBe(false);
    expect(value.endsWith('Z')).toBe(true);
  });
});
