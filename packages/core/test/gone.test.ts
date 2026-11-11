import { describe, expect, it } from 'vitest';
import { GONE_AFTER_POLLS, type GoneVerdict, goneVerdicts, type StoredKey } from '../src/gone.ts';

/**
 * D-029's level 1: how many complete, successful polls must pass without a key
 * before the paper says the key is gone.
 *
 * The tests are the rules, in order: the count; that absence is counted **once**
 * per poll; that the event fires exactly once; that a return reopens the slot;
 * and that a quiet poll yields no verdicts at all — which is what makes it
 * affordable to check the source's whole key set every poll, the only way to
 * tell "it is gone" from "it is not on this page".
 */

/** One stored key, at a given streak, optionally standing at `gone`. */
const key = (name: string, missingStreak = 0, goneAt: string | null = null): StoredKey => ({
  key: name,
  missingStreak,
  goneAt,
});

/** Apply a poll's verdicts to the stored rows: the caller's whole job, in five lines. */
const advance = (stored: readonly StoredKey[], seen: readonly string[], threshold?: number): StoredKey[] => {
  const byKey = new Map(stored.map((row) => [row.key, row]));
  const verdicts: GoneVerdict[] = goneVerdicts(stored, new Set(seen), threshold);
  for (const verdict of verdicts) {
    const row = byKey.get(verdict.key);
    if (row === undefined) continue;
    const goneAt = verdict.newlyGone ? '2026-11-11T09:00:00.000Z' : (row.goneAt ?? null);
    byKey.set(verdict.key, { ...row, missingStreak: verdict.streak, goneAt: verdict.reopened ? null : goneAt });
  }
  return [...byKey.values()];
};

describe('the disappearance ladder (D-029, level 1)', () => {
  it('K is three polls, because the rule is a decision and not a default', () => {
    expect(GONE_AFTER_POLLS).toBe(3);
  });

  it('counts the absence, one per poll, and says nothing for the first two', () => {
    const first = goneVerdicts([key('a')], new Set());
    expect(first).toEqual([{ key: 'a', streak: 1, newlyGone: false, reopened: false }]);
    const second = goneVerdicts(advance([key('a')], []), new Set());
    expect(second[0]?.streak).toBe(2);
    expect(second[0]?.newlyGone).toBe(false);
  });

  it('fires exactly one `gone` event, at the Kth poll, and never again', () => {
    // The announcement is the poll whose verdict reaches K — there is no second
    // call that announces it, so the caller stamps `goneAt` from this verdict.
    const atThird = goneVerdicts([key('a', 2)], new Set());
    expect(atThird[0]).toEqual({ key: 'a', streak: 3, newlyGone: true, reopened: false });

    const stamped = advance([key('a', 2)], []);
    expect(stamped[0]).toEqual({ key: 'a', missingStreak: 3, goneAt: '2026-11-11T09:00:00.000Z' });

    // Fourth poll: the streak keeps counting (a health note reads it), and the
    // door is not announced twice.
    const atFourth = goneVerdicts(stamped, new Set());
    expect(atFourth[0]).toEqual({ key: 'a', streak: 4, newlyGone: false, reopened: false });
  });

  it('reopens the slot when the key comes back, and resets the count', () => {
    const standing = advance([key('a', 3, '2026-11-11T09:00:00.000Z')], ['a']);
    expect(standing[0]).toEqual({ key: 'a', missingStreak: 0, goneAt: null });
  });

  it('writes nothing for a key that is present and was never gone: a quiet poll is zero rows', () => {
    // This is the whole set of a 5 000-key source whose newest entry did not
    // move: no verdicts, so no writes, so the check runs every poll.
    expect(goneVerdicts([key('a'), key('b')], new Set(['a', 'b']))).toEqual([]);
  });

  it('ignores keys the poll published that it never stored — new items are not this ladder', () => {
    expect(goneVerdicts([key('a')], new Set(['a', 'fresh']))).toEqual([]);
    expect(goneVerdicts([], new Set(['fresh']))).toEqual([]);
  });

  it('has no opinion on the first poll: an empty key set cannot disappear', () => {
    expect(goneVerdicts([], new Set(['a', 'b']))).toEqual([]);
  });

  it('obeys a threshold of one, the knob the arithmetic is pinned at', () => {
    expect(goneVerdicts([key('a')], new Set(), 1)[0]?.newlyGone).toBe(true);
    // Two polls of a set at K=2: the first counts, the second announces.
    expect(goneVerdicts(advance([key('a')], [], 2), new Set(), 2)[0]?.newlyGone).toBe(true);
  });

  it('counts each key on its own, so one closed entry is not a closed source', () => {
    const stored = [key('closed', 2), key('open'), key('returns', 1, '2026-11-10T09:00:00.000Z')];
    const verdicts = goneVerdicts(stored, new Set(['returns']));
    expect(verdicts).toEqual([
      { key: 'closed', streak: 3, newlyGone: true, reopened: false },
      // A key at streak 0 that this poll also does not list: it starts counting,
      // and the ladder's rows arrive in stored order.
      { key: 'open', streak: 1, newlyGone: false, reopened: false },
      { key: 'returns', streak: 0, newlyGone: false, reopened: true },
    ]);
  });
});
