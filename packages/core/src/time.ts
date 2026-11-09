import { hashKey } from './normalize.ts';

/**
 * The paper has a day boundary that is not midnight: the paper cut at 07:00
 * contains the night's news. Everything date-based goes through here so DST and
 * "today's paper" have exactly one definition.
 *
 * **No locale-locked formatting lives here.** The first cut of this module
 * returned `"3 min ago"` and `toLocaleDateString('en-US', …)` strings; that made
 * the language of the paper a property of the data layer, and an untranslatable
 * UI. Core returns *parts* — a unit, a number, an instant — and the web app
 * renders them with `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat` bound to
 * the i18next language (docs/decisions-tooling.md D-019). Core is browser-safe and
 * shared, so it must stay locale-free to be renderable in any.
 */

const pad = (value: number): string => String(value).padStart(2, '0');

export const editionIdFor = (now: Date, dayStartHour: number): string => {
  const d = new Date(now.getTime());
  if (d.getHours() < dayStartHour) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The edition's first instant, as a local-midnight `Date` for the dateline.
 * A malformed id gives an invalid `Date`, which the renderer shows as the raw
 * id — a broken masthead date must be visible, not blank.
 */
export const editionDate = (editionId: string): Date => {
  const [year, month, day] = editionId.split('-').map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined || day === undefined) return new Date(Number.NaN);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return new Date(Number.NaN);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

/** [start, end) of an edition window, as ISO strings in local time. */
export const editionWindow = (editionId: string, dayStartHour: number): { start: string; end: string } => {
  const start = editionDate(editionId);
  if (Number.isNaN(start.getTime())) return { start: '', end: '' };
  start.setHours(dayStartHour, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
};

/**
 * Deterministic jitter from the source id: sources must not all fire at the
 * top of the minute, and the schedule has to be reproducible for tests and for
 * "why did this poll at 09:04?" questions.
 */
export const jitterMs = (seed: string, spanMs: number): number => {
  if (spanMs <= 0) return 0;
  const n = Number.parseInt(hashKey(seed), 16);
  return Number.isFinite(n) ? n % spanMs : 0;
};

export const backoffMs = (attempts: number, baseMs: number, maxMs: number): number => {
  if (attempts <= 0) return 0;
  const exponent = Math.min(10, attempts - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
};

export interface DueInput {
  readonly lastFetchAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly cadenceMinutes: number;
  readonly attempts: number;
  readonly seed: string;
  readonly jitterSpanMs: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
}

export const isDue = (input: DueInput, now: Date): boolean => {
  const cadenceMs = input.cadenceMinutes * 60_000;
  const anchor = input.lastFetchAt === null ? null : Date.parse(input.lastFetchAt);
  if (anchor === null || Number.isNaN(anchor)) return true;
  const penalty = input.attempts > 0 ? backoffMs(input.attempts, input.backoffBaseMs, input.backoffMaxMs) : 0;
  const due = anchor + cadenceMs + jitterMs(input.seed, input.jitterSpanMs) + penalty;
  return now.getTime() >= due;
};

export type RelativeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

export interface RelativeParts {
  /** `null` = "format this as an absolute date"; a month-old item has no useful `…ago`. */
  readonly unit: RelativeUnit | null;
  /** Signed: negative for the past, which is what `Intl.RelativeTimeFormat` expects. */
  readonly delta: number;
  /** The instant being described, so the renderer never has to re-parse. */
  readonly at: Date;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The unit and size of a gap, chosen the way a newspaper writes it: minutes
 * while it is today's news, hours through the day, days while it is "recent",
 * weeks and months after that, and an absolute date beyond a year.
 *
 * Thresholds are rounded-to-unit, not exact boundaries, so a clock that ticks
 * across a threshold does not make the paper flicker between "24 hr ago" and
 * "1 day ago" at an arbitrary second.
 */
/**
 * `-0` is not a value to hand a renderer: `Object.is(-0, 0)` is false, so an
 * equality check in an adapter or a test silently misses, and a memo keyed by
 * the delta gets two entries for one state. A zero magnitude has no direction.
 */
const signed = (sign: number, magnitude: number): number => (magnitude === 0 ? 0 : sign * magnitude);

export const relativeParts = (iso: string | null, now: Date, absoluteAfterDays = 30): RelativeParts => {
  const at = iso === null ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(at)) return { unit: null, delta: 0, at: new Date(Number.NaN) };
  const date = new Date(at);
  const diffMs = at - now.getTime();
  const abs = Math.abs(diffMs);
  const sign = diffMs < 0 ? -1 : 1;
  if (abs < 45 * MINUTE) return { unit: 'minute', delta: signed(sign, Math.round(abs / MINUTE)), at: date };
  if (abs < 22 * HOUR) return { unit: 'hour', delta: sign * Math.round(abs / HOUR), at: date };
  const days = Math.round(abs / DAY);
  if (days <= 6) return { unit: 'day', delta: sign * days, at: date };
  if (days <= 12) return { unit: 'week', delta: sign * Math.round(days / 7), at: date };
  // Past the "recent" horizon an absolute date is the newspaper answer, so the
  // adapter switches to `Intl.DateTimeFormat`. A caller that wants relative
  // text for a year of history asks for it via `absoluteAfterDays`.
  if (days > absoluteAfterDays) return { unit: null, delta: 0, at: date };
  if (days >= 365) return { unit: 'year', delta: sign * Math.max(1, Math.round(days / 365)), at: date };
  // `max(1, …)`: 13 days is "1 month ago", never "0 months ago" — a zero delta
  // with a unit is text a reader cannot use.
  return { unit: 'month', delta: sign * Math.max(1, Math.round(days / 30)), at: date };
};

export const nowIso = (): string => new Date().toISOString();
