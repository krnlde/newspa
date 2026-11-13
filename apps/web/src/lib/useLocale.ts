import { relativeParts } from 'newspa-core';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Formatters,
  formatCompactCount,
  formatDate,
  formatDateTime,
  formatDayHead,
  formatRelative,
  formatStamp,
  formatTime,
  formattersFor,
} from './intl.ts';

/**
 * The formatting seam (D-019): one hook, bound to i18next's `language`, that
 * hands out `Intl` formatters and the handful of format functions the paper
 * needs. Components never construct an `Intl.*` object and never call
 * `toLocaleString` — the moment one does, the language of the paper stops being
 * a user setting.
 *
 * `useTranslation` subscribes the component to `languageChanged`, so a language
 * switch re-renders; `formattersFor` is keyed by language, so the new render
 * gets new formatters. That is the whole mechanism, and it is why this file is
 * a hook and not a module-level singleton.
 */
export interface LocaleApi {
  readonly language: string;
  readonly formatters: Formatters;
  /** "3 min ago" / "vor 3 Min.", from core's locale-free parts. */
  readonly relative: (iso: string | null, now?: Date) => string;
  readonly time: (iso: string | null) => string;
  readonly dateTime: (iso: string | null) => string;
  readonly date: (iso: string | null) => string;
  /** The instant in full, zone named: what a date's `title` attribute carries. */
  readonly stamp: (iso: string | null) => string;
  readonly dayHead: (date: Date) => string;
  readonly count: (value: number) => string;
  readonly compact: (value: number) => string;
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
      formatters,
      relative,
      time: (iso) => formatTime(iso, formatters),
      dateTime: (iso) => formatDateTime(iso, formatters),
      date: (iso) => formatDate(iso, formatters),
      stamp: (iso) => formatStamp(iso, formatters),
      dayHead: (date) => formatDayHead(date, formatters),
      count: (value) => formatters.number.format(value),
      compact: (value) => formatCompactCount(value, formatters),
    }),
    [language, formatters, relative],
  );
};
