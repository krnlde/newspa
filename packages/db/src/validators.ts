/**
 * The per-source change-detection state (docs/fetching.md §“State this
 * requires”): the HTTP validators, the payload's own signals, and the two
 * fast-path counters.
 *
 * It is written and read as **one unit**, because the ladder's trust rule
 * depends on the parts agreeing: a stored `etag` is replayed verbatim as
 * `If-None-Match`, and a half-written state is a source that looks healthy and
 * takes the slow path forever. The counters are part of the same row: they are
 * the only way an inert fast path is visible (`fastPathHits: 0,
 * fastPathMisses: 400` says this source stamps its HTML).
 *
 * `write` answers with a **discriminated result, not an exception**, so a
 * rejected state reaches the paper as a health note (AGENTS.md rule 5) instead
 * of losing the poll.
 *
 * Measured, a NUL byte in a bound text value is stored whole and compared
 * correctly (`hex(v)` is `610062`, and `where v = 'a\0c'` matches only that
 * row) while SQL's text *functions* see a C string (`length('a\0b')` is 1).
 * Nothing in this module uses a text function, so the state is stored as it
 * arrived.
 */
import type { CacheHints } from 'newspa-core';
import type { Tx } from './statement.ts';
import {
  decodeBoolean,
  decodeInteger,
  decodeJson,
  decodeOptionalInteger,
  decodeOptionalText,
  decodeText,
  encodeBoolean,
  encodeJsonColumn,
  type Row,
  RowShapeError,
  type ValidatorState,
} from './value.ts';

export type ValidatorOutcome =
  | { readonly ok: true; readonly state: ValidatorState }
  | { readonly ok: false; readonly reason: string };

export type ValidatorRead =
  | { readonly ok: true; readonly sourceId: string; readonly state: ValidatorState }
  | { readonly ok: false; readonly sourceId: string; readonly reason: string };

export interface ValidatorRow {
  readonly sourceId: string;
  readonly state: ValidatorState;
}

export interface ValidatorRepository {
  /** The whole state, in one statement: replace the row, inserting it when absent. */
  readonly write: (sourceId: string, state: ValidatorState) => ValidatorOutcome;
  /** One poll's verdict, on the counters. `false` when there is no row to count. */
  readonly countFastPath: (sourceId: string, hit: boolean) => boolean;
  readonly read: (sourceId: string) => ValidatorRead;
  /** Sources that have state. A source that has never been polled is absent. */
  readonly list: () => ValidatorRow[];
  readonly clear: (sourceId: string) => void;
}

const COLUMNS = `source_id, etag, last_modified, response_date, cache_json, vary_json, weak_etag,
  body_hash, selection_hash, declared_modified_at, generator, freshness_seconds, ttl_minutes, no_cache_meta,
  fast_path_hits, fast_path_misses`;

const FIELDS = COLUMNS.split(',').map((column) => column.trim());
const SELECT_SQL = `select ${COLUMNS} from source_validators`;

/** `parseCacheControl('')`'s shape, spelled here because core keeps it private. */
export const EMPTY_CACHE_HINTS: CacheHints = {
  maxAgeSeconds: null,
  sharedMaxAgeSeconds: null,
  noStore: false,
  noCache: false,
  mustRevalidate: false,
  private: false,
  immutable: false,
};

export const emptyValidatorState = (cache: CacheHints = EMPTY_CACHE_HINTS): ValidatorState => ({
  etag: null,
  lastModified: null,
  responseDate: null,
  cache,
  vary: [],
  weakEtag: false,
  bodyHash: null,
  selectionHash: null,
  declaredModifiedAt: null,
  generator: null,
  freshnessSeconds: null,
  ttlMinutes: null,
  noCacheMeta: false,
  fastPathHits: 0,
  fastPathMisses: 0,
});

const isCacheHints = (value: unknown): value is CacheHints => {
  if (typeof value !== 'object' || value === null) return false;
  const hints = value as Record<string, unknown>;
  const isSeconds = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0);
  const flags = ['noStore', 'noCache', 'mustRevalidate', 'private', 'immutable'];
  return (
    isSeconds(hints['maxAgeSeconds']) &&
    isSeconds(hints['sharedMaxAgeSeconds']) &&
    flags.every((flag) => typeof hints[flag] === 'boolean')
  );
};

