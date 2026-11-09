import type { CacheHints, ErrorKind } from 'newspa-core';

/**
 * The transport's answer, in the same shape as `results.ts`: every zero case
 * gets a **name**, the thing that failed, and the numbers a health note needs.
 * `FetchOutcome` is core's health-classification **input** (it carries
 * `itemCount`, which only exists after a parse), so it is not this module's
 * output: the pipeline composes the two.
 *
 * Two discriminants, deliberately. `state` is the ladder's outcome (the
 * `outcome` column on a `snapshots` row), `ok` is the boolean `FetchOutcome`
 * wants. `not-modified` is a success with no body: a `304` proves no new bytes
 * exist, which is layer 0 of D-020, not an error.
 */

/**
 * The conditional-GET state from the last poll. The **caller** owns it (D-011:
 * the DB holds state, `sources/*.json` holds config), so this module never
 * reads a database.
 *
 * `lastModified` is UTC ISO as core's `parseHttpDate` writes it, never the raw
 * header: a validator we cannot re-format is a validator we cannot send.
 */
export interface BaselineState {
  readonly etag: string | null;
  readonly lastModified: string | null;
  /** The hash of the body the last poll stored, in the format `bodyHashOf` emits. */
  readonly bodyHash: string | null;
  /** The `Date` of the response that produced the validators: the skew reference for `If-Modified-Since`. */
  readonly responseDate?: string | null;
}

/** The state of a source that has never been polled. */
export const NO_BASELINE: BaselineState = {
  etag: null,
  lastModified: null,
  bodyHash: null,
  responseDate: null,
};

export const NO_CACHE_HINTS: CacheHints = {
  maxAgeSeconds: null,
  sharedMaxAgeSeconds: null,
  noStore: false,
  noCache: false,
  mustRevalidate: false,
  private: false,
  immutable: false,
};

/**
 * Why there is no body. Each one is a sentence the paper can print, and each
 * maps to exactly one `ErrorKind` in `transportErrors.ts` — never a collapsed
 * "network error" that hides a cert problem behind a DNS one.
 */
export type TransportFailureReason =
  /** `render: true`: the JS tier owns this source, and a raw fetch of it is a silent zero. */
  | 'render-required'
  /** `profile: true` / `cookieFile`: authenticating is the renderer's job, never a plain fetch's (rule 17). */
  | 'credential-required'
  /** The URL is not fetchable (no scheme, unparseable). */
  | 'invalid-url'
  /** `AbortSignal.timeout` fired. */
  | 'timeout'
  /** Someone else's `AbortSignal` fired (shutdown); not a source fault. */
  | 'aborted'
  /** A certificate/TLS failure, named by its cause code. */
  | 'tls'
  /** DNS, connect, reset: the request never got an answer. */
  | 'network'
  /** The server answered 4xx/5xx. `status` is the fact. */
  | 'http-status'
  /** The body crossed `maxBytes`. The text is **never** returned truncated (rule 5). */
  | 'too-large'
  /** A 2xx with no bytes, e.g. `204`. A fetch problem, never "no news". */
  | 'empty'
  /** Anything else the transport itself got wrong. */
  | 'transport';

/** The response facts every member of the union carries, so a caller never narrows to log. */
export interface TransportResponseMeta {
  /** `0` when no response arrived at all (timeout, DNS, TLS). */
  readonly status: number;
  readonly statusText: string;
  /** The URL after following redirects; equals `spec.url` when nothing moved. */
  readonly url: string;
  /** True when the transport followed at least one redirect. */
  readonly redirected: boolean;
  /** Send this back verbatim as `If-None-Match` (strong `"` or weak `W/`, as received). */
  readonly etag: string | null;
  /** Parsed to UTC ISO by core, `null` when absent or unparsable. */
  readonly lastModified: string | null;
  /** The response's own `Date`, for the skew check. Store it with `lastModified`. */
  readonly responseDate: string | null;
  readonly vary: readonly string[];
  readonly cache: CacheHints;
  /** `min(max-age, s-maxage)`, `0` for `no-store`/`no-cache`, `null` with no hint at all. */
  readonly freshnessSeconds: number | null;
  readonly contentType: string | null;
  /** Request count: `1` is a clean single request, `3` is two retries. */
  readonly attempts: number;
  /** A bot wall was seen in the body (core's marker vocabulary + `challenge.ts`'s extras). */
  readonly challenge: boolean;
  /** The marker that matched, for the health note. */
  readonly challengeMarker: string | null;
  readonly notes: readonly string[];
}

