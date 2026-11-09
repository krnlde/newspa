import { describe, expect, it } from 'vitest';
import {
  conditionalHeaders,
  freshnessSeconds,
  hasValidators,
  parseCacheControl,
  retryAfterMs,
  validatorsFromHeaders,
} from '../src/validators.ts';

/**
 * The header fake: `validatorsFromHeaders` takes a `name → value | null`
 * accessor, so the tests hand it exactly that and no `Headers` type is needed
 * anywhere in core. The timestamp grammars are tested in `httpDate.test.ts`.
 */
const headerRecord =
  (values: Record<string, string | undefined>) =>
  (name: string): string | null =>
    values[name] ?? null;

describe('parseCacheControl', () => {
  it('reads the directives the poller acts on', () => {
    const hints = parseCacheControl('public, max-age=120, s-maxage=300, must-revalidate');
    expect(hints).toEqual({
      maxAgeSeconds: 120,
      sharedMaxAgeSeconds: 300,
      noStore: false,
      noCache: false,
      mustRevalidate: true,
      private: false,
      immutable: false,
    });
    expect(parseCacheControl('no-store, private, immutable').noStore).toBe(true);
    expect(parseCacheControl('NO-CACHE, MAX-AGE=60').noCache).toBe(true);
    expect(parseCacheControl('MAX-AGE=60').maxAgeSeconds).toBe(60);
  });

  it('treats a qualified no-cache list as the directive', () => {
    expect(parseCacheControl('no-cache="set-cookie, x-foo"').noCache).toBe(true);
  });

  it('ignores values it cannot use, and the empty header', () => {
    expect(parseCacheControl('max-age=abc').maxAgeSeconds).toBeNull();
    expect(parseCacheControl('max-age=-5').maxAgeSeconds).toBeNull();
    expect(parseCacheControl('max-age=1.5').maxAgeSeconds).toBeNull();
    for (const value of ['', null, undefined]) {
      expect(parseCacheControl(value)).toEqual({
        maxAgeSeconds: null,
        sharedMaxAgeSeconds: null,
        noStore: false,
        noCache: false,
        mustRevalidate: false,
        private: false,
        immutable: false,
      });
    }
  });
});

describe('freshnessSeconds', () => {
  const hints = (over: Partial<ReturnType<typeof parseCacheControl>> = {}) => ({
    ...parseCacheControl(null),
    ...over,
  });

  it('trusts the shortest lifetime, because that is the freshest copy we can get', () => {
    expect(freshnessSeconds(hints({ maxAgeSeconds: 600, sharedMaxAgeSeconds: 60 }))).toBe(60);
    expect(freshnessSeconds(hints({ maxAgeSeconds: 60, sharedMaxAgeSeconds: 600 }))).toBe(60);
    expect(freshnessSeconds(hints({ sharedMaxAgeSeconds: 300 }))).toBe(300);
    expect(freshnessSeconds(hints({ maxAgeSeconds: 0 }))).toBe(0);
  });

  it('is 0 for a response that must not be cached, and null when nothing says', () => {
    expect(freshnessSeconds(hints({ noStore: true, maxAgeSeconds: 600 }))).toBe(0);
    expect(freshnessSeconds(hints({ noCache: true }))).toBe(0);
    expect(freshnessSeconds(hints())).toBeNull();
  });
});

describe('retryAfterMs', () => {
  const now = new Date('2025-11-09T10:00:00.000Z');

  it('reads delta-seconds', () => {
    expect(retryAfterMs('20', now)).toBe(20_000);
    expect(retryAfterMs('0', now)).toBe(0);
    expect(retryAfterMs(' 30 ', now)).toBe(30_000);
  });

  it('reads an HTTP date, and never returns a negative delay', () => {
    expect(retryAfterMs('Sun, 09 Nov 2025 10:00:30 GMT', now)).toBe(30_000);
    expect(retryAfterMs('Sun, 09 Nov 2025 09:00:00 GMT', now)).toBe(0);
  });

  it('is null when the server said nothing usable, so the caller keeps its own backoff', () => {
    for (const value of ['', null, undefined, 'soon', 'Mon 9 Nov 2025']) {
      expect(retryAfterMs(value, now)).toBeNull();
    }
  });
});