const stateOf = (sourceId: string, row: Row): ValidatorState => {
  const cache = decodeJson(
    'cache_json',
    `source ${sourceId}`,
    decodeText('cache_json', `source ${sourceId}`, row['cache_json']),
  );
  if (!isCacheHints(cache)) throw new RowShapeError('cache_json', `for source ${sourceId}`, 'not CacheHints');
  const vary = decodeJson(
    'vary_json',
    `source ${sourceId}`,
    decodeText('vary_json', `source ${sourceId}`, row['vary_json']),
  );
  if (!Array.isArray(vary) || !vary.every((field) => typeof field === 'string')) {
    throw new RowShapeError('vary_json', `for source ${sourceId}`, 'not an array of strings');
  }
  const at = (name: string): string => `for source ${sourceId} (${name})`;
  return {
    etag: decodeOptionalText('etag', at('etag'), row['etag']),
    lastModified: decodeOptionalText('last_modified', at('last_modified'), row['last_modified']),
    responseDate: decodeOptionalText('response_date', at('response_date'), row['response_date']),
    cache,
    vary,
    weakEtag: decodeBoolean('weak_etag', at('weak_etag'), row['weak_etag']),
    bodyHash: decodeOptionalText('body_hash', at('body_hash'), row['body_hash']),
    selectionHash: decodeOptionalText('selection_hash', at('selection'), row['selection_hash']),
    declaredModifiedAt: decodeOptionalText('declared_modified_at', at('declared'), row['declared_modified_at']),
    generator: decodeOptionalText('generator', at('generator'), row['generator']),
    freshnessSeconds: decodeOptionalInteger('freshness_seconds', at('freshness'), row['freshness_seconds']),
    ttlMinutes: decodeOptionalInteger('ttl_minutes', at('ttl'), row['ttl_minutes']),
    noCacheMeta: decodeBoolean('no_cache_meta', at('no-cache-meta'), row['no_cache_meta']),
    fastPathHits: decodeInteger('fast_path_hits', at('hits'), row['fast_path_hits']),
    fastPathMisses: decodeInteger('fast_path_misses', at('misses'), row['fast_path_misses']),
  };
};

const valuesOf = (state: ValidatorState): (string | number | null)[] => [
  state.etag,
  state.lastModified,
  state.responseDate,
  encodeJsonColumn('cache_json', state.cache),
  encodeJsonColumn('vary_json', [...state.vary]),
  encodeBoolean(state.weakEtag),
  state.bodyHash,
  state.selectionHash,
  state.declaredModifiedAt,
  state.generator,
  state.freshnessSeconds,
  state.ttlMinutes,
  encodeBoolean(state.noCacheMeta),
  state.fastPathHits,
  state.fastPathMisses,
];

export const validatorRepository = (db: Tx): ValidatorRepository => {
  const updateSql = `update source_validators
       set etag = ?, last_modified = ?, response_date = ?, cache_json = ?, vary_json = ?, weak_etag = ?,
           body_hash = ?, selection_hash = ?, declared_modified_at = ?, generator = ?, freshness_seconds = ?, ttl_minutes = ?,
           no_cache_meta = ?, fast_path_hits = ?, fast_path_misses = ?
     where source_id = ?`;
  const insertSql = `insert into source_validators (${COLUMNS}) values (${FIELDS.map(() => '?').join(', ')})`;

  return {
    write: (sourceId, state) => {
      const values = valuesOf(state);
      try {
        if (db.run(updateSql, ...values, sourceId).changes === 1) return { ok: true, state };
        db.run(insertSql, sourceId, ...values);
        return { ok: true, state };
      } catch (cause) {
        return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
      }
    },

    countFastPath: (sourceId, hit) =>
      db.run(
        `update source_validators set fast_path_hits = fast_path_hits + ?, fast_path_misses = fast_path_misses + ?
         where source_id = ?`,
        hit ? 1 : 0,
        hit ? 0 : 1,
        sourceId,
      ).changes === 1,

    read: (sourceId) => {
      const row = db.get(`${SELECT_SQL} where source_id = ?`, sourceId);
      if (row === undefined) {
        return { ok: false, sourceId, reason: 'no validator state: never polled, or the source was removed' };
      }
      try {
        return { ok: true, sourceId, state: stateOf(sourceId, row) };
      } catch (cause) {
        return { ok: false, sourceId, reason: cause instanceof Error ? cause.message : String(cause) };
      }
    },

    list: () =>
      db.all(`${SELECT_SQL} order by source_id`).map((row) => {
        const sourceId = decodeText('source_id', 'a validator row', row['source_id']);
        return { sourceId, state: stateOf(sourceId, row) };
      }),

    clear: (sourceId) => {
      db.run('delete from source_validators where source_id = ?', sourceId);
    },
  };
};
