import { describe, expect, it } from 'vitest';
import {
  ACCEPT_BY_KIND,
  baselineValidators,
  buildRequestHeaders,
  DEFAULT_USER_AGENT,
  FORBIDDEN_HEADERS,
  headerAccessor,
} from '../src/transportHeaders.ts';
import {
  BACKOFF_BASE_MS,
  isRetryableFailure,
  isRetryableStatus,
  MAX_RETRIES,
  RETRYABLE_STATUS,
  retryPlan,
} from '../src/transportRetry.ts';
import { NO_BASELINE, NO_CACHE_HINTS } from '../src/transportTypes.ts';
import { htmlSource, jsonSource, rssSource } from './support.ts';
import { NOW_ISO } from './transportSupport.ts';

/**
 * The request builder and the retry plan, apart from a response.
 *
 * Two rules decide this arithmetic, and both are the kind that is easy to get
 * subtly wrong: a stored validator is only replayable by an identical request
 * (docs/fetching.md's `Vary` row), and a `Retry-After` is better information
 * than our own backoff — capped, because a poll does not suspend for a day.
 */

const now = new Date(NOW_ISO);

describe('the retry plan', () => {
  it('the list retried by status, and the list retried by reason', () => {
    expect(RETRYABLE_STATUS.map(isRetryableStatus)).toEqual([true, true, true, true, true, true, true]);
    for (const status of [200, 301, 400, 403, 404, 410, 451]) expect(isRetryableStatus(status)).toBe(false);
    expect(isRetryableFailure('timeout')).toBe(true);
    expect(isRetryableFailure('network')).toBe(true);
    expect(isRetryableFailure('tls')).toBe(false);
    expect(isRetryableFailure('http-status')).toBe(false);
    expect(isRetryableFailure('too-large')).toBe(false);
    expect(MAX_RETRIES).toBe(2);
  });

  it('the backoff is exponential from the base, and the base is small', () => {
    expect(retryPlan(null, 1, now).ms).toBe(BACKOFF_BASE_MS);
    expect(retryPlan(null, 2, now).ms).toBe(BACKOFF_BASE_MS * 2);
    expect(retryPlan(null, 3, now, 1_200).ms).toBe(1_200);
    expect(retryPlan(null, 1, now).source).toBe('backoff');
    expect(retryPlan(null, 1, now).notes.join(' ')).toContain('attempt 2 of 3');
  });

  it('a Retry-After in every readable form, and one that is not readable', () => {
    expect(retryPlan('3', 1, now)).toEqual({
      ms: 3_000,
      source: 'retry-after',
      notes: ["Retry-After '3' → 3000 ms replaces the exponential backoff for this retry"],
    });
    expect(retryPlan('0', 1, now).ms).toBe(0);
    expect(retryPlan('Mon, 09 Nov 2026 10:00:10 GMT', 1, now, 20_000).ms).toBe(10_000);
    expect(retryPlan('Mon, 09 Nov 2026 10:00:10 GMT', 1, now).ms).toBe(4_000);
    expect(retryPlan('Mon, 09 Nov 2026 09:00:00 GMT', 1, now).ms).toBe(0);
    expect(retryPlan('300', 1, now, 5_000).ms).toBe(5_000);
    expect(retryPlan('300', 1, now, 5_000).notes.join(' ')).toContain('the scheduler');
    expect(retryPlan('soon', 1, now).source).toBe('backoff');
  });
});

describe('the request headers', () => {
  it('the Accept is per kind, and each kind asks for what it is', () => {
    expect(ACCEPT_BY_KIND.rss).toContain('application/rss+xml');
    expect(ACCEPT_BY_KIND.html).toContain('text/html');
    expect(ACCEPT_BY_KIND.json).toContain('application/json');
    expect(FORBIDDEN_HEADERS).toContain('content-length');
    expect(DEFAULT_USER_AGENT).toContain('newspa');
  });

  it('defaults, then the pin, then the conditionals, in that order of priority', () => {
    const built = buildRequestHeaders({
      spec: rssSource({ headers: { accept: 'application/atom+xml', expect: '100-continue' } }),
      baseline: { etag: '"v7"', lastModified: null, bodyHash: null },
      now,
    });
    expect(built.headers.get('accept')).toBe('application/atom+xml');
    expect(built.headers.get('if-none-match')).toBe('"v7"');
    expect(built.headers.get('if-modified-since')).toBeNull();
    expect(built.notes.join(' ')).toContain("pinned header 'expect' is a forbidden header name");
  });

  it('an html source asks for html and a json source for json, with no conditionals on a first poll', () => {
    const html = buildRequestHeaders({ spec: htmlSource('.card'), baseline: NO_BASELINE, now });
    expect(html.headers.get('accept')).toContain('text/html');
    expect(html.notes).toEqual([]);
    const json = buildRequestHeaders({ spec: jsonSource('hits'), baseline: NO_BASELINE, now });
    expect(json.headers.get('accept')).toContain('application/json');
    expect(json.headers.get('if-none-match')).toBeNull();
  });

  it('the stored validators become the shape core reads, with the weak indicator case-sensitive', () => {
    expect(baselineValidators({ etag: 'W/"a"', lastModified: null, bodyHash: null }).weakEtag).toBe(true);
    expect(baselineValidators({ etag: 'w/"a"', lastModified: null, bodyHash: null }).weakEtag).toBe(false);
    expect(baselineValidators(NO_BASELINE).responseDate).toBeNull();
    expect(baselineValidators(NO_BASELINE).cache).toEqual(NO_CACHE_HINTS);
    expect(
      baselineValidators({ etag: null, lastModified: null, bodyHash: null, responseDate: NOW_ISO }).responseDate,
    ).toBe(NOW_ISO);
  });

  it('the header accessor answers null for a header that is not there, which is what core wants', () => {
    const get = headerAccessor(new Headers({ etag: '"v7"' }));
    expect(get('etag')).toBe('"v7"');
    expect(get('ETag')).toBe('"v7"');
    expect(get('retry-after')).toBeNull();
  });
});
