import { describe, expect, it } from 'vitest';
import {
  classifyThrown,
  fetchSource,
  MAX_RETRIES,
  NO_BASELINE,
  RETRYABLE_STATUS,
  type TransportResult,
} from '../src/index.ts';
import { fixture, rssSource } from './support.ts';
import type { TransportHarness } from './transportSupport.ts';
import { failedTransport, harness, notesText, okTransport, xmlResponse } from './transportSupport.ts';

/**
 * Every way a poll can fail, named.
 *
 * The point of this file is rule 5: a source that is down, blocked, slow or
 * cert-broken must reach the paper as a **sentence**, never as "no news". Two of
 * these tests are the ladder's contract with core: `RETRYABLE_STATUS` is core's
 * list (`core/src/health.ts`) and is **not exported**, so the parity test below
 * is what keeps the two lists from drifting apart.
 */

const FEED_URL = 'https://feeds.example.invalid/world.xml';
const WALL = fixture('challenge-cloudflare.html');
const FEED_BODY = '<rss><channel><title>World</title></channel></rss>';

interface Poll {
  readonly result: TransportResult;
  readonly h: TransportHarness;
}

const pollWith = async (
  handler: Parameters<typeof harness>[0],
  overrides: Record<string, unknown> = {},
  extra: Parameters<typeof harness>[1] = {},
): Promise<Poll> => {
  const h = harness(handler, extra);
  const result = await fetchSource(rssSource({ url: FEED_URL, ...overrides }), NO_BASELINE, h.deps);
  return { result, h };
};

const statusPoll =
  (
    status: number,
    body = '<html><body>gone</body></html>',
    headers: Record<string, string> = {},
  ): Parameters<typeof harness>[0] =>
  () =>
    xmlResponse(body, { status, headers: { 'content-type': 'text/html', ...headers } });

