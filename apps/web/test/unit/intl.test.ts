import { describe, expect, it } from 'vitest';
import {
  cachedLanguageCount,
  formatCompactCount,
  formatCount,
  formatDate,
  formatDateTime,
  formatDayHead,
  formatRelative,
  formatStamp,
  formatTime,
  formattersFor,
  supportedLanguages,
} from '../../src/lib/intl.ts';

const at = (iso: string): Date => new Date(iso);
const en = formattersFor('en');
const de = formattersFor('de');

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
    expect(formatDateTime(iso, en)).not.toBe(formatDateTime(iso, de));
    expect(formatDate(iso, de)).toMatch(/\./);
  });
});

describe('formatRelative', () => {
  const now = at('2026-11-08T12:00:00.000Z');
  const parts = (iso: string | null) => {
    const parsed = iso === null ? Number.NaN : Date.parse(iso);
    return { parsed, date: new Date(parsed) };
  };

  it('is empty for an instant that cannot be rendered', () => {
    expect(formatRelative({ unit: null, delta: 0, at: new Date(Number.NaN) }, en, { now: 'just now' })).toBe('');
    expect(parts(null).parsed).toBe(Number.NaN);
  });

  it('asks for an absolute date when core says the story is no longer recent', () => {
    const out = formatRelative({ unit: null, delta: 0, at: at('2026-10-01T10:00:00.000Z') }, de, {
      now: 'gerade eben',
    });
    expect(out).toBe(formatDate('2026-10-01T10:00:00.000Z', de));
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

describe('the instant formatters', () => {
  const iso = '2026-11-08T10:30:00.000Z';

  it('are empty for a missing or unparsable instant, so "Invalid Date" never reaches the paper', () => {
    for (const format of [formatTime, formatDateTime, formatDate, formatStamp]) {
      expect(format(null, en)).toBe('');
      expect(format('yesterday', en)).toBe('');
      expect(format('', en)).toBe('');
    }
    expect(formatDayHead(new Date(Number.NaN), en)).toBe('');
  });

  it('render a wall clock, a date, and a date with time', () => {
    expect(formatTime(iso, en)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatDate(iso, en)).toContain('2026');
    expect(formatDateTime(iso, en)).toContain('2026');
  });

  it('write a stamp that names the zone, which is the age’s answer to "when, exactly?"', () => {
    // The zone is the clause this formatter exists for, and it is the reason the
    // components are spelled out: **`dateStyle` and `timeZoneName` together throw
    // a `TypeError`** (measured — ECMA-402 forbids the pair when a style is set),
    // so `dateStyle: 'full'` cannot be the short way to ask for this.
    expect(formatStamp(iso, en)).toMatch(/GMT|UTC/u);
    expect(formatStamp(iso, en)).toMatch(/\d{1,2}:\d{2}/u);
    expect(formatStamp(iso, en)).toContain('2026');
    expect(formatStamp(iso, de)).not.toBe(formatStamp(iso, en));
  });

  it('write a day heading in the reader’s language', () => {
    expect(formatDayHead(new Date(2026, 10, 8), en)).toMatch(/November/);
    expect(formatDayHead(new Date(2026, 10, 8), de)).toMatch(/November/);
  });
});

describe('counts', () => {
  it('use the language’s grouping separators', () => {
    expect(formatCount(1234, en)).toBe('1,234');
    expect(formatCount(1234, de)).toBe('1.234');
  });

  it('compacts in English, where the badge has to fit', () => {
    expect(formatCompactCount(12_400, en)).toBe('12.4K');
    expect(formatCompactCount(1_240_000, en)).toBe('1.2M');
    // Measured, not assumed: Node 26's ICU does not abbreviate German
    // thousands — `de` groups them ('12.400') and only compacts from a million
    // ('1,2 Mio.'). Asserting the English form and "not the English compact"
    // for German is the part that is stable across ICU versions.
    expect(formatCompactCount(12_400, de)).not.toBe('12.4K');
    // CLDR puts a NO-BREAK SPACE (U+00A0) between the number and 'Mio.', so a
    // literal space in the expectation fails invisibly.
    expect(formatCompactCount(1_240_000, de)).toBe('1,2\u00a0Mio.');
  });
});
