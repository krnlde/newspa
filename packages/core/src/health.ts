import type { ErrorKind, FetchOutcome, HealthState } from './types.ts';

/**
 * Health classification is the difference between a tool you trust and one you
 * stop reading. A source that returns a Cloudflare wall (measured: apnews.com
 * → 403, 5 KB, "Just a moment…") must never look like "no news today".
 */

export const CHALLENGE_MARKERS: readonly string[] = [
  'just a moment',
  'attention required',
  'verify you are a human',
  'checking your browser',
  'enable javascript',
  'cf-browser-verification',
  'captcha',
  'access denied',
  'request blocked',
  'subscribe to continue',
  'sign in to read',
  'javascript is required',
  'access to this page has been denied',
];

export const looksLikeChallenge = (body: string): boolean => {
  const probe = body.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => probe.includes(marker));
};

export const describeState = (state: HealthState): string => {
  switch (state) {
    case 'ok':
      return 'Watching';
    case 'blocked':
      return 'Blocked — needs the JS tier or a login';
    case 'no-matches':
      return 'Selector matched nothing — pick it again';
    case 'restructured':
      return 'Page changed shape — new items suppressed, baseline kept';
    case 'error':
      return 'Fetch error';
    case 'stale':
      return 'Stale — last success is too old';
    case 'unknown':
      return 'Baselined, watching from now on';
  }
};

const BLOCKING_STATUS = new Set([401, 403, 407, 451]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export const classifyFetch = (outcome: FetchOutcome): HealthState => {
  const { status, ok, itemCount, expectedMatchCount, challenge, errorKind } = outcome;

  if (errorKind === 'kind-mismatch' || errorKind === 'parse') return 'error';
  if (errorKind === 'timeout' || errorKind === 'network' || errorKind === 'tls' || errorKind === 'render') {
    return 'error';
  }
  if (challenge || BLOCKING_STATUS.has(status)) return 'blocked';
  if (!ok && RETRYABLE_STATUS.has(status)) return 'error';
  if (!ok && status >= 400) return 'error';

  const expected = expectedMatchCount;
  if (itemCount === 0) return expected !== null && expected > 0 ? 'no-matches' : 'unknown';
  if (expected !== null && expected > 0 && itemCount / expected < 0.6) return 'restructured';
  return ok ? 'ok' : 'error';
};

/**
 * Burst breaker. A site redesigns overnight, every item key is new, and the
 * paper prints 80 articles of garbage. Above `newRatioThreshold` of the seen
 * items being new, publish "source restructured" and keep the old baseline
 * instead of poisoning the paper and the user's trust.
 */
export const detectBurst = (newKeys: number, seenKeys: number, observedNow: number, threshold: number): boolean => {
  if (seenKeys === 0) return false;
  if (observedNow > seenKeys * 2.5) return true;
  return newKeys / Math.max(1, observedNow) > threshold;
};

/** A source that has never succeeded in `maxAgeMinutes` is stale, not quiet. */
export const isStale = (lastSuccessAt: string | null, now: Date, maxAgeMinutes: number): boolean => {
  if (lastSuccessAt === null) return false;
  const at = Date.parse(lastSuccessAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > maxAgeMinutes * 60_000;
};

export const errorKindOf = (cause: unknown): ErrorKind => {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') return 'timeout';
  if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) return 'timeout';
  const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  if (message.includes('certificate') || message.includes('tls') || message.includes('ssl')) return 'tls';
  if (message.includes('enotfound') || message.includes('econnrefused') || message.includes('fetch failed'))
    return 'network';
  return 'network';
};
