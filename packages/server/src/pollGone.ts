/**
 * The disappearance ladder as the poll runs it (D-029, level 1).
 *
 * Core's `goneVerdicts` owns the arithmetic; this module owns the two things only
 * the pipeline can know: **which polls are evidence**, and the write.
 *
 * A disappearance is the one change the pipeline cannot observe — absence is not
 * a signal, it is the absence of one — so the rule is a count: K = 3 polls, about
 * an hour at the default cadence. The count advances on a poll whose item set is
 * **settled**, which is two things and not one:
 *
 *  - **the parse ran** over a set that was not cut at `maxItems`, and `seen` is
 *    the set the poll published. A feed cut at its own ceiling lists the *front*
 *    of the list, so an item missing from it has not been seen to be absent;
 *  - **or a rung skipped the item pass** — a `304`, a matching body hash, a
 *    matching selection hash — which proved the set **unchanged**. An unchanged
 *    set is the strongest evidence an absent key gets: *nothing has moved since I
 *    showed you this list*. `seen` is then derivable from the stored rows alone,
 *    because the keys at streak 0 are exactly the ones the last parse listed.
 *    Without this arm the ladder is unreachable in practice: the polls after a
 *    story leaves are byte-identical, so rung 1 fires forever and the streak
 *    freezes at 1 — the announcement never happens for a source that goes quiet,
 *    which is what a retired entry looks like.
 *
 * Nothing else is evidence. A transport failure, a parse fault and a cut list are
 * polls with no settled set — and a streak is **not reset** by them either: a
 * source briefly unreachable retires nothing and reopens nothing. The trust the
 * `304` arm borrows is not new: the poll already spends it, far more expensively,
 * by publishing nothing at all for that poll. Byte-identity is a measurement, and
 * the `304` is vouched by a validator we handed over; D-027's measured case is a
 * server (BBC) that answers `200` + the full body for a valid `If-None-Match`,
 * i.e. a rung that does **not** fire, so the news sites land on the parse path.
 *
 * One named cost, and it is the conservative direction: on a source cut at
 * `maxItems` the skip rungs vouch for the **window** the last parse saw, so every
 * stored key in it reads as present, and a disappearance there can only start on
 * a poll that was not cut.
 *
 * Two edits a test must not make, both measured on the way here. Dropping an
 * **anchor** from a card leaves the watched node's text standing: the source is
 * truthful when it says the node did not move, rung 2 fires, and the ladder
 * correctly refuses to read a re-render as a retirement — so an archive test has to
 * remove the entry, not decorate it. And a page that keeps its words in new markup
 * is a redesign: `tbody tr` matches nothing, the rung has no opinion (a `null`
 * never matches), and the parse names it `no-matches` — which is a health state,
 * and not evidence of anything.
 *
 * The `gone` event's text is the **stored** title and link: the item is not in
 * this poll, so there is nothing fresh to say about it.
 */
import type { SourceSpec } from 'newspa-config';
import { goneVerdicts } from 'newspa-core';
import type { ItemEventsRepository, ItemsRepository, NewItemEvent, StoredKeyRow, StreakWrite } from 'newspa-db';

/** The repositories the ladder writes through. */
export interface GoneRepos {
  readonly items: ItemsRepository;
  readonly itemEvents: ItemEventsRepository;
}

/** What one settled poll decided: the keys it announced, the rows to write, the events to log. */
export interface Disappearance {
  readonly keys: string[];
  readonly writes: StreakWrite[];
  readonly events: NewItemEvent[];
}

const goneEventOf = (spec: SourceSpec, row: StoredKeyRow, takenAt: string): NewItemEvent => ({
  sourceId: spec.id,
  itemKey: row.key,
  kind: 'gone',
  at: takenAt,
  title: row.title,
  link: row.link,
  score: row.scoreRealtime,
  report: null,
});

/**
 * Apply core's verdicts to the stored rows.
 *
 * A row is written only when its verdict says so, so a quiet poll over a 5 000-key
 * source writes nothing — which is what makes it affordable to check the **whole**
 * key set every poll, the only way to tell "it is gone" from "it is not on this
 * page" (rule 5's silent zero).
 */
const settle = (spec: SourceSpec, stored: readonly StoredKeyRow[], seen: ReadonlySet<string>, takenAt: string) => {
  const keys: string[] = [];
  const writes: StreakWrite[] = [];
  const events: NewItemEvent[] = [];
  const byKey = new Map(stored.map((row) => [row.key, row]));
  for (const verdict of goneVerdicts(stored, seen)) {
    const row = byKey.get(verdict.key);
    // Unreachable, and kept for the narrowing: core builds every verdict from this
    // same `stored` array, so a verdict's key is always here. Deleting the guard
    // would trade a provable fact for a cast, and a cast at a producer is the kind
    // of thing that turns out to be a missing case five commits later.
    if (row === undefined) continue;
    writes.push({
      key: verdict.key,
      streak: verdict.streak,
      // The stamp is the instant the paper said the door closed: set it at K,
      // clear it when the key is on the list again, and never move it after that
      // — a door that stays shut keeps the day it shut.
      goneAt: verdict.newlyGone ? takenAt : verdict.reopened ? null : row.goneAt,
    });
    if (!verdict.newlyGone) continue;
    keys.push(verdict.key);
    events.push(goneEventOf(spec, row, takenAt));
  }
  return { keys, writes, events };
};

/**
 * The parse path: `seen` is the key set this poll published. It is called **after**
 * the items are written, so its own rows count as present and a story cannot be
 * retired by the poll that published it.
 *
 * `seen` is `null` for a poll whose set was **not** settled — a feed cut at
 * `maxItems` — and `null` reads as "no opinion": no whole-set read, no write, no
 * reset. The streaks stay exactly where the last settled poll left them.
 *
 * The caller does the writes, so the events land in its one `insertMany`, beside
 * the `new` and `edited` rows of the same poll.
 */
export const disappear = (
  repos: GoneRepos,
  spec: SourceSpec,
  seen: ReadonlySet<string> | null,
  takenAt: string,
): Disappearance =>
  seen === null ? { keys: [], writes: [], events: [] } : settle(spec, repos.items.storedKeys(spec.id), seen, takenAt);

/**
 * A rung that skipped the item pass (D-029's second arm). The set is unchanged
 * since the last parse, so the source is vouching for the set it last showed us:
 * every key at streak 0 is still listed, and every key already counted absent is
 * still absent — which is the evidence the count needs.
 *
 * It writes for itself (there is no item pass to join), and answers the keys it
 * announced, so the snapshot's counts and the SSE push name them.
 */
export const countAbsence = (repos: GoneRepos, spec: SourceSpec, takenAt: string): string[] => {
  const stored = repos.items.storedKeys(spec.id);
  const seen = new Set(stored.filter((row) => row.missingStreak === 0).map((row) => row.key));
  const gone = settle(spec, stored, seen, takenAt);
  if (gone.writes.length > 0) repos.items.markStreaks(spec.id, gone.writes);
  if (gone.events.length > 0) repos.itemEvents.insertMany(gone.events);
  return gone.keys;
};
