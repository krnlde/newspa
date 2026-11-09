import type { FormatProps } from 'newspa-paper';
import type { LocaleApi } from './lib/useLocale.ts';

/**
 * The `FormatProps` the paper components are handed (D-019).
 *
 * The rule that shapes this file: a formatter created at module load is a
 * **frozen language**. So this is a function of the locale hook, called per
 * render, and `now` is an argument — a component that read `Date.now()` inline
 * could not be tested at a fixed instant, and "is this today?" is exactly the
 * kind of question a test must be able to pin.
 */
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const formatFor = (locale: LocaleApi, now: () => Date = () => new Date()): FormatProps => ({
  /** `"14:05"` today, `"Nov 8, 2025"` for anything older — the publisher's stamp, in the reader's calendar. */
  published: (iso: string | null): string => {
    if (iso === null) return '';
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return '';
    return sameDay(new Date(at), now()) ? locale.time(iso) : locale.date(iso);
  },
  ago: (iso: string): string => locale.relative(iso, now()),
});