describe('statuses: retried, and how many times', () => {
  it('a 404 is not retried, keeps its status, and names the URL that answered it', async () => {
    const poll = await pollWith(statusPoll(404, '', { 'content-type': 'text/html; charset=utf-8' }));
    const failure = failedTransport(poll.result);
    expect(failure.reason).toBe('http-status');
    expect(failure.errorKind).toBe('http');
    expect(failure.status).toBe(404);
    expect(failure.attempts).toBe(1);
    expect(poll.h.calls).toHaveLength(1);
    expect(poll.h.waits).toEqual([]);
    expect(failure.detail).toContain(FEED_URL);
  });

  it('a 403 that answers a wall is a named challenge, not an empty day', async () => {
    const poll = await pollWith(statusPoll(403, WALL));
    const failure = failedTransport(poll.result);
    expect(failure.status).toBe(403);
    expect(failure.challenge).toBe(true);
    expect(failure.challengeMarker).toBe('just a moment');
    expect(notesText(poll.result)).toContain('the body is a challenge page');
    expect(failure.attempts).toBe(1);
  });

  it("a wall from the extended list is named as the extended list, not as core's", async () => {
    const poll = await pollWith(
      statusPoll(
        403,
        '<html><head><title>Access</title></head><body>Are you a robot? <a href="/login">Log in</a></body></html>',
      ),
    );
    const failure = failedTransport(poll.result);
    expect(failure.challengeMarker).toBe('are you a robot');
    expect(notesText(poll.result)).toContain('the extended wall list');
  });

  it('a 410 with no content-type at all says so, rather than printing "undefined"', async () => {
    const poll = await pollWith(() => new Response(null, { status: 410 }));
    const failure = failedTransport(poll.result);
    expect(failure.status).toBe(410);
    expect(failure.contentType).toBeNull();
    expect(notesText(poll.result)).toContain('content-type: absent');
  });

  it('the probe of a 403 is a probe, not the whole page: 16 KB of a 5 MB body', async () => {
    const poll = await pollWith(statusPoll(503, 'x'.repeat(4_000_000)));
    const failure = failedTransport(poll.result);
    expect(failure.bytes).toBeLessThanOrEqual(16_384);
    expect(failure.attempts).toBe(3);
  });

  it('a wall on a 200 is a challenge on the success, because the bytes decide (D-006)', async () => {
    const poll = await pollWith(statusPoll(200, WALL));
    const ok = okTransport(poll.result);
    expect(ok.challenge).toBe(true);
    expect(ok.challengeMarker).toBe('just a moment');
    expect(notesText(poll.result)).toContain("a challenge marker 'just a moment'");
  });

  it('every core-retryable status is retried to the budget and no further', async () => {
    for (const status of RETRYABLE_STATUS) {
      const poll = await pollWith(statusPoll(status));
      const failure = failedTransport(poll.result);
      expect(failure.status).toBe(status);
      expect(failure.attempts).toBe(MAX_RETRIES + 1);
      expect(poll.h.calls).toHaveLength(MAX_RETRIES + 1);
    }
  });

  it('the list core calls an error is the list this transport retries, pinned in transportRetry.test.ts', () => {
    expect(RETRYABLE_STATUS).toEqual([408, 425, 429, 500, 502, 503, 504]);
    expect(MAX_RETRIES).toBe(2);
  });

  it('a 500 followed by a 200 is a success, and the failed attempt is in the notes', async () => {
    const poll = await pollWith((call) => (call === 1 ? xmlResponse('busy', { status: 500 }) : xmlResponse(FEED_BODY)));
    const ok = okTransport(poll.result);
    expect(ok.text).toContain('World');
    expect(ok.attempts).toBe(2);
    expect(poll.h.waits).toEqual([500]);
    expect(notesText(poll.result)).toContain('attempt 1 of 3: HTTP 500 is retryable');
    expect(notesText(poll.result)).toContain('backoff 500 ms');
  });

  it('without a Retry-After the backoff is bounded and exponential', async () => {
    const poll = await pollWith(statusPoll(503));
    expect(poll.h.waits).toEqual([500, 1_000]);
    expect(notesText(poll.result)).toContain('attempt 3 of 3 after 2 failure(s); backoff 1000 ms');
  });

  it('the cap is a knob: backoffMaxMs 100 keeps a poll short', async () => {
    const poll = await pollWith(statusPoll(503), {}, { backoffMaxMs: 100 });
    expect(poll.h.waits).toEqual([100, 100]);
  });
});

describe('Retry-After: the server is better informed than we are', () => {
  it('a delta-seconds value replaces the exponential backoff for that retry', async () => {
    const poll = await pollWith(statusPoll(429, '', { 'retry-after': '2' }));
    expect(poll.h.waits).toEqual([2_000, 2_000]);
    expect(notesText(poll.result)).toContain("Retry-After '2' → 2000 ms replaces the exponential backoff");
  });

  it('an HTTP date is read as a delta from the clock, not as a string', async () => {
    const poll = await pollWith(statusPoll(503, '', { 'retry-after': 'Mon, 09 Nov 2026 10:00:02 GMT' }));
    expect(poll.h.waits).toEqual([2_000, 2_000]);
  });

  it('a day of Retry-After is capped: this transport does not suspend a poll, the scheduler keeps the source quiet', async () => {
    const poll = await pollWith(statusPoll(429, '', { 'retry-after': '86400' }));
    expect(poll.h.waits).toEqual([4_000, 4_000]);
    expect(notesText(poll.result)).toContain("the scheduler's backoff owns the rest");
  });

  it('a Retry-After we cannot read is a backoff, named as a backoff', async () => {
    const poll = await pollWith(statusPoll(503, '', { 'retry-after': 'soon' }));
    expect(poll.h.waits).toEqual([500, 1_000]);
    expect(notesText(poll.result)).toContain('backoff 500 ms');
  });
});

