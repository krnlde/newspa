/**
 * The disappearance ladder's half of `items` (D-029, level 1): the two columns
 * migration 4 added, read as the whole key set of one source and written as the
 * verdicts core's `goneVerdicts` produced.
 *
 * These members are **not** part of the paper's read side, and they are in
 * their own module for both reasons:
 *  - `items.ts` is at the 300-line cap of AGENTS.md rule 1, and this is a
 *    separate responsibility — a column that is not in `ItemRecord`, never
 *    travels to the browser, and is written by one caller;
 *  - the read is the whole set, not a page. `items.list` is capped at
 *    `DEFAULT_ITEM_LIMIT` (200, ceiling 500), and inferring "it is gone" from
 *    "it is not on this page" is the silent zero rule 5 forbids — which is why
 *    `gone` is refused in `packages/server/src/pollItems.ts` and this read
 *    exists. It has no limit, and it takes no filter: the point is the whole set.
 *
 * The read carries `title`, `link` and `scoreRealtime` because the caller builds
 * a `gone` event from them and must not go back to the table per key. It
 * deliberately does **not** carry `body`: the ladder reads every key of a source,
 * and the scrape is the widest column in the database (rule 7).
 */
import type { Tx } from './statement.ts';
import { decodeInteger, decodeOptionalText, decodeReal, decodeText, type Row } from './value.ts';

/**
 * One stored key, as the ladder sees it: the identity fields a `gone` event
 * needs, and the streak beside them.
 */
export interface StoredKeyRow {
  readonly key: string;
  readonly title: string;
  readonly link: string;
  readonly scoreRealtime: number;
  /** Polls, complete and successful, that did not list this key. */
  readonly missingStreak: number;
  /** The instant the paper said so, or `null` while the key is on the list. */
  readonly goneAt: string | null;
}

/** One row of the verdict list: what one poll decided about one stored key. */
export interface StreakWrite {
  readonly key: string;
  /** The streak to store: `0` for a key that came back. */
  readonly streak: number;
  /** The stamp to store; `null` clears it (core's reopen arm). */
  readonly goneAt: string | null;
}

/** The streak members of `ItemsRepository`, contributed by this module. */
export interface StreakMembers {
  /** The ladder's state for every key of one source. **Not a page**: this reads the whole set. */
  readonly storedKeys: (sourceId: string) => StoredKeyRow[];
  /** Write the streaks the ladder moved. Returns the rows written. */
  readonly markStreaks: (sourceId: string, rows: readonly StreakWrite[]) => number;
}

/**
 * `order by first_seen_at, key` is the stable order a caller can assert a list
 * against: the ladder does not care in which order it walks the set, and a read
 * with no `order by` on a `without rowid` table has no defined one.
 */
const SELECT_SQL = `select key, title, link, score_realtime, missing_streak, gone_at
  from items where source_id = ? order by first_seen_at, key`;

/**
 * `source_id` is in the `where` because a key is only unique inside its source
 * (`items` is keyed `(source_id, key)`): an unscoped write would let one row
 * touch every source that spells the key the same way.
 */
const UPDATE_SQL = 'update items set missing_streak = ?, gone_at = ? where source_id = ? and key = ?';

const storedKeyOf = (sourceId: string, row: Row): StoredKeyRow => {
  const key = decodeText('key', `a stored key of source ${sourceId}`, row['key']);
  const at = (name: string): string => `${sourceId}/${key} (${name})`;
  return {
    key,
    title: decodeText('title', at('title'), row['title']),
    link: decodeText('link', at('link'), row['link']),
    scoreRealtime: decodeReal('score_realtime', at('score_realtime'), row['score_realtime']),
    missingStreak: decodeInteger('missing_streak', at('missing_streak'), row['missing_streak']),
    goneAt: decodeOptionalText('gone_at', at('gone_at'), row['gone_at']),
  };
};

export const itemsStreaksRepository = (db: Tx): StreakMembers => ({
  storedKeys: (sourceId) => db.all(SELECT_SQL, sourceId).map((row) => storedKeyOf(sourceId, row)),

  /**
   * The summed `changes()`, not `rows.length`: the count is the caller's
   * evidence that the ladder wrote anything, so a verdict that names a key this
   * source does not store comes back as a smaller number than the list it was
   * given, and is never reported as a write.
   */
  markStreaks: (sourceId, rows) =>
    rows.reduce((written, row) => written + db.run(UPDATE_SQL, row.streak, row.goneAt, sourceId, row.key).changes, 0),
});
