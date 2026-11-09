import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_MARKERS,
  classifyFetch,
  describeState,
  detectBurst,
  errorKindOf,
  isStale,
  looksLikeChallenge,
} from '../src/health.ts';
import type { ErrorKind, FetchOutcome } from '../src/types.ts';

const NOW = new Date(2026, 10, 9, 12, 0, 0);

const anOutcome = (over: Partial<FetchOutcome> = {}): FetchOutcome => ({
  status: 200,
  ok: true,
  itemCount: 5,
  expectedMatchCount: null,
  challenge: false,
  errorKind: null,
  ...over,
});

describe('classifyFetch', () => {
  it('calls a shape mismatch an error, whatever the status said', () => {
    const kinds: readonly (ErrorKind | null)[] = ['kind-mismatch', 'parse', 'timeout', 'network', 'tls', 'render'];
    for (const errorKind of kinds) {
      const outcome = anOutcome({ errorKind, ok: false, status: 0 });
      expect(classifyFetch(outcome), String(errorKind)).toBe('error');
    }
  });

  it('calls a challenge wall blocked, never "no news"', () => {
    expect(classifyFetch(anOutcome({ challenge: true, ok: false, status: 403, itemCount: 0 }))).toBe('blocked');
    for (const status of [401, 403, 407, 451]) {
      expect(classifyFetch(anOutcome({ status, ok: false, itemCount: 0 })), String(status)).toBe('blocked');
    }
  });

  it('sees a retryable status as an error, and any other 4xx as an error too', () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(classifyFetch(anOutcome({ status, ok: false, itemCount: 0 })), String(status)).toBe('error');
    }
    expect(classifyFetch(anOutcome({ status: 404, ok: false, itemCount: 0 }))).toBe('error');
    expect(classifyFetch(anOutcome({ status: 200, ok: false, itemCount: 5 }))).toBe('error');
  });

  it('reports a selector that matched nothing as no-matches, once the source declares a count', () => {
    expect(classifyFetch(anOutcome({ itemCount: 0 }))).toBe('unknown');
    expect(classifyFetch(anOutcome({ itemCount: 0, expectedMatchCount: 0 }))).toBe('unknown');
    expect(classifyFetch(anOutcome({ itemCount: 0, expectedMatchCount: 12 }))).toBe('no-matches');
  });

  it('calls a collapsed item count restructured, at 60% of baseline', () => {
    expect(classifyFetch(anOutcome({ itemCount: 5, expectedMatchCount: 10 }))).toBe('restructured');
    expect(classifyFetch(anOutcome({ itemCount: 6, expectedMatchCount: 10 }))).toBe('ok');
    expect(classifyFetch(anOutcome({ itemCount: 1, expectedMatchCount: 1 }))).toBe('ok');
    expect(classifyFetch(anOutcome({ itemCount: 5, expectedMatchCount: null }))).toBe('ok');
  });

  it('is ok only when the fetch was ok', () => {
    expect(classifyFetch(anOutcome({ itemCount: 9, expectedMatchCount: 9 }))).toBe('ok');
    expect(classifyFetch(anOutcome({ itemCount: 9, expectedMatchCount: 9, ok: false }))).toBe('error');
  });
});

describe('describeState', () => {
  it('explains all seven states to a reader', () => {
    expect(describeState('ok')).toBe('Watching');
    expect(describeState('blocked')).toBe('Blocked — needs the JS tier or a login');
    expect(describeState('no-matches')).toBe('Selector matched nothing — pick it again');
    expect(describeState('restructured')).toBe('Page changed shape — new items suppressed, baseline kept');
    expect(describeState('error')).toBe('Fetch error');
    expect(describeState('stale')).toBe('Stale — last success is too old');
    expect(describeState('unknown')).toBe('Baselined, watching from now on');
  });
});

describe('detectBurst', () => {
  it('says nothing on a first baseline, when nothing has been seen yet', () => {
    expect(detectBurst(100, 0, 1000, 0.5)).toBe(false);
  });

  it('fires when the page is far bigger than the baseline', () => {
    expect(detectBurst(5, 10, 100, 0.5)).toBe(true);
    expect(detectBurst(25, 10, 26, 0.99)).toBe(true);
  });

  it('fires on the new-item ratio, and not at the boundary', () => {
    expect(detectBurst(6, 20, 10, 0.5)).toBe(true);
    expect(detectBurst(5, 20, 10, 0.5)).toBe(false);
    expect(detectBurst(0, 10, 0, 0.5)).toBe(false);
  });
});

describe('isStale', () => {
  it('is false for a source that has never succeeded, true for a timestamp it cannot read', () => {
    expect(isStale(null, NOW, 60)).toBe(false);
    expect(isStale('garbage', NOW, 60)).toBe(true);
  });

  it('is false inside the window, true beyond it, and not on the boundary', () => {
    expect(isStale(new Date(NOW.getTime() - 30 * 60_000).toISOString(), NOW, 60)).toBe(false);
    expect(isStale(new Date(NOW.getTime() - 90 * 60_000).toISOString(), NOW, 60)).toBe(true);
    expect(isStale(new Date(NOW.getTime() - 60 * 60_000).toISOString(), NOW, 60)).toBe(false);
  });
});

describe('looksLikeChallenge', () => {
  it('finds every marker it declares, in any case', () => {
    for (const marker of CHALLENGE_MARKERS) {
      expect(looksLikeChallenge(`Please note: ${marker.toUpperCase()} while we check.`), marker).toBe(true);
    }
    expect(looksLikeChallenge('The council voted on the budget today.')).toBe(false);
  });

  it('only probes the first 4000 characters, where a wall always is', () => {
    expect(looksLikeChallenge(`${'x'.repeat(3990)}CAPTCHA here`)).toBe(true);
    expect(looksLikeChallenge(`${'x'.repeat(4000)}just a moment`)).toBe(false);
  });
});

describe('errorKindOf', () => {
  it('calls an AbortSignal timeout a timeout', () => {
    expect(errorKindOf(new DOMException('timed out', 'TimeoutError'))).toBe('timeout');
    expect(errorKindOf(new DOMException('aborted', 'AbortError'))).toBe('timeout');
    expect(errorKindOf(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe('timeout');
    expect(errorKindOf(Object.assign(new Error('late'), { name: 'TimeoutError' }))).toBe('timeout');
  });

  it('separates tls from the rest of the network failures', () => {
    expect(errorKindOf(new Error('unable to verify the first certificate'))).toBe('tls');
    expect(errorKindOf(new Error('TLS handshake failed'))).toBe('tls');
    expect(errorKindOf(new Error('ERR_SSL_WRONG_CERT_TYPE'))).toBe('tls');
    expect(errorKindOf(new Error('getaddrinfo ENOTFOUND example.com'))).toBe('network');
    expect(errorKindOf(new Error('connect ECONNREFUSED 127.0.0.1:8080'))).toBe('network');
    expect(errorKindOf(new Error('fetch failed'))).toBe('network');
    expect(errorKindOf(new Error('socket hang up'))).toBe('network');
  });

  it('falls back to network for anything else, including non-errors', () => {
    expect(errorKindOf('proxy refused')).toBe('network');
    expect(errorKindOf({ toString: () => 'weird 418' })).toBe('network');
  });
});
