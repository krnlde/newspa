import { describe, expect, it } from 'vitest';
import { fetchSource, NO_BASELINE } from '../src/index.ts';
import { rssSource } from './support.ts';
import {
  callAt,
  failedTransport,
  harness,
  NOW_ISO,
  notesText,
  notModifiedTransport,
  okTransport,
  sentHeader,
  xmlResponse,
} from './transportSupport.ts';

/**
 * Layer 0 of the ladder: the conditional GET (docs/fetching.md, the `ETag`,
 * `Last-Modified`, `Date` rows; D-020).
 *
 * The measured fact that decides the shape of these tests: BBC answers a valid
 * `If-None-Match` with **`200` + the full 370 KB**, not a `304`. So a `304` is a
 * strong "nothing changed" and a `200` is simply "here is the body" — the
 * transport never treats a `200` as a validator failure, and never assumes a
 * source supports conditional GET.
 */

const FEED_URL = 'https://feeds.example.invalid/world.xml';
const BODY = '<rss><channel><title>World in full</title></channel></rss>';
const LM = 'Sun, 09 Nov 2026 09:58:00 GMT';
const DATE = 'Sun, 09 Nov 2026 10:00:00 GMT';

describe('what the stored validators become', () => {
  it('a stored ETag goes back verbatim as If-None-Match', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(rssSource({ url: FEED_URL }), { etag: '"v7"', lastModified: null, bodyHash: null }, h.deps);
    expect(sentHeader(callAt(h, 0), 'if-none-match')).toBe('"v7"');
  });

  it('a weak ETag keeps its W/ prefix: the weak indicator is sent as it was received', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(rssSource({ url: FEED_URL }), { etag: 'W/"x9"', lastModified: null, bodyHash: null }, h.deps);
    expect(sentHeader(callAt(h, 0), 'if-none-match')).toBe('W/"x9"');
  });

  it('a lowercase w/ is sent back as written, because an opaque validator asks for that', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(rssSource({ url: FEED_URL }), { etag: 'w/"x9"', lastModified: null, bodyHash: null }, h.deps);
    expect(sentHeader(callAt(h, 0), 'if-none-match')).toBe('w/"x9"');
  });

  it('If-Modified-Since is one second before the stored Last-Modified: 1 s resolution, inclusive compare, and a 412 is a broken source', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(
      rssSource({ url: FEED_URL }),
      { etag: null, lastModified: '2026-11-09T09:58:00.000Z', bodyHash: null },
      h.deps,
    );
    expect(sentHeader(callAt(h, 0), 'if-modified-since')).toBe('Mon, 09 Nov 2026 09:57:59 GMT');
  });

  it('both validators go together when both are stored', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(
      rssSource({ url: FEED_URL }),
      { etag: '"v7"', lastModified: '2026-11-09T09:58:00.000Z', bodyHash: null },
      h.deps,
    );
    const call = callAt(h, 0);
    expect(sentHeader(call, 'if-none-match')).toBe('"v7"');
    expect(sentHeader(call, 'if-modified-since')).toBe('Mon, 09 Nov 2026 09:57:59 GMT');
  });

  it('the first poll sends neither: there is nothing to replay', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps);
    const call = callAt(h, 0);
    expect(sentHeader(call, 'if-none-match')).toBeNull();
    expect(sentHeader(call, 'if-modified-since')).toBeNull();
  });

  it('an unparsable stored Last-Modified sends no conditional: a null validator means no fast path, which is always safe', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(rssSource({ url: FEED_URL }), { etag: null, lastModified: 'not a date', bodyHash: null }, h.deps);
    expect(sentHeader(callAt(h, 0), 'if-modified-since')).toBeNull();
  });
});

