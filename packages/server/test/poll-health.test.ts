/**
 * Rule 5: **a silent zero is a bug.** Every way a source can stop reporting has
 * to arrive at the paper as a `HealthState` with a line of evidence beside it —
 * a payload the parser refuses, a selector that matches nothing, a wall, a
 * server that is down, a source we are not allowed to fetch with a bare client.
 *
 * The other thing this file pins is the ladder's honesty under failure: a poll
 * that produced **no items** leaves the stored baseline where it was.
 * `body_hash` means "the hash of the body the item set was built from", so a
 * refused body must not become the baseline — the next identical poll would
 * answer `same-body`, skip the parse that has to happen, and the source would
 * sit at zero items with a healthy-looking ladder.
 */
import { describe, expect, it } from 'vitest';
import { fixture, okResponse, pollHarness, storedState, TAKEN_AT } from './pollSupport.ts';
import { aJsonSpec, anHtmlSpec, anRssSpec } from './support.ts';

const FEED = 'feed-bbc-world.xml';
const HTML = 'html-card-list.html';

/** The card-list capture, with the selectors it was captured for. */
const cardsSpec = (over: Record<string, unknown> = {}) =>
  anHtmlSpec({ id: 'bbc', list: 'ul.cards .card', fields: { title: '.title', summary: '.deck', link: 'a' }, ...over });

const apiSpec = (itemsPath: string, over: Record<string, unknown> = {}) => aJsonSpec({ id: 'bbc', itemsPath, ...over });

const serve = (name: string, contentType: string) => () => okResponse(fixture(name), '"cap-1"', contentType);
const JSON_TYPE = 'application/json; charset=utf-8';
const HTML_TYPE = 'text/html; charset=utf-8';

