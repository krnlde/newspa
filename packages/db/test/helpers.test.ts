/**
 * The test helpers themselves.
 *
 * `support.ts` is the scaffolding every other test stands on: a fixed clock,
 * real parsed specs, the driver spy that lets a repository be watched from
 * outside. A helper that quietly returns the wrong thing makes every suite
 * agree on a fiction, so the scaffolding gets its own tests.
 */

import { stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { emptyValidatorState } from '../src/index.ts';
import { statementsOf } from '../src/statement.ts';
import {
  aDriverSpy,
  anEvent,
  anItem,
  aSnapshot,
  aValidatorState,
  FIXED,
  fixedClock,
  HTML_SPEC,
  JSON_SPEC,
  later,
  openTestDatabase,
  RSS_SPEC,
  SPECS,
  seed,
  sharedMemory,
  tempFile,
} from './support.ts';

describe('the clock', () => {
  it('is fixed until it is advanced, and a second clock is independent', () => {
    const clock = fixedClock();
    expect(clock.now()).toEqual(FIXED);
    clock.advance(1_500);
    expect(clock.now()).toEqual(later(FIXED, 1_500));
    expect(fixedClock().now()).toEqual(FIXED);
    expect(fixedClock(later(FIXED, 60_000)).now().toISOString()).toBe('2026-11-09T10:01:00.000Z');
  });
});

describe('the fixtures', () => {
  it('are the specs the config schema accepts, in the order the paper lists them', () => {
    expect(SPECS.map((spec) => spec.id)).toEqual(['rss-one', 'html-two', 'json-three']);
    expect(RSS_SPEC.cadenceCron).toBe('0 1-7 * * 6');
    expect(HTML_SPEC.headers?.['Accept-Language']).toBe('tr');
    expect(JSON_SPEC.enabled).toBe(false);
  });

  it('build a record, an event, a snapshot and a validator state that round-trip', () => {
    const db = openTestDatabase();
    expect(() => db.items.upsert({ item: anItem(), section: 'world' })).toThrow(/FOREIGN KEY/i);
    db.close();

    const seeded = openTestDatabase();
    seed(seeded);
    expect(seeded.sources.list()).toHaveLength(3);
    expect(seeded.items.list()).toHaveLength(2);
    expect(seeded.itemEvents.listRecent({})).toHaveLength(1);
    expect(seeded.snapshots.list('rss-one')).toHaveLength(3);
    seeded.close();

    expect(aSnapshot({ outcome: 'error' }).errorKind).toBeNull();
    expect(anEvent({ kind: 'edited' }).report).toBeNull();
    expect(aValidatorState()).toEqual(emptyValidatorState());
    expect(aValidatorState({ fastPathHits: 3 }).fastPathHits).toBe(3);
  });
});

describe('the driver spy', () => {
  it('reports the mode a connection was opened with, on both paths', () => {
    const spy = aDriverSpy('newspa.db');
    const file = spy.driver.open('newspa.db', { busyTimeoutMs: 1_000 });
    expect(file.journalMode()).toBe('wal');
    const memory = spy.driver.open(':memory:', { busyTimeoutMs: 500 });
    expect(memory.journalMode()).toBe('memory');
    expect(spy.connection.journal).toBe('memory');
  });

  it('answers the pragmas, records what it was asked to run, and counts closes', () => {
    const spy = aDriverSpy(':memory:', 3);
    const tx = statementsOf(spy.driver.open(':memory:', { busyTimeoutMs: 1 }));
    expect(tx.get('pragma user_version')).toEqual({ user_version: 3 });
    expect(tx.get('pragma journal_mode')).toEqual({ journal_mode: 'memory' });
    expect(tx.all('select * from whatever')).toEqual([]);
    expect(tx.get('select * from nothing')).toBeUndefined();
    tx.exec('pragma user_version = 7');
    expect(tx.get('pragma user_version')).toEqual({ user_version: 7 });
    expect(tx.run('insert into sources (id) values (?)', 'rss-one')).toEqual({ changes: 1, lastInsertRowid: 7 });
    expect(spy.connection.runs).toContain('insert into sources (id) values (?)');
    expect(tx.inTransaction()).toBe(false);
    tx.close();
    expect(spy.connection.closed).toBe(1);
  });

  it('opens a database through the seam, and hands the options through', () => {
    const spy = aDriverSpy(':memory:', 2);
    const db = openTestDatabase({ driver: spy.driver, busyTimeoutMs: 25, lockStaleAfterMs: 60_000, token: 'spy' });
    expect(db.journalMode).toBe('memory');
    expect(db.token).toBe('spy');
    expect(db.version).toBe(2);
    db.close();
  });
});

describe('the files', () => {
  it('gives a temp file and a cleanup that takes the directory away', async () => {
    const { file, dir, cleanup } = await tempFile('newspa-db-helper-');
    expect(file.endsWith('newspa.db')).toBe(true);
    const db = openTestDatabase({ file });
    expect(db.journalMode).toBe('wal');
    db.close();
    await stat(file);
    await cleanup();
    await expect(stat(dir)).rejects.toThrow(/ENOENT/);
  });

  it('names a shared in-memory database that two connections can contend', () => {
    expect(sharedMemory('x')).toBe('file:memdb-x?mode=memory&cache=shared');
  });
});
