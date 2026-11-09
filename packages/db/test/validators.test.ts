/**
 * The validator state: the row that answers "has this changed?" before the
 * body is read. Every read is a result, never an exception, because a source
 * that has never been polled is normal and a row that cannot be decoded is a
 * report about the cache, not a crash.
 */
import { describe, expect, it } from 'vitest';
import { EMPTY_CACHE_HINTS, emptyValidatorState, type ValidatorState } from '../src/index.ts';
import { aValidatorState, HTML_SPEC, JSON_SPEC, openTestDatabase, RSS_SPEC, seed } from './support.ts';

const FULL: ValidatorState = aValidatorState({
  etag: 'W/"3f9-1a2"',
  lastModified: 'Mon, 09 Nov 2026 05:59:00 GMT',
  responseDate: 'Mon, 09 Nov 2026 06:00:01 GMT',
  cache: {
    maxAgeSeconds: 120,
    sharedMaxAgeSeconds: null,
    noStore: false,
    noCache: false,
    mustRevalidate: true,
    private: true,
    immutable: false,
  },
  vary: ['Accept-Language', 'Cookie'],
  weakEtag: true,
  bodyHash: '9b15d2c7e0a4',
  declaredModifiedAt: '2026-11-09T05:59:00Z',
  generator: 'WordPress 6.9',
  freshnessSeconds: 90,
  ttlMinutes: 30,
  noCacheMeta: true,
  fastPathHits: 7,
  fastPathMisses: 2,
});

const seeded = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  seed(db);
  return db;
};

const rowCount = (db: ReturnType<typeof openTestDatabase>): number =>
  Number(db.tx.get('select count(*) as c from source_validators')?.['c']);

describe('validators: the round trip', () => {
  it('writes a state and reads the same state back', () => {
    const db = seeded();
    expect(db.validators.write(RSS_SPEC.id, FULL)).toEqual({ ok: true, state: FULL });
    expect(db.validators.read(RSS_SPEC.id)).toEqual({ ok: true, sourceId: RSS_SPEC.id, state: FULL });
    expect(rowCount(db)).toBe(1);
    db.close();
  });

  it('writes the empty state, where every nullable column is null', () => {
    const db = seeded();
    const empty = emptyValidatorState();
    expect(empty).toEqual({
      etag: null,
      lastModified: null,
      responseDate: null,
      cache: EMPTY_CACHE_HINTS,
      vary: [],
      weakEtag: false,
      bodyHash: null,
      declaredModifiedAt: null,
      generator: null,
      freshnessSeconds: null,
      ttlMinutes: null,
      noCacheMeta: false,
      fastPathHits: 0,
      fastPathMisses: 0,
    });
    db.validators.write(HTML_SPEC.id, empty);
    expect(db.validators.read(HTML_SPEC.id)).toEqual({ ok: true, sourceId: HTML_SPEC.id, state: empty });
    const row = db.tx.get(
      'select etag, body_hash, vary_json, cache_json, weak_etag, no_cache_meta from source_validators',
    );
    expect(row).toMatchObject({ etag: null, body_hash: null, weak_etag: 0, no_cache_meta: 0 });
    expect(JSON.parse(String(row?.['vary_json']))).toEqual([]);
    expect(JSON.parse(String(row?.['cache_json']))).toEqual(EMPTY_CACHE_HINTS);
    db.close();
  });

  it('updates the row it already wrote, instead of adding a second one', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, emptyValidatorState());
    db.validators.write(RSS_SPEC.id, FULL);
    expect(rowCount(db)).toBe(1);
    expect(db.validators.read(RSS_SPEC.id)).toEqual({ ok: true, sourceId: RSS_SPEC.id, state: FULL });
    expect(db.validators.list().map((v) => v.sourceId)).toEqual([RSS_SPEC.id]);
    db.close();
  });

  it('lists every source that has state, in key order', () => {
    const db = seeded();
    db.validators.write(HTML_SPEC.id, FULL);
    db.validators.write(RSS_SPEC.id, emptyValidatorState());
    expect(db.validators.list()).toEqual([
      { sourceId: HTML_SPEC.id, state: FULL },
      { sourceId: RSS_SPEC.id, state: emptyValidatorState() },
    ]);
    db.close();
  });
});

