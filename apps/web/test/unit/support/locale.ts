import { relativeParts } from 'newspa-core';
import {
  formatCompactCount,
  formatDate,
  formatDateTime,
  formatDayHead,
  formatRelative,
  formatTime,
  formattersFor,
} from '../../../src/lib/intl.ts';
import type { LocaleApi } from '../../../src/lib/useLocale.ts';

/**
 * A real `LocaleApi`, assembled the way `useLocale` assembles one (core's
 * locale-free parts + this package's `Intl` formatters), for the tests of the
 * seams that take a `LocaleApi` as an argument.
 *
 * Constants would be easier and would prove nothing: `labels.ts` and
 * `format.ts` are only interesting because of what `Intl` does to the number and
 * the date, so a stub of `Intl` lets the real grouping separator, plural rule
 * and calendar change under a green test.
 *
 * The one thing not taken from the hook is `time.now`: `useLocale` reads it from
 * i18next, and these tests do not run i18next, so it is a literal.
 */
export const localeFor = (language: string): LocaleApi => {
  const formatters = formattersFor(language);
  return {
    language,
    formatters,
    relative: (iso, now = new Date()) => formatRelative(relativeParts(iso, now), formatters, { now: 'just now' }),
    time: (iso) => formatTime(iso, formatters),
    dateTime: (iso) => formatDateTime(iso, formatters),
    date: (iso) => formatDate(iso, formatters),
    dayHead: (date) => formatDayHead(date, formatters),
    count: (value) => formatters.number.format(value),
    compact: (value) => formatCompactCount(value, formatters),
  };
};
