import { describe, expect, it } from 'vitest';
import { openTestDatabase } from './support.ts';

describe('the statement cache', () => {
  it('prepares a statement once per SQL text', () => {
    const db = openTestDatabase();
    const sources = db.tx.prepare('select count(*) as c from sources');
    expect(db.tx.prepare('select count(*) as c from sources')).toBe(sources);
    expect(db.tx.prepare('select count(*) as c from items')).not.toBe(sources);
    db.close();
  });

  it('reads, writes and counts through the sugar', () => {
    const db = openTestDatabase();
    db.tx.exec('create table t (v text)');
    expect(db.tx.run('insert into t values (?)', 'one').changes).toBe(1);
    expect(db.tx.get('select v from t')?.['v']).toBe('one');
    expect(db.tx.all('select v from t')).toEqual([{ v: 'one' }]);
    expect(db.tx.get('select v from t where v = ?', 'missing')).toBeUndefined();
    expect(db.tx.run('delete from t where v = ?', 'missing').changes).toBe(0);
    db.close();
  });
});

describe('transactions', () => {
  it('commits on a normal return and hands back the value', () => {
    const db = openTestDatabase();
    db.tx.exec('create table t (v text)');
    const written = db.tx.transaction(() => {
      db.tx.run('insert into t values (?)', 'kept');
      return db.tx.get('select count(*) as c from t');
    });
    expect(written?.['c']).toBe(1);
    expect(db.tx.all('select v from t')).toEqual([{ v: 'kept' }]);
    expect(db.tx.inTransaction()).toBe(false);
    db.close();
  });

  it('rolls back and rethrows the caller’s error', () => {
    const db = openTestDatabase();
    db.tx.exec('create table t (v text)');
    expect(() =>
      db.tx.transaction(() => {
        db.tx.run('insert into t values (?)', 'gone');
        throw new Error('the poll failed');
      }),
    ).toThrow('the poll failed');
    expect(db.tx.all('select v from t')).toEqual([]);
    expect(db.tx.inTransaction()).toBe(false);
    db.close();
  });

  it('keeps the outer work when a nested transaction fails', () => {
    const db = openTestDatabase();
    db.tx.exec('create table t (v text)');
    db.tx.transaction(() => {
      db.tx.run('insert into t values (?)', 'outer-before');
      try {
        db.tx.transaction(() => {
          db.tx.run('insert into t values (?)', 'inner');
          throw new Error('inner boom');
        });
      } catch {
        db.tx.run('insert into t values (?)', 'after-inner-failure');
      }
      db.tx.run('insert into t values (?)', 'outer-after');
    });
    expect(db.tx.all('select v from t order by rowid').map((row) => row['v'])).toEqual([
      'outer-before',
      'after-inner-failure',
      'outer-after',
    ]);
    db.close();
  });

  it('takes a savepoint when the caller has already begun, and does not end it', () => {
    const db = openTestDatabase();
    db.tx.exec('create table t (v text)');
    db.tx.exec('begin');
    db.tx.transaction(() => {
      db.tx.run('insert into t values (?)', 'inside-the-callers-transaction');
    });
    expect(db.tx.inTransaction()).toBe(true);
    db.tx.exec('commit');
    expect(db.tx.all('select v from t').map((row) => row['v'])).toEqual(['inside-the-callers-transaction']);
    db.close();
  });
});

describe('close', () => {
  it('makes the connection unusable, so a repository cannot write after shutdown', () => {
    const db = openTestDatabase();
    db.close();
    expect(() => db.tx.get('select 1')).toThrow(/database is not open/);
    expect(() => db.tx.exec('pragma user_version = 9')).toThrow(/database is not open/);
  });
});
