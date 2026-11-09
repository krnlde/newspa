/**
 * The assembler: rows in, `StateResponse` out.
 *
 * `state.ts` reads the repositories and hands the rows here, so the whole wire
 * shape is testable without a database and the database tests stay about SQL.
 * Nothing in this file runs a query, opens a file or touches a socket.
 *
 * It also owns **no language and no clock** — the same needles `packages/paper`
 * bans, for the same reason (D-019): a formatter built at module load is a
 * frozen language, and a clock read in here would make every test assert on the
 * moment it happened to execute. Hence `now` and `dateline` are inputs.
 */
import type { MastheadConfig } from 'newspa-config';
import {
  buildEdition,
  type EditionStats,
  editionIdFor,
  type ItemEventRecord,
  type ItemRecord,
  type ItemView,
  isBoilerplateTeaser,
  type SourceHealthView,
  type StateResponse,
  teaserFor,
  tierFor,
} from 'newspa-core';
import type { PollSnapshot, SnapshotRow, SourceCount, StoredSource } from 'newspa-db';

/** Everything the assembler needs, already read. Pure input: `readonly` throughout. */
export interface EditionInput {
  readonly masthead: MastheadConfig;
  /** Injected. The assembler owns no clock, so a test gets an edition it can predict. */
  readonly now: Date;
  /** Injected. The assembler owns no language: the dateline is a finished string (D-019). */
  readonly dateline: string;
  /** Every source, disabled ones included — a source that is off stays visible (rule 5). */
  readonly sources: readonly StoredSource[];
  readonly items: readonly ItemRecord[];
  /** The events the caller read, in any order. The newest per item wins here. */
  readonly events: readonly ItemEventRecord[];
  /** One row per source from `countBySource()`; a source that is absent has no items. */
  readonly itemCounts: readonly SourceCount[];
  /** One snapshot per source, the newest the caller has. */
  readonly snapshots: readonly SnapshotRow[];
  readonly cycles: number;
}

/**
 * Item identity across the two tables: `key` alone is unique only inside a
 * source, and a key already carries its source prefix, so the separator cannot
 * collide with a real key.
 */
const eventKeyOf = (sourceId: string, itemKey: string): string => `${sourceId}:${itemKey}`;

/**
 * The newest event per item, from **one** read (rule: never query per item).
 * `listRecent` arrives newest-first, so a first-sighting rule would be enough;
 * comparing `at` and then `id` keeps that true when a caller hands rows in any
 * order, which happens because retention deletes rows and a poll can write two
 * events with the same declared instant.
 */
const eventMapOf = (events: readonly ItemEventRecord[]): Map<string, ItemEventRecord> => {
  const newest = new Map<string, ItemEventRecord>();
  for (const event of events) {
    const key = eventKeyOf(event.sourceId, event.itemKey);
    const seen = newest.get(key);
    if (seen === undefined) newest.set(key, event);
    else if (event.at > seen.at || (event.at === seen.at && event.id > seen.id)) newest.set(key, event);
  }
  return newest;
};

/**
 * Source id → label. `label` is a spec field, not an item column, so it travels
 * in from the source rows. An item whose source row is gone prints its source
 * id: a label is never blanked into a silent zero (rule 5).
 */
const labelMapOf = (sources: readonly StoredSource[]): Map<string, string> =>
  new Map(sources.map((source) => [source.spec.id, source.spec.label]));

/**
 * `sources` has **no `last_change_at` column** (`packages/db/src/schema.ts`), so
 * the health view's `lastChangeAt` is derived: the newest `lastChangedAt` among
 * that source's items. Derived, not stored — reported as the schema gap it is.
 * A column would make this one query; the fold is bounded by the item page.
 */
const lastChangeMapOf = (items: readonly ItemRecord[]): Map<string, string> => {
  const latest = new Map<string, string>();
  for (const item of items) {
    const at = item.lastChangedAt;
    if (at === null) continue;
    const seen = latest.get(item.sourceId);
    if (seen === undefined || at > seen) latest.set(item.sourceId, at);
  }
  return latest;
};

/**
 * Source id → section label, for `buildEdition`'s 6th argument: the source's own
 * words beat the keyword ladder (core's `headingOf`). A source with no declared
 * section is absent from the map, which is what sends its stories to the ladder.
 */
const declaredMapOf = (sources: readonly StoredSource[]): Map<string, string> => {
  const declared = new Map<string, string>();
  for (const source of sources) {
    const label = source.spec.section;
    if (label !== undefined) declared.set(source.spec.id, label);
  }
  return declared;
};

