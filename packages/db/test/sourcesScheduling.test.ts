/**
 * The scheduler's state in the db: the batch that is due, the plan one poll
 * writes, and migration 5's two columns. The pins are the ones the contract
 * depends on: a fresh database polls everything at once (a `null` sorts
 * **first**); the due boundary is inclusive (a scheduler that misses equality
 * polls a source one cadence late, forever); a disabled source is not the
 * scheduler's business; a batch is bounded **and** totally ordered, so a catch-up
 * is deterministic — the roadmap's "bounded batches, not all at once"; and a
 * re-import never resets a live countdown. `now` is always a literal: the db
 * never reads a clock, so every pin is a string comparison, as the scheduler runs it.
 */
import { type SourceSpec, sourceSchema } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_VERSION,
  type Database,
  MAX_DUE_SOURCES,
  MIGRATIONS,
  type Row,
  RowShapeError,
  type ScheduledSource,
  sourcesSchedulingRepository,
  TimeSpecError,
} from '../src/index.ts';
import { aSnapshot, HTML_SPEC, JSON_SPEC, openTestDatabase, RSS_SPEC, seed, tempFile } from './support.ts';

const NOW = '2026-11-09T10:00:00Z';
const CREATED = '2026-11-01T00:00:00Z';

/** A source in a fresh database: never scheduled, no failures, nothing polled. */
const FRESH: ScheduledSource = {
  spec: RSS_SPEC,
  health: 'unknown',
  nextRunAt: null,
  consecutiveFailures: 0,
  lastSuccessAt: null,
};

const aSpec = (id: string): SourceSpec =>
  sourceSchema.parse(
    JSON.parse(
      `{"id":"${id}","kind":"rss","label":"Source","url":"https://${id}.example/feed.xml","cadenceMinutes":30,"weight":1}`,
    ) as unknown,
  );

/** `n` enabled sources, ids `due-00`…, in a database that starts empty. */
const batch = (db: Database, n: number): void => {
  for (let index = 0; index < n; index += 1) {
    db.sources.insert(aSpec(`due-${String(index).padStart(2, '0')}`), CREATED);
  }
};

const due = (db: Database, now: string = NOW, limit = 50): string[] =>
  db.sources.dueSources(now, limit).map((row) => row.spec.id);

/** The two columns read raw: the paper's read side has no field for a countdown. */
const planOf = (db: Database, id: string): Row | undefined =>
  db.tx.get('select next_run_at, consecutive_failures from sources where id = ?', id);

