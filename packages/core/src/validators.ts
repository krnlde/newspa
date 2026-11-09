/**
 * The cheap inputs that decide whether there is any work to do: HTTP validators
 * (`ETag`, `Last-Modified`), cache freshness, `Retry-After`, and the two
 * conditionals we can send back.
 *
 * This is a pure module — headers come in through a `name → value | null`
 * accessor, never a `Headers`/`node:http` type — so it is browser-safe and the
 * parsing traps are testable without a network.
 *
 * Measured on this project's own sources (docs/decisions.md D-006, D-020): a
 * validator is an **optimization, never the truth**. BBC answers a valid
 * `If-None-Match` with `200` + the full 370 KB body, so a 304 is a strong
 * "nothing changed" and a 200 is simply "here is the body, parse it".
 */
import { formatHttpDate, parseHttpDate } from './httpDate.ts';

export interface CacheHints {
  readonly maxAgeSeconds: number | null;
  readonly sharedMaxAgeSeconds: number | null;
  readonly noStore: boolean;
  readonly noCache: boolean;
  readonly mustRevalidate: boolean;
  readonly private: boolean;
  readonly immutable: boolean;
}

const NO_HINTS: CacheHints = {
  maxAgeSeconds: null,
  sharedMaxAgeSeconds: null,
  noStore: false,
  noCache: false,
  mustRevalidate: false,
  private: false,
  immutable: false,
};

const directiveValue = (token: string, name: string): number | null => {
  const prefix = `${name}=`;
  if (!token.startsWith(prefix)) return null;
  const raw = token.slice(prefix.length).replaceAll('"', '');
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * `Cache-Control` for the freshness questions we care about. Quoted-list forms
 * (`no-cache="set-cookie"`) count as the directive: the response says it is not
 * a reliable fresh copy, which is the only thing we act on.
 */
export const parseCacheControl = (header: string | null | undefined): CacheHints => {
  const text = header?.trim();
  if (text === undefined || text.length === 0) return NO_HINTS;
  const tokens = text.split(',').map((token) => token.trim().toLowerCase());
  const maxAge = tokens.reduce<number | null>((acc, token) => acc ?? directiveValue(token, 'max-age'), null);
  const shared = tokens.reduce<number | null>((acc, token) => acc ?? directiveValue(token, 's-maxage'), null);
  return {
    maxAgeSeconds: maxAge,
    sharedMaxAgeSeconds: shared,
    noStore: tokens.includes('no-store'),
    noCache: tokens.some((token) => token === 'no-cache' || token.startsWith('no-cache=')),
    mustRevalidate: tokens.includes('must-revalidate'),
    private: tokens.includes('private'),
    immutable: tokens.includes('immutable'),
  };
};

/**
 * The freshness lifetime a poller can rely on: the shortest of the origin's
 * `max-age` and the CDN's `s-maxage`. A CDN that holds a page for 300 s means a
 * 60 s cadence cannot see news sooner, and this number is what makes that
 * visible as a health note instead of a mystery ("why is it always the same?").
 *
 * `no-store`/`no-cache` mean 0 (always revalidate). `null` = no hint at all.
 */
export const freshnessSeconds = (hints: CacheHints): number | null => {
  if (hints.noStore || hints.noCache) return 0;
  const known = [hints.maxAgeSeconds, hints.sharedMaxAgeSeconds].filter((n): n is number => n !== null);
  if (known.length === 0) return null;
  return Math.min(...known);
};

/**
 * `Retry-After` as a delay: delta-seconds (`Retry-After: 20`) or an HTTP date
 * (`Retry-After: Wed, 21 Oct 2015 07:28:00 GMT`). Non-negative, `null` when the
 * header is unusable — the caller then falls back to its own exponential
 * backoff, which is the honest answer to "the server told us nothing".
 */
export const retryAfterMs = (header: string | null | undefined, now: Date): number | null => {
  const text = header?.trim();
  if (text === undefined || text.length === 0) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = parseHttpDate(text);
  if (at === null) return null;
  return Math.max(0, Date.parse(at) - now.getTime());
};

export interface Validators {
  /** Sent back verbatim as `If-None-Match`. Strong (`"abc"`) or weak (`W/"abc"`). */
  readonly etag: string | null;
  /** Parsed to UTC ISO, `null` when absent or unparsable. */
  readonly lastModified: string | null;
  /** The response's own `Date`, for detecting a skewed `Last-Modified`. */
  readonly responseDate: string | null;
  readonly cache: CacheHints;
  /** `Vary` fields we do not send consistently can make a 304 serve a variant. */
  readonly vary: readonly string[];
  readonly weakEtag: boolean;
}

/**
 * Read the validators out of a response. The accessor shape (not `Headers`, not
 * `IncomingHttpHeaders`) keeps this browser-safe and unit-testable; a caller
 * adapts with `(name) => headers[name] ?? null`.
 */
export const validatorsFromHeaders = (get: (name: string) => string | null): Validators => {
  const etag = get('etag')?.trim() ?? null;
  const vary = (get('vary') ?? '')
    .split(',')
    .map((field) => field.trim().toLowerCase())
    .filter((field) => field.length > 0);
  return {
    etag: etag === null || etag.length === 0 ? null : etag,
    lastModified: parseHttpDate(get('last-modified')),
    responseDate: parseHttpDate(get('date')),
    cache: parseCacheControl(get('cache-control')),
    vary,
    weakEtag: etag?.startsWith('W/') ?? false,
  };
};

/**
 * `Last-Modified` is second-resolution and servers compare inclusively, so the
 * request must name the second **before** it (`If-Modified-Since: <lm - 1s>`)
 * or a skewed CDN answers 412 and the source looks broken. A value in the
 * future beyond `skewToleranceMs` (measured: CDN `Last-Modified` runs ahead of
 * `Date`) is dropped: we would be asking the server for content it has not
 * sent yet, and a 304 we cannot trust is worse than a parse.
 */
export const conditionalHeaders = (
  validators: Validators,
  now: Date,
  skewToleranceMs = 300_000,
): { readonly [name: string]: string } => {
  const out: { [name: string]: string } = {};
  if (validators.etag !== null) out['If-None-Match'] = validators.etag;
  if (validators.lastModified !== null) {
    const at = Date.parse(validators.lastModified);
    const reference = validators.responseDate === null ? now.getTime() : Date.parse(validators.responseDate);
    if (!Number.isNaN(at) && at <= reference + skewToleranceMs) {
      const sent = formatHttpDate(new Date(Math.floor(at / 1000) * 1000 - 1000).toISOString());
      if (sent !== null) out['If-Modified-Since'] = sent;
    }
  }
  return out;
};

/**
 * Which declared-change signals are worth reading out of a payload is the same
 * question as this one — has this source produced anything new? — but the
 * answer is per-format, so it lives in `signals.ts`.
 */
export const hasValidators = (validators: Validators): boolean =>
  validators.etag !== null || validators.lastModified !== null;
