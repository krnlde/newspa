/**
 * One row per poll, including the polls that changed nothing: this table is what
 * makes "answered 304 four hundred times" a sentence (docs/architecture.md).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAPSHOT_LIMIT,
  MAX_SNAPSHOT_LIMIT,
  type PollSnapshot,
  SNAPSHOT_OUTCOMES,
  SnapshotError,
} from '../src/index.ts';
import { aSnapshot, HTML_SPEC, openTestDatabase, RSS_SPEC, seed } from './support.ts';

const POLL_SQL =
  'insert into snapshots (source_id, taken_at, outcome, status, bytes, duration_ms, item_count, error_kind, note) values (?, ?, ?, ?, ?, ?, ?, ?, ?)';

const withPolls = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  seed(db);
  db.snapshots.record(
    aSnapshot({
      takenAt: '2026-11-09T07:00:00Z',
      outcome: 'declared-unchanged',
      status: 200,
      bytes: 370_436,
      durationMs: 96,
      itemCount: 30,
    }),
  );
  db.snapshots.record(
    aSnapshot({ sourceId: HTML_SPEC.id, takenAt: '2026-11-09T07:05:00Z', itemCount: 12, bytes: 20_000 }),
  );
  return db;
};

describe('snapshots: one row per poll', () => {
  it('records a poll and reads it back, id included', () => {
    const db = withPolls();
    const last = db.snapshots.last(RSS_SPEC.id);
    expect(last?.id).toBe(4);
    expect(last?.snapshot).toEqual({
      sourceId: RSS_SPEC.id,
      takenAt: '2026-11-09T07:00:00Z',
      outcome: 'declared-unchanged',
      status: 200,
      bytes: 370_436,
      durationMs: 96,
      itemCount: 30,
      errorKind: null,
      note: null,
    });
    expect(db.snapshots.count()).toBe(5);
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(4);
    expect(db.snapshots.count(HTML_SPEC.id)).toBe(1);
    db.close();
  });

  it('stores the 304 poll, with the validators that answered it', () => {
    const db = withPolls();
    const id = db.snapshots.record(
      aSnapshot({
        takenAt: '2026-11-09T08:00:00Z',
        outcome: 'not-modified',
        status: 304,
        bytes: 0,
        durationMs: 88,
        itemCount: null,
      }),
    );
    const stored = db.snapshots.list(RSS_SPEC.id, { limit: 1 })[0];
    expect(stored?.id).toBe(id);
    expect(stored?.snapshot.outcome).toBe('not-modified');
    expect(stored?.snapshot.status).toBe(304);
    expect(stored?.snapshot.bytes).toBe(0);
    expect(stored?.snapshot.itemCount).toBeNull();
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(5);
    db.close();
  });

  it('stores the failed poll, and the shape of each rung of the ladder', () => {
    const db = withPolls();
    const failed = db.snapshots.record(
      aSnapshot({
        takenAt: '2026-11-09T09:00:00Z',
        outcome: 'error',
        status: 503,
        bytes: 0,
        durationMs: 2_010,
        itemCount: null,
        errorKind: 'http',
        note: 'upstream 503 from the CDN',
      }),
    );
    expect(failed).toBe(6);
    expect(db.snapshots.last(RSS_SPEC.id)?.snapshot).toMatchObject({
      outcome: 'error',
      status: 503,
      errorKind: 'http',
      note: 'upstream 503 from the CDN',
    });
    for (const [index, outcome] of SNAPSHOT_OUTCOMES.entries()) {
      expect(
        db.snapshots.record(aSnapshot({ takenAt: `2026-11-09T11:0${index}:00Z`, outcome, itemCount: 1 })),
      ).toBeGreaterThan(0);
    }
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(5 + SNAPSHOT_OUTCOMES.length);
    db.close();
  });

  it('answers a source that has never been polled', () => {
    const db = openTestDatabase();
    seed(db);
    db.tx.run('delete from snapshots');
    expect(db.snapshots.last(RSS_SPEC.id)).toBeUndefined();
    expect(db.snapshots.list(RSS_SPEC.id)).toEqual([]);
    expect(db.snapshots.count()).toBe(0);
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(0);
    db.close();
  });
});

describe('snapshots: the history the health page reads', () => {
  it('lists one source, newest first, with a limit and a floor', () => {
    const db = withPolls();
    expect(db.snapshots.list(RSS_SPEC.id).map((s) => s.snapshot.takenAt)).toEqual([
      '2026-11-09T07:00:00Z',
      '2026-11-09T06:40:00Z',
      '2026-11-09T06:20:00Z',
      '2026-11-09T06:00:00Z',
    ]);
    expect(db.snapshots.list(RSS_SPEC.id, { limit: 2 }).map((s) => s.snapshot.outcome)).toEqual([
      'declared-unchanged',
      'error',
    ]);
    expect(db.snapshots.list(RSS_SPEC.id, { since: '2026-11-09T06:20:00Z' }).map((s) => s.snapshot.takenAt)).toEqual([
      '2026-11-09T07:00:00Z',
      '2026-11-09T06:40:00Z',
      '2026-11-09T06:20:00Z',
    ]);
    expect(db.snapshots.list(RSS_SPEC.id, { since: '2026-11-09T06:20:00Z', limit: 1 })).toHaveLength(1);
    expect(db.snapshots.list(RSS_SPEC.id, { limit: 10_000 })).toHaveLength(4);
    // A limit of 0 is clamped to 1, not read as "all": a page of nothing is a
    // bug, and a caller that meant "all" passes MAX_SNAPSHOT_LIMIT.
    expect(db.snapshots.list(RSS_SPEC.id, { limit: 0 })).toHaveLength(1);
    expect(db.snapshots.list('nosuch')).toEqual([]);
    db.close();
  });

  it('publishes the limits the health page is built around', () => {
    expect(DEFAULT_SNAPSHOT_LIMIT).toBe(50);
    expect(MAX_SNAPSHOT_LIMIT).toBe(200);
    const db = openTestDatabase();
    seed(db);
    expect(db.snapshots.list(RSS_SPEC.id, { limit: 2.4 })).toHaveLength(2);
    expect(db.snapshots.list(RSS_SPEC.id, { limit: 900 })).toHaveLength(3);
    db.close();
  });

  it('names the source, and the constraint, when a write fails', () => {
    const db = withPolls();
    expect(() => db.snapshots.record(aSnapshot({ sourceId: 'nosuch' }))).toThrow(SnapshotError);
    expect(() => db.snapshots.record(aSnapshot({ sourceId: 'nosuch' }))).toThrow('snapshot for source "nosuch"');
    expect(() => db.snapshots.record(aSnapshot({ sourceId: 'nosuch' }))).toThrow(/FOREIGN KEY constraint failed/i);
    db.close();
  });

  it('refuses an outcome the ladder does not name, and an error kind core does not have', () => {
    const db = withPolls();
    const outcomes = [
      ['not-modified', 304],
      ['same-body', 200],
      ['declared-unchanged', 200],
      ['changed', 200],
      ['error', 0],
    ] as const;
    for (const [index, pair] of outcomes.entries()) {
      expect(
        db.snapshots.record(
          aSnapshot({
            sourceId: HTML_SPEC.id,
            takenAt: `2026-11-09T12:0${index}:00Z`,
            outcome: pair[0],
            status: pair[1],
          }),
        ),
      ).toBeGreaterThan(0);
    }
    const bad: PollSnapshot = { ...aSnapshot(), outcome: 'fetch-failed' as never };
    expect(() => db.snapshots.record(bad)).toThrow(/CHECK constraint/i);
    expect(() => db.snapshots.record({ ...aSnapshot(), errorKind: 'dns' as never })).toThrow(/CHECK constraint/i);
    for (const kind of ['network', 'timeout', 'tls', 'http', 'parse', 'kind-mismatch', 'render'] as const) {
      db.tx.run(POLL_SQL, RSS_SPEC.id, '2026-11-09T13:00:00Z', 'error', 0, 0, null, null, kind, null);
    }
    expect(() =>
      db.tx.run(POLL_SQL, RSS_SPEC.id, '2026-11-09T13:10:00Z', 'error', 0, 0, null, null, 'dns', null),
    ).toThrow(/CHECK constraint/i);
    db.close();
  });

  it('cascades a source’s polls when the paper deletes the source', () => {
    const db = withPolls();
    expect(db.snapshots.count()).toBe(5);
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(4);
    db.tx.run('delete from sources where id = ?', RSS_SPEC.id);
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(0);
    expect(db.snapshots.count(HTML_SPEC.id)).toBe(1);
    expect(db.snapshots.count()).toBe(1);
    expect(db.snapshots.list(RSS_SPEC.id)).toEqual([]);
    db.close();
  });
});
