import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchSource, NO_BASELINE, type TransportResult } from '../src/index.ts';
import { fixture, rssSource } from './support.ts';
import { failedTransport, fixtureBytes, notesText, okTransport } from './transportSupport.ts';

/**
 * The transport against a **real** `node:http` server on localhost, through
 * `globalThis.fetch` (docs/testing.md: the HTTP policy is tested against a local
 * stub, and a localhost request is 1–5 ms).
 *
 * A fake `Response` cannot prove three things, and they are the three this file
 * exists for: undici's transparent gzip (the cap must be on **decoded** bytes,
 * D-006), a real redirect chain (the final URL and the `redirected` flag), and a
 * real `304`/`ENOTFOUND` round trip. No test in this package reaches the internet.
 */

const FEED = fixture('feed-ubuntu-blog.xml');
const LATIN1 = fixtureBytes('transport-feed-latin1.xml');

const counts = new Map<string, number>();
const next = (key: string): number => {
  const seen = (counts.get(key) ?? 0) + 1;
  counts.set(key, seen);
  return seen;
};

/** Requests the server saw, so a test can read the headers as a server reads them. */
const seen: Array<{ readonly path: string; readonly headers: IncomingMessage['headers'] }> = [];

const handler = (req: IncomingMessage, res: ServerResponse): void => {
  const path = req.url ?? '';
  const headers = req.headers;
  seen.push({ path, headers });
  const send = (status: number, body: string | Buffer, extra: Record<string, string> = {}): void => {
    res.writeHead(status, { 'content-type': 'application/rss+xml', ...extra });
    res.end(body);
  };
  if (path === '/feed.xml') {
    send(200, FEED, {
      etag: '"v9"',
      'last-modified': 'Sun, 08 Nov 2026 21:03:11 GMT',
      date: 'Mon, 09 Nov 2026 09:59:58 GMT',
      'cache-control': 'public, max-age=120',
    });
    return;
  }
  if (path === '/gzip.xml') {
    const compressed = gzipSync(Buffer.from(FEED, 'utf8'));
    send(200, compressed, { 'content-encoding': 'gzip', 'content-length': String(compressed.length) });
    return;
  }
  if (path === '/conditional') {
    const match = headers['if-none-match'];
    if (match === '"v9"') {
      res.writeHead(304, { etag: '"v9"', date: 'Mon, 09 Nov 2026 10:00:00 GMT' });
      res.end();
      return;
    }
    send(200, FEED, { etag: '"v9"', 'cache-control': 'no-store' });
    return;
  }
  if (path === '/redirect') {
    res.writeHead(302, { location: '/feed.xml' });
    res.end();
    return;
  }
  if (path === '/latin1') {
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=ISO-8859-1' });
    res.end(LATIN1);
    return;
  }
  if (path === '/flaky') {
    if (next('/flaky') === 1) {
      send(503, 'busy', { 'content-type': 'text/html' });
      return;
    }
    send(200, FEED);
    return;
  }
  if (path === '/rate-limited') {
    if (next('/rate-limited') === 1) {
      send(429, 'slow down', { 'content-type': 'text/html', 'retry-after': '30' });
      return;
    }
    send(200, FEED);
    return;
  }
  if (path === '/hang') return;
  send(404, 'gone', { 'content-type': 'text/html' });
};

