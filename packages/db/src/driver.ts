/**
 * The seam between this package and `node:sqlite`. `nodeDriver.ts` is the only
 * module that imports `node:sqlite`; everything else — every repository, every
 * migration, every test — talks to `DatabaseLike`.
 *
 * The seam is narrower than `DatabaseSync` on purpose. Measured on
 * Node 26.12.1, rows arrive as `Record<string, SQLOutputValue>` where a value
 * can be a `bigint` (an INTEGER above 2^53 makes `node:sqlite` throw a
 * `RangeError` while it builds the row) or a `Uint8Array`; the driver narrows
 * both to a typed failure that names the statement, because this schema stores
 * no bigints and no blobs. `node:sqlite` also has no `.transaction()` —
 * `exec('begin')` twice throws `cannot start a transaction within a
 * transaction` — so nesting is a `savepoint` (see `statement.ts`).
 */
import type { Row, RunResult, SqlValue } from './value.ts';

export interface StatementLike {
  readonly run: (...params: SqlValue[]) => RunResult;
  readonly get: (...params: SqlValue[]) => Row | undefined;
  readonly all: (...params: SqlValue[]) => Row[];
}

export interface DatabaseLike {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => StatementLike;
  /** The journal mode the engine reports back: `wal` for a file, `memory` for `:memory:`. */
  readonly journalMode: () => string;
  readonly isTransaction: boolean;
  readonly close: () => void;
}

/**
 * The same connection under the name callers use. `DatabaseSync` is the
 * engine's name for the file; what this type describes is a live connection,
 * and the distinction matters because `:memory:` files die with their last
 * connection.
 */
export type ConnectionLike = DatabaseLike;

export interface DriverOptions {
  /** `PRAGMA busy_timeout`, measured: 0 fails after 1 ms with `database is locked`. */
  readonly busyTimeoutMs: number;
}

/** Opens a connection with this schema's pragmas applied. */
export interface Driver {
  readonly open: (file: string, options: DriverOptions) => DatabaseLike;
}

export type { Row, RunResult } from './value.ts';
