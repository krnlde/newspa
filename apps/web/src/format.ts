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
 * Two renderings of the same instant, and the page shows one and tooltips the
 * other: `ago` is the **age** the reader scans a front page by, and `stamp` is
 * the same instant written out with its time zone, which is what the `title`
 * attribute carries. An age is measured from the reader's clock, so "so when,
 * exactly?" needs an answer that names the clock — a date without a zone is a
 * number the reader cannot check.
 */
export const formatFor = (locale: LocaleApi, now: () => Date = () => new Date()): FormatProps => ({
  ago: (iso: string): string => locale.relative(iso, now()),
  stamp: (iso: string | null): string => locale.stamp(iso),
});