describe('dueSources: the batch that is due', () => {
  it('reads a fresh source as never scheduled, and puts it first', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    db.sources.insert(HTML_SPEC, CREATED);
    // `html-two` is due an hour **before** `now`, and the never-scheduled source
    // still leads: a fresh database has to poll every source, and a batch that
    // filled from the past would never reach it.
    db.sources.setSchedule(HTML_SPEC.id, '2026-11-09T09:00:00Z', 2);
    const rows = db.sources.dueSources(NOW, 10);
    expect(rows[0]).toEqual(FRESH);
    expect(rows.map((row) => row.spec.id)).toEqual([RSS_SPEC.id, HTML_SPEC.id]);
    expect(rows[1]).toMatchObject({ nextRunAt: '2026-11-09T09:00:00Z', consecutiveFailures: 2 });
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'consecutiveFailures',
      'health',
      'lastSuccessAt',
      'nextRunAt',
      'spec',
    ]);
    db.close();
  });

  it('decodes the spec as every read does, and carries nothing else', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    db.sources.setHealth(RSS_SPEC.id, { health: 'ok', lastSuccessAt: '2026-11-09T09:00:00Z' });
    expect(db.sources.dueSources(NOW, 10)[0]).toEqual({
      spec: RSS_SPEC,
      health: 'ok',
      nextRunAt: null,
      consecutiveFailures: 0,
      lastSuccessAt: '2026-11-09T09:00:00Z',
    });
    db.close();
  });

  it('refuses a source scheduled for the future, and takes one due at exactly now', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    db.sources.insert(HTML_SPEC, CREATED);
    db.sources.setSchedule(RSS_SPEC.id, '2026-11-09T10:00:01Z', 0);
    db.sources.setSchedule(HTML_SPEC.id, NOW, 0);
    // The boundary is inclusive: equality is the instant the cadence says, and a
    // scheduler that missed it polls that source one interval late, every time.
    expect(due(db)).toEqual([HTML_SPEC.id]);
    expect(due(db, '2026-11-09T10:00:01Z')).toEqual([HTML_SPEC.id, RSS_SPEC.id]);
    db.close();
  });

  it('is not the scheduler’s business when a source is disabled, and leaves its plan alone', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    db.sources.insert(JSON_SPEC, CREATED); // the fixture is `enabled: false`
    expect(due(db)).toEqual([RSS_SPEC.id]);

    // A plan written for a disabled source is never read: `enabled = 1` is the
    // whole filter. And writing the enabled source's plan leaves this row's plan
    // alone — a disabled source's countdown is not moved by a tick it skipped.
    expect(db.sources.setSchedule(JSON_SPEC.id, '2026-11-09T09:00:00Z', 1)).toBe(1);
    expect(due(db)).toEqual([RSS_SPEC.id]);
    expect(db.sources.setSchedule(RSS_SPEC.id, '2026-11-09T11:00:00Z', 0)).toBe(1);
    expect(planOf(db, JSON_SPEC.id)).toEqual({ next_run_at: '2026-11-09T09:00:00Z', consecutive_failures: 1 });
    expect(due(db)).toEqual([]);

    // Re-enabled, the plan it was left with is what makes it due, and it precedes
    // the source scheduled for an hour from now.
    db.sources.setEnabled(JSON_SPEC.id, true);
    expect(due(db)).toEqual([JSON_SPEC.id]);
    db.close();
  });

  it('returns a bounded batch in a total order, so a catch-up is deterministic', () => {
    const db = openTestDatabase();
    batch(db, 10);
    const plan: Record<string, string> = {
      'due-01': '2026-11-09T08:00:00Z',
      'due-02': NOW,
      'due-03': '2026-11-09T09:30:00Z',
      'due-05': '2026-11-09T08:00:00Z',
      'due-06': '2026-11-09T06:00:00Z',
      'due-07': '2026-11-09T07:00:00Z',
      'due-09': '2026-11-09T09:30:00Z',
    };
    for (const [id, when] of Object.entries(plan)) expect(db.sources.setSchedule(id, when, 1)).toBe(1);

    // Never-scheduled first (by id), then soonest, then by id — so the ties
    // `due-01`/`due-05` and `due-03`/`due-09` have one right answer, and the
    // three never-scheduled sources lead every batch a catch-up runs.
    const all = ['due-00', 'due-04', 'due-08', 'due-06', 'due-07', 'due-01', 'due-05', 'due-03', 'due-09', 'due-02'];
    expect(due(db, NOW, 3)).toEqual(all.slice(0, 3));
    expect(due(db, NOW, 6)).toEqual(all.slice(0, 6));
    expect(due(db, NOW, 100)).toEqual(all);
    expect(due(db, '2026-11-09T07:30:00Z')).toEqual(['due-00', 'due-04', 'due-08', 'due-06', 'due-07']);
    expect(db.sources.dueSources(NOW, 100).filter((row) => row.consecutiveFailures === 1)).toHaveLength(7);
    db.close();
  });

  it('bounds the limit the way every other `limit ?` in this package is', () => {
    const db = openTestDatabase();
    batch(db, MAX_DUE_SOURCES + 1);
    expect(db.sources.count()).toBe(MAX_DUE_SOURCES + 1);
    expect(db.sources.dueSources(NOW, MAX_DUE_SOURCES + 500)).toHaveLength(MAX_DUE_SOURCES);
    // A batch of zero would poll nothing, so the floor is one; a fraction is a
    // count, not a duration.
    expect(db.sources.dueSources(NOW, 0)).toHaveLength(1);
    expect(db.sources.dueSources(NOW, 2.9)).toHaveLength(2);
    expect(due(db, NOW, 2)).toEqual(['due-00', 'due-01']);
    db.close();
  });
});

