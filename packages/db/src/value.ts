/**
 * The row boundary. Every value that crosses into or out of SQLite is encoded,
 * decoded, narrowed and validated **here, and nowhere else**: a repository
 * reads a `Row` of `SqlValue` and calls a named decoder, so a column that is
 * NULL where the record says `string` fails with the column name and the
 * record's id (AGENTS.md rule 5 — a broken row is a report, never a silent
 * zero).
 *
 * The JSON-encoded columns are enumerated by name, so "the JSON is encoded in
 * exactly one place" is checkable: `encodeJsonColumn` only accepts a name in
 * `JSON_COLUMNS`, so a new JSON column that is not listed there does not encode.
 *
 * `body` — the capped scrape used for edit detection and scoring — is stored
 * here and is deliberately absent from `ItemView` (D-017): the paper is an
 * index, so full text never reaches the browser.
 */
import type { CacheHints } from 'newspa-core';

/**
 * What this package binds. `node:sqlite` also accepts `bigint` and
 * `ArrayBufferView`, and measured on Node 26.12.1: a `Date`, `NaN` and a plain
 * object all bind as SQL **NULL**, `undefined` binds NULL, a boolean binds 1/0,
 * an array throws, and a JS number binds as REAL (the column's INTEGER affinity
 * is what stores it as an integer). Excluding them here is what keeps those
 * traps out of every repository.
 */
export type SqlValue = null | number | string;

export type Row = Record<string, SqlValue>;

export interface RunResult {
  readonly changes: number;
  readonly lastInsertRowid: number;
}

/** Every column whose content is JSON. Listing one here is the only way to get one. */
export const JSON_COLUMNS = [
  'source_json',
  'fields_json',
  'time_spec_json',
  'cache_json',
  'vary_json',
  'report_json',
] as const;

export type JsonColumn = (typeof JSON_COLUMNS)[number];

/**
 * The per-source change-detection state (docs/fetching.md §“State this
 * requires”). `cache`/`vary`/`etag`/`lastModified`/`responseDate` are the
 * `Validators` core parses out of headers; the rest are the payload's own
 * signals. The two counters make an inert fast path visible, which is why they
 * are written in exactly one statement (`setValidatorState`) and read by the
 * health note.
 */
export interface ValidatorState {
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly responseDate: string | null;
  readonly cache: CacheHints;
  readonly vary: readonly string[];
  readonly weakEtag: boolean;
  readonly bodyHash: string | null;
  /**
   * The hash of the **selected node's** normalized text — the third rung's state
   * (D-027): a poll compares this before it extracts any field, so "the template
   * moved, the story did not" is a named rung and not an `edited` event. `null`
   * for a page-mode source, where the page *is* the selection and rung 2's bytes
   * hash is strictly stronger.
   */
  readonly selectionHash: string | null;
  readonly declaredModifiedAt: string | null;
  readonly generator: string | null;
  readonly freshnessSeconds: number | null;
  readonly ttlMinutes: number | null;
  readonly noCacheMeta: boolean;
  readonly fastPathHits: number;
  readonly fastPathMisses: number;
}

/** A row-boundary failure names the column and the record it came from. */
export class RowShapeError extends Error {
  constructor(column: string, context: string, found: string) {
    super(`column "${column}" ${context}: ${found}`);
    this.name = 'RowShapeError';
  }
}

const describeValue = (value: SqlValue | undefined): string => {
  if (value === undefined) return 'the column was not selected';
  if (value === null) return 'SQL NULL';
  return typeof value === 'number' ? `the number ${value}` : `a ${typeof value}`;
};

export const decodeText = (column: string, id: string, value: SqlValue | undefined): string => {
  if (typeof value === 'string') return value;
  throw new RowShapeError(column, `for ${id}`, describeValue(value));
};

export const decodeOptionalText = (column: string, id: string, value: SqlValue | undefined): string | null => {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw new RowShapeError(column, `for ${id}`, describeValue(value));
};

/**
 * An integer column. Measured: reading an INTEGER above 2^53 makes
 * `node:sqlite` throw a `RangeError` inside `get()`/`all()` (it is not
 * converted to a number), so ids stay in `integer primary key autoincrement`
 * range; a non-finite number in the row is a broken row, not a zero.
 */
export const decodeInteger = (column: string, id: string, value: SqlValue | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  throw new RowShapeError(column, `for ${id}`, describeValue(value));
};

export const decodeOptionalInteger = (column: string, id: string, value: SqlValue | undefined): number | null =>
  value === null ? null : decodeInteger(column, id, value);

/** A REAL column (scores, weights): finite, because `NaN` is a silent zero. */
export const decodeReal = (column: string, id: string, value: SqlValue | undefined): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new RowShapeError(column, `for ${id}`, describeValue(value));
};

export const decodeBoolean = (column: string, id: string, value: SqlValue | undefined): boolean => {
  if (value === 1) return true;
  if (value === 0) return false;
  throw new RowShapeError(column, `for ${id}`, `expected 0 or 1, got ${describeValue(value)}`);
};

export const encodeBoolean = (value: boolean): number => (value ? 1 : 0);

/** A `count(*)` row, `0` when the query returned no row at all. */
export const decodeCount = (column: string, row: Row | undefined): number => {
  if (row === undefined) return 0;
  return decodeInteger(column, 'a count', row[column]);
};

export interface SourceCount {
  readonly sourceId: string;
  readonly count: number;
}

export const decodeCounts = (column: string, rows: Row[]): SourceCount[] =>
  rows.map((row) => ({
    sourceId: decodeText('source_id', 'a per-source count', row['source_id']),
    count: decodeInteger(column, 'a per-source count', row[column]),
  }));

/**
 * `JSON.stringify` with keys sorted. D-004 rules out native modules and the
 * `escape()` form (non-ASCII bytes are emitted literally), so canonical form is
 * key-sorted JSON: an exported source file diffs by field, and the round-trip
 * test compares parsed values, not bytes.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      if (child !== undefined) out[key] = canonical(child);
    }
    return out;
  }
  return value;
};

export const encodeJson = (value: unknown): string => JSON.stringify(canonical(value));

/**
 * The gate is the point of `JSON_COLUMNS`: a JSON column that is not listed
 * there does not encode, so "the JSON is encoded in exactly one place" is a
 * checkable statement and not a comment.
 */
export const encodeJsonColumn = (name: JsonColumn, value: unknown): string => {
  if (!(JSON_COLUMNS as readonly string[]).includes(name)) {
    throw new RowShapeError(name, 'encode', 'not a JSON column of this schema');
  }
  return encodeJson(value);
};

/**
 * A scalar out of a row that may be absent — a pragma, a `get` that found
 * nothing. The message names the statement, which is the only clue a caller
 * has when a pragma comes back shapeless.
 */
export const decodeTextOf = (column: string, source: string, row: Row | undefined): string =>
  decodeText(column, source, row?.[column]);

export const decodeJson = (column: string, id: string, text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new RowShapeError(column, `for ${id}`, `not JSON (${cause instanceof Error ? cause.message : 'unreadable'})`);
  }
};

/** A JSON column the record requires: absent, NULL or unparsable is an error. */
export const decodeJsonColumn = <T>(name: JsonColumn, id: string, value: SqlValue | undefined): T =>
  decodeJson(name, id, decodeText(name, id, value)) as T;

export const decodeOptionalJsonColumn = <T>(name: JsonColumn, id: string, value: SqlValue | undefined): T | null => {
  if (value === null) return null;
  return decodeJson(name, id, decodeText(name, id, value)) as T;
};
