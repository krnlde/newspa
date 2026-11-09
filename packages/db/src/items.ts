/**
 * The `items` repository. Its primary key is `(source_id, key)` — D-005, the
 * canonical link with the source prefix — so an item is identified by the story,
 * not by a row position, and a poll that re-sees 60 items writes 60 rows
 * without creating any.
 *
 * `ItemRecord` is the record, and it round-trips exactly. Two columns are not
 * in it, and both are stated:
 *  - `body` (from `PickedItem`) is the capped scrape for edit detection and
 *    scoring. `ItemView` has no `body`, so it is read by `bodyOf`, which the
 *    server uses and the browser never sees (D-017).
 *  - `section` is the value the server's `sectionFor` computed. `ItemRecord`
 *    carries no section, so the paper's "items in section X" filter is a DB-side
 *    column, written by `setSection`.
 *
 * The upsert is the diff's write side: `first_seen_at` and `read_at` are
 * insert-only, `edit_count` **adds** the caller's delta (so the caller never
 * reads-modifies-writes a count), and `last_changed_at` keeps the first change
 * it was given — clearing it is not an operation this table offers.
 */
import type { ItemRecord } from 'newspa-core';
import type { Tx } from './statement.ts';
import {
  decodeBoolean,
  decodeCount,
  decodeCounts,
  decodeInteger,
  decodeOptionalText,
  decodeReal,
  decodeText,
  type Row,
  type SourceCount,
} from './value.ts';

/** The architecture's event-loop budget caps SQLite reads at a page; 500 is the hard ceiling. */
export const MAX_ITEM_LIMIT = 500;
export const DEFAULT_ITEM_LIMIT = 200;

export interface ItemWrite {
  readonly item: ItemRecord;
  readonly section: string;
}

export interface ItemFilter {
  readonly sourceId?: string;
  readonly section?: string;
  /** Items seen at or after this UTC ISO instant. */
  readonly since?: string;
}

export interface ItemListQuery extends ItemFilter {
  readonly unreadOnly?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

/** `item` is present when the row is; `section` only when the column has a value. */
export type ItemRead =
  | { readonly key: string; readonly item: ItemRecord; readonly section: string }
  | { readonly key: string; readonly item: ItemRecord; readonly section: null }
  | { readonly key: string; readonly item: undefined; readonly section: undefined };

export interface ItemsRepository {
  readonly upsert: (write: ItemWrite) => void;
  readonly itemOf: (sourceId: string, key: string) => ItemRecord | undefined;
  readonly find: (sourceId: string, key: string) => ItemRecord;
  readonly read: (sourceId: string, key: string) => ItemRead;
  /** The stored scrape. Server-side only: `ItemView` has no `body`. */
  readonly bodyOf: (sourceId: string, key: string) => string;
  readonly list: (query?: ItemListQuery) => ItemRecord[];
  readonly count: (filter?: ItemFilter) => number;
  readonly countBySource: () => SourceCount[];
  readonly setSection: (sourceId: string, key: string, section: string) => void;
  /** Set the read marker, or clear it with `null` (the column is nullable). */
  readonly setRead: (sourceId: string, key: string, at: string | null) => void;
  readonly isRead: (sourceId: string, key: string) => boolean;
}

export class ItemKeyError extends Error {
  constructor(sourceId: string, key: string, reason: string) {
    super(`item "${key}" of source "${sourceId}": ${reason}`);
    this.name = 'ItemKeyError';
  }
}

const COLUMNS = `source_id, key, kind, title, link, summary, image, author, published_at, body,
  section, first_seen_at, last_seen_at, last_changed_at, edit_count, read_at, score_realtime, score_digest`;

const PLACEHOLDERS = COLUMNS.split(',')
  .map(() => '?')
  .join(', ');
const SELECT_SQL = `select ${COLUMNS} from items`;

const ofKey = (sourceId: string, key: string): string => `${sourceId}/${key}`;

const itemOf = (row: Row): ItemRecord => {
  const sourceId = decodeText('source_id', 'an item row', row['source_id']);
  const key = decodeText('key', `item of source ${sourceId}`, row['key']);
  const at = (name: string): string => `for ${ofKey(sourceId, key)} (${name})`;
  return {
    key,
    title: decodeText('title', at('title'), row['title']),
    link: decodeText('link', at('link'), row['link']),
    publishedAt: decodeOptionalText('published_at', at('published_at'), row['published_at']),
    summary: decodeOptionalText('summary', at('summary'), row['summary']),
    image: decodeOptionalText('image', at('image'), row['image']),
    author: decodeOptionalText('author', at('author'), row['author']),
    body: decodeText('body', at('body'), row['body']),
    sourceId,
    kind: decodeText('kind', at('kind'), row['kind']) as ItemRecord['kind'],
    firstSeenAt: decodeText('first_seen_at', at('first_seen_at'), row['first_seen_at']),
    lastSeenAt: decodeText('last_seen_at', at('last_seen_at'), row['last_seen_at']),
    lastChangedAt: decodeOptionalText('last_changed_at', at('last_changed_at'), row['last_changed_at']),
    editCount: decodeInteger('edit_count', at('edit_count'), row['edit_count']),
    readAt: decodeOptionalText('read_at', at('read_at'), row['read_at']),
    scoreRealtime: decodeReal('score_realtime', at('score_realtime'), row['score_realtime']),
    scoreDigest: decodeReal('score_digest', at('score_digest'), row['score_digest']),
  };
};

const filterOf = (filter: ItemFilter): { readonly clauses: string[]; readonly params: (string | number)[] } => {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filter.sourceId !== undefined) {
    clauses.push('source_id = ?');
    params.push(filter.sourceId);
  }
  if (filter.section !== undefined) {
    clauses.push('section = ?');
    params.push(filter.section);
  }
  if (filter.since !== undefined) {
    clauses.push('last_seen_at >= ?');
    params.push(filter.since);
  }
  return { clauses, params };
};