describe('no response at all: the cause chain decides, and the names do not collapse', () => {
  const causeOf = (message: string, code: string | undefined): Error =>
    new TypeError('fetch failed', { cause: Object.assign(new Error(message), code === undefined ? {} : { code }) });

  it('DNS failure is network, by name, and the code is in the report', async () => {
    const poll = await pollWith(() => {
      throw causeOf('getaddrinfo ENOTFOUND feeds.example.invalid', 'ENOTFOUND');
    });
    const failure = failedTransport(poll.result);
    expect(failure.reason).toBe('network');
    expect(failure.errorKind).toBe('network');
    expect(failure.status).toBe(0);
    expect(failure.detail).toContain('ENOTFOUND');
    expect(failure.detail).toContain('did not resolve');
    expect(notesText(poll.result)).toContain('cause codes: ENOTFOUND');
  });

  it('a refused port is network, and the detail says refused, not "network error"', async () => {
    const poll = await pollWith(() => {
      throw causeOf('connect ECONNREFUSED 127.0.0.1:8787', 'ECONNREFUSED');
    });
    expect(failedTransport(poll.result).detail).toContain('ECONNREFUSED');
  });

  it('a certificate failure is tls, through the `fetch failed` wrapper undici puts on everything', async () => {
    const poll = await pollWith(() => {
      throw causeOf('unable to verify the first certificate', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    });
    const failure = failedTransport(poll.result);
    expect(failure.reason).toBe('tls');
    expect(failure.errorKind).toBe('tls');
    expect(failure.detail).toContain('certificate/TLS failure');
  });

  it('a cert failure is not retried: it is deterministic, and three identical failures only delay the sentence', async () => {
    const poll = await pollWith(() => {
      throw causeOf('self-signed certificate', 'DEPTH_ZERO_SELF_SIGNED_CERT');
    });
    expect(poll.h.calls).toHaveLength(1);
    expect(poll.h.waits).toEqual([]);
    expect(failedTransport(poll.result).attempts).toBe(1);
  });

  it('a stalled response is a timeout, not a network failure', async () => {
    const poll = await pollWith(() => {
      throw causeOf('Response headers timed out', 'UND_ERR_HEADERS_TIMEOUT');
    });
    expect(failedTransport(poll.result).reason).toBe('timeout');
  });

  it('a TimeoutError is a timeout, and the request is retried twice', async () => {
    const poll = await pollWith(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    const failure = failedTransport(poll.result);
    expect(failure.reason).toBe('timeout');
    expect(failure.errorKind).toBe('timeout');
    expect(failure.attempts).toBe(3);
    expect(poll.h.waits).toEqual([500, 1_000]);
  });

  it('the timeout is enforced for real: the signal is the source timeoutMs, and a hung server is a timeout', async () => {
    const poll = await pollWith(
      (_call, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (signal === null || signal === undefined) throw new Error('the transport must send a signal');
          signal.addEventListener('abort', () => {
            reject(signal.reason);
          });
        }),
      { timeoutMs: 1_000 },
    );
    const failure = failedTransport(poll.result);
    expect(failure.reason).toBe('timeout');
    expect(failure.detail).toContain('did not complete before its timeout');
    expect(failure.attempts).toBe(3);
  });

  it('an error with nothing to read is still named, with what was seen', async () => {
    const poll = await pollWith(() => {
      throw new Error('a transport bug');
    });
    const failure = failedTransport(poll.result);
    expect(failure.reason).toBe('network');
    expect(failure.detail).toContain('a transport bug');
    expect(notesText(poll.result)).toContain('cause codes: none reported');
  });

  it('classifyThrown keeps the chain, so a log prints the codes and the names', () => {
    const info = classifyThrown(causeOf('socket hang up', 'ECONNRESET'), new AbortController().signal);
    expect(info.errorKind).toBe('network');
    expect(info.notes).toContain('cause codes: ECONNRESET');
    expect(info.notes).toContain('error names: TypeError, Error');
  });
});
