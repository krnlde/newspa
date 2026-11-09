import type { SourceSpec } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import { describeTransport, fetchSource, NO_BASELINE } from '../src/index.ts';
import { DEFAULT_USER_AGENT } from '../src/transportHeaders.ts';
import { rssSource } from './support.ts';
import {
  callAt,
  failedTransport,
  fixtureBytes,
  harness,
  notesText,
  notModifiedTransport,
  okTransport,
  sentHeader,
  sentMethod,
  sentSignal,
} from './transportSupport.ts';

/**
 * The request, and the sources the transport must refuse **by name**.
 *
 * The doc rule pinned here is the `Vary` row of docs/fetching.md: every header
 * is deterministic per source, because a stored validator is only safe to
 * replay for a request that is reproducible. The refusals are D-007's argument:
 * `render: true` and a login profile belong to the renderer, and a raw fetch of
 * them answers a wall that parses as a page — the quiet zero-item poll.
 */

const FEED_URL = 'https://feeds.example.invalid/world.xml';

const xml = (body: string | null, init: ResponseInit = {}): Response =>
  new Response(body, { ...init, headers: { 'content-type': 'application/rss+xml', ...init.headers } });

const feedResponse = (): Response => xml('<rss><channel><title>World</title></channel></rss>');

/**
 * A spec whose URL is one the schema would reject. The transport's contract is a
 * `SourceSpec`, so the only way to pin that it defends itself is to hand it a
 * URL it cannot parse — a source file edited by hand, not written by the picker.
 */
const specWithUrl = (url: string): SourceSpec => ({ ...rssSource({ url: 'https://ok.example.invalid/' }), url });

describe('the request is the policy', () => {
  it('asks for the configured kind, the source language, and a declared user agent', async () => {
    const h = harness(feedResponse);
    const result = okTransport(await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps));
    expect(result.status).toBe(200);
    expect(h.calls).toHaveLength(1);
    const call = callAt(h, 0);
    expect(call.url).toBe(FEED_URL);
    expect(sentMethod(call)).toBe('GET');
    expect(sentHeader(call, 'accept')).toContain('application/rss+xml');
    expect(sentHeader(call, 'accept-language')).toBe('en-US,en;q=0.9');
    expect(sentHeader(call, 'user-agent')).toBe(DEFAULT_USER_AGENT);
  });

  it('a per-source userAgent wins: the picker learned which UA the publisher answers', async () => {
    const h = harness(feedResponse);
    await fetchSource(
      rssSource({ url: FEED_URL, userAgent: 'newspa-edge/1.0', acceptLanguage: 'de-DE,de;q=0.8' }),
      NO_BASELINE,
      h.deps,
    );
    const call = callAt(h, 0);
    expect(sentHeader(call, 'user-agent')).toBe('newspa-edge/1.0');
    expect(sentHeader(call, 'accept-language')).toBe('de-DE,de;q=0.8');
  });

  it('a pinned header is sent, because a variant pin is what makes a diff stable (D-006)', async () => {
    const h = harness(feedResponse);
    await fetchSource(
      rssSource({ url: FEED_URL, headers: { 'X-BBC-Edge-Scheme': 'https', bbcmvt: 'no' } }),
      NO_BASELINE,
      h.deps,
    );
    const call = callAt(h, 0);
    expect(sentHeader(call, 'x-bbc-edge-scheme')).toBe('https');
    expect(sentHeader(call, 'bbcmvt')).toBe('no');
  });

  it('a pin replaces our default instead of standing beside it: two Accept values is the Vary trouble', async () => {
    const h = harness(feedResponse);
    await fetchSource(rssSource({ url: FEED_URL, headers: { accept: 'application/atom+xml' } }), NO_BASELINE, h.deps);
    expect(sentHeader(callAt(h, 0), 'accept')).toBe('application/atom+xml');
  });

  it('a forbidden pinned header is refused by name, and the poll goes on', async () => {
    const h = harness(feedResponse);
    const result = okTransport(
      await fetchSource(rssSource({ url: FEED_URL, headers: { 'content-length': '5' } }), NO_BASELINE, h.deps),
    );
    expect(sentHeader(callAt(h, 0), 'content-length')).toBeNull();
    expect(notesText(result)).toContain("pinned header 'content-length' is a forbidden header name");
  });

  it('sends no cookie: a plain fetch has no jar, and rule 17 puts auth in the renderer', async () => {
    const h = harness(feedResponse);
    await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps);
    const call = callAt(h, 0);
    expect(sentHeader(call, 'cookie')).toBeNull();
    expect(call.init.credentials).toBe('omit');
  });

  it('the request carries an abort signal, so the source timeout can fire', async () => {
    const h = harness(feedResponse);
    await fetchSource(rssSource({ url: FEED_URL, timeoutMs: 1_000 }), NO_BASELINE, h.deps);
    const signal = sentSignal(callAt(h, 0));
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it('the same spec sends the same headers twice, which is what makes replaying an ETag safe', async () => {
    const h = harness(feedResponse);
    const spec = rssSource({ url: FEED_URL, headers: { 'x-pin': 'a' } });
    await fetchSource(spec, NO_BASELINE, h.deps);
    await fetchSource(spec, NO_BASELINE, h.deps);
    const first = [...new Headers(callAt(h, 0).init.headers).entries()];
    const second = [...new Headers(callAt(h, 1).init.headers).entries()];
    expect(second).toEqual(first);
  });
});

