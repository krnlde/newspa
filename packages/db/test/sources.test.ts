/**
 * The sources repository: the `SourceSpec` round trip, the list the scheduler
 * reads, and the health patch that must not be overwritten by a re-import.
 */
import { describe, expect, it } from 'vitest';
import { ItemKeyError, SourceKeyError, type SourceSpec } from '../src/index.ts';
import { anItem, HTML_SPEC, JSON_SPEC, openTestDatabase, RSS_SPEC, SPECS } from './support.ts';

const seeded = (): ReturnType<typeof openTestDatabase> => {
  const db = openTestDatabase();
  for (const [index, spec] of SPECS.entries()) db.sources.insert(spec, `2026-11-0${index + 1}T00:00:00Z`);
  return db;
};

describe('sources: the spec round trip', () => {
  it('has no row to report for a source that is not there', () => {
    const db = seeded();
    expect(db.sources.get('nosuch')).toBeUndefined();
    expect(db.sources.get(RSS_SPEC.id)?.spec.label).toBe('One Weekly');
    expect(db.sources.list({ enabledOnly: true })).toHaveLength(2);
    db.close();
  });
  it('returns every spec byte for byte, defaults included', () => {
    const db = seeded();
    for (const spec of SPECS) {
      const stored = db.sources.find(spec.id);
      expect(stored.spec).toEqual(spec);
      expect(stored.health).toBe('unknown');
      expect(stored.note).toBeNull();
      expect(stored.lastStatus).toBeNull();
      expect(stored.lastPolledAt).toBeNull();
      expect(stored.lastSuccessAt).toBeNull();
    }
    db.close();
  });

  it('keeps the time fields that live in their own column', () => {
    const db = seeded();
    const row = db.tx.get('select source_json, time_spec_json from sources where id = ?', RSS_SPEC.id);
    expect(JSON.parse(String(row?.['source_json']))).not.toHaveProperty('cadenceCron');
    expect(JSON.parse(String(row?.['time_spec_json']))).toEqual({
      cadenceCron: RSS_SPEC.cadenceCron,
      quietHours: RSS_SPEC.quietHours,
    });
    expect(db.sources.find(RSS_SPEC.id).spec.cadenceCron).toBe('0 1-7 * * 6');
    expect(db.sources.find(RSS_SPEC.id).spec.quietHours).toEqual({ startHour: 3, endHour: 4 });
    expect(db.sources.find(HTML_SPEC.id).spec.cadenceCron).toBeUndefined();
    expect(db.sources.find(HTML_SPEC.id).spec.quietHours).toBeUndefined();
    expect(
      JSON.parse(
        String(db.tx.get('select time_spec_json from sources where id = ?', HTML_SPEC.id)?.['time_spec_json']),
      ),
    ).toEqual({ cadenceCron: null, quietHours: null });
    db.close();
  });

  it('stores the spec as canonical JSON: compact, stable, time fields moved out', () => {
    const db = seeded();
    const stored = String(db.tx.get('select source_json from sources where id = ?', RSS_SPEC.id)?.['source_json']);
    expect(stored).toBe(JSON.stringify(JSON.parse(stored)));
    expect(stored).not.toContain('cadenceCron');
    expect(stored).not.toContain('quietHours');
    expect(JSON.parse(stored)).toMatchObject({
      id: 'rss-one',
      kind: 'rss',
      label: 'One Weekly',
      url: 'https://one.example/feed.xml',
      group: 'Newswires',
      enabled: true,
      cadenceMinutes: 20,
      weight: 3,
      watchwords: ['kernel'],
      maxItems: 60,
      baselinedAt: '2026-11-08T06:00:00Z',
    });
    expect(db.tx.get('select json_type (source_json) as t from sources where id = ?', RSS_SPEC.id)?.['t']).toBe(
      'object',
    );
    db.close();
  });

  it('carries the Turkish text through JSON, headers and notes', () => {
    const db = seeded();
    const stored = db.sources.find(HTML_SPEC.id).spec;
    expect(stored.notes).toBe('İstanbul bureau');
    expect(stored.headers).toEqual({ 'Accept-Language': 'tr' });
    // `maxItems` is rss-only, so an HTML spec round-trips without the key at
    // all — the absence is the fact, not a lost default.
    expect('maxItems' in stored ? stored['maxItems'] : undefined).toBeUndefined();
    db.close();
  });

  it('rejects a spec whose kind is outside the CHECK set', () => {
    const db = seeded();
    const impostor = { ...JSON_SPEC, id: 'ftp-four', kind: 'ftp' } as unknown as SourceSpec;
    expect(() => db.sources.insert(impostor, '2026-11-09T00:00:00Z')).toThrow(SourceKeyError);
    expect(() => db.sources.insert(impostor, '2026-11-09T00:00:00Z')).toThrow(/CHECK constraint/i);
    db.close();
  });
});