describe('a source that is not reporting says so (rule 5)', () => {
  it('a payload whose items path resolves to nothing is an error, not an empty day', async () => {
    const h = pollHarness(apiSpec('data.stories'), serve('json-no-items.json', JSON_TYPE));
    const result = await h.poll();

    expect(result.outcome).toBe('error');
    expect(result.health).toBe('error');
    expect(result.errorKind).toBe('parse');
    // The parse ran and found nothing: that is a measurement, so it is a zero.
    expect(result.itemCount).toBe(0);
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe(0);

    // The note names the fault in words a reader can act on, and the snapshot
    // keeps the parser's own detail.
    expect(result.note).toContain('parse/');
    expect(h.db.snapshots.last('bbc')?.snapshot.errorKind).toBe('parse');
    expect(h.db.sources.find('bbc').note).toContain('parse/');
  });

  it('a refused payload writes no baseline, so the next poll parses again', async () => {
    const h = pollHarness(apiSpec('data.stories'), serve('json-no-items.json', JSON_TYPE));
    await h.poll();

    // No validator row at all: this source has never produced items, so it has
    // no body the hash could describe.
    expect(h.db.validators.read('bbc').ok).toBe(false);

    const again = await h.pollAt(new Date('2026-11-09T11:00:00.000Z'));
    expect(again.outcome).toBe('error');
    expect(h.db.snapshots.count('bbc')).toBe(2);
  });

  it('a selector that matches nothing is `no-matches`, with the authored count as its evidence', async () => {
    // The reader wrote `matchCount: 5`; the page has five cards and the selector
    // names a redesign. "Nothing matched" and "nothing happened" are different
    // states, and the paper prints them differently.
    const h = pollHarness(cardsSpec({ list: 'section.stories article.card', matchCount: 5 }), serve(HTML, HTML_TYPE));
    const result = await h.poll();

    expect(result.outcome).toBe('error');
    expect(result.health).toBe('no-matches');
    expect(result.errorKind).toBeNull();
    expect(result.itemCount).toBe(0);
    expect(result.note).toContain('no-matches');
  });

  it('a challenge wall is `blocked`, not `error`', async () => {
    const h = pollHarness(cardsSpec(), serve('challenge-cloudflare.html', HTML_TYPE));
    const result = await h.poll();

    expect(result.health).toBe('blocked');
    expect(result.itemCount).toBe(0);
    expect(h.db.sources.find('bbc').health).toBe('blocked');
  });

  it('a 403 is `blocked`, and the HTTP status reaches the source row', async () => {
    const h = pollHarness(anRssSpec(), () => new Response('no', { status: 403, statusText: 'Forbidden' }));
    const result = await h.poll();

    expect(result.outcome).toBe('error');
    expect(result.health).toBe('blocked');
    expect(result.status).toBe(403);
    expect(h.db.sources.find('bbc').lastStatus).toBe(403);
    expect(h.db.sources.find('bbc').lastSuccessAt).toBeNull();
  });

  it('a 500 is retried, the waits are the transport’s, and the source ages without a success', async () => {
    const h = pollHarness(anRssSpec(), () => new Response('boom', { status: 500, statusText: 'Server Error' }));
    const result = await h.poll();

    // The transport's own policy, recorded rather than waited: 500 ms, then
    // 1 000 ms (core's `backoffMs`, base 500, cap 4 000). No wall time passes.
    expect(h.calls).toHaveLength(3);
    expect(h.waits).toEqual([500, 1_000]);

    expect(result.health).toBe('error');
    expect(result.itemCount).toBeNull();
    const source = h.db.sources.find('bbc');
    expect(source.lastPolledAt).toBe(TAKEN_AT);
    // The one field a failure must not write: `isStale` reads `lastSuccessAt`,
    // so a source that is failing has to age, not look quiet.
    expect(source.lastSuccessAt).toBeNull();
  });

  it('a payload of the wrong kind is named, with the kind the source claims', async () => {
    // The feed body served to an html source: the sniff knows what arrived.
    const h = pollHarness(cardsSpec(), serve(FEED, 'application/rss+xml; charset=utf-8'));
    const result = await h.poll();

    expect(result.outcome).toBe('error');
    expect(result.errorKind).toBe('kind-mismatch');
    expect(result.health).toBe('error');
  });

  it('a source that needs the renderer is named, and no request is made', async () => {
    // `render: true` is the renderer's (playwright-core + Edge). Fetching it with
    // a bare client yields a wall that parses as a document — the silent zero.
    const spec = anRssSpec({ render: true });
    const h = pollHarness(spec, serve(FEED, 'application/rss+xml; charset=utf-8'));
    const result = await h.poll();

    expect(h.calls).toHaveLength(0);
    expect(result.outcome).toBe('error');
    expect(result.health).toBe('error');
    expect(result.errorKind).toBe('render');
    expect(result.status).toBe(0);
    expect(result.note).toContain('render');
  });

  it('a body that stops parsing keeps the last good items, and says the source is broken', async () => {
    const h = pollHarness(anRssSpec(), (call) =>
      call === 1 ? okResponse(fixture(FEED)) : okResponse(fixture('rss-truncated.xml'), '"cap-2"'),
    );
    const good = await h.poll();
    const items = h.db.items.count({ sourceId: 'bbc' });
    expect(good.itemCount).toBe(items);
    const state = storedState(h.db, 'bbc');

    const later = await h.pollAt(new Date('2026-11-09T11:00:00.000Z'));
    expect(later.outcome).toBe('error');
    expect(later.health).toBe('error');
    expect(later.itemCount).toBe(0);

    // The stories the source reported well are still the paper's stories.
    expect(h.db.items.count({ sourceId: 'bbc' })).toBe(items);
    expect(h.db.sources.find('bbc').health).toBe('error');
    expect(h.db.sources.find('bbc').lastSuccessAt).toBe(TAKEN_AT);
    // And the ladder's baseline is still the body that produced them: the next
    // poll has to parse again, not answer `same-body` about a broken feed.
    expect(storedState(h.db, 'bbc').bodyHash).toBe(state.bodyHash);
  });
});