describe('the skew rule: a CDN Last-Modified that runs ahead of Date is not a validator', () => {
  it('more than 5 min ahead of the response Date is dropped, and the ETag still goes', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(
      rssSource({ url: FEED_URL }),
      {
        etag: '"v7"',
        lastModified: '2026-11-09T10:06:00.000Z',
        bodyHash: null,
        responseDate: '2026-11-09T10:00:00.000Z',
      },
      h.deps,
    );
    const call = callAt(h, 0);
    expect(sentHeader(call, 'if-modified-since')).toBeNull();
    expect(sentHeader(call, 'if-none-match')).toBe('"v7"');
  });

  it('4 minutes of skew is inside the tolerance, so the fast path is kept', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(
      rssSource({ url: FEED_URL }),
      {
        etag: null,
        lastModified: '2026-11-09T10:04:00.000Z',
        bodyHash: null,
        responseDate: '2026-11-09T10:00:00.000Z',
      },
      h.deps,
    );
    expect(sentHeader(callAt(h, 0), 'if-modified-since')).toBe('Mon, 09 Nov 2026 10:03:59 GMT');
  });

  it('with no stored response Date the clock is the reference, and 10 min of skew kills the validator', async () => {
    expect(NOW_ISO).toBe('2026-11-09T10:00:00.000Z');
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(
      rssSource({ url: FEED_URL }),
      { etag: null, lastModified: '2026-11-09T10:10:00.000Z', bodyHash: null },
      h.deps,
    );
    expect(sentHeader(callAt(h, 0), 'if-modified-since')).toBeNull();
  });

  it('a Last-Modified in the past is never dropped for skew', async () => {
    const h = harness(() => xmlResponse(BODY));
    await fetchSource(
      rssSource({ url: FEED_URL }),
      { etag: null, lastModified: '2020-01-01T00:00:00.000Z', bodyHash: null },
      h.deps,
    );
    expect(sentHeader(callAt(h, 0), 'if-modified-since')).toBe('Tue, 31 Dec 2019 23:59:59 GMT');
  });
});

describe('the 304, and the 200 that is not one', () => {
  it('a 304 is a success with no body, and the note names the layer that fired', async () => {
    const h = harness(() =>
      xmlResponse(null, {
        status: 304,
        statusText: 'Not Modified',
        headers: { 'cache-control': 'no-store', date: DATE },
      }),
    );
    const result = notModifiedTransport(
      await fetchSource(
        rssSource({ url: FEED_URL }),
        { etag: '"v7"', lastModified: '2026-11-09T09:58:00.000Z', bodyHash: null },
        h.deps,
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(304);
    expect(result.bytes).toBe(0);
    expect('text' in result).toBe(false);
    expect(result.challenge).toBe(false);
    expect(notesText(result)).toContain('layer 0 (conditional GET): 304');
    // The `no-store` row of the doc: freshness 0 is a health note, not a cadence change.
    expect(result.freshnessSeconds).toBe(0);
    expect(notesText(result)).toContain('freshness 0 s');
  });

  it('a 304 keeps the validators it carried, so the next poll has the new ones', async () => {
    const h = harness(() =>
      xmlResponse(null, {
        status: 304,
        headers: { etag: '"v8"', 'last-modified': LM, date: DATE },
      }),
    );
    const result = notModifiedTransport(
      await fetchSource(rssSource({ url: FEED_URL }), { etag: '"v7"', lastModified: null, bodyHash: null }, h.deps),
    );
    expect(result.etag).toBe('"v8"');
    expect(result.lastModified).toBe('2026-11-09T09:58:00.000Z');
    expect(result.responseDate).toBe('2026-11-09T10:00:00.000Z');
  });

  it('a 200 with a full body after a valid If-None-Match is parsed, not distrusted (the BBC measurement)', async () => {
    const h = harness(() => xmlResponse(BODY, { status: 200, headers: { etag: '"v7"', date: DATE } }));
    const result = okTransport(
      await fetchSource(
        rssSource({ url: FEED_URL }),
        { etag: '"v7"', lastModified: null, bodyHash: 'sha256:stale-baseline-hash' },
        h.deps,
      ),
    );
    expect(result.status).toBe(200);
    expect(result.text).toBe(BODY);
    expect(notesText(result)).toContain('layer 1 (body hash) missed');
  });

  it('the freshness floor is a note, never a cadence change: max-age 300 against a 1 min cadence', async () => {
    const h = harness(() => xmlResponse(BODY, { status: 200, headers: { 'cache-control': 'public, max-age=300' } }));
    const result = okTransport(await fetchSource(rssSource({ url: FEED_URL, cadenceMinutes: 1 }), NO_BASELINE, h.deps));
    expect(result.freshnessSeconds).toBe(300);
    expect(notesText(result)).toContain("cache freshness 300 s is longer than this source's 1 min cadence");
  });

  it('a 200 with no bytes is named empty, and never a zero-item day', async () => {
    const h = harness(() => xmlResponse('', { status: 200, headers: { 'content-length': '0' } }));
    const result = failedTransport(await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps));
    expect(result.reason).toBe('empty');
    expect(result.errorKind).toBe('parse');
    expect(notesText(result)).toContain('an empty body is a fetch problem, never "no news"');
    expect(notesText(result)).toContain('content-length: 0');
  });

  it('a 204 is the same named case, with its status kept', async () => {
    const h = harness(() => new Response(null, { status: 204, headers: { 'content-type': 'application/rss+xml' } }));
    const result = failedTransport(await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps));
    expect(result.reason).toBe('empty');
    expect(result.status).toBe(204);
  });
});
