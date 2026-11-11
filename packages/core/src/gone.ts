/**
 * The disappearance ladder (D-029, level 1): a **known** key has stopped
 * appearing, and the paper is allowed to say so only after enough polls have
 * seen the list without it.
 *
 * A disappearance is the one change the pipeline cannot observe directly:
 * absence is not a signal, it is the absence of one. So the evidence is a
 * streak, and three rules decide it. The caller supplies the first two, and
 * this module cannot check them:
 *
 *  - **the poll was complete** — the parse saw the source's whole set, not the
 *    front of a feed cut at `maxItems` (`ParseSuccess.capped`). An item that is
 *    not in a cut list has not been seen to be absent;
 *  - **the poll succeeded** — a timeout, a `403`, a bot wall, a parse fault, a
 *    rung that skipped the item pass: none of those is evidence of anything, and
 *    a source that is briefly unreachable must not retire its own front page
 *    (the "never lie" half of D-020, rule 5);
 *  - **K consecutive such polls** — one missing poll is a fetch hiccup, a burst,
 *    a redesign day. The third is a story that left the list.
 *
 * A key that comes back is **reopened**, not resurrected: the streak resets to
 * zero and the `gone` stamp is cleared, because the paper keeps polling the
 * source and the slot stays a door left open.
 *
 * The verdict list is only the rows that **change**. An unchanged poll writes
 * nothing, so a source with 5 000 stored keys costs zero writes on a quiet day —
 * which is what makes it affordable to check the whole key set on every poll,
 * and checking the whole set is the only way to tell "it is gone" from "it is
 * not on this page" (the silent zero rule 5 forbids).
 */

/** K. Three polls, because a poll is 20 minutes of the source's life. */
export const GONE_AFTER_POLLS = 3;

/** The ladder's state for one key, as stored beside the item. */
export interface StoredKey {
  readonly key: string;
  /** Polls, complete and successful, that did not list this key. */
  readonly missingStreak: number;
  /** The instant the paper said so, or `null` while the key is on the list. */
  readonly goneAt: string | null;
}

/** What one complete, successful poll decides about one stored key. */
export interface GoneVerdict {
  readonly key: string;
  /** The streak to store: `0` for a key that came back. */
  readonly streak: number;
  /** Stamp `goneAt` and write **one** `gone` event: the streak has just reached K. */
  readonly newlyGone: boolean;
  /** Clear a stored `goneAt`: the key is on the list again. */
  readonly reopened: boolean;
}

/**
 * The streaks, for every stored key this poll moves.
 *
 * `seen` is the key set the poll published. `threshold` exists for a test to
 * pin the arithmetic at a size it can see; production reads `GONE_AFTER_POLLS`.
 */
export const goneVerdicts = (
  stored: readonly StoredKey[],
  seen: ReadonlySet<string>,
  threshold: number = GONE_AFTER_POLLS,
): GoneVerdict[] =>
  stored.flatMap<GoneVerdict>((row) => {
    if (seen.has(row.key)) {
      // A present key has nothing to write unless it is standing at `gone`.
      return row.goneAt === null ? [] : [{ key: row.key, streak: 0, newlyGone: false, reopened: true }];
    }
    const streak = row.missingStreak + 1;
    // Already gone and still absent: the streak keeps counting — it is the
    // number a health note reads — and no second event fires for one door.
    return [{ key: row.key, streak, newlyGone: row.goneAt === null && streak >= threshold, reopened: false }];
  });
