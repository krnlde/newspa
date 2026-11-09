import { backoffMs, retryAfterMs } from 'newspa-core';
import type { TransportFailureReason } from './transportTypes.ts';

/**
 * The retry policy. `core`'s `RETRYABLE_STATUS` (`core/src/health.ts`) is the
 * list, and it is **not exported**, so this file mirrors it and
 * `test/transportRetry.test.ts` pins the two against each other through
 * `classifyFetch` — the coupling is a test, not a comment.
 *
 * The budget is deliberately small: **two retries**. This is a personal tool
 * polling a stranger's web server; hammering a site that answered `503` is how
 * a reader's IP gets rate-limited, and the scheduler owns the long backoff
 * (`backoffBaseMs`/`backoffMaxMs`, `maxFailuresBeforePause`). A retry here buys
 * a transient blip, nothing more, and `attempts` in the result makes the cost
 * visible in the log.
 */
export const RETRYABLE_STATUS: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

/** Retries after the first request. So a poll is at most three requests. */
export const MAX_RETRIES = 2;

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 4_000;

export const isRetryableStatus = (status: number): boolean => RETRYABLE_STATUS.includes(status);

/**
 * A `timeout`/`network` failure is retried: both are transient in the measured
 * cases (121–648 ms for a real fetch on this machine, and a transient DNS/reset
 * blip is the reason the pipeline exists). A `tls` failure is **not**: a cert
 * problem is deterministic, and retrying it is three identical failures and a
 * slower report.
 */
export const isRetryableFailure = (reason: TransportFailureReason): boolean =>
  reason === 'timeout' || reason === 'network';

export interface RetryPlan {
  /** Milliseconds to wait before the next attempt. */
  readonly ms: number;
  /** Where the number came from, because a `Retry-After` is the server's instruction. */
  readonly source: 'retry-after' | 'backoff';
  readonly notes: readonly string[];
}

/**
 * The delay before attempt `failures + 1`. A `Retry-After` **replaces** the
 * exponential backoff (the server's number is better information than ours) and
 * is clamped non-negative and by `maxMs` — a `Retry-After: 86400` must not
 * suspend a poll, and the scheduler's own backoff is what keeps the source quiet
 * for a day.
 */
export const retryPlan = (
  retryAfter: string | null,
  failures: number,
  now: Date,
  maxMs: number = BACKOFF_MAX_MS,
): RetryPlan => {
  const asked = retryAfterMs(retryAfter, now);
  if (asked !== null) {
    // core's `retryAfterMs` is already non-negative: digits are `^\d+$`, and an
    // HTTP date is `max(0, at - now)`.
    const notes = [`Retry-After '${retryAfter}' → ${String(asked)} ms replaces the exponential backoff for this retry`];
    if (asked > maxMs) {
      notes.push(
        `Retry-After asked for ${String(asked)} ms; this transport's cap is ${String(maxMs)} ms, so the scheduler's backoff owns the rest`,
      );
    }
    return { ms: Math.min(maxMs, asked), source: 'retry-after', notes };
  }
  const ms = backoffMs(failures, BACKOFF_BASE_MS, maxMs);
  return {
    ms,
    source: 'backoff',
    notes: [
      `attempt ${String(failures + 1)} of ${String(MAX_RETRIES + 1)} after ${String(failures)} failure(s); backoff ${String(ms)} ms`,
    ],
  };
};
