import { describe, expect, it, vi } from 'vitest';
import { formatFor } from '../../src/format.ts';
import { localeFor } from './support/locale.ts';

/**
 * `format.ts` is the paper's two renderings of one instant, and a clock: the
 * **age** the page prints, and the **stamp** its tooltip carries. The decision
 * that matters is **whose clock** — the file takes `now` as an argument, so a
 * test can pin an age to an instant. Every fixture here is built from the
 * *injected* `now`, which is what makes the age independent of the machine's
 * date; the stamp does not depend on it at all, and that is asserted too — a
 * tooltip that drifted with the clock would be a lie about a date.
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

describe('stamp', () => {
  it('names the date, the clock and the zone — the zone is the whole reason it exists', () => {
    const format = formatFor(en, () => NOW);
    const iso = NOW.toISOString();
    expect(format.stamp(iso)).toContain(String(NOW.getFullYear()));
    // An age is a distance from the reader's clock, so the exact answer has to say
    // which clock: a date without a zone is a number the reader cannot check.
    expect(format.stamp(iso)).toMatch(/GMT|UTC/u);
    expect(format.stamp(iso)).toBe(en.stamp(iso));
  });

  it('follows the language of the page, not the machine (D-019)', () => {
    const iso = NOW.toISOString();
    expect(formatFor(en, () => NOW).stamp(iso)).toBe(en.stamp(iso));
    expect(formatFor(de, () => NOW).stamp(iso)).toBe(de.stamp(iso));
    expect(formatFor(de, () => NOW).stamp(iso)).toMatch(/November/u);
    expect(formatFor(en, () => NOW).stamp(iso)).not.toBe(formatFor(de, () => NOW).stamp(iso));
  });

  it('prints the same instant under any injected `now`: a tooltip is a date, not an age', () => {
    const iso = stampAt(NOW, 9, 30);
    expect(formatFor(en, () => NOW).stamp(iso)).toBe(formatFor(en, () => new Date(NOW.getTime() + DAY)).stamp(iso));
    expect(formatFor(en).stamp(iso)).toBe(formatFor(en, () => NOW).stamp(iso));
  });

  it('is empty for a stamp the paper cannot print, so no tooltip says "Invalid Date"', () => {
    const format = formatFor(en, () => NOW);
    for (const iso of [null, '', 'yesterday', 'not-a-date', '2026-13-40T99:99:99Z']) {
      expect(format.stamp(iso)).toBe('');
    }
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
    expect(first.stamp(iso)).toBe(en.stamp(iso));
    expect(second.stamp(iso)).toBe(de.stamp(iso));
    expect(first.stamp(iso)).not.toBe(second.stamp(iso));
  });
});
