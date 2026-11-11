/**
 * Fixture builders for the read side. Every record is written **through the real
 * repositories into a real in-memory database** (`openInMemory` runs the
 * migrations as part of opening — that order is `packages/db`'s contract), so
 * these tests exercise the columns and the JSON columns, not a mock's idea of
 * them.
 *
 * The clock is always injected: `edition.ts` takes `now` as an input, so a test
 * asserts on an instant, never on the moment it happened to execute.
 */
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { type AppConfig, appConfigSchema, type MastheadConfig, type SourceSpec, sourceSchema } from 'newspa-config';
import {
  type ItemEventRecord,
  type ItemRecord,
  type ItemView,
  type SourceHealthView,
  type StateResponse,
  stateResponseSchema,
} from 'newspa-core';
import { type Database, openInMemory, type PollSnapshot, type SnapshotRow, type SourceHealthPatch } from 'newspa-db';
import { type EditionInput, editionOf } from '../src/edition.ts';
import { type StateDeps, stateOf } from '../src/state.ts';

/** One instant for every fixture, so a fixture's dates are always in the same order. */
export const FIXED = new Date('2026-11-09T10:00:00Z');

/** A dateline that cannot be mistaken for one the server computed. */
export const DATELINE = 'INJECTED DATELINE: Monday, 9 November 2026';

/** Long enough to survive core's boilerplate filter, so a teaser is printed, not dropped. */
export const DECK = 'A deck long enough to survive the boilerplate filter and print as a teaser.';

/**
 * The D-017 needle. Distinctive so a substring search over `JSON.stringify` of
 * the whole wire shape is unambiguous: it appears in a stored `body` only.
 */
export const BODY_NEEDLE = 'ZZPLATE-CANARY the full text of this story never reaches the browser.';

/** `AppConfig` through the schema, so every default is the default a run really has. */
export const aConfig = (masthead: Partial<MastheadConfig> = {}): AppConfig =>
  appConfigSchema.parse({
    masthead: {
      name: 'The Weekly Ledger',
      tagline: 'As it happens, on your own machine',
      dayStartHour: 7,
      ...masthead,
    },
  });

/** The masthead the assembler is handed: a slice of the config, not a made-up shape. */
export const aMasthead = (over: Partial<MastheadConfig> = {}): MastheadConfig => aConfig(over).masthead;

/** Specs are built by the config schema, so a fixture that is not a valid spec is a failure. */
const specOf = (fields: Record<string, unknown>): SourceSpec => sourceSchema.parse(fields);

export const anRssSpec = (over: Record<string, unknown> = {}): SourceSpec =>
  specOf({ id: 'bbc', kind: 'rss', label: 'BBC World', url: 'https://bbc.example/world.xml', weight: 3, ...over });

export const anHtmlSpec = (over: Record<string, unknown> = {}): SourceSpec =>
  specOf({
    id: 'cards',
    kind: 'html',
    label: 'Example Daily',
    url: 'https://cards.example/',
    list: '.card',
    fields: { title: '.title', link: 'a' },
    ...over,
  });

export const aJsonSpec = (over: Record<string, unknown> = {}): SourceSpec =>
  specOf({
    id: 'hn',
    kind: 'json',
    label: 'Hacker News',
    url: 'https://hn.example/front',
    itemsPath: 'hits',
    fields: { title: 'title', link: 'url' },
    ...over,
  });

export const anItemRecord = (over: Partial<ItemRecord> = {}): ItemRecord => ({
  key: 'bbc:h1',
  sourceId: 'bbc',
  kind: 'rss',
  title: 'Central bank holds rates as inflation cools',
  link: 'https://bbc.example/a',
  publishedAt: '2026-11-09T06:00:00Z',
  summary: 'The bank kept rates unchanged, the third meeting in a row.',
  image: null,
  author: null,
  body: 'The bank kept rates unchanged. Analysts had expected a cut.',
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
  sourceId: 'bbc',
  itemKey: 'bbc:h1',
  kind: 'new',
  at: '2026-11-09T06:05:00Z',
  title: 'Central bank holds rates as inflation cools',
  link: 'https://bbc.example/a',
  score: 12,
  report: null,
  ...over,
});

