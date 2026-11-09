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
 */

export interface Formatters {
  readonly language: string;
  readonly relative: Intl.RelativeTimeFormat;
  readonly date: Intl.DateTimeFormat;
  readonly dateTime: Intl.DateTimeFormat;
  readonly time: Intl.DateTimeFormat;
  /** "Monday, 9 November" — the heading above a day's items. */
  readonly dayHead: Intl.DateTimeFormat;
  /** "November 2026" — the archive grouping. */
  readonly monthHead: Intl.DateTimeFormat;
  /** A poll duration: seconds, no unit drift. */
  readonly seconds: Intl.NumberFormat;
  readonly number: Intl.NumberFormat;
  readonly compact: Intl.NumberFormat;
  readonly list: Intl.ListFormat;
  readonly plural: Intl.PluralRules;
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
    date: new Intl.DateTimeFormat(lng, { dateStyle: 'medium' }),
    dateTime: new Intl.DateTimeFormat(lng, { dateStyle: 'medium', timeStyle: 'short' }),
    time: new Intl.DateTimeFormat(lng, { timeStyle: 'short' }),
    dayHead: new Intl.DateTimeFormat(lng, { weekday: 'long', day: 'numeric', month: 'long' }),
    monthHead: new Intl.DateTimeFormat(lng, { month: 'long', year: 'numeric' }),
    seconds: new Intl.NumberFormat(lng, { maximumFractionDigits: 1 }),
    number: new Intl.NumberFormat(lng),
    compact: new Intl.NumberFormat(lng, { notation: 'compact', maximumFractionDigits: 1 }),
    list: new Intl.ListFormat(lng, { style: 'long', type: 'conjunction' }),
    plural: new Intl.PluralRules(lng),
  };
  cache.set(lng, built);
  return built;
};

/** Cache size is bounded by the catalog, which is what makes the memo safe. */
export const cachedLanguageCount = (): number => cache.size;

export const supportedLanguages = (): readonly string[] => SUPPORTED_LANGUAGES;

/**
 * A relative label from core's locale-free parts.
 *
 * `Intl.RelativeTimeFormat` wants a number and a unit, which is exactly what
 * `relativeParts` returns; the only strings this module owns are the two the
 * formatter cannot express: "just now" (a 0-minute delta renders as "in 0
 * minutes") and an absolute date, which is what a month-old item deserves.
 */
export const formatRelative = (parts: RelativeParts, formatters: Formatters, strings: { now: string }): string => {
  if (Number.isNaN(parts.at.getTime())) return '';
  if (parts.unit === null) return formatters.date.format(parts.at);
  if (parts.unit === 'minute' && parts.delta === 0) return strings.now;
  // No cast: every `RelativeUnit` is a valid `Intl.RelativeTimeFormatUnit`, which
  // is why core is allowed to name them.
  return formatters.relative.format(parts.delta, parts.unit);
};

/** Empty for a missing instant, so a caller never prints "Invalid Date". */
export const formatTime = (iso: string | null, formatters: Formatters): string => {
  if (iso === null) return '';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : formatters.time.format(at);
};

export const formatDateTime = (iso: string | null, formatters: Formatters): string => {
  if (iso === null) return '';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : formatters.dateTime.format(at);
};

export const formatDate = (iso: string | null, formatters: Formatters): string => {
  if (iso === null) return '';
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : formatters.date.format(at);
};

/**
 * The day heading an item belongs in, in the reader's language and calendar
 * rules: the day boundary is the *edition's* (core computes the id), so this
 * takes the id and formats the date, rather than parsing a timestamp.
 */
export const formatDayHead = (date: Date, formatters: Formatters): string =>
  Number.isNaN(date.getTime()) ? '' : formatters.dayHead.format(date);

export const formatCount = (value: number, formatters: Formatters): string => formatters.number.format(value);

export const formatCompactCount = (value: number, formatters: Formatters): string => formatters.compact.format(value);
