/**
 * The read-counting spy. Rule 4 ("never query per item") and rule 5 / D-017
 * ("the stored body has one door") are properties of the **sequence of reads**,
 * so they cannot be asserted from the wire shape alone.
 *
 * The repositories are the real ones, wrapped to count: a per-item query shows up
 * in a failing assertion as a number, and a `bodyOf` call shows up as a number
 * too. Nothing here replaces a repository's behaviour.
 */
import type { Database, ItemsRepository } from 'newspa-db';
import type { StateDeps } from '../src/state.ts';
import { depsOf } from './support.ts';

/** Which tables the read side touched, and how often. */
export interface Counts {
  sources: number;
  items: number;
  bodyOf: number;
  events: number;
  itemCounts: number;
  snapshotLast: number;
  cycles: number;
}

export const countedDeps = (db: Database): { readonly deps: StateDeps; readonly reads: () => Counts } => {
  const counts: Counts = { sources: 0, items: 0, bodyOf: 0, events: 0, itemCounts: 0, snapshotLast: 0, cycles: 0 };
  const items: ItemsRepository = {
    ...db.items,
    list: (query) => {
      counts.items += 1;
      return db.items.list(query);
    },
    countBySource: () => {
      counts.itemCounts += 1;
      return db.items.countBySource();
    },
    bodyOf: (sourceId, key) => {
      counts.bodyOf += 1;
      return db.items.bodyOf(sourceId, key);
    },
  };
  const deps = depsOf(db, {
    sources: {
      ...db.sources,
      list: (options) => {
        counts.sources += 1;
        return db.sources.list(options);
      },
    },
    items,
    itemEvents: {
      ...db.itemEvents,
      listRecent: (query) => {
        counts.events += 1;
        return db.itemEvents.listRecent(query);
      },
    },
    snapshots: {
      ...db.snapshots,
      last: (sourceId) => {
        counts.snapshotLast += 1;
        return db.snapshots.last(sourceId);
      },
      count: (sourceId) => {
        counts.cycles += 1;
        return db.snapshots.count(sourceId);
      },
    },
  });
  return { deps, reads: () => ({ ...counts }) };
};
