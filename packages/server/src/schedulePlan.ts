/**
 * When a source runs **next** (WP3, MVP): a pure function of the source, the
 * failure count and the instant, so the whole policy is testable without a clock,
 * a socket or a database.
 *
 * The rules, in the order they are consulted — the order is the policy, so it is
 * written down once, here:
 *
 *  1. **Paused** — `maxFailuresBeforePause` consecutive failures: the interval is
 *     the backoff ceiling. A source that answers `403` at every attempt is asking
 *     to be left alone, and the rule 5 duty ("its state reaches the paper") is
 *     served by the health state the poll already wrote, not by trying harder.
 *  2. **Backoff** — any failure: core's `effectiveCadenceMinutes` (×4 per
 *     consecutive failure, capped). This is why a **cron-anchored** source cannot
 *     re-hammer a site that answered `429`: a failure outranks the cron, and the
 *     cron returns on the first success.
 *  3. **Cron** — an anchored schedule, honoured exactly, so a source that
 *     publishes at 07:00 is read at 07:01 and not at 06:41.
 *  4. **Cadence** — the authored `cadenceMinutes`.
 *
 * Two floors apply on top, and both exist because a fast poll is a cost the
 * reader pays in the publisher's currency:
 *
 *  - a **`render: true`** source may not poll faster than
 *    `MIN_RENDERED_CADENCE_MINUTES`: measured (D-033), one browser per poll is
 *    1 440 launches a day and ~41 minutes of `goto` for a *single* 1-minute source,
 *    so the floor is applied by the scheduler and not trusted to the schema —
 *    `cadenceMinutes` accepts 1 by design, because a feed at 1 minute is fine;
 *  - **quiet hours** push the instant to the end of the window, because "do not
 *    poll this blog at 04:00" is a decision the reader made, and a cadence
 *     computed from `now` would ignore it.
 *
 * `minutes` is the interval the plan implies, so a log line can say "backoff
 * after 3 failure(s) → 320 min" and a test can assert the arithmetic without
 * reading a date.
 */
import type { SourceSpec } from 'newspa-config';
import {
  effectiveCadenceMinutes,
  inQuietHours,
  MIN_CADENCE_MINUTES,
  MIN_RENDERED_CADENCE_MINUTES,
  nextCronTime,
  parseCron,
} from 'newspa-core';

/** A day, in the unit every instant here is measured in. */
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

export interface PlanInput {
  readonly spec: SourceSpec;
  /** Consecutive failures at the last plan. `0` means the last poll reported well. */
  readonly failures: number;
  readonly now: Date;
  /** The backoff ceiling, in minutes (`scheduler.backoffMaxMs` converted once, by the caller). */
  readonly capMinutes: number;
  readonly maxFailuresBeforePause: number;
}

export interface SchedulePlan {
  readonly nextRunAt: Date;
  /** The interval this plan implies, so a test asserts a number and a log names it. */
  readonly minutes: number;
  /** The rules that fired, joined: `cadence`, `backoff after 2 failure(s)`, `cron … + quiet hours`. */
  readonly why: string;
}

/** The floor for this source's tier: a rendered source pays more per poll (D-033). */
const floorOf = (spec: SourceSpec): number => (spec.render ? MIN_RENDERED_CADENCE_MINUTES : MIN_CADENCE_MINUTES);

/**
 * Push an instant out of a quiet window to the window's **end** (end-exclusive, so
 * the end hour is pollable). A window that runs past midnight is core's
 * `inQuietHours`, and its end is tomorrow — hence the day added when the end has
 * already passed.
 */
const outOfQuiet = (spec: SourceSpec, at: Date): { readonly at: Date; readonly quiet: boolean } => {
  const hours = spec.quietHours;
  if (hours === undefined || !inQuietHours(hours, at)) return { at, quiet: false };
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), hours.endHour, 0, 0, 0);
  return { at: end.getTime() <= at.getTime() ? new Date(end.getTime() + DAY_MS) : end, quiet: true };
};

/** The plan: the instant, the interval it implies, and the rules that made it. */
const planOf = (spec: SourceSpec, now: Date, instant: Date, notes: readonly string[]): SchedulePlan => {
  const quiet = outOfQuiet(spec, instant);
  const at = quiet.at;
  const why = quiet.quiet ? [...notes, 'quiet hours'].join(' + ') : notes.join(' + ');
  return { nextRunAt: at, minutes: Math.round((at.getTime() - now.getTime()) / MINUTE_MS), why };
};

/** The next instant this source may be polled, and why. */
export const planNextRun = (input: PlanInput): SchedulePlan => {
  const { spec, failures, now, capMinutes, maxFailuresBeforePause } = input;
  const base = spec.cadenceMinutes;
  const notes: string[] = [];

  if (spec.cadenceCron !== undefined && failures === 0) {
    notes.push(`cron ${String(spec.cadenceCron)}`);
    return planOf(spec, now, nextCronTime(parseCron(spec.cadenceCron), now), notes);
  }

  let minutes: number;
  if (failures >= maxFailuresBeforePause) {
    minutes = Math.max(base, capMinutes);
    notes.push(`paused after ${String(failures)} failure(s)`);
  } else if (failures > 0) {
    minutes = effectiveCadenceMinutes({ cadenceMinutes: base, attempts: failures, state: 'error', capMinutes });
    notes.push(`backoff after ${String(failures)} failure(s)`);
  } else {
    minutes = base;
    notes.push('cadence');
  }

  const floor = floorOf(spec);
  if (minutes < floor) {
    minutes = floor;
    notes.push(`render floor ${String(floor)} min`);
  }

  return planOf(spec, now, new Date(now.getTime() + minutes * MINUTE_MS), notes);
};