/** A body arrived. What the ladder does with it is the pipeline's decision. */
export interface TransportOk extends TransportResponseMeta {
  readonly ok: true;
  readonly state: 'ok';
  /** The **decoded** body; `parsePayload` is documented to receive decoded text. */
  readonly text: string;
  /** Decoded bytes read — the number `maxBytes` caps (D-006: `content-length` is the gzipped size). */
  readonly bytes: number;
  /** The label the bytes were decoded with. */
  readonly charset: string;
  /** The encoding the XML prolog declared, when it declared one. Reported, never obeyed. */
  readonly declaredCharset: string | null;
  /** Layer 1's key. Format: `sha256:<hex>`. */
  readonly bodyHash: string;
  /** `bodyHash === baseline.bodyHash`: the strong "nothing changed", no parse needed. */
  readonly sameBody: boolean;
}

/** Layer 0: the conditional GET answered `304`, so there are no new bytes. */
export interface TransportNotModified extends TransportResponseMeta {
  readonly ok: true;
  readonly state: 'not-modified';
  readonly bytes: 0;
}

export interface TransportFailure extends TransportResponseMeta {
  readonly ok: false;
  readonly state: 'failure';
  readonly reason: TransportFailureReason;
  /** Core's classification input, so `classifyFetch` needs no mapping table. */
  readonly errorKind: ErrorKind;
  /** One sentence, the first fault that explains the poll. */
  readonly detail: string;
  /** Bytes read before giving up (`too-large`), 0 when nothing was read. */
  readonly bytes: number;
}

export type TransportResult = TransportOk | TransportNotModified | TransportFailure;

export interface FailureInput {
  readonly reason: TransportFailureReason;
  readonly errorKind: ErrorKind;
  readonly detail: string;
  readonly url: string;
  readonly attempts: number;
  readonly status?: number;
  readonly statusText?: string;
  readonly bytes?: number;
  readonly notes?: readonly string[];
  readonly etag?: string | null;
  readonly lastModified?: string | null;
  readonly responseDate?: string | null;
  readonly vary?: readonly string[];
  readonly cache?: CacheHints | null;
  readonly freshnessSeconds?: number | null;
  readonly contentType?: string | null;
  readonly redirected?: boolean;
  readonly challenge?: boolean;
  readonly challengeMarker?: string | null;
}

/** Build a failure with every meta field present, so no caller forgets one. */
export const failTransport = (input: FailureInput): TransportFailure => ({
  ok: false,
  state: 'failure',
  reason: input.reason,
  errorKind: input.errorKind,
  detail: input.detail,
  status: input.status ?? 0,
  statusText: input.statusText ?? '',
  url: input.url,
  redirected: input.redirected ?? false,
  bytes: input.bytes ?? 0,
  etag: input.etag ?? null,
  lastModified: input.lastModified ?? null,
  responseDate: input.responseDate ?? null,
  vary: input.vary ?? [],
  cache: input.cache ?? NO_CACHE_HINTS,
  freshnessSeconds: input.freshnessSeconds ?? null,
  contentType: input.contentType ?? null,
  attempts: input.attempts,
  challenge: input.challenge ?? false,
  challengeMarker: input.challengeMarker ?? null,
  notes: input.notes ?? [],
});

/** The result in one line, for the log and for test failure messages. */
export const describeTransport = (result: TransportResult): string => {
  const at = `HTTP ${String(result.status)} of ${result.url} in ${String(result.attempts)} attempt(s)`;
  if (result.state === 'ok') return `ok: ${String(result.bytes)} bytes as ${result.charset}, ${at}`;
  if (result.state === 'not-modified') return `not-modified: ${at}`;
  return `failure/${result.reason} (${result.errorKind}): ${result.detail} :: ${result.notes.join(' | ')}`;
};