describe('sources the transport refuses, named before a request is made', () => {
  /** A refusal must not touch the network, and must say `attempts: 0`. */
  const refused = async (spec: SourceSpec): Promise<ReturnType<typeof failedTransport>> => {
    const h = harness(feedResponse);
    const result = failedTransport(await fetchSource(spec, NO_BASELINE, h.deps));
    expect(h.calls).toHaveLength(0);
    expect(result.attempts).toBe(0);
    return result;
  };

  it('render: true belongs to the Edge renderer, and a raw fetch of it is a silent zero (D-007)', async () => {
    const result = await refused(rssSource({ url: FEED_URL, render: true }));
    expect(result.reason).toBe('render-required');
    expect(result.errorKind).toBe('render');
    expect(result.detail).toContain('render: true');
    expect(notesText(result)).toContain('zero-item poll');
  });

  it('profile: true is a login, and `pnpm login` is the only thing that owns it (rule 17)', async () => {
    const result = await refused(rssSource({ url: FEED_URL, profile: true }));
    expect(result.reason).toBe('credential-required');
    expect(result.errorKind).toBe('render');
    expect(result.detail).toContain('profile: true');
  });

  it('a cookieFile is a credential, and a config file in git is the worst place for one', async () => {
    const result = await refused(rssSource({ url: FEED_URL, cookieFile: 'secrets/guardian.txt' }));
    expect(result.reason).toBe('credential-required');
    expect(result.detail).toContain('secrets/guardian.txt');
  });

  it('a non-http scheme is not a source: the paper indexes the web, not the disk', async () => {
    const result = await refused(specWithUrl('file:///etc/passwd'));
    expect(result.reason).toBe('invalid-url');
    expect(result.detail).toContain('file:');
  });

  it('an unparseable URL is named, with the URL that failed', async () => {
    const result = await refused(specWithUrl('not a url at all'));
    expect(result.reason).toBe('invalid-url');
    expect(result.detail).toContain('not a url at all');
  });
});

describe('what a 200 reports', () => {
  it('the body, and every validator the pipeline has to store', async () => {
    const body = fixtureBytes('transport-feed-utf8.xml').toString('utf8');
    const h = harness(
      () =>
        new Response(body, {
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/rss+xml; charset=utf-8',
            etag: '"v7"',
            'last-modified': 'Sun, 08 Nov 2026 21:03:11 GMT',
            date: 'Sun, 09 Nov 2026 09:59:58 GMT',
            vary: 'Accept-Language, Cookie',
            'cache-control': 'public, max-age=120, s-maxage=300',
          },
        }),
    );
    const result = okTransport(await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps));
    expect(result.text).toBe(body);
    expect(result.etag).toBe('"v7"');
    expect(result.lastModified).toBe('2026-11-08T21:03:11.000Z');
    expect(result.responseDate).toBe('2026-11-09T09:59:58.000Z');
    expect(result.vary).toEqual(['accept-language', 'cookie']);
    expect(result.freshnessSeconds).toBe(120);
    expect(result.contentType).toBe('application/rss+xml; charset=utf-8');
    expect(result.attempts).toBe(1);
    expect(result.redirected).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.challenge).toBe(false);
    // The `Vary` row: a stored validator is only reusable by an identical request.
    expect(notesText(result)).toContain('the source varies on: accept-language, cookie');
  });

  it('the report line a log prints, for each state of the union', async () => {
    const ok = okTransport(await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, harness(feedResponse).deps));
    expect(describeTransport(ok)).toMatch(/^ok: \d+ bytes as utf-8, HTTP 200 of https:\/\/feeds\.example\.invalid/);
    expect(describeTransport(ok)).toContain('1 attempt(s)');

    const threeOhFour = notModifiedTransport(
      await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, harness(() => xml(null, { status: 304 })).deps),
    );
    expect(describeTransport(threeOhFour)).toContain('not-modified: HTTP 304');

    const failure = failedTransport(
      await fetchSource(
        rssSource({ url: FEED_URL }),
        NO_BASELINE,
        harness(() => xml('nope', { status: 404, statusText: 'Not Found' })).deps,
      ),
    );
    expect(describeTransport(failure)).toContain('failure/http-status (http): HTTP 404 Not Found');
  });
});