describe('validators: the counters, and the results that report', () => {
  it('counts the fast path in the state it stores', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, emptyValidatorState());
    expect(db.validators.countFastPath(RSS_SPEC.id, true)).toBe(true);
    expect(db.validators.countFastPath(RSS_SPEC.id, true)).toBe(true);
    expect(db.validators.countFastPath(RSS_SPEC.id, false)).toBe(true);
    const state = db.validators.read(RSS_SPEC.id);
    expect(state.ok && state.state.fastPathHits).toBe(2);
    expect(state.ok && state.state.fastPathMisses).toBe(1);
    expect(db.validators.countFastPath('nosuch', true)).toBe(false);
    db.close();
  });

  it('reports a source that has never been polled, without throwing', () => {
    const db = seeded();
    expect(db.validators.read(RSS_SPEC.id)).toEqual({
      ok: false,
      sourceId: RSS_SPEC.id,
      reason: 'no validator state: never polled, or the source was removed',
    });
    db.close();
  });

  it('reports a write that the schema refuses, and names the cause', () => {
    const db = seeded();
    const written = db.validators.write('nosuch', FULL);
    expect(written.ok).toBe(false);
    expect(written.ok ? '' : written.reason).toMatch(/FOREIGN KEY constraint failed/i);
    expect(rowCount(db)).toBe(0);
    db.close();
  });

  it('reports a cache hint that is not a cache hint, and leaves the row alone', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, FULL);
    // The CHECK keeps out anything that is not a JSON object, so every value
    // here is an object: the read is a schema failure, and it is reported.
    for (const broken of [
      '{}',
      '{"maxAgeSeconds":120}',
      '{"noStore":true}',
      '{"maxAgeSeconds":-1,"noStore":false,"noCache":false,"mustRevalidate":false,"private":false,"immutable":false}',
    ]) {
      db.tx.run('update source_validators set cache_json = ? where source_id = ?', broken, RSS_SPEC.id);
      const read = db.validators.read(RSS_SPEC.id);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toMatch(/cache_json|CacheHints/i);
    }
    expect(() => db.validators.list()).toThrow(/cache_json|CacheHints/i);
    db.close();
  });

  it('reports a Vary list that is not a list of strings', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, FULL);
    // The CHECK keeps out anything that is not a JSON array, so the read is the
    // place a mixed list is caught.
    for (const broken of ['["ok",3]', '[null]', '[{}]', '[[]]', '["ok","ok"]']) {
      db.tx.run('update source_validators set vary_json = ? where source_id = ?', broken, RSS_SPEC.id);
      const read = db.validators.read(RSS_SPEC.id);
      if (broken === '["ok","ok"]') {
        expect(read.ok).toBe(true);
        if (read.ok) expect(read.state.vary).toEqual(['ok', 'ok']);
        continue;
      }
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toMatch(/vary_json|array of strings/i);
    }
    db.close();
  });

  it('clears the state, which is what a source that changed shape needs', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, FULL);
    db.validators.clear(RSS_SPEC.id);
    expect(rowCount(db)).toBe(0);
    expect(db.validators.read(RSS_SPEC.id).ok).toBe(false);
    db.validators.clear(RSS_SPEC.id);
    expect(rowCount(db)).toBe(0);
    db.close();
  });

  it('follows the source away when the paper deletes it', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, FULL);
    db.validators.write(HTML_SPEC.id, emptyValidatorState());
    db.tx.run('delete from sources where id = ?', RSS_SPEC.id);
    expect(rowCount(db)).toBe(1);
    expect(db.validators.list().map((v) => v.sourceId)).toEqual([HTML_SPEC.id]);
    db.close();
  });

  it('refuses a broken JSON column at the door, with the CHECK it wrote', () => {
    const db = seeded();
    const insert =
      'insert into source_validators (source_id, etag, last_modified, response_date, cache_json, vary_json, weak_etag, body_hash, declared_modified_at, generator, freshness_seconds, ttl_minutes, no_cache_meta, fast_path_hits, fast_path_misses) values (?, null, null, null, ?, ?, 0, null, null, null, null, null, 0, 0, 0)';
    for (const broken of ['nope', '[]', '[1,2]', 'null', '"a"', '5']) {
      expect(() => db.tx.run(insert, RSS_SPEC.id, broken, '[]')).toThrow(/CHECK constraint/i);
    }
    for (const broken of ['nope', '{}', 'null', '"a"']) {
      expect(() => db.tx.run(insert, RSS_SPEC.id, '{}', broken)).toThrow(/CHECK constraint/i);
    }
    expect(() => db.tx.run(insert, HTML_SPEC.id, '{}', '[]')).not.toThrow();
    expect(() =>
      db.tx.run(
        insert,
        JSON_SPEC.id,
        '{"maxAgeSeconds":null,"sharedMaxAgeSeconds":null,"noStore":false,"noCache":false,"mustRevalidate":false,"private":false,"immutable":false}',
        '["Accept-Encoding"]',
      ),
    ).not.toThrow();
    // The CHECK is a door, not a validator: it keeps out what is not JSON of the
    // right shape. An object with no hints passes it, and the read reports it.
    expect(db.validators.read(HTML_SPEC.id).ok).toBe(false);
    const read = db.validators.read(JSON_SPEC.id);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.state.vary).toEqual(['Accept-Encoding']);
    expect(() => db.validators.list()).toThrow(/cache_json|CacheHints/i);
    db.close();
  });
});
