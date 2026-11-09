/**
 * The `sources` repository: a `SourceSpec` in, a `SourceSpec` out.
 *
 * One-way by design (D-011): `sources/*.json` is the truth, the row is a
 * runnable copy of it, and the web UI never writes here. The spec is stored as
 * canonical JSON **plus** the scalars a query needs — id, kind, url, group,
 * enabled, cadence, weight, `matchCount` — so the sources table answers "which
 * sources are enabled, in which group, at what cadence" without parsing JSON.
 *
 * `insert` and `upsert` both report the source id on failure: a `CHECK`
 * violation, a duplicate id or a JSON column that does not parse is a report
 * naming the source, never a row that quietly is not there.
 */

import type { SourceSpec } from 'newspa-config';
import type { HealthState } from 'newspa-core';
import type { Tx } from './statement.ts';
import { parseTimeSpec, timeSpecOf } from './timeSpec.ts';
import {
  decodeBoolean,
  decodeCount,
  decodeJsonColumn,
  decodeOptionalInteger,
  decodeOptionalText,
  decodeText,
  encodeBoolean,
  encodeJsonColumn,
  type Row,
} from './value.ts';

export interface StoredSource {
  readonly spec: SourceSpec;
  readonly health: HealthState;
  readonly note: string | null;
  readonly lastStatus: number | null;
  readonly lastPolledAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly createdAt: string;
}

/** Fields the pipeline writes after a poll. Absent means "leave what is there". */
export interface SourceHealthPatch {
  readonly health: HealthState;
  readonly note?: string | null;
  readonly lastStatus?: number | null;
  readonly lastPolledAt?: string | null;
  readonly lastSuccessAt?: string | null;
}

export interface SourceListOptions {
  readonly enabledOnly?: boolean;
}

export interface SourcesRepository {
  readonly insert: (spec: SourceSpec, createdAt: string) => void;
  readonly upsert: (spec: SourceSpec, createdAt: string) => void;
  readonly get: (id: string) => StoredSource | undefined;
  readonly find: (id: string) => StoredSource;
  readonly list: (options?: SourceListOptions) => StoredSource[];
  readonly ids: () => string[];
  readonly count: () => number;
  readonly setEnabled: (id: string, enabled: boolean) => void;
  readonly touchLastPolled: (id: string, at: string) => void;
  readonly setHealth: (id: string, patch: SourceHealthPatch) => void;
}

export class SourceKeyError extends Error {
  constructor(sourceId: string, reason: string) {
    super(`source "${sourceId}": ${reason}`);
    this.name = 'SourceKeyError';
  }
}

const COLUMNS = `id, kind, label, url, group_name, enabled, cadence_minutes, weight, match_count,
  source_json, time_spec_json, health, note, last_status, last_polled_at, last_success_at, created_at`;

const SELECT_SQL = `select ${COLUMNS} from sources`;

const bindOf = (spec: SourceSpec, createdAt: string): (string | number | null)[] => [
  spec.id,
  spec.kind,
  spec.label,
  spec.url,
  spec.group ?? spec.label,
  encodeBoolean(spec.enabled),
  spec.cadenceMinutes,
  spec.weight,
  spec.matchCount ?? null,
  encodeJsonColumn('source_json', specWithoutTime(spec)),
  encodeJsonColumn('time_spec_json', timeSpecOf(spec)),
  'unknown',
  null,
  null,
  null,
  null,
  createdAt,
];

/** `cadenceCron`/`quietHours` live in their own column, so they leave the spec JSON. */
const specWithoutTime = (spec: SourceSpec): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...spec };
  delete out['cadenceCron'];
  delete out['quietHours'];
  return out;
};

const specOf = (sourceId: string, row: Row): SourceSpec => {
  const stored = decodeJsonColumn<Record<string, unknown>>('source_json', sourceId, row['source_json']);
  const timeSpec = parseTimeSpec(sourceId, decodeText('time_spec_json', sourceId, row['time_spec_json']));
  if (timeSpec.cadenceCron !== null) stored['cadenceCron'] = timeSpec.cadenceCron;
  if (timeSpec.quietHours !== null) stored['quietHours'] = timeSpec.quietHours;
  // `enabled` is the one spec field the app changes on its own (D-011: the paper
  // has no UI, and `setEnabled` is the seam a future one uses), so the column,
  // not the JSON copied from `sources/*.json`, is the answer.
  stored['enabled'] = decodeBoolean('enabled', `source ${sourceId}`, row['enabled']);
  return stored as SourceSpec;
};

