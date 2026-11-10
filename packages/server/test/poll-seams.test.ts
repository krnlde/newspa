/**
 * The seams, from the side a test normally does not stand on: **defaulted**.
 *
 * Every other poll test injects the clock, the `fetch` and the sleep, which is
 * what makes them deterministic. The CLI injects only the `fetch` it owns, and
 * `pollOne` then reads the real clock and lets the transport own its retry
 * wait. Those default paths are the ones that ship, so they are pinned here —
 * with a `fetch` that answers from a string, because no test in this repo
 * reaches the network.
 */
import { fetchSource, NO_BASELINE, refusalOf } from 'newspa-fetch';
import { describe, expect, it } from 'vitest';
import { pollOne } from '../src/poll.ts';
import { pollDepsOf } from '../src/pollDeps.ts';
import { refusalFailure } from '../src/pollVerdicts.ts';
import { fixture, okResponse, pollHarness, storedState } from './pollSupport.ts';
import { addSource, anRssSpec, openDb } from './support.ts';

const FEED = 'feed-bbc-world.xml';

describe('the default seams', () => {
  it('reads the real clock, and the poll is stamped with it', async () => {
    const db = openDb();
    const spec = anRssSpec();
    addSource(db, spec);
    const before = new Date();

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

describe('the narrowing the pipeline refuses to cast through', () => {
  it('names the state a refusal builder cannot produce, instead of pretending', async () => {
    // `refusalOf` builds a `TransportFailure` for all three refusals, and the
    // barrel types its answer as the union. The pipeline narrows with this
    // helper, whose throw is the honest answer to a builder that changed.
    // A real success — built by the real transport, not by hand — is the state
    // that must not reach the failure path.
    const ok = await fetchSource(anRssSpec(), NO_BASELINE, {
      fetch: async () => okResponse(fixture(FEED)),
      now: () => new Date('2026-11-09T10:00:00.000Z'),
    });
    expect(ok.state).toBe('ok');
    expect(() => refusalFailure(ok)).toThrow(/a refusal is a failure by construction/u);

    // And the real refusal narrows to a failure with the request never made.
    const refusal = refusalOf(anRssSpec({ render: true }));
    if (refusal === null) throw new Error('render: true must be refused');
    expect(refusalFailure(refusal)).toMatchObject({ state: 'failure', reason: 'render-required', attempts: 0 });
  });
});

/** The ladder's layer 0, from a CDN that answers a `304` with cache metadata. */
describe('a 304 that speaks', () => {
  it('refreshes the stored cache metadata, and keeps the body-derived fields', async () => {
    const h = pollHarness(anRssSpec(), (_call, request) =>
      request.headers.get('if-none-match') === null
        ? okResponse(fixture(FEED))
        : new Response(null, {
            status: 304,
            headers: { 'cache-control': 'max-age=120, must-revalidate', vary: 'Accept-Encoding', etag: '"cap-2"' },
          }),
    );
    await h.poll();
    expect(h.calls).toHaveLength(1);
    const before = storedState(h.db, 'bbc');

    const second = await h.pollAt(new Date('2026-11-09T11:00:00.000Z'));
    expect(second.outcome).toBe('not-modified');

    // RFC 9110 §15.4.5: the 304 updates the stored response's **validators**,
    // and §4.2.1: the freshness lifetime of the updated entry is the 304's. The
    // rest of the hint set describes the stored body, which the 304 never sent,
    // so `cache` stays what the 200 said.
    const after = storedState(h.db, 'bbc');
    expect(after.etag).toBe('"cap-2"');
    expect(after.vary).toEqual(['accept-encoding']);
    expect(after.freshnessSeconds).toBe(120);
    expect(after.cache.maxAgeSeconds).toBe(before.cache.maxAgeSeconds);
    expect(after.cache.mustRevalidate).toBe(before.cache.mustRevalidate);
    // And the body it never sent stays exactly as the parse left it.
    expect(after.bodyHash).toBe(before.bodyHash);
    expect(after.declaredModifiedAt).toBe(before.declaredModifiedAt);
    expect(after.generator).toBe(before.generator);
    expect(after.ttlMinutes).toBe(before.ttlMinutes);
  });
});
