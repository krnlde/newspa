import type { SourceSpec } from 'newspa-config';
import { freshnessSeconds, type Validators, validatorsFromHeaders } from 'newspa-core';
import { type Challenge, challengeOf } from './challenge.ts';
import { type DecodedBody, decodeBody } from './charset.ts';
import { bodyHashOf, declaredBytesOf, probeLimit, readCapped } from './transportBody.ts';
import { headerAccessor } from './transportHeaders.ts';
import {
  type BaselineState,
  failTransport,
  type TransportOk,
  type TransportResponseMeta,
  type TransportResult,
} from './transportTypes.ts';

/**
 * One response, one named outcome. The ladder (D-020) starts here: a `304` is
 * layer 0, a matching body hash is layer 1, and both are recorded as notes so a
 * fast path that never fires stays visible (rule 5).
 *
 * What this file does **not** do: it never decides whether an item is
 * interesting and it never suppresses one. The body is handed over decoded, with
 * its hash; layers 2 and 3 (`pageSignals`, the parse) are the pipeline's.
 */

export interface ResponseContext {
  readonly spec: SourceSpec;
  readonly baseline: BaselineState;
  readonly attempts: number;
  /** Notes from the request side: pinned headers that could not be sent, and so on. */
  readonly preNotes: readonly string[];
}

export interface Interpretation {
  readonly result: TransportResult;
  /** The response's `Retry-After`: for this one retry the server's number beats ours. */
  readonly retryAfter: string | null;
}

/** `Response#url` is empty for a `Response` constructed in a test; the request URL is the honest fallback. */
const finalUrl = (response: Response, requested: string): string =>
  response.url.length > 0 ? response.url : requested;

const ladderNotes = (baseline: BaselineState, sameBody: boolean): string[] => {
  if (sameBody)
    return ['layer 1 (body hash): the bytes match the stored baseline, so parse, diff and score are redundant'];
  if (baseline.bodyHash === null)
    return ['first poll for this source: layer 1 has no stored body hash to compare against'];
  return ['layer 1 (body hash) missed: the bytes differ from the stored baseline, so this is a full parse'];
};

/**
 * The cadence floor, surfaced as a note and **never** applied (docs/fetching.md:
 * a CDN holding a page for 300 s means a 60 s cadence cannot see news sooner;
 * the user's cadence is the user's).
 */
const cacheNotes = (validators: Validators, cadenceMinutes: number): string[] => {
  const freshness = freshnessSeconds(validators.cache);
  const notes: string[] = [];
  if (freshness === 0) {
    notes.push(
      'Cache-Control says no-store/no-cache: freshness 0 s, so a conditional GET is the only fast path this source offers',
    );
  } else if (freshness !== null && freshness > cadenceMinutes * 60) {
    notes.push(
      `cache freshness ${String(freshness)} s is longer than this source's ${String(cadenceMinutes)} min cadence: a poll inside that window cannot see news sooner (a health note, never applied to the cadence)`,
    );
  }
  if (validators.vary.length > 0) {
    notes.push(
      `the source varies on: ${validators.vary.join(', ')} — a stored validator is only reusable by a request that sends the same of those (this transport pins Accept-Language and sends no cookie)`,
    );
  }
  return notes;
};

const metaOf = (
  response: Response,
  context: ResponseContext,
  validators: Validators,
  notes: string[],
  challengeMarker: string | null,
): TransportResponseMeta => {
  const url = finalUrl(response, context.spec.url);
  const all = [...context.preNotes, ...notes];
  if (response.redirected) all.push(`redirected: ${context.spec.url} → ${url}`);
  return {
    status: response.status,
    statusText: response.statusText,
    url,
    redirected: response.redirected,
    etag: validators.etag,
    lastModified: validators.lastModified,
    responseDate: validators.responseDate,
    vary: validators.vary,
    cache: validators.cache,
    freshnessSeconds: freshnessSeconds(validators.cache),
    contentType: headerAccessor(response.headers)('content-type'),
    attempts: context.attempts,
    challenge: challengeMarker !== null,
    challengeMarker,
    notes: all,
  };
};

const wallNotes = (wall: Challenge | null, probeBytes: number, contentType: string | null): string[] => {
  const notes = [
    `content-type: ${contentType ?? 'absent'}`,
    `${String(probeBytes)} byte(s) of the body were read, far less than maxBytes, to look for a wall marker`,
  ];
  if (wall === null) return notes;
  notes.push(
    `the body is a challenge page: '${wall.marker}' from ${wall.source === 'core' ? "core's CHALLENGE_MARKERS" : 'the extended wall list'} — the health state is 'blocked', and the fix is render: true or a login`,
  );
  return notes;
};

/** A 4xx/5xx: read a probe of the body, because that is where a bot wall lives. */
const statusFailure = async (response: Response, context: ResponseContext): Promise<Interpretation> => {
  const get = headerAccessor(response.headers);
  const url = finalUrl(response, context.spec.url);
  const read = await readCapped(response.body, probeLimit(context.spec.maxBytes));
  const decoded = decodeBody(read.bytes, get('content-type'));
  const wall = challengeOf(decoded.text);
  const status = response.status;
  return {
    result: failTransport({
      reason: 'http-status',
      errorKind: 'http',
      detail: `HTTP ${String(status)}${response.statusText.length > 0 ? ` ${response.statusText}` : ''} from ${url}`,
      url,
      attempts: context.attempts,
      status,
      statusText: response.statusText,
      bytes: read.bytes.byteLength,
      redirected: response.redirected,
      contentType: get('content-type'),
      challenge: wall !== null,
      challengeMarker: wall?.marker ?? null,
      notes: [...context.preNotes, ...wallNotes(wall, read.bytes.byteLength, get('content-type'))],
    }),
    retryAfter: get('retry-after'),
  };
};

