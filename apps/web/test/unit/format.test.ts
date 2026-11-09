import { describe, expect, it, vi } from 'vitest';
import { formatFor } from '../../src/format.ts';
import { localeFor } from './support/locale.ts';

/**
 * `format.ts` is two decisions and a clock: today → wall clock, older → date,
 * and an age from core's relative parts. The decision that matters is **whose
 * clock** — the file takes `now` as an argument, so a test can pin "is this
 * today?" to an instant. Every fixture here is built from the *injected*
 * `now`, which is what makes the test independent of the machine's date.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Local noon yesterday: a day that is never "today", and a whole day of
 * same-day instants to test against (midnight boundary included). */
const noonYesterday = (): Date => {
  const at = new Date();
  at.setDate(at.getDate() - 1);
  at.setHours(12, 0, 0, 0);
  return at;
};

const NOW = noonYesterday();

/** An instant on `day` at a local time, as the ISO string the paper gets. */
const stampAt = (day: Date, hour: number, minute = 0): string => {
  const at = new Date(day);
  at.setHours(hour, minute, 0, 0);
  return at.toISOString();
};

const en = localeFor('en');
const de = localeFor('de');

describe('published', () => {
  it('shows the clock for an instant on the injected day', () => {
    const format = formatFor(en, () => NOW);
    const morning = stampAt(NOW, 9, 30);
    expect(format.published(morning)).toBe(en.time(morning));
    expect(format.published(morning)).toMatch(/\d{1,2}:\d{2}/);
    expect(format.published(morning)).not.toContain(String(NOW.getFullYear()));
  });

  it('shows the date for an older instant, in the reader’s calendar', () => {
    const format = formatFor(en, () => NOW);
    const older = new Date(NOW.getTime() - 90 * DAY).toISOString();
    expect(format.published(older)).toBe(en.date(older));
    expect(format.published(older)).toContain(String(new Date(older).getFullYear()));
    expect(formatFor(de, () => NOW).published(older)).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/);
  });

  it('is a clock before local midnight and a date after it', () => {
    const format = formatFor(en, () => NOW);
    const late = stampAt(NOW, 23, 59);
    expect(format.published(late)).toBe(en.time(late));
    const nextDay = new Date(NOW.getTime() + DAY);
    const justAfterMidnight = stampAt(nextDay, 0, 15);
    expect(format.published(justAfterMidnight)).toBe(en.date(justAfterMidnight));
    expect(format.published(justAfterMidnight)).toContain(String(nextDay.getFullYear()));
  });

  it('is empty for a stamp the paper cannot print', () => {
    const format = formatFor(en, () => NOW);
    for (const iso of [null, '', 'yesterday', 'not-a-date', '2026-13-40T99:99:99Z']) {
      expect(format.published(iso)).toBe('');
    }
  });

  it('reads the injected `now`, never the wall clock', () => {
    const format = formatFor(en, () => NOW);
    const live = new Date().toISOString();
    // A stamp from the live clock is **not** on the injected day, so it must
    // print as a date. If it printed as a clock time, `published` is reading
    // `Date.now()` and a test of "is this today?" would be a coin flip.
    expect(format.published(live)).toBe(en.date(live));
    // And the default `now` is the clock, i.e. the way a component calls it.
    const thisMinute = new Date().toISOString();
    const asClock = formatFor(en).published(thisMinute);
    expect(asClock).toBe(en.time(thisMinute));
    expect(asClock).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('ago', () => {
  it('delegates to the locale’s relative formatter with the injected `now`', () => {
    const relative = vi.fn(() => 'spied');
    const format = formatFor({ ...en, relative }, () => NOW);
    const iso = stampAt(NOW, 10, 0);
    expect(format.ago(iso)).toBe('spied');
    expect(relative.mock.calls).toEqual([[iso, NOW]]);
  });

  it('measures the age against the injected instant, in the reader’s language', () => {
    expect(formatFor(en, () => NOW).ago(new Date(NOW.getTime() - 2 * HOUR).toISOString())).toBe('2 hours ago');
    expect(formatFor(de, () => NOW).ago(new Date(NOW.getTime() - 2 * HOUR).toISOString())).toBe('vor 2 Stunden');
    expect(formatFor(en, () => NOW).ago(NOW.toISOString())).toBe('just now');
  });

  it('is stable for the same pair of instants, so a render loop cannot drift', () => {
    const format = formatFor(en, () => NOW);
    const iso = new Date(NOW.getTime() - 3 * HOUR).toISOString();
    expect(format.ago(iso)).toBe(format.ago(iso));
    expect(format.ago(iso)).toBe('3 hours ago');
  });

  it('uses the clock when no `now` is injected', () => {
    const format = formatFor(en);
    expect(format.ago(new Date().toISOString())).toBe('just now');
    expect(format.ago(new Date(Date.now() - 2 * HOUR).toISOString())).toBe('2 hours ago');
  });
});

describe('the format object', () => {
  it('is a fresh object per call, bound to the locale it is handed', () => {
    const first = formatFor(en, () => NOW);
    const second = formatFor(de, () => NOW);
    expect(first).not.toBe(second);
    const iso = new Date(NOW.getTime() - 90 * DAY).toISOString();
    expect(first.published(iso)).toBe(en.date(iso));
    expect(second.published(iso)).toBe(de.date(iso));
  });
});
