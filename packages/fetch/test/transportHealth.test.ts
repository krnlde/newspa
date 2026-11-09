import { classifyFetch, type FetchOutcome } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { fetchSource, NO_BASELINE } from '../src/index.ts';
import type { TransportResult } from '../src/transportTypes.ts';
import { fixture, rssSource } from './support.ts';
import { failedTransport, harness, xmlResponse } from './transportSupport.ts';

/**
 * The seam between the transport and core's health classifier.
 *
 * `FetchOutcome` is core's classification **input** and it carries `itemCount`,
 * which only exists after a parse — so the transport does not produce one. No
 * mapping table is needed either: every field of a `FetchOutcome` is a
 * projection of a `TransportResult`. This file pins that projection, so the
 * day someone adds a status-to-health switch, the switch is shown to be
 * redundant.
 */

const FEED_URL = 'https://feeds.example.invalid/world.xml';
const WALL = fixture('challenge-cloudflare.html');
const FEED_BODY = '<rss><channel><title>World</title></channel></rss>';

const outcomeFrom = (result: TransportResult, itemCount: number): FetchOutcome => ({
  status: result.status,
  ok: result.ok,
  itemCount,
  expectedMatchCount: null,
  challenge: result.challenge,
  errorKind: result.state === 'failure' ? result.errorKind : null,
});

/** One poll, answered by `response`, and the health state the pipeline would publish. */
const healthOf = async (
  response: Response,
  itemCount = 0,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const h = harness(() => response);
  const result = await fetchSource(rssSource({ url: FEED_URL, ...overrides }), NO_BASELINE, h.deps);
  return classifyFetch(outcomeFrom(result, itemCount));
};

const statusPage = (status: number, body: string): Response =>
  xmlResponse(body, { status, headers: { 'content-type': 'text/html' } });

describe('the projection is the composition, with no status-to-health switch', () => {
  it('a 403 wall composes to blocked, which is the whole point of the ladder', async () => {
    expect(await healthOf(statusPage(403, WALL))).toBe('blocked');
  });

  it('a 200 that carries a wall composes to blocked too: the bytes decide, not the status (D-006)', async () => {
    expect(await healthOf(statusPage(200, WALL))).toBe('blocked');
  });

  it('a 200 with a body composes to ok', async () => {
    expect(await healthOf(xmlResponse(FEED_BODY), 3)).toBe('ok');
  });

  it('a 304 composes to unknown on a fresh health state, and the pipeline keeps the last good one: a 304 is not a zero', async () => {
    const h = harness(() => xmlResponse(null, { status: 304 }));
    const result = await fetchSource(
      rssSource({ url: FEED_URL }),
      { etag: '"v7"', lastModified: null, bodyHash: null },
      h.deps,
    );
    expect(result.ok).toBe(true);
    expect(classifyFetch(outcomeFrom(result, 0))).toBe('unknown');
  });

  it('a spent retry composes to error, and the attempts say what was spent', async () => {
    const h = harness(() => statusPage(503, 'busy'));
    const failure = failedTransport(await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps));
    expect(classifyFetch(outcomeFrom(failure, 0))).toBe('error');
    expect(failure.attempts).toBe(3);
  });

  it('a body over the cap composes to error, not to the quiet zero the cap would have produced', async () => {
    const h = harness(() => xmlResponse('x'.repeat(4_000), { status: 200 }));
    const result = await fetchSource(rssSource({ url: FEED_URL, maxBytes: 1_024 }), NO_BASELINE, h.deps);
    expect(failedTransport(result).reason).toBe('too-large');
    expect(classifyFetch(outcomeFrom(result, 0))).toBe('error');
  });

  it('a 2xx with no bytes composes to error: the status is a 200, so only the kind can speak', async () => {
    const h = harness(() => xmlResponse('', { status: 200, headers: { 'content-length': '0' } }));
    const result = await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, h.deps);
    expect(failedTransport(result).reason).toBe('empty');
    expect(classifyFetch(outcomeFrom(result, 0))).toBe('error');
  });

  it('a timeout and a cert failure both compose to error, so the paper says so', async () => {
    const timeout = harness(() => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const timedOut = await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, timeout.deps);
    expect(timedOut.status).toBe(0);
    expect(classifyFetch(outcomeFrom(timedOut, 0))).toBe('error');

    const cert = harness(() => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('no trust'), { code: 'CERT_UNTRUSTED' }) });
    });
    const failed = await fetchSource(rssSource({ url: FEED_URL }), NO_BASELINE, cert.deps);
    expect(failed.state).toBe('failure');
    expect(classifyFetch(outcomeFrom(failed, 0))).toBe('error');
  });
});
