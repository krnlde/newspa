/**
 * `item_events`: what changed, in order. An event is meaningless without the
 * item it is about (D-002: "a record must exist, because stealth-edit detection
 * is meaningless without what the page said at the time"), so
 * `(source_id, item_key)` is a foreign key to `items` and a write for an item
 * that is not there is a **reported** foreign-key failure, naming the key.
 *
 * `report` is the word diff of the teaser fields, JSON in `report_json`,
 * validated on read by **core's own `editReportSchema`** — the same schema the
 * wire uses, so a diff written by one build is read by the next, and a
 * hand-edited row fails with the event's id.
 *
 * `id` comes from an `autoincrement` rowid: measured, a plain
 * `integer primary key` reuses id 1 after its rows are deleted, and an id that
 * comes back is an id a client already has.
 */
import { type EditReport, type EventKind, editReportSchema, type ItemEventRecord } from 'newspa-core';
import type { Tx } from './statement.ts';
import {
  decodeCount,
  decodeInteger,
  decodeOptionalJsonColumn,
  decodeReal,
  decodeText,
  type Row,
  RowShapeError,
  type SqlValue,
} from './value.ts';

/** The event ceiling of one query, in the spirit of the paper's `limit<=200`. */
export const MAX_EVENT_LIMIT = 200;
export const DEFAULT_EVENT_LIMIT = 100;

export type NewItemEvent = Omit<ItemEventRecord, 'id'>;

export interface EventListQuery {
  readonly sourceId?: string;
  readonly kind?: EventKind;
  readonly since?: string;
  readonly limit?: number;
}

export interface ItemEventsRepository {
  readonly insert: (event: NewItemEvent) => number;
  /** One transaction for a poll's events: all of them, or none. */
  readonly insertMany: (events: readonly NewItemEvent[]) => number[];
  readonly listRecent: (query?: EventListQuery) => ItemEventRecord[];
  readonly listForItem: (sourceId: string, itemKey: string, limit?: number) => ItemEventRecord[];
  readonly count: (query?: EventListQuery) => number;
}

export class ItemEventError extends Error {
  constructor(sourceId: string, itemKey: string, reason: string) {
    super(`event for item "${itemKey}" of source "${sourceId}": ${reason}`);
    this.name = 'ItemEventError';
  }
}

const COLUMNS = 'source_id, item_key, kind, at, title, link, score, report_json';
const PLACEHOLDERS = COLUMNS.split(',')
  .map(() => '?')
  .join(', ');
const SELECT_SQL = `select id, ${COLUMNS} from item_events`;

const reportOf = (id: number, value: SqlValue | undefined): EditReport | null => {
  const json = decodeOptionalJsonColumn('report_json', `event ${id}`, value);
  if (json === null) return null;
  const parsed = editReportSchema.safeParse(json);
  if (!parsed.success)
    throw new RowShapeError('report_json', `event ${id}`, parsed.error.issues[0]?.message ?? 'not an EditReport');
  return parsed.data;
};

const eventOf = (row: Row): ItemEventRecord => {
  const id = decodeInteger('id', 'an event row', row['id']);
  const sourceId = decodeText('source_id', `event ${id}`, row['source_id']);
  const at = (name: string): string => `event ${id} (${name})`;
  return {
    id,
    sourceId,
    itemKey: decodeText('item_key', at('item_key'), row['item_key']),
    kind: decodeText('kind', at('kind'), row['kind']) as EventKind,
    at: decodeText('at', at('at'), row['at']),
    title: decodeText('title', at('title'), row['title']),
    link: decodeText('link', at('link'), row['link']),
    score: decodeReal('score', at('score'), row['score']),
    report: reportOf(id, row['report_json']),
  };
};

const valuesOf = (event: NewItemEvent): (string | number | null)[] => [
  event.sourceId,
  event.itemKey,
  event.kind,
  event.at,
  event.title,
  event.link,
  event.score,
  event.report === null ? null : encodeReport(event.report),
];

const encodeReport = (report: EditReport): string => JSON.stringify(report);

const limitOf = (limit: number | undefined): number =>
  Math.min(MAX_EVENT_LIMIT, Math.max(1, Math.trunc(limit ?? DEFAULT_EVENT_LIMIT)));

const queryOf = (query: EventListQuery): { readonly sql: string; readonly params: (string | number)[] } => {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (query.sourceId !== undefined) {
    clauses.push('source_id = ?');
    params.push(query.sourceId);
  }
  if (query.kind !== undefined) {
    clauses.push('kind = ?');
    params.push(query.kind);
  }
  if (query.since !== undefined) {
    clauses.push('at >= ?');
    params.push(query.since);
  }
  return { sql: clauses.length === 0 ? '' : ` where ${clauses.join(' and ')}`, params };
};

export const itemEventsRepository = (db: Tx): ItemEventsRepository => {
  const insertOne = (event: NewItemEvent): number => {
    try {
      return db.run(`insert into item_events (${COLUMNS}) values (${PLACEHOLDERS})`, ...valuesOf(event))
        .lastInsertRowid;
    } catch (cause) {
      throw new ItemEventError(event.sourceId, event.itemKey, cause instanceof Error ? cause.message : String(cause));
    }
  };

  return {
    insert: insertOne,

    insertMany: (events) => db.transaction(() => events.map(insertOne)),

    listRecent: (query) => {
      const where = queryOf(query ?? {});
      return db
        .all(`${SELECT_SQL}${where.sql} order by at desc, id desc limit ?`, ...where.params, limitOf(query?.limit))
        .map(eventOf);
    },

    listForItem: (sourceId, itemKey, limit) =>
      db
        .all(
          `${SELECT_SQL} where source_id = ? and item_key = ? order by at desc, id desc limit ?`,
          sourceId,
          itemKey,
          limitOf(limit),
        )
        .map(eventOf),

    count: (query) =>
      decodeCount(
        'c',
        db.get(`select count(*) as c from item_events${queryOf(query ?? {}).sql}`, ...queryOf(query ?? {}).params),
      ),
  };
};
