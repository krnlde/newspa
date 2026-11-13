import type { FormatProps } from 'newspa-paper';
import type { LocaleApi } from './lib/useLocale.ts';

/**
 * The `FormatProps` the paper components are handed (D-019).
 *
 * The rule that shapes this file: a formatter created at module load is a
 * **frozen language**. So this is a function of the locale hook, called per
 * render, and `now` is an argument — a component that read `Date.now()` inline
 * could not be tested at a fixed instant, and "how old is this?" is exactly the
 * kind of question a test must be able to pin.
 *
 * Two renderings of one instant, and the page shows one and tooltips the other
 * (D-047): `ago` is the **age** a front page is scanned by, and `absolute` is
 * the same instant written out — in the page's language, with the zone in the
 * string (`November 13, 2026 at 2:30 PM +01:00`), which is what a `title`
 * carries and what the line prints once an item is older than a month. An age
 * is a distance from the reader's clock, so the exact answer has to say which
 * clock it is written on.
 */
export const formatFor = (locale: LocaleApi, now: () => Date = () => new Date()): FormatProps => ({
  ago: (iso: string): string => locale.relative(iso, now()),
  absolute: (iso: string | null): string => locale.absolute(iso),
});