let server: Server | null = null;
let origin = 'http://127.0.0.1:0';

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    const started = createServer(handler);
    started.once('error', reject);
    started.listen(0, '127.0.0.1', () => {
      const address = started.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('the stub did not get a port'));
        return;
      }
      server = started;
      origin = `http://127.0.0.1:${String(address.port)}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server === null) {
      resolve();
      return;
    }
    const closing = server;
    // `/hang` leaves a socket open on purpose, and `close()` waits for those.
    closing.closeAllConnections();
    closing.close(() => resolve());
  });
});

/** A real poll: the injected clock only, so the retry sleep is real and short (`backoffMaxMs: 0`). */
const poll = async (path: string, overrides: Record<string, unknown> = {}): Promise<TransportResult> =>
  fetchSource(rssSource({ url: `${origin}${path}`, ...overrides }), NO_BASELINE, {
    now: () => new Date('2026-11-09T10:00:00.000Z'),
    backoffMaxMs: 0,
  });

describe('a real round trip, through global fetch', () => {
  it('a feed arrives decoded, with the validators a server really sends', async () => {
    const ok = okTransport(await poll('/feed.xml'));
    expect(ok.status).toBe(200);
    expect(ok.text).toBe(FEED);
    expect(ok.etag).toBe('"v9"');
    expect(ok.lastModified).toBe('2026-11-08T21:03:11.000Z');
    expect(ok.responseDate).toBe('2026-11-09T09:59:58.000Z');
    expect(ok.freshnessSeconds).toBe(120);
    expect(ok.bytes).toBe(Buffer.byteLength(FEED, 'utf8'));
    expect(ok.bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('the server sees the headers: an Accept for the kind, the pinned Accept-Language, a declared UA, and gzip on offer', async () => {
    seen.length = 0;
    await poll('/feed.xml');
    const request = seen[0];
    const headers = request?.headers;
    if (headers === undefined) throw new Error('the stub saw no request');
    expect(String(headers.accept)).toContain('application/rss+xml');
    expect(headers['accept-language']).toBe('en-US,en;q=0.9');
    expect(String(headers['user-agent'])).toContain('newspa/0.1');
    expect(String(headers['accept-encoding'])).toContain('gzip');
  });

  it('the cap is on decoded bytes: the gzipped content-length is under the cap and the feed is over it', async () => {
    const failure = failedTransport(await poll('/gzip.xml', { maxBytes: 2_048 }));
    expect(failure.reason).toBe('too-large');
    expect(failure.detail).toContain('decoded bytes');
    expect(notesText(failure)).toContain('content-length says');
    expect(Buffer.byteLength(FEED, 'utf8')).toBeGreaterThan(2_048);
  });

  it('the same gzipped feed fits when the cap is honest, and the bytes counted are decoded', async () => {
    const ok = okTransport(await poll('/gzip.xml'));
    expect(ok.bytes).toBe(Buffer.byteLength(FEED, 'utf8'));
    expect(ok.text).toBe(FEED);
  });

  it('a 304 from a server, for an ETag that came from that server', async () => {
    const result = await fetchSource(
      rssSource({ url: `${origin}/conditional` }),
      { etag: '"v9"', lastModified: null, bodyHash: null },
      { now: () => new Date('2026-11-09T10:00:00.000Z') },
    );
    expect(result.state).toBe('not-modified');
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(0);
    expect(notesText(result)).toContain('layer 0 (conditional GET): 304');
  });

  it('a redirect chain reports the final URL, and the flag that says the page moved', async () => {
    const ok = okTransport(await poll('/redirect'));
    expect(ok.status).toBe(200);
    expect(ok.redirected).toBe(true);
    expect(ok.url).toBe(`${origin}/feed.xml`);
    expect(notesText(ok)).toContain('redirected:');
  });

  it('a charset the server declares decodes its own bytes, through undici, without undici decoding them', async () => {
    const ok = okTransport(await poll('/latin1'));
    expect(ok.charset).toBe('iso-8859-1');
    expect(ok.text).toContain('Le Café « Zürich »');
  });

  it('a 503 is retried against a real server, and the second answer wins', async () => {
    counts.delete('/flaky');
    const ok = okTransport(await poll('/flaky'));
    expect(ok.text).toBe(FEED);
    expect(ok.attempts).toBe(2);
  });

  it('a Retry-After of 30 s is honoured for the retry and capped, because a poll does not suspend for a day', async () => {
    counts.delete('/rate-limited');
    const ok = okTransport(await poll('/rate-limited'));
    expect(ok.attempts).toBe(2);
    expect(notesText(ok)).toContain("Retry-After '30' → 30000 ms");
    expect(notesText(ok)).toContain("the scheduler's backoff owns the rest");
  });

  it('a host that does not resolve is network, named by the code undici reports', async () => {
    const failure = failedTransport(
      await fetchSource(rssSource({ url: 'http://no-such-source.invalid/feed.xml' }), NO_BASELINE, { backoffMaxMs: 0 }),
    );
    expect(failure.reason).toBe('network');
    expect(failure.errorKind).toBe('network');
    expect(failure.status).toBe(0);
    expect(failure.detail).toMatch(/ENOTFOUND|EAI_AGAIN|did not resolve/);
  });

  it('a server that accepts and never answers is a timeout, by the source timeoutMs', async () => {
    const failure = failedTransport(await poll('/hang', { timeoutMs: 1_000 }));
    expect(failure.reason).toBe('timeout');
    expect(failure.attempts).toBe(3);
  });
});