describe('setSchedule: the plan one poll writes', () => {
  it('writes both fields, reads them back, and returns the rows written', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    db.sources.setHealth(RSS_SPEC.id, { health: 'ok', lastSuccessAt: '2026-11-09T09:00:00Z' });
    expect(db.sources.setSchedule(RSS_SPEC.id, '2026-11-09T11:00:00Z', 3)).toBe(1);
    expect(planOf(db, RSS_SPEC.id)).toEqual({ next_run_at: '2026-11-09T11:00:00Z', consecutive_failures: 3 });
    expect(db.sources.dueSources('2026-11-09T11:00:00Z', 10)[0]).toEqual({
      spec: RSS_SPEC,
      health: 'ok',
      nextRunAt: '2026-11-09T11:00:00Z',
      consecutiveFailures: 3,
      lastSuccessAt: '2026-11-09T09:00:00Z',
    });
    // Writing the same plan again is still a write: `changes()` counts the row
    // that matched, and the count is the caller's evidence the id is in the table.
    expect(db.sources.setSchedule(RSS_SPEC.id, '2026-11-09T11:00:00Z', 3)).toBe(1);
    db.close();
  });

  it('returns 0 for an id that is not there, and writes nothing', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    expect(db.sources.setSchedule('no-such-source', NOW, 5)).toBe(0);
    expect(db.sources.count()).toBe(1);
    expect(planOf(db, RSS_SPEC.id)).toEqual({ next_run_at: null, consecutive_failures: 0 });
    expect(due(db, NOW, 10)).toEqual([RSS_SPEC.id]);
    db.close();
  });

  it('writes a disabled source: the db does not police `enabled`, the caller decides', () => {
    const db = openTestDatabase();
    db.sources.insert(JSON_SPEC, CREATED);
    expect(db.sources.setSchedule(JSON_SPEC.id, NOW, 2)).toBe(1);
    expect(planOf(db, JSON_SPEC.id)).toEqual({ next_run_at: NOW, consecutive_failures: 2 });
    expect(due(db, NOW, 10)).toEqual([]);
    db.close();
  });

  it('survives the re-import: upsert does not name the countdown columns', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    db.sources.setHealth(RSS_SPEC.id, { health: 'ok', lastSuccessAt: '2026-11-09T09:00:00Z' });
    db.sources.setSchedule(RSS_SPEC.id, '2026-11-09T11:00:00Z', 4);
    // The pipeline re-inserts every source from `sources/*.json` on every load.
    // The upsert names 17 columns; these two are not among them (migration 5).
    db.sources.upsert(RSS_SPEC, '2026-11-02T00:00:00Z');
    expect(planOf(db, RSS_SPEC.id)).toEqual({ next_run_at: '2026-11-09T11:00:00Z', consecutive_failures: 4 });
    expect(db.sources.dueSources('2026-11-09T11:30:00Z', 10)[0]).toEqual({
      spec: RSS_SPEC,
      health: 'ok',
      nextRunAt: '2026-11-09T11:00:00Z',
      consecutiveFailures: 4,
      lastSuccessAt: '2026-11-09T09:00:00Z',
    });
    db.close();
  });

  it('names the column and the source when a stored value holds a foreign shape', () => {
    const db = openTestDatabase();
    db.sources.insert(RSS_SPEC, CREATED);
    // Integer affinity does not reject text it cannot convert (measured), so the
    // decoder is the boundary, and it names the column and the source (rule 5).
    db.tx.run('update sources set consecutive_failures = ? where id = ?', 'not-a-number', RSS_SPEC.id);
    expect(() => db.sources.dueSources(NOW, 10)).toThrow(RowShapeError);
    expect(() => db.sources.dueSources(NOW, 10)).toThrow(
      'column "consecutive_failures" for source rss-one (consecutive_failures)',
    );
    // The `spec` is decoded as every other read decodes it: a stored cron the
    // scheduler could not act on is a report naming the source, never a null.
    db.tx.run('update sources set consecutive_failures = ? where id = ?', 0, RSS_SPEC.id);
    db.tx.run('update sources set time_spec_json = ? where id = ?', '{"cadenceCron": 5}', RSS_SPEC.id);
    expect(() => db.sources.dueSources(NOW, 10)).toThrow(TimeSpecError);
    expect(() => db.sources.dueSources(NOW, 10)).toThrow(/rss-one/);
    db.close();
  });
});

