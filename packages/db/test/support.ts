/**
 * Test helpers: fixed clocks, real `SourceSpec`s (parsed through the config
 * schema, so a fixture that is not a valid spec is a build failure), record
 * builders, and an opener that pins the clock and the lock token.
 *
 * The clock is always injected — every timestamp in the schema is produced by
 * a caller, so a test that let the clock run would assert on the moment it
 * happened to execute.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SourceSpec, sourceSchema } from 'newspa-config';
import type { ItemEventRecord, ItemRecord } from 'newspa-core';
import type { ConnectionLike, DatabaseLike, Row, RunResult, StatementLike } from '../src/driver.ts';
import {
  type Database,
  type Driver,
  emptyValidatorState,
  type Migration,
  type OpenOptions,
  openDatabase,
  type PollSnapshot,
  type ValidatorState,
} from '../src/index.ts';
import type { SqlValue } from '../src/value.ts';

export const FIXED = new Date('2026-11-09T10:00:00Z');

export interface Clock {
  readonly now: () => Date;
  readonly advance: (ms: number) => void;
}

export const fixedClock = (start: Date = FIXED): Clock => {
  let at = start.getTime();
  return {
    now: () => new Date(at),
    advance: (ms: number) => {
      at += ms;
    },
  };
};

/** A `SourceSpec`, produced by the schema so defaults are the real ones. */
const spec = (text: string): SourceSpec => sourceSchema.parse(JSON.parse(text) as unknown);

export const RSS_SPEC: SourceSpec = spec(
  '{"id":"rss-one","kind":"rss","label":"One Weekly","url":"https://one.example/feed.xml","group":"Newswires","cadenceMinutes":20,"cadenceCron":"0 1-7 * * 6","quietHours":{"startHour":3,"endHour":4},"weight":3,"watchwords":["kernel"],"maxItems":60,"baselinedAt":"2026-11-08T06:00:00Z"}',
);

export const HTML_SPEC: SourceSpec = spec(
  '{"id":"html-two","kind":"html","label":"Two","url":"https://two.example/news","list":"article.card","fields":{"title":"h3 a","link":"h3 a"},"matchCount":12,"headers":{"Accept-Language":"tr"},"notes":"İstanbul bureau","minEditRatio":0.2}',
);

export const JSON_SPEC: SourceSpec = spec(
  '{"id":"json-three","kind":"json","label":"Three","url":"https://three.example/api/feed","itemsPath":"$.articles[*]","fields":{"title":"title","link":"url"},"island":"script#__NEXT_DATA__","enabled":false}',
);

export const SPECS: readonly SourceSpec[] = [RSS_SPEC, HTML_SPEC, JSON_SPEC];

export const anItem = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  key: 'rss-one:1',
  sourceId: 'rss-one',
  kind: 'rss',
  title: 'Central bank holds rates',
  link: 'https://one.example/a',
  publishedAt: '2026-11-09T06:00:00Z',
  summary: 'The bank kept rates unchanged.',
  image: null,
  author: null,
  body: 'The bank kept rates unchanged. Analysts expected a cut.',
  firstSeenAt: '2026-11-09T06:05:00Z',
  lastSeenAt: '2026-11-09T06:05:00Z',
  lastChangedAt: null,
  editCount: 0,
  readAt: null,
  scoreRealtime: 12,
  scoreDigest: 9,
  ...over,
});

export const anEvent = (over: Partial<Omit<ItemEventRecord, 'id'>> = {}): Omit<ItemEventRecord, 'id'> => ({
  sourceId: 'rss-one',
  itemKey: 'rss-one:1',
  kind: 'new',
  at: '2026-11-09T06:05:00Z',
  title: 'Central bank holds rates',
  link: 'https://one.example/a',
  score: 12,
  report: null,
  ...over,
});

export const aSnapshot = (over: Partial<PollSnapshot> = {}): PollSnapshot => ({
  sourceId: 'rss-one',
  takenAt: '2026-11-09T06:00:00Z',
  outcome: 'changed',
  status: 200,
  bytes: 370_436,
  durationMs: 412,
  itemCount: 30,
  errorKind: null,
  note: null,
  ...over,
});

export const aValidatorState = (over: Partial<ValidatorState> = {}): ValidatorState => ({
  ...emptyValidatorState(),
  ...over,
});

export interface TestOpenOptions {
  readonly file?: string;
  readonly token?: string;
  readonly driver?: Driver;
  readonly migrations?: readonly Migration[];
  readonly now?: () => Date;
  readonly busyTimeoutMs?: number;
  readonly lockStaleAfterMs?: number;
}

/** `:memory:` by default: one connection, one claim, a migrated schema. */
export const openTestDatabase = (options: TestOpenOptions = {}): Database => {
  const open: { -readonly [K in keyof OpenOptions]?: OpenOptions[K] } = {
    token: options.token ?? 'test-owner',
    now: options.now ?? ((): Date => FIXED),
  };
  if (options.driver !== undefined) open.driver = options.driver;
  if (options.migrations !== undefined) open.migrations = options.migrations;
  if (options.busyTimeoutMs !== undefined) open.busyTimeoutMs = options.busyTimeoutMs;
  if (options.lockStaleAfterMs !== undefined) open.lockStaleAfterMs = options.lockStaleAfterMs;
  return openDatabase(options.file ?? ':memory:', open);
};