/** Layer 0: the conditional GET answered `304`, which proves there are no new bytes. */
const notModified = (response: Response, context: ResponseContext, validators: Validators): Interpretation => ({
  result: {
    ok: true,
    state: 'not-modified',
    bytes: 0,
    ...metaOf(
      response,
      context,
      validators,
      [
        'layer 0 (conditional GET): 304, no bytes, so parse, diff and score are all skipped',
        ...cacheNotes(validators, context.spec.cadenceMinutes),
      ],
      null,
    ),
  },
  retryAfter: null,
});

const overCap = (
  response: Response,
  context: ResponseContext,
  read: { readonly bytes: Uint8Array; readonly seen: number },
): TransportResult => {
  const get = headerAccessor(response.headers);
  const declared = declaredBytesOf(get('content-length'));
  return failTransport({
    reason: 'too-large',
    // `parse`, not `http`: `classifyFetch` projects the http kind through the
    // **status**, and the status here is a 2xx, so an http kind composes to
    // `unknown` — "Baselined, watching from now on" for a source that returned a
    // body the cap rejected. `parse` says what is true: no document arrived.
    errorKind: 'parse',
    detail: `the body crossed maxBytes (${String(read.seen)} > ${String(context.spec.maxBytes)} decoded bytes), so no text is returned`,
    url: finalUrl(response, context.spec.url),
    attempts: context.attempts,
    status: response.status,
    statusText: response.statusText,
    bytes: read.bytes.byteLength,
    redirected: response.redirected,
    contentType: get('content-type'),
    notes: [
      ...context.preNotes,
      'a truncated body is a silent zero: the parser would print the items that survived the cut, so the source needs a larger maxBytes (rule 5)',
      `the cap is on decoded bytes: content-length ${declared === null ? 'is absent' : `says ${String(declared)}`} and is the gzipped size (measured: 61508 for a 370436-byte body, D-006)`,
    ],
  });
};

/** A 2xx with no bytes: named, never a zero-item success. */
const emptyBody = (
  response: Response,
  context: ResponseContext,
  validators: Validators,
  read: { readonly bytes: Uint8Array },
  decoded: DecodedBody,
): TransportResult => {
  const get = headerAccessor(response.headers);
  const declared = declaredBytesOf(get('content-length'));
  return failTransport({
    reason: 'empty',
    // `parse` for the same reason as the cap: a 2xx with no bytes has no status
    // for `classifyFetch` to read, and `unknown` would print a benign note.
    errorKind: 'parse',
    detail: `HTTP ${String(response.status)} arrived with no bytes to parse`,
    url: finalUrl(response, context.spec.url),
    attempts: context.attempts,
    status: response.status,
    statusText: response.statusText,
    bytes: read.bytes.byteLength,
    redirected: response.redirected,
    contentType: get('content-type'),
    notes: [
      ...context.preNotes,
      ...decoded.notes,
      ...cacheNotes(validators, context.spec.cadenceMinutes),
      `content-length: ${declared === null ? 'absent' : String(declared)}`,
      'an empty body is a fetch problem, never "no news"',
    ],
  });
};

/** A 2xx. Read it, decode it, hash it, name what arrived. */
export const interpretResponse = async (response: Response, context: ResponseContext): Promise<Interpretation> => {
  const get = headerAccessor(response.headers);
  const validators = validatorsFromHeaders(get);
  if (response.status === 304) return notModified(response, context, validators);
  if (response.status >= 400) return await statusFailure(response, context);

  const read = await readCapped(response.body, context.spec.maxBytes);
  if (read.ok === false) return { result: overCap(response, context, read), retryAfter: null };

  const decoded = decodeBody(read.bytes, get('content-type'));
  if (decoded.text.trim().length === 0) {
    return { result: emptyBody(response, context, validators, read, decoded), retryAfter: null };
  }

  const hash = bodyHashOf(read.bytes);
  const sameBody = context.baseline.bodyHash === hash && context.baseline.bodyHash !== null;
  const wall = challengeOf(decoded.text);
  const notes = [
    ...decoded.notes,
    ...cacheNotes(validators, context.spec.cadenceMinutes),
    ...ladderNotes(context.baseline, sameBody),
  ];
  if (wall !== null) {
    notes.push(
      `the body carries a challenge marker '${wall.marker}': the parse will name this source 'blocked', not empty — render: true or a login is the fix`,
    );
  }
  const ok: TransportOk = {
    ok: true,
    state: 'ok',
    text: decoded.text,
    bytes: read.bytes.byteLength,
    charset: decoded.charset,
    declaredCharset: decoded.declaredCharset,
    bodyHash: hash,
    sameBody,
    ...metaOf(response, context, validators, notes, wall?.marker ?? null),
  };
  return { result: ok, retryAfter: get('retry-after') };
};