describe('migration 5: scheduling', () => {
  it('gains both columns below head, keeps its rows, starts every source unscheduled', async () => {
    const { file, cleanup } = await tempFile('newspa-db-scheduling-');
    const migrations = MIGRATIONS.slice(0, CURRENT_VERSION - 1);
    const belowHead = openTestDatabase({ file, token: 'below-head', migrations });
    expect(belowHead.version).toBe(CURRENT_VERSION - 1);
    belowHead.sources.insert(RSS_SPEC, CREATED);
    belowHead.snapshots.record(aSnapshot());
    const columns = belowHead.tx.all('pragma table_info (sources)').map((row) => String(row['name']));
    expect(columns.filter((name) => ['next_run_at', 'consecutive_failures'].includes(name))).toEqual([]);
    belowHead.close();

    const atHead = openTestDatabase({ file, token: 'at-head' });
    expect(atHead.migrations.map((m) => m.name)).toEqual(['scheduling']);
    expect(
      atHead.tx
        .all('pragma table_info (sources)')
        .map((row) => String(row['name']))
        .slice(-2),
    ).toEqual(['next_run_at', 'consecutive_failures']);
    expect(atHead.sources.count()).toBe(1);
    expect(atHead.snapshots.count(RSS_SPEC.id)).toBe(1);
    // The row a pre-migration build wrote is "never scheduled, no failures": the
    // first tick polls it, which is exactly what a first run has to do.
    expect(atHead.sources.dueSources(NOW, 10)).toEqual([FRESH]);
    expect(atHead.tx.get('pragma integrity_check')?.['integrity_check']).toBe('ok');
    atHead.close();
    await cleanup();
  });
});

describe('the spread composes', () => {
  it('reaches both members through db.sources, and is the same module directly', () => {
    const db = openTestDatabase();
    seed(db);
    // `sourcesRepository` is built by spreading the module, so the two members
    // are methods on the repository the server already holds.
    expect(typeof db.sources.dueSources).toBe('function');
    expect(typeof db.sources.setSchedule).toBe('function');
    // `seed` inserts three specs, one of them disabled; both enabled ones are
    // never scheduled, so the tie is broken by id.
    expect(due(db, NOW, 10)).toEqual([HTML_SPEC.id, RSS_SPEC.id]);
    expect(db.sources.setSchedule(HTML_SPEC.id, NOW, 1)).toBe(1);
    // A scheduled source moves **behind** a never-scheduled one: the null wins.
    expect(due(db, NOW, 10)).toEqual([RSS_SPEC.id, HTML_SPEC.id]);
    expect(sourcesSchedulingRepository(db.tx).setSchedule(RSS_SPEC.id, '2026-11-09T09:00:00Z', 0)).toBe(1);
    expect(due(db, NOW, 10)).toEqual([RSS_SPEC.id, HTML_SPEC.id]);
    db.close();
  });
});
