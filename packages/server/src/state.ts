/**
 * The read side of the server: repositories in, `StateResponse` out.
 *
 * This is the composition root of the slice, so it is the only file here allowed
 * to read the clock, and the only one that formats a string: the dateline is a
 * finished string, so it is built here and travels as data (D-019). `edition.ts`
 * never sees `Intl`, which is what keeps the assembler locale-free and every
 * assembler test deterministic.
 *
 * The event-loop budget (docs/architecture.md: indexed, `limit<=200`, no
 * `SELECT *`): **one** items read, **one** events read, **one** count query,
 * `snapshots.last()` once per source, one count. Nothing per item — the newest
 * event per item and the counts are folded into maps in `edition.ts`.
 *
 * `bodyOf` is never called (D-017): the stored scrape has no door onto the wire.
 */
import type { MastheadConfig } from 'newspa-config';
import type { EditionFreshness, StateResponse } from 'newspa-core';
import {
  DEFAULT_ITEM_LIMIT,
  type ItemEventsRepository,
  type ItemsRepository,
  MAX_EVENT_LIMIT,
  type SnapshotRepository,
  type SnapshotRow,
  type SourcesRepository,
  type StoredSource,
} from 'newspa-db';
import { editionOf } from './edition.ts';

/** The page the paper shows: the architecture's budget, not SQLite's ceiling. */
export const DEFAULT_STATE_ITEM_LIMIT = DEFAULT_ITEM_LIMIT;

/** Events are the newest 200 of the whole corpus; older events are not on the wire. */
export const DEFAULT_STATE_EVENT_LIMIT = MAX_EVENT_LIMIT;

/** The read side, wired by hand: the repositories `openDatabase` hands out, and the config. */
export interface StateDeps {
  readonly sources: SourcesRepository;
  readonly items: ItemsRepository;
  readonly itemEvents: ItemEventsRepository;
  readonly snapshots: SnapshotRepository;
  readonly masthead: MastheadConfig;
  /** The seam for a deterministic test; the composition root is where the real clock enters. */
  readonly now?: () => Date;
  /** The seam for a deterministic dateline; the paper prints the string it is given. */
  readonly dateline?: (now: Date) => string;
  readonly itemLimit?: number;
  readonly eventLimit?: number;
  /** The freshness law for the title page (D-048), from the config's `paper` block. */
  readonly freshness?: EditionFreshness;
}

/**
 * The dateline's locale. `packages/config` has no locale field, and the paper's
 * own chrome is translated in `apps/web` (D-019); this string is the one finished
 * string the server owns, so the masthead date is English until a locale lands
 * in the config — which is why it is a named constant and not an inline literal.
 */
const DATELINE_LOCALE = 'en-US';

/**
 * `masthead.timezone` is `'local'` by default, and `Intl` rejects
 * `timeZone: 'local'`, so the key is set only for a named zone. The formatter is
 * built per call, never at module load: a module-level formatter is a frozen
 * language and a frozen zone (D-019).
 */
export const datelineFor = (now: Date, timezone: string): string => {
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'full' };
  if (timezone !== 'local') options.timeZone = timezone;
  return new Intl.DateTimeFormat(DATELINE_LOCALE, options).format(now);
};

/** One `last()` per source; a source with no poll has no row, and `matchCount` is null. */
const newestSnapshots = (snapshots: SnapshotRepository, sources: readonly StoredSource[]): SnapshotRow[] => {
  const rows: SnapshotRow[] = [];
  for (const source of sources) {
    const row = snapshots.last(source.spec.id);
    if (row !== undefined) rows.push(row);
  }
  return rows;
};

/** Read the rows, hand them to the assembler. Every case is a valid `StateResponse`. */
export const stateOf = (deps: StateDeps): StateResponse => {
  const now = deps.now === undefined ? new Date() : deps.now();
  const sources = deps.sources.list();
  const dateline = deps.dateline === undefined ? datelineFor(now, deps.masthead.timezone) : deps.dateline(now);
  return editionOf({
    masthead: deps.masthead,
    now,
    dateline,
    sources,
    items: deps.items.list({ limit: deps.itemLimit ?? DEFAULT_STATE_ITEM_LIMIT }),
    events: deps.itemEvents.listRecent({ limit: deps.eventLimit ?? DEFAULT_STATE_EVENT_LIMIT }),
    itemCounts: deps.items.countBySource(),
    snapshots: newestSnapshots(deps.snapshots, sources),
    cycles: deps.snapshots.count(),
    ...(deps.freshness === undefined ? {} : { freshness: deps.freshness }),
  });
};
