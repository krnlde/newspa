import type { SourceSpec } from 'newspa-config';
import { type CacheHints, conditionalHeaders, type SourceKind, type Validators } from 'newspa-core';
import { type BaselineState, NO_CACHE_HINTS } from './transportTypes.ts';

/**
 * The request we send, and the accessor we read the response with.
 *
 * Two rules decide everything here:
 *
 * - **Every header is deterministic per source.** A stored `ETag` is only safe
 *   to replay if the request that produced it is reproducible — `Vary:
 *   Accept-Language, Cookie` means a 304 can serve a variant (docs/fetching.md).
 *   So `Accept` is fixed per `kind`, `Accept-Language` comes from the source,
 *   and no cookie is ever sent: a plain `fetch` has no jar, and rule 17 puts
 *   authentication in the renderer, not in a header.
 * - **The header never picks the parser** (D-006). We ask for the kind the
 *   source is configured for and then trust the bytes, because
 *   `old.reddit.com/r/worldnews/.rss` answers `200 text/html` while serving a feed.
 */

/** Declared, honest, and stable: a robot that says what it is, polled at the cadence the user set. */
export const DEFAULT_USER_AGENT =
  'newspa/0.1 (personal newspaper; runs on your own machine; polls each source at the cadence you set)';

/** One `Accept` per kind, fixed. Changing a kind's value invalidates that kind's stored validators. */
export const ACCEPT_BY_KIND: Readonly<Record<SourceKind, string>> = {
  rss: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
  html: 'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8',
  json: 'application/json, application/feed+json;q=0.9, application/xml;q=0.8, */*;q=0.5',
};

/**
 * `Headers` rejects these at set time (the fetch spec's forbidden header names).
 * A pin in `sources/*.json` that names one is a typo worth printing, not a
 * throw worth crashing the poll over — so it is skipped **and noted**.
 */
export const FORBIDDEN_HEADERS: readonly string[] = [
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

export interface BuiltHeaders {
  readonly headers: Headers;
  /** Pinned headers the fetch spec will not let us send, named so the health note can say so. */
  readonly notes: readonly string[];
}

/** The stored validators, in the shape core's `conditionalHeaders` reads. */
export const baselineValidators = (baseline: BaselineState, cache: CacheHints | null = null): Validators => ({
  etag: baseline.etag,
  lastModified: baseline.lastModified,
  // `responseDate` is optional on a first poll; core then measures skew against `now`.
  responseDate: baseline.responseDate ?? null,
  cache: cache ?? NO_CACHE_HINTS,
  vary: [],
  weakEtag: baseline.etag?.startsWith('W/') ?? false,
});

export interface RequestInput {
  readonly spec: SourceSpec;
  readonly baseline: BaselineState;
  readonly now: Date;
}

/**
 * Assemble the request headers. Order matters, and it is the priority:
 * defaults, then the source's pinned `headers` (a variant pin must be able to
 * override our `Accept`), then the conditionals (a stored validator is a policy,
 * not a default). `Headers#set` is case-insensitive, so a pin written
 * `accept-language` replaces our default instead of appending a second value —
 * two `Accept-Language` values is exactly the `Vary` trouble this file exists
 * to avoid.
 */
export const buildRequestHeaders = (input: RequestInput): BuiltHeaders => {
  const { spec, baseline, now } = input;
  const headers = new Headers();
  headers.set('accept', ACCEPT_BY_KIND[spec.kind]);
  headers.set('accept-language', spec.acceptLanguage);
  headers.set('user-agent', spec.userAgent ?? DEFAULT_USER_AGENT);
  const notes: string[] = [];
  for (const [name, value] of Object.entries(spec.headers)) {
    if (FORBIDDEN_HEADERS.includes(name.trim().toLowerCase())) {
      notes.push(
        `pinned header '${name}' is a forbidden header name: fetch will not send it, so it is not in the request`,
      );
      continue;
    }
    headers.set(name, value);
  }
  // `accept-encoding` is deliberately absent: undici adds gzip/br/zstd and
  // decompresses, which is why `maxBytes` is counted on decoded bytes
  // (measured: `content-length: 61508` for a 370 436-byte decoded body, D-006).
  for (const [name, value] of Object.entries(conditionalHeaders(baselineValidators(baseline), now))) {
    headers.set(name, value);
  }
  return { headers, notes };
};

/** The accessor shape core's `validatorsFromHeaders` wants, from a `Headers`. */
export const headerAccessor = (headers: Headers): ((name: string) => string | null) => {
  return (name: string) => {
    const value = headers.get(name);
    return value === null ? null : value;
  };
};
