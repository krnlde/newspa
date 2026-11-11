/**
 * The ladder (D-020, D-027): `304` → body hash → selection hash → full parse,
 * and the counters that make it visible.
 *
 * The proof that a rung **skipped the parse** is `last_seen_at`. Only a poll
 * that writes items stamps it, so polling at a later instant and finding the
 * rows unstamped is the observable difference between "the pipeline ran and
 * found nothing new" and "the pipeline did the work and re-wrote everything".
 *
 * And the counters: `fast_path_hits: 0, fast_path_misses: 400` is the only form
 * in which "this source's cheap signals never fire" is ever seen — a feed whose
 * bytes change every poll, an HTML source whose watched node changes — so the
 * hit/miss of every rung is asserted here.
 */
import type { Database } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { conditional, edited, fixture, okResponse, pollHarness, storedState, TAKEN_AT } from './pollSupport.ts';
import { anRssSpec, healthOfSource, stateOfDb } from './support.ts';

const FIXED_LATER = new Date('2026-11-09T11:00:00.000Z');
const FEED = 'feed-bbc-world.xml';
const stampOf = (db: Database): string | null => db.items.list({ sourceId: 'bbc' })[0]?.lastSeenAt ?? null;

describe('the ladder: a cheap signal may skip work, never suppress an item', () => {
  it('layer 0: a 304 is one snapshot, no items, and the health the source already had', async () => {
    const h = pollHarness(anRssSpec(), conditional(FEED));
    const first = await h.poll();
    expect(first.outcome).toBe('changed');
    expect(first.itemCount).toBe(h.db.items.count({ sourceId: 'bbc' }));
    const items = h.db.items.count({ sourceId: 'bbc' });
    const events = h.db.itemEvents.count({ sourceId: 'bbc' });

    const second = await h.pollAt(FIXED_LATER);
    expect(second.outcome).toBe('not-modified');
    expect(second.status).toBe(304);
    expect(second.bytes).toBe(0);
    expect(second.itemCount).toBeNull();
    expect(second.newItems).toBe(0);
    expect(second.health).toBe('ok');

    // The ladder ran because the request carried the stored validator.
    expect(h.calls[1]?.headers.get('if-none-match')).toBe('"cap-1"');
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe(items);
    expect(h.db.itemEvents.count({ sourceId: 'bbc' })).toBe(events);
    expect(stampOf(h.db)).toBe(TAKEN_AT);
    expect(h.db.snapshots.count('bbc')).toBe(2);
  });

  it('layer 0 leaves a healthy paper: no strip, and no invented match count', async () => {
    const h = pollHarness(anRssSpec(), conditional(FEED));
    await h.poll();
    await h.pollAt(FIXED_LATER);

    const view = healthOfSource(stateOfDb(h.db), 'bbc');
    expect(view.state).toBe('ok');
    // The paper prints the newest poll's own count; a 304 counted nothing, so
    // the answer is `null` — not the old count, and never a zero.
    expect(view.matchCount).toBeNull();
    expect(view.itemCount).toBe(h.db.items.count({ sourceId: 'bbc' }));
    expect(view.note).toContain('304');
    expect(stateOfDb(h.db).edition.stats.sourcesUnhealthy).toBe(0);
  });

  it('layer 0 refreshes the response validators and nothing about the body', async () => {
    const h = pollHarness(anRssSpec(), conditional(FEED));
    await h.poll();
    const afterFirst = storedState(h.db, 'bbc');

    await h.pollAt(FIXED_LATER);
    const afterSecond = storedState(h.db, 'bbc');

    expect(afterSecond.bodyHash).toBe(afterFirst.bodyHash);
    expect(afterSecond.declaredModifiedAt).toBe(afterFirst.declaredModifiedAt);
    expect(afterSecond.generator).toBe(afterFirst.generator);
    expect(afterSecond.ttlMinutes).toBe(afterFirst.ttlMinutes);
    expect(afterSecond.fastPathHits).toBe(1);
    expect(afterSecond.fastPathMisses).toBe(1);
  });

  it('a 304 that speaks refreshes the validators and the freshness, and keeps the body’s hints', async () => {
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

    const second = await h.pollAt(FIXED_LATER);
    expect(second.outcome).toBe('not-modified');

    // RFC 9110 §15.4.5: a 304 updates the stored response's **validators**, and
    // §4.2.1: the freshness lifetime of the updated entry is the 304's. The rest
    // of the hint set describes the stored body, which the 304 never sent, so
    // `cache` stays what the 200 said.
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

  it('a 304 that repeats no validators keeps the stored ones, so the fast path survives a sloppy CDN', async () => {
    const bare = pollHarness(anRssSpec(), (_call, request) =>
      request.headers.get('if-none-match') === null ? okResponse(fixture(FEED)) : new Response(null, { status: 304 }),
    );
    await bare.poll();
    const before = storedState(bare.db, 'bbc');

    await bare.pollAt(FIXED_LATER);
    const after = storedState(bare.db, 'bbc');

    // RFC 9110 §15.4.5: a 304 updates the stored response. A field it does not
    // send is not a field to forget — forgetting the etag here would put every
    // later poll on the slow path, quietly.
    expect(after.etag).toBe(before.etag);
    expect(after.weakEtag).toBe(before.weakEtag);
    expect(after.bodyHash).toBe(before.bodyHash);
    expect(after.declaredModifiedAt).toBe(before.declaredModifiedAt);
    expect(after.fastPathHits).toBe(1);
  });

  it('layer 1: a matching body hash skips the parse, and the counters say so', async () => {
    // Every call answers 200 with the same bytes and a fresh etag, so no 304 is
    // possible: only the stored body hash can stop this poll.
    const h = pollHarness(anRssSpec(), (call) => okResponse(fixture(FEED), `"cap-${String(call)}"`));
    await h.poll();

    const second = await h.pollAt(FIXED_LATER);
    expect(second.outcome).toBe('same-body');
    expect(second.itemCount).toBeNull();
    expect(second.note).toContain('hash matched');
    expect(stampOf(h.db)).toBe(TAKEN_AT);

    const state = storedState(h.db, 'bbc');
    expect(state.fastPathHits).toBe(1);
    expect(state.fastPathMisses).toBe(1);
    expect(state.etag).toBe('"cap-2"');
  });

  it('a feed’s declared timestamp no longer skips the parse: it is recorded, not obeyed (D-027)', async () => {
    // Trailing whitespace changes every cheap byte comparison and no timestamp.
    // This poll used to answer `declared-unchanged` and skip; the rung earned
    // ~50 ms of a 1 171 ms poll and could hide the news, so it is gone. The stamp
    // is still stored, because the freshness note reads it.
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1 ? okResponse(fixture(FEED)) : okResponse(`${fixture(FEED)}\n\n  `, '"cap-2"'),
    );
    await h.poll();

    const second = await h.pollAt(FIXED_LATER);
    expect(second.outcome).toBe('changed');
    expect(second.itemCount).not.toBeNull();
    const state = storedState(h.db, 'bbc');
    expect(state.fastPathHits).toBe(0);
    expect(state.declaredModifiedAt).not.toBeNull();
  });

  it('a source that stamps its own feed parses every poll, and the counters record it', async () => {
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1
        ? okResponse(fixture(FEED))
        : okResponse(
            edited(FEED, 'Mon, 09 Nov 2026 12:46:39 GMT', 'Tue, 10 Nov 2026 08:00:00 GMT'),
            `"cap-${String(call)}"`,
          ),
    );
    await h.poll();

    const second = await h.pollAt(FIXED_LATER);
    expect(second.outcome).toBe('changed');
    expect(second.itemCount).toBeGreaterThan(3);
    // The item keys come from the canonical link, so a re-stamped feed writes no
    // stories twice: a cheap signal may skip work, never suppress an item.
    expect(second.newItems).toBe(0);
    expect(second.editedItems).toBe(0);
    expect(stampOf(h.db)).toBe(FIXED_LATER.toISOString());
    expect(storedState(h.db, 'bbc').fastPathHits).toBe(0);
  });

  it('an `If-Modified-Since` baseline reaches the request when the source sends no etag', async () => {
    // `Last-Modified` must precede the poll instant: core's skew rule drops a
    // validator that runs more than 5 min ahead of the response's `Date`, because
    // a 304 we cannot trust is worse than a parse (docs/fetching.md).
    const LAST_MODIFIED = 'Mon, 09 Nov 2026 09:00:00 GMT';
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1
        ? new Response(fixture(FEED), {
            status: 200,
            headers: { 'content-type': 'application/rss+xml', 'last-modified': LAST_MODIFIED },
          })
        : new Response(null, { status: 304 }),
    );
    const first = await h.poll();
    expect(first.outcome).toBe('changed');

    expect(await h.pollAt(FIXED_LATER)).toMatchObject({ outcome: 'not-modified' });
    // One second earlier: 1 s resolution, servers compare inclusively, and a 412
    // would read as a broken source.
    expect(h.calls[1]?.headers.get('if-modified-since')).toBe('Mon, 09 Nov 2026 08:59:59 GMT');
    expect(h.calls[1]?.headers.get('if-none-match')).toBeNull();
    // fetch normalizes `Last-Modified` to an instant before the ladder sees it,
    // which is why every comparison here is an instant and never a header string.
    expect(storedState(h.db, 'bbc').lastModified).toBe('2026-11-09T09:00:00.000Z');
  });
});
