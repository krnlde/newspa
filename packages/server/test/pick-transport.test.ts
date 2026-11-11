import type { SourceSpec } from 'newspa-config';
import type { FetchLike } from 'newspa-fetch';
import { describe, expect, it } from 'vitest';
import { pickTextFetcher } from '../src/pickTransport.ts';

/**
 * The bytes a pick proves a selector against (WP6, D-036).
 *
 * The claim is narrow and load-bearing: the pick fetches **the way the poller
 * fetches**, so a selector proved here is a selector the poll can read. These tests
 * pin the three arms: a body, a named transport refusal, and the one answer that
 * leaves the derivation with nothing to read.
 *
 * The refusals are the honest ones and are named by the transport itself, not by
 * this module: `credential-required` is rule 17 (a plain fetch never authenticates),
 * `render-required` is D-007. A pick that met either with "no items" would be the
 * silent zero this project is built against (rule 5).
 */

const htmlSpec = {
  id: 'example-world',
  label: 'Example World',
  url: 'https://example.invalid/world',
  kind: 'html',
  list: 'ul.news > li',
  fields: { title: 'h2', link: 'a' },
  cadenceMinutes: 15,
  weight: 2,
  timeoutMs: 5_000,
  maxBytes: 1_048_576,
  headers: {},
  sendCookies: false,
  render: false,
  profile: false,
  strip: [],
} as unknown as SourceSpec;

const sent: RequestInit[] = [];

const socket =
  (response: Response): FetchLike =>
  async (_url, init) => {
    sent.push(init);
    return response;
  };

/** A 304 has no body, and `Response` refuses one: the null body is the spec, not a shortcut. */
const answer = (
  status: number,
  body = '<html><body><ul class="news"><li class="card"><a href="/a1">One</a></li></ul></body></html>',
  headers: Record<string, string> = {},
): Response =>
  new Response(status === 304 || status === 204 ? null : body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });

const at = (over: Record<string, unknown> = {}): SourceSpec => ({ ...htmlSpec, ...over }) as SourceSpec;

describe('the bytes behind a pick', () => {
  it('returns the body the poller would read, and sends no validators (NO_BASELINE)', async () => {
    sent.length = 0;
    const text = await pickTextFetcher({ now: () => new Date('2026-11-11T10:00:00Z'), fetch: socket(answer(200)) })(
      htmlSpec,
      'https://example.invalid/world?page=2',
    );
    expect(text).toContain('ul class="news"');
    const headers = new Headers(sent[0]?.['headers']);
    expect(headers.get('if-none-match')).toBeNull();
    expect(headers.get('if-modified-since')).toBeNull();
  });

  it('fetches the url the window ended on, with the source’s own policy', async () => {
    const spec = at({ headers: { 'accept-language': 'de-DE' }, userAgent: 'newspa-test/1' });
    const fetcher = pickTextFetcher({
      now: () => new Date('2026-11-11T10:00:00Z'),
      fetch: async (url, init) => {
        sent.push(init);
        expect(url).toBe('https://example.invalid/world?page=3');
        return answer(200);
      },
    });
    expect(await fetcher(spec, 'https://example.invalid/world?page=3')).toContain('One');
  });

  it('a render source is refused by name, because the DOM clicked is not the DOM fetched (D-007)', async () => {
    const fetcher = pickTextFetcher({ now: () => new Date(), fetch: socket(answer(200)) });
    await expect(fetcher(at({ render: true }), 'https://example.invalid/world')).rejects.toThrow(/render-required/);
  });

  it('a profile source is refused by name, because a plain fetch never authenticates (rule 17)', async () => {
    const fetcher = pickTextFetcher({ now: () => new Date(), fetch: socket(answer(200)) });
    await expect(fetcher(at({ profile: true }), 'https://example.invalid/world')).rejects.toThrow(
      /credential-required/,
    );
  });

  it('an HTTP failure carries the status, and a dead host carries the reason', async () => {
    const refused = pickTextFetcher({ now: () => new Date(), fetch: socket(answer(403, 'blocked')) });
    await expect(refused(htmlSpec, 'https://example.invalid/world')).rejects.toThrow(/http-status.*403/u);

    const gone = pickTextFetcher({
      now: () => new Date(),
      fetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND example.invalid');
      },
    });
    await expect(gone(htmlSpec, 'https://example.invalid/world')).rejects.toThrow(/network.*ENOTFOUND/u);
  });

  it('a 304 with no baseline is named as "no bytes", not as an empty page', async () => {
    const fetcher = pickTextFetcher({
      now: () => new Date(),
      fetch: socket(answer(304, '', { etag: '"W/abc"' })),
    });
    await expect(fetcher(htmlSpec, 'https://example.invalid/world')).rejects.toThrow(/answered 304/u);
  });
});
