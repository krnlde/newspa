/**
 * The scheduler's half of `sources` (roadmap: "bounded batches, not all at
 * once"): the two columns migration 5 added, read as the batch that is due and
 * written as the plan for the next attempt.
 *
 * These members are **not** part of the paper's read side, and they are in
 * their own module for the same two reasons `itemsStreaks.ts` is:
 *  - a countdown is not a fact about a source that a reader sees. `StoredSource`
 *    and the server's `SourceHealthView` have no field for one and must not gain
 *    one, so this read is the only place the columns surface, in the shape the
 *    scheduler decides with;
 *  - `insert`/`upsert` deliberately do not name the columns, so re-importing a
 *    source from `sources/*.json` — which the pipeline does on every load —
 *    never resets a countdown the scheduler is running. `setSchedule` is the
 *    only writer, and it writes both fields at once, because a plan and the
 *    failure count it was computed from are one decision.
 *
 * `now` is a parameter, never a clock read here: every timestamp in this schema
 * is produced by the caller, so "is it due" is an ISO string comparison a test
 * can set exactly (`test/support.ts` pins the clock for the same reason).
 */
import type { SourceSpec } from 'newspa-config';
import type { HealthState } from 'newspa-core';
import { specOf } from './sourceSpec.ts';
import type { Tx } from './statement.ts';
import { decodeInteger, decodeOptionalText, decodeText, type Row } from './value.ts';

/**
 * The ceiling of one catch-up batch. Sources are few (a reading list, not a
 * crawl), so 200 is generous and keeps one tick bounded — the same budget
 * `items.ts` and `itemEvents.ts` bind their `limit ?` with.
 */
export const MAX_DUE_SOURCES = 200;

/** One source, in the shape the scheduler decides with. */
export interface ScheduledSource {
  readonly spec: SourceSpec;
  readonly health: HealthState;
  readonly nextRunAt: string | null;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
}

export interface ScheduleMembers {
  /** Enabled sources due at `now`, never-scheduled first, then soonest, then by id. */
  readonly dueSources: (now: string, limit: number) => ScheduledSource[];
  /** Record the next run and the failure count. Returns the rows written (0 = no such id). */
  readonly setSchedule: (id: string, nextRunAt: string, failures: number) => number;
}

/**
 * `enabled = 1` is the whole filter: a disabled source is not the scheduler's
 * business, and its `next_run_at` is left alone while it is off.
 *
 * `next_run_at <= ?` is **inclusive** — a source due at exactly `now` is due,
 * and a scheduler that misses equality polls a source one cadence late, every
 * cadence. The comparison is a string compare, which is what a UTC ISO instant
 * in a `text` column is for (schema.ts).
 *
 * `order by (next_run_at is not null)` puts a never-scheduled source **first**:
 * a fresh database has a row per source and has to poll all of them, and a
 * catch-up batch that filled from the past would never reach them. The rest of
 * the order — soonest, then id — is total, so a bounded batch is deterministic
 * and a caller can assert a list against it.
 */
const SELECT_SQL = `select id, source_json, time_spec_json, enabled, health,
    next_run_at, consecutive_failures, last_success_at
  from sources
  where enabled = 1 and (next_run_at is null or next_run_at <= ?)
  order by (next_run_at is not null), next_run_at, id
  limit ?`;

const UPDATE_SQL = 'update sources set next_run_at = ?, consecutive_failures = ? where id = ?';

const scheduledOf = (row: Row): ScheduledSource => {
  const id = decodeText('id', 'a source row', row['id']);
  const at = (name: string): string => `source ${id} (${name})`;
  return {
    spec: specOf(id, row),
    health: decodeText('health', at('health'), row['health']) as HealthState,
    nextRunAt: decodeOptionalText('next_run_at', at('next_run_at'), row['next_run_at']),
    consecutiveFailures: decodeInteger('consecutive_failures', at('consecutive_failures'), row['consecutive_failures']),
    lastSuccessAt: decodeOptionalText('last_success_at', at('last_success_at'), row['last_success_at']),
  };
};

/** The batch ceiling, bounded the way every other `limit ?` in this package is. */
const limitOf = (limit: number): number => Math.min(MAX_DUE_SOURCES, Math.max(1, Math.trunc(limit)));

export const sourcesSchedulingRepository = (db: Tx): ScheduleMembers => ({
  dueSources: (now, limit) => db.all(SELECT_SQL, now, limitOf(limit)).map(scheduledOf),

  /**
   * `changes()`, not `1`: the count is the caller's evidence that the source is
   * still in the table. The db does **not** police `enabled` here — disabling a
   * source is the app's decision and the scheduler's, and a write that refused a
   * disabled id would strand its stale plan with no way to record the last one.
   */
  setSchedule: (id, nextRunAt, failures) => db.run(UPDATE_SQL, nextRunAt, failures, id).changes,
});