/** Newest snapshot per source. The caller hands one row each; folding keeps that honest. */
const snapshotMapOf = (snapshots: readonly SnapshotRow[]): Map<string, PollSnapshot> => {
  const newest = new Map<string, PollSnapshot>();
  for (const row of snapshots) {
    const seen = newest.get(row.snapshot.sourceId);
    if (seen === undefined || row.snapshot.takenAt > seen.takenAt) newest.set(row.snapshot.sourceId, row.snapshot);
  }
  return newest;
};

/**
 * One record → one wire item. Note what is **not** here: `body`, `lastSeenAt`,
 * `scoreDigest`, `section` (D-017: the paper is an index, and the teaser is the
 * whole content the browser gets).
 */
const viewOf = (item: ItemRecord, sourceLabel: string, event: ItemEventRecord | undefined): ItemView => {
  const teaser = teaserFor({ summary: item.summary, body: item.body });
  return {
    key: item.key,
    sourceId: item.sourceId,
    sourceLabel,
    kind: item.kind,
    title: item.title,
    link: item.link,
    // A paywall prompt is not a deck. Core's rule, applied where the teaser is made.
    teaser: isBoilerplateTeaser(teaser) ? '' : teaser,
    image: item.image,
    publishedAt: item.publishedAt,
    author: item.author,
    firstSeenAt: item.firstSeenAt,
    lastChangedAt: item.lastChangedAt,
    editCount: item.editCount,
    // `scoreRealtime` is the number the paper's tiers follow; `scoreDigest`
    // belongs to the digest pass and has no tier of its own.
    score: item.scoreRealtime,
    tier: tierFor(item.scoreRealtime),
    read: item.readAt !== null,
    // A missing event is a missing event: null, never a made-up `'new'`.
    lastEventKind: event?.kind ?? null,
    lastEventAt: event?.at ?? null,
    lastReport: event?.report ?? null,
  };
};

const healthOf = (
  source: StoredSource,
  itemCount: number,
  snapshot: PollSnapshot | undefined,
  lastChangeAt: string | null,
): SourceHealthView => ({
  id: source.spec.id,
  label: source.spec.label,
  kind: source.spec.kind,
  url: source.spec.url,
  state: source.health,
  lastStatus: source.lastStatus,
  lastFetchAt: source.lastPolledAt,
  lastChangeAt,
  itemCount,
  expectedMatchCount: source.spec.matchCount ?? null,
  // The newest poll's own count, not a re-parse: a 304 records `null`, and
  // `null` is the honest answer for "this poll did not count matches".
  matchCount: snapshot?.itemCount ?? null,
  note: source.note,
  cadenceMinutes: source.spec.cadenceMinutes,
  enabled: source.spec.enabled,
});

const statsOf = (
  items: readonly ItemRecord[],
  sources: readonly StoredSource[],
  health: readonly SourceHealthView[],
  cycles: number,
): EditionStats => ({
  items: items.length,
  newItems: items.filter((item) => item.editCount === 0).length,
  editedItems: items.filter((item) => item.editCount > 0).length,
  // "fetched" is "answered at least once", which is `last_polled_at`, not health.
  sourcesFetched: sources.filter((source) => source.lastPolledAt !== null).length,
  // Rule 5: an unhealthy source is counted, never hidden. A never-polled source
  // is `unknown`, which is not `ok`, so it counts as unhealthy — a paper made of
  // sources that have never answered is not a healthy paper.
  sourcesUnhealthy: health.filter((view) => view.state !== 'ok').length,
  cycles,
});

/** Rows → the wire shape. `buildEdition` does all the sorting; this does not re-sort. */
export const editionOf = (input: EditionInput): StateResponse => {
  const { masthead, now, dateline, sources, items, events, itemCounts, snapshots, cycles } = input;
  const labels = labelMapOf(sources);
  const eventsByItem = eventMapOf(events);
  const views = items.map((item) =>
    viewOf(item, labels.get(item.sourceId) ?? item.sourceId, eventsByItem.get(eventKeyOf(item.sourceId, item.key))),
  );
  const counts = new Map(itemCounts.map((row) => [row.sourceId, row.count]));
  const newestSnapshot = snapshotMapOf(snapshots);
  const lastChange = lastChangeMapOf(items);
  const health = sources.map((source) =>
    healthOf(
      source,
      counts.get(source.spec.id) ?? 0,
      newestSnapshot.get(source.spec.id),
      lastChange.get(source.spec.id) ?? null,
    ),
  );
  const generatedAt = now.toISOString();
  return {
    masthead: {
      name: masthead.name,
      tagline: masthead.tagline,
      dayStartHour: masthead.dayStartHour,
      generatedAt,
    },
    edition: buildEdition(
      editionIdFor(now, masthead.dayStartHour),
      generatedAt,
      dateline,
      views,
      statsOf(items, sources, health, cycles),
      declaredMapOf(sources),
    ),
    sources: health,
  };
};
