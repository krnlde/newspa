import { describe, expect, it } from 'vitest';
import {
  cachedLanguageCount,
  formatAbsolute,
  formatCount,
  formatRelative,
  formatTime,
  formattersFor,
  supportedLanguages,
} from '../../src/lib/intl.ts';

/**
 * The app's whole locale surface: four renderings (age, instant, clock, count),
 * built per language, cached by language. The zone clauses are the load-bearing
 * ones (D-047): an age is measured from the reader's clock, so every absolute
 * form has to say which clock it is written on. The offset assertions are
 * zone-agnostic — `+01:00`, `+00:00`, `-05:00` all pass — so this file does not
 * depend on the machine's time zone.
 */

const at = (iso: string): Date => new Date(iso);
const en = formattersFor('en');
const de = formattersFor('de');
const OFFSET = /[+-]\d{2}:\d{2}/u;

describe('formattersFor', () => {
  it('is memoised per language, so a render loop does not rebuild `Intl`', () => {
    expect(formattersFor('en')).toBe(formattersFor('en'));
    expect(formattersFor('en')).toBe(en);
  });

  it('falls back to the default language for an unsupported tag', () => {
    expect(formattersFor('klingon')).toBe(en);
    expect(formattersFor('de-AT').language).toBe('de');
  });

  it('caches at most one entry per supported language', () => {
    for (const language of [...supportedLanguages(), 'fr', 'klingon', 'de-AT']) formattersFor(language);
    expect(cachedLanguageCount()).toBe(supportedLanguages().length);
  });

  it('formats the same instant differently per language', () => {
    const iso = '2026-11-08T10:30:00.000Z';
    expect(formatAbsolute(iso, en)).not.toBe(formatAbsolute(iso, de));
  });
});

describe('formatRelative', () => {
  const now = at('2026-11-08T12:00:00.000Z');

  it('is empty for an instant that cannot be rendered', () => {
    expect(formatRelative({ unit: null, delta: 0, at: new Date(Number.NaN) }, en, { now: 'just now' })).toBe('');
  });

  it('falls back to the absolute form when core says the story is no longer recent', () => {
    // The page has **one** way to write a date (D-047): the month-old fallback is
    // the same rendering the tooltip carries, so "seen 8 November 2026 …" and the
    // card's tooltip cannot tell two stories.
    const iso = '2026-10-01T10:00:00.000Z';
    expect(formatRelative({ unit: null, delta: 0, at: at(iso) }, de, { now: 'gerade eben' })).toBe(
      formatAbsolute(iso, de),
    );
  });

  it('names the zone even in the visible fallback, so a date is a day somewhere', () => {
    const out = formatRelative({ unit: null, delta: 0, at: at('2026-10-01T10:00:00.000Z') }, en, { now: 'now' });
    expect(out).toMatch(OFFSET);
    expect(out).toContain('2026');
  });

  it('renders a zero-minute delta as "just now", because `Intl` says "in 0 minutes"', () => {
    expect(formatRelative({ unit: 'minute', delta: 0, at: now }, en, { now: 'just now' })).toBe('just now');
    expect(formatRelative({ unit: 'minute', delta: 0, at: now }, de, { now: 'gerade eben' })).toBe('gerade eben');
  });

  it('hands the unit straight to `Intl.RelativeTimeFormat`, signed', () => {
    expect(formatRelative({ unit: 'minute', delta: -3, at: now }, en, { now: 'now' })).toBe('3 minutes ago');
    expect(formatRelative({ unit: 'hour', delta: -2, at: now }, de, { now: 'jetzt' })).toBe('vor 2 Stunden');
    expect(formatRelative({ unit: 'day', delta: -1, at: now }, en, { now: 'now' })).toBe('yesterday');
    expect(formatRelative({ unit: 'week', delta: -2, at: now }, en, { now: 'now' })).toBe('2 weeks ago');
    expect(formatRelative({ unit: 'month', delta: -1, at: now }, en, { now: 'now' })).toBe('last month');
    expect(formatRelative({ unit: 'year', delta: -1, at: now }, en, { now: 'now' })).toBe('last year');
    expect(formatRelative({ unit: 'minute', delta: 5, at: now }, en, { now: 'now' })).toBe('in 5 minutes');
  });
});

describe('the absolute instant', () => {
  const iso = '2026-11-08T10:30:00.000Z';

  it('writes the date, the clock and the offset: `8 November 2026 at 10:30 AM +01:00`', () => {
    const out = formatAbsolute(iso, en);
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{1,2}:\d{2}/u);
    expect(out).toMatch(OFFSET);
  });

  it('drops the `GMT` prefix, and keeps a language that names the zone its own way', () => {
    // Measured: `Intl` spells `timeZoneName: 'longOffset'` as `GMT+01:00`, and the
    // page writes `+01:00`. A language that prints `UTC+01:00` (French) is left
    // alone — that is what that language calls the zone, and rewriting it is the
    // page overruling the locale.
    expect(formatAbsolute(iso, en)).not.toContain('GMT');
    expect(formatAbsolute(iso, de)).not.toContain('GMT');
    expect(formatTime(iso, en)).not.toContain('GMT');
  });

  it('names the zone in the clock too, because "13:58" is a time somewhere', () => {
    expect(formatTime(iso, en)).toMatch(/\d{1,2}:\d{2}/u);
    expect(formatTime(iso, en)).toMatch(OFFSET);
  });

  it('is empty for a missing or unparsable instant, so "Invalid Date" never reaches the paper', () => {
    for (const format of [formatAbsolute, formatTime]) {
      expect(format(null, en)).toBe('');
      expect(format('yesterday', en)).toBe('');
      expect(format('', en)).toBe('');
    }
  });
});

describe('counts', () => {
  it('use the language’s grouping separators', () => {
    expect(formatCount(1234, en)).toBe('1,234');
    expect(formatCount(1234, de)).toBe('1.234');
  });
});
