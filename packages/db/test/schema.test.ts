/**
 * The DDL: what SQLite is told to accept, measured by trying it. Every `CHECK`
 * set is pinned to the union in core that it came from, and every cascade is
 * the paper's own "delete a source" path.
 */

import type { ErrorKind, EventKind, HealthState, SourceKind } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import {
  CHECK_ERROR_KINDS,
  CHECK_EVENT_KINDS,
  CHECK_HEALTH_STATES,
  CHECK_KINDS,
  emptyValidatorState,
  SNAPSHOT_OUTCOMES,
  type SnapshotOutcome,
} from '../src/index.ts';
import { anItem, openTestDatabase, RSS_SPEC, seed } from './support.ts';

const SOURCE_INSERT =
  'insert into sources (id, kind, label, url, group_name, enabled, cadence_minutes, weight, source_json, time_spec_json, health, created_at) values (?, ?, ?, ?, ?, 1, 30, 1, ?, ?, ?, ?)';
const ITEM_INSERT =
  'insert into items (source_id, key, kind, title, link, body, section, first_seen_at, last_seen_at, edit_count, score_realtime, score_digest) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1)';
const EVENT_INSERT =
  'insert into item_events (source_id, item_key, kind, at, title, link, score) values (?, ?, ?, ?, ?, ?, 1)';
const SNAPSHOT_INSERT = 'insert into snapshots (source_id, taken_at, outcome, status, bytes) values (?, ?, ?, 200, 10)';

const seeded = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  seed(db);
  return db;
};

describe('the CHECK sets, pinned to core', () => {
  it('names exactly the source kinds core has', () => {
    const kinds: readonly SourceKind[] = ['rss', 'html', 'json'];
    expect(CHECK_KINDS).toEqual(kinds);
    const db = seeded();
    for (const kind of kinds) {
      db.tx.run(
        SOURCE_INSERT,
        `k-${kind}`,
        kind,
        'K',
        `https://${kind}.example`,
        'K',
        '{}',
        '{}',
        'unknown',
        '2026-11-09T00:00:00Z',
      );
    }
    expect(db.sources.count()).toBe(3 + 3);
    expect(() =>
      db.tx.run(
        SOURCE_INSERT,
        'k-atom',
        'atom',
        'K',
        'https://atom.example',
        'K',
        '{}',
        '{}',
        'unknown',
        '2026-11-09T00:00:00Z',
      ),
    ).toThrow(/CHECK constraint/i);
    expect(() => db.items.upsert({ item: anItem({ kind: 'atom' as SourceKind }), section: 'world' })).toThrow(
      /CHECK constraint/i,
    );
    db.close();
  });

  it('names exactly the event kinds core has', () => {
    const kinds: readonly EventKind[] = ['new', 'edited', 'gone'];
    expect(CHECK_EVENT_KINDS).toEqual(kinds);
    const db = seeded();
    for (const kind of kinds) {
      db.tx.run(EVENT_INSERT, RSS_SPEC.id, 'rss-one:1', kind, '2026-11-09T07:00:00Z', 't', 'https://one.example/a');
    }
    expect(db.itemEvents.count({ kind: 'new' })).toBe(2);
    expect(() =>
      db.tx.run(
        EVENT_INSERT,
        RSS_SPEC.id,
        'rss-one:1',
        'removed',
        '2026-11-09T07:10:00Z',
        't',
        'https://one.example/a',
      ),
    ).toThrow(/CHECK constraint/i);
    db.close();
  });

  it('names exactly the health states the validator uses', () => {
    const states: readonly HealthState[] = ['unknown', 'ok', 'blocked', 'no-matches', 'restructured', 'error', 'stale'];
    expect(CHECK_HEALTH_STATES).toEqual(states);
    const db = seeded();
    for (const state of states) db.sources.setHealth(RSS_SPEC.id, { health: state });
    expect(db.sources.find(RSS_SPEC.id).health).toBe('stale');
    expect(() => db.sources.setHealth(RSS_SPEC.id, { health: 'meh' as HealthState })).toThrow(/CHECK constraint/i);
    db.close();
  });

  it('names exactly the error kinds core has, and allows no error', () => {
    const kinds: readonly ErrorKind[] = ['network', 'timeout', 'tls', 'http', 'parse', 'kind-mismatch', 'render'];
    expect(CHECK_ERROR_KINDS).toEqual(kinds);
    const db = seeded();
    const withKind = (kind: string | null, at: string): number =>
      db.tx.run(
        'insert into snapshots (source_id, taken_at, outcome, status, bytes, error_kind) values (?, ?, ?, 500, 0, ?)',
        RSS_SPEC.id,
        at,
        'error',
        kind,
      ).changes;
    for (const [index, kind] of kinds.entries()) expect(withKind(kind, `2026-11-09T09:0${index}:00Z`)).toBe(1);
    expect(withKind(null, '2026-11-09T09:30:00Z')).toBe(1);
    expect(() => withKind('dns', '2026-11-09T10:00:00Z')).toThrow(/CHECK constraint/i);
    expect(() =>
      db.snapshots.record({
        sourceId: RSS_SPEC.id,
        takenAt: '2026-11-09T10:10:00Z',
        outcome: 'nope' as SnapshotOutcome,
        status: 200,
        bytes: 1,
        durationMs: null,
        itemCount: null,
        errorKind: null,
        note: null,
      }),
    ).toThrow(/CHECK constraint/i);
    db.close();
  });

  it('lists exactly the rungs of the change-detection ladder', () => {
    const outcomes: readonly SnapshotOutcome[] = [
      'not-modified',
      'same-body',
      'declared-unchanged',
      'selection-unchanged',
      'changed',
      'error',
    ];
    expect(SNAPSHOT_OUTCOMES).toEqual(outcomes);
    const db = seeded();
    for (const [index, outcome] of outcomes.entries()) {
      db.snapshots.record({
        sourceId: RSS_SPEC.id,
        takenAt: `2026-11-09T11:${String(index).padStart(2, '0')}:00Z`,
        outcome,
        status: outcome === 'not-modified' ? 304 : 200,
        bytes: 1_000,
        durationMs: 100,
        itemCount: outcome === 'not-modified' ? null : 10,
        errorKind: null,
        note: null,
      });
    }
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(3 + outcomes.length);
    expect(() => db.tx.run(SNAPSHOT_INSERT, RSS_SPEC.id, '2026-11-09T12:00:00Z', 'fetch-failed')).toThrow(
      /CHECK constraint/i,
    );
    db.close();
  });
});

