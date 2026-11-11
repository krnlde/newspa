/**
 * Per-source cadence. The canonical value is `cadenceMinutes` (a number in the
 * source file); presets are derived for display and for the picker's select,
 * so a label can never drift from the number it claims to mean.
 */

export interface CadencePreset {
  readonly label: string;
  readonly minutes: number;
  /** True when this cadence is only sensible for plain fetches, not rendered ones. */
  readonly fastTier: boolean;
}

export const MIN_CADENCE_MINUTES = 1;
export const MAX_CADENCE_MINUTES = 10_080;
/** A rendered source may not poll faster than this (see docs/decisions.md). */
export const MIN_RENDERED_CADENCE_MINUTES = 5;

export const CADENCE_PRESETS: readonly CadencePreset[] = [
  { label: '1 min', minutes: 1, fastTier: true },
  { label: '2 min', minutes: 2, fastTier: true },
  { label: '5 min', minutes: 5, fastTier: true },
  { label: '15 min', minutes: 15, fastTier: true },
  { label: '30 min', minutes: 30, fastTier: true },
  { label: '1 hour', minutes: 60, fastTier: true },
  { label: '3 hours', minutes: 180, fastTier: false },
  { label: '6 hours', minutes: 360, fastTier: false },
  { label: '12 hours', minutes: 720, fastTier: false },
  { label: 'daily', minutes: 1_440, fastTier: false },
  { label: 'weekly', minutes: 10_080, fastTier: false },
];

/** "120" -> "2 hours"; a non-preset value gets a readable description. */
export const describeCadence = (minutes: number): string => {
  const exact = CADENCE_PRESETS.find((preset) => preset.minutes === minutes);
  if (exact !== undefined) return exact.label;
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1_440) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours`;
  }
  const days = minutes / 1_440;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} days`;
};

export const isKnownCadence = (minutes: number): boolean =>
  Number.isInteger(minutes) && minutes >= MIN_CADENCE_MINUTES && minutes <= MAX_CADENCE_MINUTES;

export interface RelaxInput {
  readonly cadenceMinutes: number;
  readonly attempts: number;
  readonly state: 'blocked' | 'error' | 'ok';
  readonly capMinutes: number;
}

/**
 * A source that answers 429/403 is asking us to slow down. The scheduler
 * multiplies its interval by 4 per consecutive failure, capped, and returns to
 * the configured cadence on the first success. This is the "be polite, stay
 * unblocked" rule, enforced in code rather than in a comment.
 *
 * The **author's interval is the floor**, and the cap bounds the multiplier, not
 * the schedule. The difference is only visible when the cap is below the cadence,
 * and with the default `backoffMaxMs` of one hour it always is for the 3 h, 6 h,
 * 12 h, daily and weekly presets: capping the *result* there turned a backoff
 * into an acceleration — one transient failure on a daily feed would plan the
 * next read an hour later, every hour, for as long as it kept failing.
 */
export const effectiveCadenceMinutes = (input: RelaxInput): number => {
  if (input.state === 'ok' || input.attempts === 0) return input.cadenceMinutes;
  const relaxed = input.cadenceMinutes * 4 ** Math.min(4, input.attempts);
  return Math.max(input.cadenceMinutes, Math.min(input.capMinutes, relaxed));
};

/** Local-hour quiet window: "poll this source only between 06:00 and 23:00". */
export interface QuietHours {
  readonly startHour: number;
  readonly endHour: number;
}

export const inQuietHours = (hours: QuietHours | undefined, now: Date): boolean => {
  if (hours === undefined) return false;
  const hour = now.getHours();
  const { startHour, endHour } = hours;
  if (startHour === endHour) return false;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
};