const whereOf = (clauses: readonly string[]): string => (clauses.length === 0 ? '' : ` where ${clauses.join(' and ')}`);

/** The event-loop budget: a page is 200 rows, and 500 is the ceiling a caller may ask for. */
const limitOf = (limit: number | undefined): number =>
  Math.min(MAX_ITEM_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_ITEM_LIMIT)));
const offsetOf = (offset: number | undefined): number => Math.max(0, Math.trunc(offset ?? 0));

export const itemsRepository = (db: Tx): ItemsRepository => {
  const mutate = (sql: string, sourceId: string, key: string, ...params: (string | number | null)[]): void => {
    if (db.run(sql, ...params, sourceId, key).changes === 0) throw new ItemKeyError(sourceId, key, 'no such item');
  };

  /** Every item lookup is by the composite key, so the predicate is part of the helper. */
  const one = (sql: string, sourceId: string, key: string): Row | undefined =>
    db.get(`${sql} where source_id = ? and key = ?`, sourceId, key);

  return {
    upsert: (write) => {
      const { item, section } = write;
      const values: (string | number | null)[] = [
        item.sourceId,
        item.key,
        item.kind,
        item.title,
        item.link,
        item.summary,
        item.image,
        item.author,
        item.publishedAt,
        item.body,
        section,
        item.firstSeenAt,
        item.lastSeenAt,
        item.lastChangedAt,
        item.editCount,
        item.readAt,
        item.scoreRealtime,
        item.scoreDigest,
      ];
      try {
        db.run(
          `insert into items (${COLUMNS}) values (${PLACEHOLDERS})
           on conflict (source_id, key) do update set
             kind = excluded.kind, title = excluded.title, link = excluded.link,
             summary = excluded.summary, image = excluded.image, author = excluded.author,
             published_at = excluded.published_at, body = excluded.body, section = excluded.section,
             last_seen_at = excluded.last_seen_at,
             last_changed_at = coalesce (items.last_changed_at, excluded.last_changed_at),
             edit_count = items.edit_count + excluded.edit_count,
             score_realtime = excluded.score_realtime, score_digest = excluded.score_digest`,
          ...values,
        );
      } catch (cause) {
        throw new ItemKeyError(item.sourceId, item.key, cause instanceof Error ? cause.message : String(cause));
      }
    },

    itemOf: (sourceId, key) => {
      const row = one(SELECT_SQL, sourceId, key);
      return row === undefined ? undefined : itemOf(row);
    },

    find: (sourceId, key) => {
      const row = one(SELECT_SQL, sourceId, key);
      if (row === undefined) throw new ItemKeyError(sourceId, key, 'no such item');
      return itemOf(row);
    },

    read: (sourceId, key) => {
      const row = one(SELECT_SQL, sourceId, key);
      if (row === undefined) return { key, item: undefined, section: undefined };
      const section = decodeOptionalText('section', ofKey(sourceId, key), row['section']);
      return section === null ? { key, item: itemOf(row), section: null } : { key, item: itemOf(row), section };
    },

    bodyOf: (sourceId, key) => {
      const row = one('select body from items', sourceId, key);
      if (row === undefined) throw new ItemKeyError(sourceId, key, 'no such item');
      return decodeText('body', ofKey(sourceId, key), row['body']);
    },

    list: (query) => {
      const filter = filterOf(query ?? {});
      const clauses = [...filter.clauses];
      if (query?.unreadOnly === true) clauses.push('read_at is null');
      const params = [...filter.params, limitOf(query?.limit), offsetOf(query?.offset)];
      return db
        .all(`${SELECT_SQL}${whereOf(clauses)} order by last_seen_at desc, source_id, key limit ? offset ?`, ...params)
        .map(itemOf);
    },

    count: (filter) => {
      const where = filterOf(filter ?? {});
      return decodeCount('c', db.get(`select count(*) as c from items${whereOf(where.clauses)}`, ...where.params));
    },

    countBySource: () =>
      decodeCounts('c', db.all('select source_id, count(*) as c from items group by source_id order by source_id')),

    setSection: (sourceId, key, section) =>
      mutate('update items set section = ? where source_id = ? and key = ?', sourceId, key, section),

    setRead: (sourceId, key, at) =>
      mutate('update items set read_at = ? where source_id = ? and key = ?', sourceId, key, at),

    isRead: (sourceId, key) => {
      const row = one('select read_at is not null as r from items', sourceId, key);
      if (row === undefined) throw new ItemKeyError(sourceId, key, 'no such item');
      return decodeBoolean('r', ofKey(sourceId, key), row['r']);
    },
  };
};

export const itemWriteOf = (item: ItemRecord, section: string): ItemWrite => ({ item, section });