/** Every spec, two items, one event, three snapshots (one of them a 304). */
export const seed = (db: Database): void => {
  for (const spec of SPECS) db.sources.insert(spec, '2026-11-01T00:00:00Z');
  db.items.upsert({ item: anItem(), section: 'world' });
  db.items.upsert({
    item: anItem({
      key: 'html-two:1',
      sourceId: 'html-two',
      kind: 'html',
      link: 'https://two.example/x',
      firstSeenAt: '2026-11-09T06:20:00Z',
      lastSeenAt: '2026-11-09T06:20:00Z',
    }),
    section: 'opinion',
  });
  db.itemEvents.insert(anEvent());
  db.snapshots.record(aSnapshot());
  db.snapshots.record(
    aSnapshot({ takenAt: '2026-11-09T06:20:00Z', outcome: 'not-modified', bytes: 0, itemCount: null, durationMs: 88 }),
  );
  db.snapshots.record(
    aSnapshot({
      takenAt: '2026-11-09T06:40:00Z',
      outcome: 'error',
      status: 503,
      bytes: 0,
      itemCount: null,
      errorKind: 'http',
      note: 'upstream',
    }),
  );
};

/**
 * A named in-memory database shared by every connection that names it (measured:
 * `file:<name>?mode=memory&cache=shared`, and it is destroyed when the last
 * connection closes). This is how the single-instance claim is tested with two
 * connections and no file on disk.
 */
export const sharedMemory = (name: string): string => `file:memdb-${name}?mode=memory&cache=shared`;

/**
 * A file database in the temp dir; the caller closes and removes it.
 *
 * `maxRetries` is not decoration: on Windows a WAL connection's handles are
 * released a moment after `close()`, and an immediate `rm` of the temp dir then
 * fails with `EBUSY: resource busy or locked, unlink '…-wal'` (measured).
 */
export const tempFile = async (
  prefix = 'newspa-db-',
): Promise<{ readonly file: string; readonly dir: string; readonly cleanup: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const file = join(dir, 'newspa.db');
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 50 });
  };
  return { file, dir, cleanup };
};

/** A moment `ms` after `at`, for a claim that must be older or newer than another. */
export const later = (at: Date, ms: number): Date => new Date(at.getTime() + ms);

/**
 * The driver seam, exercised with recording: which SQL was prepared, run
 * directly, and closed. This is how the one-importer rule and the open/migrate/
 * close order are checked without a second process.
 */
class FakeStatement implements StatementLike {
  readonly calls: unknown[] = [];
  private readonly parent: FakeConnection;
  readonly sql: string;

  constructor(parent: FakeConnection, sql: string) {
    this.parent = parent;
    this.sql = sql;
  }

  run(...params: SqlValue[]): RunResult {
    this.calls.push(...params);
    this.parent.runs.push(this.sql);
    return { changes: this.parent.changes, lastInsertRowid: this.parent.rowid };
  }

  get(...params: SqlValue[]): Row | undefined {
    this.calls.push(...params);
    return this.parent.firstRow(this.sql);
  }

  all(...params: SqlValue[]): Row[] {
    this.calls.push(...params);
    return this.parent.rowsFor(this.sql);
  }
}

class FakeConnection implements ConnectionLike {
  readonly prepared: string[] = [];
  readonly runs: string[] = [];
  closed = 0;
  changes = 1;
  rowid = 7;
  /** `wal` for a file, `memory` for `:memory:` — the value `journalMode()` reports. */
  journal = 'memory';
  /** The `user_version` the fake starts at. */
  version = 0;

  prepare(sql: string): StatementLike {
    this.prepared.push(sql);
    return new FakeStatement(this, sql);
  }

  exec(sql: string): void {
    this.runs.push(sql);
    const version = /^pragma user_version = (\d+)$/.exec(sql);
    if (version?.[1] !== undefined) this.version = Number(version[1]);
  }

  close(): void {
    this.closed += 1;
  }

  journalMode(): string {
    return this.journal;
  }

  /** The fake is never inside a transaction: it records, it does not run SQL. */
  readonly isTransaction: boolean = false;

  firstRow(sql: string): Row | undefined {
    if (sql === 'pragma journal_mode') return { journal_mode: this.journal };
    if (sql === 'pragma user_version') return { user_version: this.version };
    if (sql.startsWith('select owner, taken_at from db_lock')) {
      return { owner: 'fake', taken_at: FIXED.toISOString() };
    }
    return undefined;
  }

  rowsFor(_sql: string): Row[] {
    return [];
  }
}

export const aDriverSpy = (
  _file: string,
  version = 0,
): { readonly driver: Driver; readonly connection: FakeConnection } => {
  const connection = new FakeConnection();
  connection.version = version;
  const driver: Driver = {
    open: (requested: string): DatabaseLike => {
      connection.journal = requested === ':memory:' ? 'memory' : 'wal';
      return {
        prepare: (sql: string) => connection.prepare(sql),
        exec: (sql: string) => connection.exec(sql),
        journalMode: () => connection.journal,
        isTransaction: false,
        close: () => connection.close(),
      };
    },
  };
  return { driver, connection };
};