describe('validatorsFromHeaders', () => {
  it('reads a strong ETag, the dates and the vary fields', () => {
    const v = validatorsFromHeaders(
      headerRecord({
        etag: '"5l49hlg0od7xhg"',
        'last-modified': 'Sun, 09 Nov 2025 10:00:00 GMT',
        date: 'Sun, 09 Nov 2025 12:00:00 GMT',
        'cache-control': 'max-age=60',
        vary: 'Accept-Language, Cookie',
      }),
    );
    expect(v.etag).toBe('"5l49hlg0od7xhg"');
    expect(v.weakEtag).toBe(false);
    expect(v.lastModified).toBe('2025-11-09T10:00:00.000Z');
    expect(v.responseDate).toBe('2025-11-09T12:00:00.000Z');
    expect(v.cache.maxAgeSeconds).toBe(60);
    expect(v.vary).toEqual(['accept-language', 'cookie']);
    expect(hasValidators(v)).toBe(true);
  });

  it('marks a weak ETag, and keeps it as a validator', () => {
    const v = validatorsFromHeaders(headerRecord({ etag: 'W/"weak"' }));
    expect(v.weakEtag).toBe(true);
    expect(v.etag).toBe('W/"weak"');
    // The weak indicator is case-sensitive per RFC 9110, so a lowercase `w/` is
    // a server bug: not marked weak, and still sent back verbatim, which is
    // what an opaque validator asks for.
    const lowercase = validatorsFromHeaders(headerRecord({ etag: '  w/"weak"' }));
    expect(lowercase.weakEtag).toBe(false);
    expect(lowercase.etag).toBe('w/"weak"');
    expect(validatorsFromHeaders(headerRecord({ vary: 'Accept,,' })).vary).toEqual(['accept']);
  });

  it('is all-empty for a response that sends no validators, without throwing', () => {
    const v = validatorsFromHeaders(headerRecord({ 'last-modified': 'yesterday', etag: '   ' }));
    expect(v).toEqual({
      etag: null,
      lastModified: null,
      responseDate: null,
      cache: parseCacheControl(null),
      vary: [],
      weakEtag: false,
    });
    expect(hasValidators(v)).toBe(false);
  });
});

describe('conditionalHeaders', () => {
  const now = new Date('2025-11-09T12:00:00.000Z');
  const withLm = (lastModified: string | null, responseDate: string | null = '2025-11-09T12:00:00.000Z') => ({
    ...validatorsFromHeaders(
      headerRecord({ 'last-modified': lastModified ?? undefined, date: responseDate ?? undefined }),
    ),
    responseDate,
  });

  it('sends the ETag back verbatim, weak spelling included', () => {
    const etagOnly = validatorsFromHeaders(headerRecord({ etag: 'W/"a"' }));
    expect(conditionalHeaders(etagOnly, now)).toEqual({ 'If-None-Match': 'W/"a"' });
  });

  it('names the second before Last-Modified, because servers compare inclusively', () => {
    expect(conditionalHeaders(withLm('Sun, 09 Nov 2025 10:00:00 GMT'), now)).toEqual({
      'If-Modified-Since': 'Sun, 09 Nov 2025 09:59:59 GMT',
    });
  });

  it('sends a mildly skewed date (a CDN ahead of its own Date), clamped to the response', () => {
    const skewed = withLm('Sun, 09 Nov 2025 12:02:00 GMT');
    expect(conditionalHeaders(skewed, now)['If-Modified-Since']).toBe('Sun, 09 Nov 2025 12:01:59 GMT');
  });

  it('drops a Last-Modified that is far in the future, rather than asking for content that does not exist', () => {
    expect(conditionalHeaders(withLm('Sun, 09 Nov 2035 10:00:00 GMT'), now)).toEqual({});
  });

  it('sends both conditionals together, and nothing at all when there are no validators', () => {
    const both = validatorsFromHeaders(
      headerRecord({
        etag: '"x"',
        'last-modified': 'Sun, 09 Nov 2025 10:00:00 GMT',
        date: 'Sun, 09 Nov 2025 12:00:00 GMT',
      }),
    );
    expect(conditionalHeaders(both, now)).toEqual({
      'If-None-Match': '"x"',
      'If-Modified-Since': 'Sun, 09 Nov 2025 09:59:59 GMT',
    });
    expect(conditionalHeaders(validatorsFromHeaders(headerRecord({})), now)).toEqual({});
  });

  it('uses the wall clock as the reference when the response has no Date', () => {
    expect(conditionalHeaders(withLm('Sun, 09 Nov 2025 11:59:00 GMT', null), now)).toEqual({
      'If-Modified-Since': 'Sun, 09 Nov 2025 11:58:59 GMT',
    });
  });
});
