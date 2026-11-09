/**
 * Prepared statements, cached by SQL text, and the transaction idiom.
 *
 * `node:sqlite` has no `.transaction()` (measured: `db.transaction` is
 * `undefined`), and a second `exec('begin')` throws
 * `cannot start a transaction within a transaction`. Nesting is therefore a
 * `SAVEPOINT`: measured, a savepoint rolled back inside an open transaction
 * undoes only its own writes and the outer work continues — which is what
 * `migrate` needs (one transaction per migration) and what one poll needs when
 * it writes items, events and a snapshot together.
 *
 * Statements are cached because re-preparing per call is the cost the
 * architecture's "SQLite on the event loop, bounded queries" row is about.
 */
import type { DatabaseLike, StatementLike } from './driver.ts';
import type { Row, RunResult, SqlValue } from './value.ts';

/**
 * What a repository needs: statements, and a transaction to nest in. This is
 * the parameter type every module takes, because the same code has to run on a
 * connection *and* inside a `SAVEPOINT` — the pipeline writes items, events and
 * a snapshot in one transaction, so a repository that asked for `Statements`
 * could not be called from `transaction(tx => …)`.
 */
export interface Tx {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => StatementLike;
  readonly get: (sql: string, ...params: SqlValue[]) => Row | undefined;
  readonly all: (sql: string, ...params: SqlValue[]) => Row[];
  readonly run: (sql: string, ...params: SqlValue[]) => RunResult;
  readonly inTransaction: () => boolean;
  readonly transaction: <T>(work: (tx: Tx) => T) => T;
}

/** A connection: everything a transaction has, plus the way to hand it back. */
export interface Statements extends Tx {
  readonly close: () => void;
}

export const statementsOf = (db: DatabaseLike): Statements => {
  const cache = new Map<string, StatementLike>();
  let savepoints = 0;

  const prepare = (sql: string): StatementLike => {
    const cached = cache.get(sql);
    if (cached !== undefined) return cached;
    const statement = db.prepare(sql);
    cache.set(sql, statement);
    return statement;
  };

  const runInTransaction = <T>(work: (tx: Tx) => T): T => {
    if (!db.isTransaction) {
      db.exec('begin immediate');
      try {
        const result = work(api);
        db.exec('commit');
        return result;
      } catch (cause) {
        db.exec('rollback');
        throw cause;
      }
    }
    savepoints += 1;
    const name = `sp${savepoints}`;
    db.exec(`savepoint ${name}`);
    try {
      const result = work(api);
      db.exec(`release ${name}`);
      return result;
    } catch (cause) {
      db.exec(`rollback to ${name}`);
      db.exec(`release ${name}`);
      throw cause;
    }
  };

  const api: Statements = {
    exec: (sql: string) => db.exec(sql),
    prepare,
    transaction: <T>(work: (tx: Tx) => T): T => runInTransaction<T>(work),
    get: (sql: string, ...params: SqlValue[]) => prepare(sql).get(...params),
    all: (sql: string, ...params: SqlValue[]) => prepare(sql).all(...params),
    run: (sql: string, ...params: SqlValue[]) => prepare(sql).run(...params),
    inTransaction: () => db.isTransaction,
    close: () => db.close(),
  };
  return api;
};
