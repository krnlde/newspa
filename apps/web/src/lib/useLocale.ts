import { relativeParts } from 'newspa-core';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAbsolute, formatCount, formatRelative, formatTime, formattersFor } from './intl.ts';

/**
 * The formatting seam (D-019): one hook, bound to i18next's `language`, that
 * hands out the handful of format functions the paper needs. Components never
 * construct an `Intl.*` object and never call `toLocaleString` — the moment one
 * does, the language of the paper stops being a user setting.
 *
 * `useTranslation` subscribes the component to `languageChanged`, so a language
 * switch re-renders; `formattersFor` is keyed by language, so the new render
 * gets new formatters. That is the whole mechanism, and it is why this file is
 * a hook and not a module-level singleton.
 *
 * Four functions, and `language` for a caller that has to name the language it
 * rendered in. The `Formatters` object itself is **not** exposed: a component
 * handed `Intl` objects will call them directly, and the language of the page
 * becomes a function of which formatter a component happened to pick.
 */
export interface LocaleApi {
  readonly language: string;
  /** "3 min ago" / "vor 3 Min.", from core's locale-free parts. */
  readonly relative: (iso: string | null, now?: Date) => string;
  /** "02:30 PM +01:00" — the wall clock, zone named. */
  readonly time: (iso: string | null) => string;
  /** "November 13, 2026 at 2:30 PM +01:00" — the instant, zone named (D-047). */
  readonly absolute: (iso: string | null) => string;
  /** A count with the language's grouping separator: `"1,234"` / `"1.234"`. */
  readonly count: (value: number) => string;
}

export const useLocale = (): LocaleApi => {
  const { t, i18n } = useTranslation();
  // `i18n.language`, not `resolvedLanguage`: it is the tag the strings are
  // rendering from, and `formattersFor` normalises an unsupported tag to the
  // default, so the numbers and dates always agree with the text on the page.
  const language = i18n.language;
  const formatters = useMemo(() => formattersFor(language), [language]);
  const nowWord = t('time.now');

  const relative = useCallback(
    (iso: string | null, now: Date = new Date()): string =>
      formatRelative(relativeParts(iso, now), formatters, { now: nowWord }),
    [formatters, nowWord],
  );

  return useMemo(
    () => ({
      language,
      relative,
      time: (iso) => formatTime(iso, formatters),
      absolute: (iso) => formatAbsolute(iso, formatters),
      count: (value) => formatCount(value, formatters),
    }),
    [language, formatters, relative],
  );
};