export const aSnapshot = (over: Partial<PollSnapshot> = {}): PollSnapshot => ({
  sourceId: 'bbc',
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

/** A migrated in-memory database: one connection, one claim, the real schema. */
export const openDb = (): Database => openInMemory({ now: () => FIXED, token: 'newspa-server-test' });

/** A source row, and its health when the caller has one. A fresh source is `unknown`. */
export const addSource = (db: Database, spec: SourceSpec, patch?: SourceHealthPatch): void => {
  db.sources.insert(spec, '2026-11-01T00:00:00Z');
  if (patch !== undefined) db.sources.setHealth(spec.id, patch);
};

export const addItem = (db: Database, item: ItemRecord, section = 'world'): void => {
  db.items.upsert({ item, section });
};

export const addEvent = (db: Database, event: Omit<ItemEventRecord, 'id'>): void => {
  db.itemEvents.insert(event);
};

export const addSnapshot = (db: Database, snapshot: PollSnapshot): void => {
  db.snapshots.record(snapshot);
};

/**
 * The rows behind an `EditionInput`, read from a real database. This is exactly
 * what `state.ts` reads, which is the point: the pure assembler is tested on the
 * same rows the composed path produces.
 */
export const rowsOf = (db: Database, over: Partial<EditionInput> = {}): EditionInput => {
  const sources = db.sources.list();
  const lastPerSource: SnapshotRow[] = [];
  for (const source of sources) {
    const row = db.snapshots.last(source.spec.id);
    if (row !== undefined) lastPerSource.push(row);
  }
  return {
    masthead: aMasthead(),
    now: FIXED,
    dateline: DATELINE,
    sources,
    items: db.items.list(),
    events: db.itemEvents.listRecent(),
    itemCounts: db.items.countBySource(),
    snapshots: lastPerSource,
    cycles: db.snapshots.count(),
    ...over,
  };
};

/** Rows → state, through the schema: a shape the schema rejects is a failing test. */
export const build = (input: EditionInput): StateResponse => stateResponseSchema.parse(editionOf(input));

/** The paper before the first poll: every list empty, every count zero. */
export const emptyRows = (): EditionInput => ({
  masthead: aMasthead(),
  now: FIXED,
  dateline: DATELINE,
  sources: [],
  items: [],
  events: [],
  itemCounts: [],
  snapshots: [],
  cycles: 0,
});

/** A database with these sources and items, written through the repositories. */
export const seeded = (specs: readonly SourceSpec[], items: readonly ItemRecord[] = []): Database => {
  const db = openDb();
  for (const spec of specs) addSource(db, spec);
  for (const item of items) addItem(db, item);
  return db;
};

/** The read side as the CLI wires it, with the clock and the dateline pinned. */
export const depsOf = (db: Database, over: Partial<StateDeps> = {}): StateDeps => ({
  sources: db.sources,
  items: db.items,
  itemEvents: db.itemEvents,
  snapshots: db.snapshots,
  masthead: aMasthead(),
  now: () => FIXED,
  dateline: () => DATELINE,
  ...over,
});

/** Deps with no clock and no dateline: the composition root's own defaults run. */
export const bareDeps = (db: Database): StateDeps => ({
  sources: db.sources,
  items: db.items,
  itemEvents: db.itemEvents,
  snapshots: db.snapshots,
  masthead: aMasthead(),
});

export const stateOfDb = (db: Database, over: Partial<StateDeps> = {}): StateResponse =>
  stateResponseSchema.parse(stateOf(depsOf(db, over)));

export const wireItems = (state: StateResponse): ItemView[] => state.edition.sections.flatMap((s) => s.items);

/** The wire item for a key, with a failure that names the key it looked for. */
export const wireItem = (state: StateResponse, sourceId: string, key: string): ItemView => {
  const found = wireItems(state).find((item) => item.sourceId === sourceId && item.key === key);
  if (found === undefined) throw new Error(`no wire item for ${sourceId} / ${key}`);
  return found;
};

/** The health view for a source id, with a failure that names the source. */
export const healthOfSource = (state: StateResponse, sourceId: string): SourceHealthView => {
  const found = state.sources.find((source) => source.id === sourceId);
  if (found === undefined) throw new Error(`no health view for source ${sourceId}`);
  return found;
};

/**
 * A pid that **was** a live process and is now reaped.
 *
 * The lock's liveness answer needs a dead pid, and a made-up large number is not
 * a proof: on Windows pids reach into the millions, so a test that passes by
 * picking an unused pid proves nothing about `ESRCH`. Running the Node that is
 * already on PATH and letting it exit is the fact.
 */
export const deadPid = (): number => {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { timeout: 20_000 });
  if (child.status !== 0 || child.pid === undefined) {
    // `spawnSync` reports a failed spawn on `error` (there is no `message` on
    // `SpawnSyncReturns`), so the reason has to come from there.
    throw new Error(`the probe process failed: ${String(child.status)} ${child.error?.message ?? ''}`);
  }
  return child.pid;
};

/** An owner text for a process that ran and is gone, on **this** host. */
export const deadOwner = (): string => `0e9a5b11-1111-4111-8111-111111111111@${hostname()}:${String(deadPid())}`;