describe('sources: the scheduler’s view', () => {
  it('lists in group order, and enabledOnly drops the disabled source', () => {
    const db = seeded();
    expect(db.sources.list().map((s) => s.spec.id)).toEqual(['rss-one', 'json-three', 'html-two']);
    expect(db.sources.list({ enabledOnly: true }).map((s) => s.spec.id)).toEqual(['rss-one', 'html-two']);
    expect(db.sources.ids()).toEqual(['html-two', 'json-three', 'rss-one']);
    expect(db.sources.count()).toBe(3);
    db.close();
  });

  it('enables and disables, and the list follows', () => {
    const db = seeded();
    db.sources.setEnabled(JSON_SPEC.id, true);
    expect(db.sources.list({ enabledOnly: true }).map((s) => s.spec.id)).toEqual(['rss-one', 'json-three', 'html-two']);
    db.sources.setEnabled(RSS_SPEC.id, false);
    expect(db.sources.list({ enabledOnly: true }).map((s) => s.spec.id)).toEqual(['json-three', 'html-two']);
    expect(db.sources.find(RSS_SPEC.id).spec.enabled).toBe(false);
    db.close();
  });

  it('names the source when an update matches no row', () => {
    const db = seeded();
    expect(() => db.sources.find('nosuch')).toThrow(SourceKeyError);
    expect(() => db.sources.find('nosuch')).toThrow('source "nosuch": no such source');
    expect(() => db.sources.setEnabled('nosuch', true)).toThrow('source "nosuch": no such source');
    expect(() => db.sources.touchLastPolled('nosuch', '2026-11-09T06:00:00Z')).toThrow(SourceKeyError);
    expect(() => db.sources.setHealth('nosuch', { health: 'ok' })).toThrow(SourceKeyError);
    expect(db.sources.get('nosuch')).toBeUndefined();
    db.close();
  });
});

describe('sources: health, and the import that must not erase it', () => {
  it('patches health, and coalesce keeps the fields a partial patch omits', () => {
    const db = seeded();
    db.sources.setHealth(RSS_SPEC.id, {
      health: 'blocked',
      note: '403 from the edge',
      lastStatus: 403,
      lastPolledAt: '2026-11-09T06:00:00Z',
      lastSuccessAt: '2026-11-09T05:40:00Z',
    });
    const blocked = db.sources.find(RSS_SPEC.id);
    expect(blocked.health).toBe('blocked');
    expect(blocked.note).toBe('403 from the edge');
    expect(blocked.lastStatus).toBe(403);
    expect(blocked.lastPolledAt).toBe('2026-11-09T06:00:00Z');
    expect(blocked.lastSuccessAt).toBe('2026-11-09T05:40:00Z');

    db.sources.setHealth(RSS_SPEC.id, { health: 'ok' });
    const ok = db.sources.find(RSS_SPEC.id);
    expect(ok.health).toBe('ok');
    expect(ok.note).toBe('403 from the edge');
    expect(ok.lastStatus).toBe(403);
    expect(ok.lastSuccessAt).toBe('2026-11-09T05:40:00Z');

    db.sources.touchLastPolled(RSS_SPEC.id, '2026-11-09T06:20:00Z');
    expect(db.sources.find(RSS_SPEC.id).lastPolledAt).toBe('2026-11-09T06:20:00Z');
    db.close();
  });

  it('upserts a changed file over a live source: the health stays, the spec moves', () => {
    const db = seeded();
    db.sources.setHealth(RSS_SPEC.id, {
      health: 'no-matches',
      note: 'selector found nothing',
      lastStatus: 200,
      lastSuccessAt: '2026-11-09T05:40:00Z',
    });
    db.sources.touchLastPolled(RSS_SPEC.id, '2026-11-09T06:00:00Z');

    const edited: SourceSpec = {
      ...RSS_SPEC,
      label: 'One Weekly (feeds)',
      cadenceMinutes: 45,
      weight: 5,
      watchwords: ['rss'],
    };
    db.sources.upsert(edited, '2026-11-09T00:00:00Z');

    const stored = db.sources.find(RSS_SPEC.id);
    expect(stored.spec).toEqual(edited);
    expect(stored.health).toBe('no-matches');
    expect(stored.lastStatus).toBe(200);
    expect(stored.lastSuccessAt).toBe('2026-11-09T05:40:00Z');
    expect(stored.lastPolledAt).toBe('2026-11-09T06:00:00Z');
    expect(stored.createdAt).toBe('2026-11-01T00:00:00Z');
    expect(db.sources.count()).toBe(3);
    db.close();
  });

  it('refuses an item whose source is not there, and names both sides', () => {
    const db = seeded();
    expect(() => db.items.upsert({ item: anItem({ sourceId: 'nosuch', key: 'nosuch:1' }), section: 'world' })).toThrow(
      ItemKeyError,
    );
    expect(() => db.items.upsert({ item: anItem({ sourceId: 'nosuch', key: 'nosuch:1' }), section: 'world' })).toThrow(
      /FOREIGN KEY constraint failed/i,
    );
    db.close();
  });
});
