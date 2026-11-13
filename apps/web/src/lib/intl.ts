import type { RelativeParts } from 'newspa-core';
import { baseLanguage, DEFAULT_LANGUAGE, isSupportedLanguage, SUPPORTED_LANGUAGES } from '../i18n/languages.ts';

/**
 * Every locale-sensitive rendering in the app, in one place, built from one
 * language string (D-019).
 *
 * `Intl` objects are not cheap — each is a locale lookup, a data load and a
 * resolver — and a React app renders them thousands of times. So they are
 * memoised per language, in a map that never exceeds the number of supported
 * languages. The language is an argument, never a module-level constant: a
 * formatter built at import time freezes the paper's language at whatever it was
 * on first render, which is the bug this module exists to make impossible.
 *
 * Four renderings, because the page asks four questions: how old (relative),
 * when exactly (absolute, zone named), what time (clock, zone named), how many
 * (number). A formatter nobody calls is not a small saving, it is a small lie
 * about what the page does, so this list is exactly the list of callers.
 */

export interface Formatters {
  readonly language: string;
  readonly relative: Intl.RelativeTimeFormat;
  /**
   * The instant, in the page's language, **with the zone in the string**:
   * `November 13, 2026 at 2:30 PM +01:00`, `13. November 2026 um 14:30 +01:00`.
   *
   * The components are spelled out because the shorthand cannot do this: **`dateStyle`
   * and `timeStyle` together with `timeZoneName` throw a `TypeError`** (measured;
   * ECMA-402 forbids the pair), while `year/month/day` plus `timeZoneName` is legal.
   * The zone is not garnish — an age is measured from the reader's clock, and a date
   * without an offset is a day in a calendar the page has not named (D-047).
   */
  readonly absolute: Intl.DateTimeFormat;
  /** The wall clock, zone named: `02:30 PM +01:00`. Same reason, same shape. */
  readonly time: Intl.DateTimeFormat;
  readonly number: Intl.NumberFormat;
}

const cache = new Map<string, Formatters>();

/**
 * Base tag, then the catalog. `Intl` is happy with a full tag (`de-AT`), and the
 * paper's own conventions are keyed by base tag, so `de-AT` renders Austrian
 * German, not the default language: a formatter that dropped a regional variant
 * because it did not match a catalog entry exactly would be a silent downgrade.
 */
const normalize = (language: string): string => {
  const base = baseLanguage(language);
  return isSupportedLanguage(base) ? base : DEFAULT_LANGUAGE;
};

export const formattersFor = (language: string): Formatters => {
  const lng = normalize(language);
  const cached = cache.get(lng);
  if (cached !== undefined) return cached;
  const built: Formatters = {
    language: lng,
    relative: new Intl.RelativeTimeFormat(lng, { numeric: 'auto' }),
    absolute: new Intl.DateTimeFormat(lng, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'longOffset',
    }),
    time: new Intl.DateTimeFormat(lng, { hour: '2-digit', minute: '2-digit', timeZoneName: 'longOffset' }),
    number: new Intl.NumberFormat(lng),
  };
  cache.set(lng, built);
  return built;
};

/** Cache size is bounded by the catalog, which is what makes the memo safe. */
export const cachedLanguageCount = (): number => cache.size;

export const supportedLanguages = (): readonly string[] => SUPPORTED_LANGUAGES;

/**
 * `Intl` spells an offset as `GMT+01:00`; the page writes `+01:00`, which is the
 * form that carries no assumption about a prime meridian. A language that spells
 * its own word for the zone (`fr` prints `UTC+01:00`) is left alone: that is what
 * that language calls it, and rewriting it is the page overruling the locale.
 */
const offsetOnly = (rendered: string): string => rendered.replace(/\sGMT(?=[+-])/u, ' ');

/**
 * A relative label from core's locale-free parts.
 *
 * `Intl.RelativeTimeFormat` wants a number and a unit, which is exactly what
 * `relativeParts` returns; the two strings this module owns are the ones the
 * formatter cannot express: "just now" (a 0-minute delta renders as "in 0
 * minutes") and the absolute instant, which is what a month-old item deserves —
 * the same rendering the tooltip carries, so a page has one way to say a date.
 */
export const formatRelative = (parts: RelativeParts, formatters: Formatters, strings: { now: string }): string => {
  if (Number.isNaN(parts.at.getTime())) return '';
  if (parts.unit === null) return offsetOnly(formatters.absolute.format(parts.at));
  if (parts.unit === 'minute' && parts.delta === 0) return strings.now;
  // No cast: every `RelativeUnit` is a valid `Intl.RelativeTimeFormatUnit`, which
  // is why core is allowed to name them.
  return formatters.relative.format(parts.delta, parts.unit);
};

/** The instant, zone named. Empty for a missing one, so no caller prints "Invalid Date". */
export const formatAbsolute = (iso: string | null, formatters: Formatters): string => {
  if (iso === null) return '';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : offsetOnly(formatters.absolute.format(at));
};

/** The wall clock, zone named. Empty for a missing instant. */
export const formatTime = (iso: string | null, formatters: Formatters): string => {
  if (iso === null) return '';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : offsetOnly(formatters.time.format(at));
};

export const formatCount = (value: number, formatters: Formatters): string => formatters.number.format(value);
