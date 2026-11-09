/**
 * The driver seam. `node:sqlite` is measured to hand back a bigint for an
 * integer above 2^53 (and to throw when it converts one), and a byte array for a
 * blob; this schema stores neither, so the seam turns them into a typed failure
 * that names the statement. These cases cannot be produced through a
 * repository, which is why the seam is tested on its own.
 */
import { describe, expect, it } from 'vitest';
import { narrowRow, narrowRunResult, RowShapeError, sqliteDriver, statementsOf } from '../src/index.ts';
import { tempFile } from './support.ts';

const onMemory = (): ReturnType<typeof statementsOf> =>
  statementsOf(sqliteDriver.open(':memory:', { busyTimeoutMs: 250 }));

describe('the seam’s narrowing', () => {
  it('refuses a run result whose counts are not numbers, by name', () => {
    const nullish = { changes: null as unknown as number, lastInsertRowid: 1 };
    expect(() => narrowRunResult('insert into t (a) values (1)', nullish)).toThrow(/SQL NULL/);
    expect(() =>
      narrowRunResult('insert into t (a) values (1)', { changes: undefined as unknown as number, lastInsertRowid: 1 }),
    ).toThrow(/absent/);
  });
  it('accepts what this schema stores: text, integers, reals, null', () => {
    expect(narrowRow('select 1 as one', { n: null, t: 'text', three: 3, half: 2.5 })).toEqual({
      n: null,
      t: 'text',
      three: 3,
      half: 2.5,
    });
    expect(narrowRow('select 1 as one', undefined)).toBeUndefined();
    expect(narrowRow('select 1 as one', {})).toEqual({});
  });

  it('refuses a bigint, and says what it found and in which statement', () => {
    expect(() => narrowRow('select n from bigs', { n: 9007199254740993n })).toThrow(RowShapeError);
    expect(() => narrowRow('select n from bigs', { n: 9007199254740993n })).toThrow(
      /the bigint 9007199254740993 \(outside the 2\^53 range/,
    );
    expect(() => narrowRow('select n from bigs', { n: 9007199254740993n })).toThrow('in select n from bigs');
    expect(() => narrowRow('insert into bigs (n)\n  values (1)', { n: -9007199254740993n })).toThrow(
      'in insert into bigs (n)',
    );
  });

  it('refuses a blob, and counts the bytes it will not guess at', () => {
    expect(() => narrowRow('select x as signature', { x: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })).toThrow(
      /4 bytes \(this schema stores no blobs\)/,
    );
    expect(() => narrowRow('select x as signature', { x: new Uint8Array(0) })).toThrow(/0 bytes/);
  });

  it('refuses the rest of JavaScript, by name', () => {
    expect(() => narrowRow('select * from t', { a: undefined })).toThrow(/absent/);
    expect(() => narrowRow('select * from t', { a: {} })).toThrow(/an object/);
    expect(() => narrowRow('select * from t', { a: [] })).toThrow(/an object/);
    expect(() => narrowRow('select * from t', { a: Number.NaN })).toThrow(/a number/);
    expect(() => narrowRow('select * from t', { a: Number.POSITIVE_INFINITY })).toThrow(/a number/);
  });

  it('accepts a run result it can count, and refuses one it cannot', () => {
    expect(narrowRunResult('insert into t (a) values (1)', { changes: 2, lastInsertRowid: 7 })).toEqual({
      changes: 2,
      lastInsertRowid: 7,
    });
    expect(() => narrowRunResult('insert into t (a) values (1)', { changes: 3n, lastInsertRowid: 7 })).toThrow(
      /the bigint 3/,
    );
    expect(() => narrowRunResult('insert into t (a) values (1)', { changes: 1, lastInsertRowid: 7n })).toThrow(
      RowShapeError,
    );
    expect(narrowRunResult('insert into t (a) values (1)', { changes: 0, lastInsertRowid: 0 })).toEqual({
      changes: 0,
      lastInsertRowid: 0,
    });
  });
});

describe('the real driver', () => {
  it('lets `node:sqlite` refuse an integer above 2^53 when it reads one', () => {
    // Measured, and worth a test: the conversion throws before the seam sees a
    // bigint, so a database written by another tool with a huge integer fails
    // loudly on the read.
    const db = onMemory();
    db.exec('create table bigs (n integer)');
    db.exec('insert into bigs (n) values (9007199254740993)');
    expect(() => db.get('select n from bigs')).toThrow(/too large to be represented as a JavaScript number/);
    expect(() => db.all('select n from bigs')).toThrow(/too large/);
    db.close();
  });

  it('passes null, text and finite numbers through untouched', () => {
    const db = onMemory();
    expect(db.get("select null as n, 'text' as t, 3 as three, 2.5 as half")).toEqual({
      n: null,
      t: 'text',
      three: 3,
      half: 2.5,
    });
    expect(db.get('select 1 as one where 0')).toBeUndefined();
    expect(db.all('select 1 as one where 0')).toEqual([]);
    expect(() => db.get('select 1e999 as infinity')).toThrow(RowShapeError);
    db.close();
  });

  it('runs a statement and reports the row it wrote', () => {
    const db = onMemory();
    db.exec('create table ones (id integer primary key autoincrement, t text)');
    expect(db.run("insert into ones (t) values ('a')")).toEqual({ changes: 1, lastInsertRowid: 1 });
    expect(db.run("insert into ones (t) values ('b'), ('c')")).toEqual({ changes: 2, lastInsertRowid: 3 });
    expect(db.run('delete from ones where t = ?', 'nope')).toEqual({ changes: 0, lastInsertRowid: 3 });
    db.close();
  });

  it('knows when it is inside a transaction, because the savepoint rule depends on it', () => {
    const db = onMemory();
    expect(db.inTransaction()).toBe(false);
    db.transaction((tx) => {
      expect(tx.inTransaction()).toBe(true);
      tx.exec('create table inside (a primary key)');
    });
    expect(db.inTransaction()).toBe(false);
    expect(db.get("select name from sqlite_master where name = 'inside'")?.['name']).toBe('inside');
    db.close();
  });

  it('reports the journal mode it was given, for a file and for memory', async () => {
    const memory = sqliteDriver.open(':memory:', { busyTimeoutMs: 100 });
    expect(memory.journalMode()).toBe('memory');
    memory.close();

    const { file, cleanup } = await tempFile('newspa-db-driver-');
    const onFile = sqliteDriver.open(file, { busyTimeoutMs: 100 });
    expect(onFile.journalMode()).toBe('wal');
    onFile.close();

    const reopened = sqliteDriver.open(file, { busyTimeoutMs: 100 });
    expect(reopened.journalMode()).toBe('wal');
    expect(reopened.prepare('pragma busy_timeout').get()).toEqual({ timeout: 100 });
    reopened.close();
    await cleanup();
  });

  it('applies the pragmas on every connection, including a fractional timeout', () => {
    const db = sqliteDriver.open(':memory:', { busyTimeoutMs: 1_234.7 });
    const tx = statementsOf(db);
    expect(tx.get('pragma busy_timeout')).toEqual({ timeout: 1234 });
    expect(tx.get('pragma foreign_keys')).toEqual({ foreign_keys: 1 });
    expect(tx.get('pragma journal_mode')?.['journal_mode']).toBe('memory');
    tx.close();
  });

  it('opens a file that already exists, and keeps what is in it', async () => {
    const { file, cleanup } = await tempFile('newspa-db-reopen-');
    const made = statementsOf(sqliteDriver.open(file, { busyTimeoutMs: 100 }));
    made.exec('create table kept (a primary key, b)');
    made.run("insert into kept (a, b) values ('one', 2)");
    made.close();

    const again = statementsOf(sqliteDriver.open(file, { busyTimeoutMs: 100 }));
    expect(again.all('select a, b from kept')).toEqual([{ a: 'one', b: 2 }]);
    expect(again.get('pragma integrity_check')?.['integrity_check']).toBe('ok');
    again.close();
    await cleanup();
  });
});