describe('the constraints, by name', () => {
  it('keeps the JSON columns JSON, and of the shape they claim', () => {
    const db = seeded();
    for (const broken of ['nope', '[]', 'null', '"a"']) {
      expect(() =>
        db.tx.run(
          SOURCE_INSERT,
          `j-${broken.length}`,
          'rss',
          'J',
          'https://j.example',
          'J',
          broken,
          '{}',
          'unknown',
          '2026-11-09T00:00:00Z',
        ),
      ).toThrow(/CHECK constraint/i);
      expect(() =>
        db.tx.run(
          SOURCE_INSERT,
          `t-${broken.length}`,
          'rss',
          'T',
          'https://t.example',
          'T',
          '{}',
          broken,
          'unknown',
          '2026-11-09T00:00:00Z',
        ),
      ).toThrow(/CHECK constraint/i);
    }
    db.tx.run(
      SOURCE_INSERT,
      'json-ok',
      'rss',
      'J',
      'https://j.example',
      'J',
      '{"id":"json-ok"}',
      '{"cadenceCron":null,"quietHours":null}',
      'unknown',
      '2026-11-09T00:00:00Z',
    );
    expect(db.sources.find('json-ok').spec.id).toBe('json-ok');
    db.close();
  });

  it('keeps a teaser body, because edit detection reads it', () => {
    const db = seeded();
    expect(() =>
      db.tx.run(
        'insert into items (source_id, key, kind, title, link, body, section, first_seen_at, last_seen_at, edit_count, score_realtime, score_digest) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1)',
        RSS_SPEC.id,
        'no-body',
        'rss',
        'No body',
        'https://one.example/nobody',
        null,
        'world',
        '2026-11-09T06:00:00Z',
        '2026-11-09T06:00:00Z',
      ),
    ).toThrow(/NOT NULL constraint failed/i);
    db.close();
  });

  it('keeps the claim to one row, the row it is', () => {
    const db = openTestDatabase();
    expect(() =>
      db.tx.run('insert into db_lock (id, owner, taken_at) values (2, ?, ?)', 'two', '2026-11-09T10:00:00Z'),
    ).toThrow(/CHECK constraint/i);
    expect(db.tx.get('select count(*) as c from db_lock')?.['c']).toBe(1);
    expect(db.tx.get('select id, owner from db_lock')).toEqual({ id: 1, owner: 'test-owner' });
    db.close();
  });

  it('cascades the paper’s own delete, all four tables, in one statement', () => {
    const db = seeded();
    db.validators.write(RSS_SPEC.id, emptyValidatorState());
    expect(db.items.count({ sourceId: RSS_SPEC.id })).toBeGreaterThan(0);
    expect(db.itemEvents.count({ sourceId: RSS_SPEC.id })).toBeGreaterThan(0);
    expect(db.snapshots.count(RSS_SPEC.id)).toBeGreaterThan(0);

    db.tx.run('delete from sources where id = ?', RSS_SPEC.id);
    expect(db.items.count({ sourceId: RSS_SPEC.id })).toBe(0);
    expect(db.itemEvents.count({ sourceId: RSS_SPEC.id })).toBe(0);
    expect(db.snapshots.count(RSS_SPEC.id)).toBe(0);
    expect(db.tx.get('select count(*) as c from source_validators where source_id = ?', RSS_SPEC.id)?.['c']).toBe(0);
    expect(db.sources.count()).toBe(2);
    expect(db.tx.get('pragma integrity_check')?.['integrity_check']).toBe('ok');
    db.close();
  });

  it('refuses a child row whose parent is not there', () => {
    const db = seeded();
    expect(() =>
      db.tx.run(
        ITEM_INSERT,
        'ghost',
        'ghost:1',
        'rss',
        't',
        'https://x.example',
        'b',
        'world',
        '2026-11-09T06:00:00Z',
        '2026-11-09T06:00:00Z',
      ),
    ).toThrow(/FOREIGN KEY constraint failed/i);
    expect(() =>
      db.tx.run(EVENT_INSERT, 'ghost', 'ghost:1', 'new', '2026-11-09T06:00:00Z', 't', 'https://x.example'),
    ).toThrow(/FOREIGN KEY constraint failed/i);
    expect(() => db.tx.run(SNAPSHOT_INSERT, 'ghost', '2026-11-09T06:00:00Z', 'changed')).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
    expect(() =>
      db.tx.run(
        'insert into source_validators (source_id, cache_json, vary_json, weak_etag, no_cache_meta) values (?, ?, ?, 0, 0)',
        'ghost',
        '{}',
        '[]',
      ),
    ).toThrow(/FOREIGN KEY constraint failed/i);
    db.close();
  });
});
