/**
 * `snapshots`: one row per poll. Not one row per change — a `not-modified`
 * poll, a `same-body` poll and a failed poll each get a row, with the status,
 * the byte count and the outcome (docs/architecture.md step 9,
 * docs/fetching.md's ladder).
 *
 * That is the point: retention is "keep the last N rows per source", and the
 * rows are what make "this source answered 304 for three days" and "this poll
 * took 38 bytes" readable. A snapshot whose source is gone is a foreign-key
 * failure, reported with the source id — never a row that belongs to nobody.
 *
 * `outcome` and the byte count are DB-side: core's `FetchOutcome` is the
 * numeric result of one fetch, not the rung that ended the poll.
 */
import type { ErrorKind } from 'newspa-core';
import { CHECK_ERROR_KINDS, SNAPSHOT_OUTCOMES } from './schema.ts';
import type { Tx } from './statement.ts';
import {
  decodeCount,
  decodeInteger,
  decodeOptionalInteger,
  decodeOptionalText,
  decodeText,
  type Row,
  RowShapeError,
} from './value.ts';

/** The ladder's rungs, plus `error` for a poll that never got a payload. */
export type SnapshotOutcome = (typeof SNAPSHOT_OUTCOMES)[number];

export interface PollSnapshot {
  readonly sourceId: string;
  readonly takenAt: string;
  readonly outcome: SnapshotOutcome;
  readonly status: number;
  /** Decoded bytes measured by the fetch; 0 for a 304 (D-006: caps use decoded bytes). */
  readonly bytes: number;
  readonly durationMs: number | null;
  readonly itemCount: number | null;
  readonly errorKind: ErrorKind | null;
  readonly note: string | null;
}

export interface SnapshotRow {
  readonly id: number;
  readonly snapshot: PollSnapshot;
}

export interface SnapshotListOptions {
  readonly limit?: number;
  readonly since?: string;
}

export interface SnapshotRepository {
  readonly record: (snapshot: PollSnapshot) => number;
  readonly list: (sourceId: string, options?: SnapshotListOptions) => SnapshotRow[];
  readonly last: (sourceId: string) => SnapshotRow | undefined;
  readonly count: (sourceId?: string) => number;
}

export class SnapshotError extends Error {
  constructor(sourceId: string, reason: string) {
    super(`snapshot for source "${sourceId}": ${reason}`);
    this.name = 'SnapshotError';
  }
}

/** The event ceiling of one query, per the paper's `limit<=200`. */
export const MAX_SNAPSHOT_LIMIT = 200;
export const DEFAULT_SNAPSHOT_LIMIT = 50;

const COLUMNS = 'source_id, taken_at, outcome, status, bytes, duration_ms, item_count, error_kind, note';
const PLACEHOLDERS = COLUMNS.split(',')
  .map(() => '?')
  .join(', ');
const SELECT_SQL = `select id, ${COLUMNS} from snapshots`;

const oneOf = (row: Row): SnapshotRow => {
  const id = decodeInteger('id', 'a snapshot row', row['id']);
  const sourceId = decodeText('source_id', `snapshot ${id}`, row['source_id']);
  const at = (name: string): string => `snapshot ${id} (${name})`;
  const outcome = decodeText('outcome', at('outcome'), row['outcome']);
  if (!SNAPSHOT_OUTCOMES.some((known) => known === outcome)) {
    throw new RowShapeError('outcome', `snapshot ${id}`, `"${outcome}" is not one of ${SNAPSHOT_OUTCOMES.join(', ')}`);
  }
  const errorKind = decodeOptionalText('error_kind', at('error_kind'), row['error_kind']);
  if (errorKind !== null && !CHECK_ERROR_KINDS.some((known) => known === errorKind)) {
    throw new RowShapeError(
      'error_kind',
      `snapshot ${id}`,
      `"${errorKind}" is not one of ${CHECK_ERROR_KINDS.join(', ')}`,
    );
  }
  return {
    id,
    snapshot: {
      sourceId,
      takenAt: decodeText('taken_at', at('taken_at'), row['taken_at']),
      outcome: outcome as SnapshotOutcome,
      status: decodeInteger('status', at('status'), row['status']),
      bytes: decodeInteger('bytes', at('bytes'), row['bytes']),
      durationMs: decodeOptionalInteger('duration_ms', at('duration_ms'), row['duration_ms']),
      itemCount: decodeOptionalInteger('item_count', at('item_count'), row['item_count']),
      errorKind: errorKind as ErrorKind | null,
      note: decodeOptionalText('note', at('note'), row['note']),
    },
  };
};

const limitOf = (limit: number | undefined): number =>
  Math.min(MAX_SNAPSHOT_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_SNAPSHOT_LIMIT)));

export const snapshotsRepository = (db: Tx): SnapshotRepository => ({
  record: (snapshot) => {
    try {
      return db.run(
        `insert into snapshots (${COLUMNS}) values (${PLACEHOLDERS})`,
        snapshot.sourceId,
        snapshot.takenAt,
        snapshot.outcome,
        snapshot.status,
        snapshot.bytes,
        snapshot.durationMs,
        snapshot.itemCount,
        snapshot.errorKind,
        snapshot.note,
      ).lastInsertRowid;
    } catch (cause) {
      throw new SnapshotError(snapshot.sourceId, cause instanceof Error ? cause.message : String(cause));
    }
  },

  list: (sourceId, options) => {
    const since = options?.since === undefined ? '' : ' and taken_at >= ?';
    const params =
      options?.since === undefined
        ? [sourceId, limitOf(options?.limit)]
        : [sourceId, options.since, limitOf(options?.limit)];
    return db
      .all(`${SELECT_SQL} where source_id = ?${since} order by taken_at desc, id desc limit ?`, ...params)
      .map(oneOf);
  },

  last: (sourceId) => {
    const row = db.get(`${SELECT_SQL} where source_id = ? order by taken_at desc, id desc limit 1`, sourceId);
    return row === undefined ? undefined : oneOf(row);
  },

  count: (sourceId) =>
    decodeCount(
      'c',
      sourceId === undefined
        ? db.get('select count(*) as c from snapshots')
        : db.get('select count(*) as c from snapshots where source_id = ?', sourceId),
    ),
});
