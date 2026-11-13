import { relativeParts } from 'newspa-core';
import { formatAbsolute, formatCount, formatRelative, formatTime, formattersFor } from '../../../src/lib/intl.ts';
import type { LocaleApi } from '../../../src/lib/useLocale.ts';

/**
 * A real `LocaleApi`, assembled the way `useLocale` assembles one (core's
 * locale-free parts + this package's `Intl` formatters), for the tests of the
 * seams that take a `LocaleApi` as an argument.
 *
 * Constants would be easier and would prove nothing: `labels.ts` and `format.ts`
 * are only interesting because of what `Intl` does to the number and the date, so
 * a stub of `Intl` lets the real grouping separator, plural rule, calendar and
 * UTC offset change under a green test.
 *
 * The one thing not taken from the hook is `time.now`: `useLocale` reads it from
 * i18next, and these tests do not run i18next, so it is a literal.
 */
export const localeFor = (language: string): LocaleApi => {
  const formatters = formattersFor(language);
  return {
    language,
    relative: (iso, now = new Date()) => formatRelative(relativeParts(iso, now), formatters, { now: 'just now' }),
    time: (iso) => formatTime(iso, formatters),
    absolute: (iso) => formatAbsolute(iso, formatters),
    count: (value) => formatCount(value, formatters),
  };
};
