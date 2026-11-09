import type { SourceSpec } from 'newspa-config';
import { classifyThrown } from './transportErrors.ts';
import { buildRequestHeaders } from './transportHeaders.ts';
import { interpretResponse } from './transportResponse.ts';
import {
  BACKOFF_MAX_MS,
  isRetryableFailure,
  isRetryableStatus,
  MAX_RETRIES,
  type RetryPlan,
  retryPlan,
} from './transportRetry.ts';
import { type BaselineState, failTransport, NO_BASELINE, type TransportResult } from './transportTypes.ts';

/**
 * The transport: one spec in, one named outcome out, and no database, no
 * scheduler, no parser. `packages/fetch` used to be parsers with no way to get
 * a payload, and `parsePayload`'s own docstring named the gap ("the transport
 * layer owns the charset").
 *
 * The whole policy comes from docs/fetching.md and D-020; the parts worth
 * reading before changing this file:
 *
 * - Conditional GET is an **optimization, never the truth** (measured: BBC
 *   answers a valid `If-None-Match` with `200` + the full 370 KB). So a `200`
 *   is simply "here is the body", and a `304` is the only fast answer.
 * - Nothing is ever `catch`ed into an empty result. Every failure carries a
 *   `reason`, an `errorKind`, the status if there was one, and notes.
 * - `render: true` is refused **by name**. A raw fetch of a JS-tier source
 *   answers a wall, and a wall parsed as a page is a quiet zero-item poll —
 *   D-007's whole argument.
 */

/** The injectable edge: a test supplies this and no network exists. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TransportDeps {
  readonly fetch?: FetchLike;
  readonly now?: () => Date;
  /** The retry wait. A test injects a recorder and no timer runs. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Cap on the **in-poll** backoff. The scheduler owns the long waits (`backoffMaxMs`). */
  readonly backoffMaxMs?: number;
}

interface ResolvedDeps {
  readonly fetch: FetchLike;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly backoffMaxMs: number;
}

const resolveDeps = (deps: TransportDeps): ResolvedDeps => ({
  fetch: deps.fetch ?? globalThis.fetch,
  now: deps.now ?? (() => new Date()),
  sleep:
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      })),
  backoffMaxMs: deps.backoffMaxMs ?? BACKOFF_MAX_MS,
});

/**
 * The sources this transport must not touch, named rather than attempted.
 *
 * `render: true` and a login profile are the renderer's (`playwright-core` +
 * Edge). Fetching them with a bare client produces a wall that parses as a
 * document, which is the silent zero rule 5 forbids. `attempts: 0` says the
 * request was never made, so a log line cannot be mistaken for a network fault.
 */
export const refusalOf = (spec: SourceSpec): TransportResult | null => {
  if (spec.render) {
    return failTransport({
      reason: 'render-required',
      errorKind: 'render',
      detail: `'${spec.id}' is render: true, so the Edge renderer owns it and a plain fetch is refused (D-007)`,
      url: spec.url,
      attempts: 0,
      notes: [
        'a raw fetch of a JS-tier source answers a wall, and a wall parsed as a page is a zero-item poll that looks like a quiet day',
      ],
    });
  }
  if (spec.profile || spec.cookieFile !== undefined) {
    const file = typeof spec.cookieFile === 'string' ? `'${spec.cookieFile}'` : 'a cookie file';
    const how = spec.profile ? 'profile: true (a persistent Edge profile)' : `cookieFile ${file}`;
    return failTransport({
      reason: 'credential-required',
      errorKind: 'render',
      detail: `'${spec.id}' needs authentication via ${how}, which the renderer owns and this transport never performs (rule 17)`,
      url: spec.url,
      attempts: 0,
      notes: ['a plain fetch has no cookie jar: it would answer the login wall, and the paper would print the wall'],
    });
  }
  let target: URL | null = null;
  try {
    target = new URL(spec.url);
  } catch (cause) {
    return failTransport({
      reason: 'invalid-url',
      errorKind: 'network',
      detail: `'${spec.id}' has a URL this runtime cannot parse: '${spec.url}' (${String(cause)})`,
      url: spec.url,
      attempts: 0,
      notes: ['the request was never made, so nothing about the source is known beyond its URL'],
    });
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return failTransport({
      reason: 'invalid-url',
      errorKind: 'network',
      detail: `'${spec.id}' has the scheme '${target.protocol}', and only http/https are polled`,
      url: spec.url,
      attempts: 0,
      notes: [
        'a file:/data:/ftp: URL is not a source: the paper is an index of the web, and a local read belongs in a config file, not a poll',
      ],
    });
  }
  return null;
};

const attemptNote = (attempt: number, what: string, plan: RetryPlan): string =>
  `attempt ${String(attempt)} of ${String(MAX_RETRIES + 1)}: ${what}; waited ${String(plan.ms)} ms (${plan.source}) before the next attempt`;

/**
 * Fetch one source.
 *
 * `baseline` is the stored conditional-GET state, supplied by the caller from
 * the DB (D-011): this module never opens a database. `deps` is the test seam:
 * no test in this package touches a network, and the clock is injected so the
 * `If-Modified-Since` skew rule and a `Retry-After` HTTP date are pinable.
 */
export const fetchSource = async (
  spec: SourceSpec,
  baseline: BaselineState = NO_BASELINE,
  deps: TransportDeps = {},
): Promise<TransportResult> => {
  const d = resolveDeps(deps);
  const refused = refusalOf(spec);
  if (refused !== null) return refused;

  /** Notes carried from the attempts that failed, so the final result shows the whole story. */
  const carried: string[] = [];
  let attempt = 0;

  for (;;) {
    attempt += 1;
    const built = buildRequestHeaders({ spec, baseline, now: d.now() });
    const signal = AbortSignal.timeout(spec.timeoutMs);
    try {
      const response = await d.fetch(spec.url, {
        method: 'GET',
        headers: built.headers,
        signal,
        redirect: 'follow',
        // Stated, because it is true: a plain fetch has no jar and no credentials
        // are in scope for this transport (rule 17).
        credentials: 'omit',
      });
      const seen = await interpretResponse(response, {
        spec,
        baseline,
        attempts: attempt,
        preNotes: [...carried, ...built.notes],
      });
      const result = seen.result;
      const retryable = result.state === 'failure' && isRetryableStatus(result.status);
      if (retryable && attempt <= MAX_RETRIES) {
        const plan = retryPlan(seen.retryAfter, attempt, d.now(), d.backoffMaxMs);
        carried.push(attemptNote(attempt, `HTTP ${String(result.status)} is retryable`, plan), ...plan.notes);
        await d.sleep(plan.ms);
        continue;
      }
      return result;
    } catch (cause) {
      const info = classifyThrown(cause, signal);
      if (isRetryableFailure(info.reason) && attempt <= MAX_RETRIES) {
        const plan = retryPlan(null, attempt, d.now(), d.backoffMaxMs);
        carried.push(attemptNote(attempt, info.detail, plan), ...plan.notes);
        await d.sleep(plan.ms);
        continue;
      }
      return failTransport({
        reason: info.reason,
        errorKind: info.errorKind,
        detail: `${info.detail} — no response from ${spec.url}`,
        url: spec.url,
        attempts: attempt,
        notes: [...carried, ...built.notes, ...info.notes],
      });
    }
  }
};
