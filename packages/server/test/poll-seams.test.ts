/**
 * The seams, from the side a test normally does not stand on: **defaulted**.
 *
 * Every other poll test injects the clock and the retry sleep, which is what
 * makes it deterministic. The CLI injects the `fetch` it owns — the socket is a
 * **required** dep, so no poll can silently start talking to the internet — and
 * leaves `now` and `sleep` out, so `pollOne` reads the real clock and the
 * transport owns its own backoff. Those are the paths that ship, so they are
 * pinned here, with a `fetch` that answers from a string: no test in this repo
 * reaches the network, and the composition root's `globalThis.fetch` is asserted
 * as a value, not exercised.
 */
import { describe, expect, it } from 'vitest';
import { pollOne } from '../src/poll.ts';
import { pollDepsOf } from '../src/pollDeps.ts';
import { fixture, okResponse } from './pollSupport.ts';
import { addSource, anRssSpec, openDb } from './support.ts';

const FEED = 'feed-bbc-world.xml';

describe('the default seams', () => {
  it('reads the real clock, and the poll is stamped with it', async () => {
    const db = openDb();
    const spec = anRssSpec();
    addSource(db, spec);
    const before = new Date();

    // The composition root owns the socket: `pollDepsOf` hands over
    // `globalThis.fetch`, and the pipeline never reaches for a global itself.
    expect(pollDepsOf(db).fetch).toBe(globalThis.fetch);

    // No `now`, no `sleep`: the composition root's defaults are what the CLI gets.
    const deps = { ...pollDepsOf(db), fetch: async () => okResponse(fixture(FEED)), backoffMaxMs: 1_000 };
    const result = await pollOne(spec, deps);

    expect(result.outcome).toBe('changed');
    expect(result.itemCount).toBe(db.items.count({ sourceId: 'bbc' }));
    const takenAt = Date.parse(result.takenAt);
    expect(takenAt).toBeGreaterThanOrEqual(before.getTime());
    expect(takenAt).toBeLessThanOrEqual(Date.now());
    // `durationMs` is measured on the same clock that stamped the rows.
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(60_000);
    expect(db.snapshots.last('bbc')?.snapshot.takenAt).toBe(result.takenAt);
  });
});

/**
 * Not pinned here, and named so the next reader looks in the right file: the
 * `304` that answers with cache metadata is layer 0, in `poll-ladder.test.ts`;
 * the narrowing of `refusalOf`'s union, and every way a source stops
 * reporting, are in `poll-health.test.ts`.
 */