const sourceOf = (row: Row): StoredSource => {
  const id = decodeText('id', 'a source row', row['id']);
  return {
    spec: specOf(id, row),
    health: decodeText('health', `source ${id}`, row['health']) as HealthState,
    note: decodeOptionalText('note', `source ${id}`, row['note']),
    lastStatus: decodeOptionalInteger('last_status', `source ${id}`, row['last_status']),
    lastPolledAt: decodeOptionalText('last_polled_at', `source ${id}`, row['last_polled_at']),
    lastSuccessAt: decodeOptionalText('last_success_at', `source ${id}`, row['last_success_at']),
    createdAt: decodeText('created_at', `source ${id}`, row['created_at']),
  };
};

export const sourcesRepository = (db: Tx): SourcesRepository => {
  const runSpec = (sql: string, spec: SourceSpec, createdAt: string): void => {
    try {
      db.run(sql, ...bindOf(spec, createdAt));
    } catch (cause) {
      throw new SourceKeyError(spec.id, cause instanceof Error ? cause.message : String(cause));
    }
  };

  const requireRow = (sql: string, id: string): StoredSource => {
    const row = db.get(sql, id);
    if (row === undefined) throw new SourceKeyError(id, 'no such source');
    return sourceOf(row);
  };

  const mutate = (sql: string, id: string, ...params: (string | number | null)[]): void => {
    if (db.run(sql, ...params, id).changes === 0) throw new SourceKeyError(id, 'no such source');
  };

  return {
    insert: (spec, createdAt) =>
      runSpec(
        `insert into sources (${COLUMNS}) values (${Array.from({ length: 17 }, () => '?').join(', ')})`,
        spec,
        createdAt,
      ),
    upsert: (spec, createdAt) =>
      runSpec(
        `insert into sources (${COLUMNS}) values (${Array.from({ length: 17 }, () => '?').join(', ')})
         on conflict (id) do update set
           kind = excluded.kind, label = excluded.label, url = excluded.url,
           group_name = excluded.group_name, enabled = excluded.enabled,
           cadence_minutes = excluded.cadence_minutes, weight = excluded.weight,
           match_count = excluded.match_count, source_json = excluded.source_json,
           time_spec_json = excluded.time_spec_json, note = excluded.note`,
        spec,
        createdAt,
      ),
    get: (id) => {
      const row = db.get(`${SELECT_SQL} where id = ?`, id);
      return row === undefined ? undefined : sourceOf(row);
    },
    find: (id) => requireRow(`${SELECT_SQL} where id = ?`, id),
    list: (options) =>
      db
        .all(
          options?.enabledOnly === true
            ? `${SELECT_SQL} where enabled = 1 order by group_name, id`
            : `${SELECT_SQL} order by group_name, id`,
        )
        .map(sourceOf),
    ids: () => db.all('select id from sources order by id').map((row) => decodeText('id', 'a source id', row['id'])),
    count: () => decodeCount('c', db.get('select count(*) as c from sources')),
    setEnabled: (id, enabled) => mutate('update sources set enabled = ? where id = ?', id, encodeBoolean(enabled)),
    touchLastPolled: (id, at) => mutate('update sources set last_polled_at = ? where id = ?', id, at),
    setHealth: (id, patch) =>
      mutate(
        `update sources
           set health = ?,
               note = coalesce (?, note),
               last_status = coalesce (?, last_status),
               last_polled_at = coalesce (?, last_polled_at),
               last_success_at = coalesce (?, last_success_at)
         where id = ?`,
        id,
        patch.health,
        patch.note ?? null,
        patch.lastStatus ?? null,
        patch.lastPolledAt ?? null,
        patch.lastSuccessAt ?? null,
      ),
  };
};

export type { SourceTimeSpec } from './timeSpec.ts';
