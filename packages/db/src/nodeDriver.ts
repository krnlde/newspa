/**
 * The only `node:sqlite` import in the repository.
 *
 * Measured on Node 26.12.1 / SQLite 3.54.0 and applied here:
 *  - `new DatabaseSync(file, { timeout })` — the `timeout` option *is*
 *    `PRAGMA busy_timeout`; the pragma is set again so a connection built
 *    without the option still waits. Measured: at 0 ms a contended write fails
 *    after 1 ms with `database is locked`; at 3000 ms it waits out a 400 ms
 *    write from another process and succeeds.
 *  - `journal_mode = wal` persists in the file — a second opener reports `wal`
 *    — and is **silently ignored on `:memory:`** (the probe read `memory`
 *    back), so the mode is reported by `journalMode()`, never asserted.
 *  - `foreign_keys` is on by default in Node's binding; the pragma states it,
 *    because the `items → item_events` cascade depends on it.
 *  - Rows arrive as `Record<string, SQLOutputValue>`: an INTEGER above 2^53
 *    makes `node:sqlite` throw a `RangeError` inside `get()`. Nothing here is
 *    that large, so a `bigint` or a blob in a row is reported, naming the
 *    statement, rather than passed to a typed mapper.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { DatabaseLike, Driver, DriverOptions, StatementLike } from './driver.ts';
import { decodeTextOf, type Row, RowShapeError, type RunResult, type SqlValue } from './value.ts';

type RawRow = Record<string, unknown>;

/** The seam's own vocabulary for "this is not a value this schema stores". */
const describe = (value: unknown): string => {
  if (value === undefined) return 'absent';
  if (typeof value === 'bigint') return `the bigint ${value} (outside the 2^53 range node:sqlite converts to a number)`;
  if (value instanceof Uint8Array) return `${value.length} bytes (this schema stores no blobs)`;
  if (value === null) return 'SQL NULL';
  if (typeof value === 'object') return 'an object';
  return `a ${typeof value}`;
};

/** One line of the statement, for a message that has to be findable. */
const label = (sql: string): string => {
  const newline = sql.indexOf('\n');
  return newline === -1 ? sql : sql.slice(0, newline);
};
const narrowFields = (sql: string, row: RawRow): Row => {
  const out: Row = {};
  for (const key of Object.keys(row)) {
    const value: unknown = row[key];
    if (value === null || typeof value === 'string') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    throw new RowShapeError(key, `in ${label(sql)}`, describe(value));
  }
  return out;
};

const narrow = (sql: string, row: RawRow | undefined): Row | undefined =>
  row === undefined ? undefined : narrowFields(sql, row);

const narrowRun = (
  sql: string,
  result: { readonly changes: number | bigint; readonly lastInsertRowid: number | bigint },
): RunResult => {
  if (typeof result.changes !== 'number' || typeof result.lastInsertRowid !== 'number') {
    throw new RowShapeError('changes', `in ${label(sql)}`, describe(result.changes));
  }
  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
};

/**
 * The seam's judgement, exported so its own test can hand it the values
 * `node:sqlite` is measured to produce: a bigint for an integer above 2^53, a
 * byte array for a blob, `undefined` for a missing key.
 */
export const narrowRow = narrow;
export const narrowRunResult = narrowRun;

const statementOf = (statement: StatementSync, sql: string): StatementLike => ({
  run: (...params: SqlValue[]) => narrowRun(sql, statement.run(...params)),
  get: (...params: SqlValue[]) => narrow(sql, statement.get(...params)),
  all: (...params: SqlValue[]) => statement.all(...params).map((row) => narrowFields(sql, row)),
});

const isMemory = (file: string): boolean => file === ':memory:' || file.includes('mode=memory');

export const sqliteDriver: Driver = {
  open: (file: string, options: DriverOptions): DatabaseLike => {
    // `DatabaseSync` refuses a fractional `timeout` (measured: `The
    // "options.timeout" argument must be an integer`), so the number is
    // truncated once and both the constructor and the pragma see it.
    const timeoutMs = Math.trunc(options.busyTimeoutMs);
    const db = new DatabaseSync(file, { timeout: timeoutMs });
    db.exec('pragma foreign_keys = on');
    db.exec(`pragma busy_timeout = ${timeoutMs}`);
    if (!isMemory(file)) db.exec('pragma journal_mode = wal');
    return {
      exec: (sql: string) => db.exec(sql),
      prepare: (sql: string) => statementOf(db.prepare(sql), sql),
      journalMode: () =>
        decodeTextOf(
          'journal_mode',
          'pragma journal_mode',
          statementOf(db.prepare('pragma journal_mode'), 'pragma journal_mode').get(),
        ),
      get isTransaction(): boolean {
        return db.isTransaction;
      },
      close: () => db.close(),
    };
  },
};
