/**
 * The ladder's state (docs/fetching.md, D-020): `304` → body hash → declared
 * timestamp → full parse, with its two counters.
 *
 * Two rules decide everything here.
 *
 * **A cheap signal may skip work, never suppress an item.** So the state is
 * written from what a poll actually read. A `304` carries the response
 * validators and *no body*: the body-derived fields (`body_hash`,
 * `declared_modified_at`, `generator`, `ttl`, `no-cache-meta`) stay exactly as
 * they were, because the body that produced them is still what is on the server.
 * A poll that read the body refreshes all of them.
 *
 * **`body_hash` is the hash of the body the item set was built from.** That is
 * why a failed parse writes nothing: storing the hash of a body the parser
 * refused would make the next identical poll answer `same-body`, skip the parse
 * that has to happen, and the source would sit at zero items with a healthy
 * ladder. Same reason a transport failure writes nothing — the baseline describes
 * the last body we have items for.
 */
import type { PageSignals } from 'newspa-core';
import { emptyValidatorState, type SnapshotOutcome, type ValidatorRead, type ValidatorState } from 'newspa-db';
import { type BaselineState, NO_BASELINE, type TransportOk, type TransportResponseMeta } from 'newspa-fetch';

/** The `If-None-Match` / `If-Modified-Since` inputs for the next request. */
export const baselineOf = (read: ValidatorRead): BaselineState =>
  read.ok === true
    ? {
        etag: read.state.etag,
        lastModified: read.state.lastModified,
        bodyHash: read.state.bodyHash,
        responseDate: read.state.responseDate,
      }
    : NO_BASELINE;

/** The stored state, or a clean one for a source that has never been polled. */
export const previousStateOf = (read: ValidatorRead): ValidatorState =>
  read.ok === true ? read.state : emptyValidatorState();

/** `W/"…"`, the shape `If-None-Match` has to be replayed with (RFC 9110 §6.4). */
const isWeakEtag = (etag: string | null): boolean => etag !== null && /^\s*W\//u.test(etag);

/**
 * The response's own validators. A `304` repeats them, which is why this reads
 * the shared meta and not `TransportOk`: the ladder's layer 0 is the only thing
 * a `304` is allowed to refresh.
 */
const headerFieldsOf = (meta: TransportResponseMeta) => ({
  etag: meta.etag,
  lastModified: meta.lastModified,
  responseDate: meta.responseDate,
  cache: meta.cache,
  vary: meta.vary,
  weakEtag: isWeakEtag(meta.etag),
  freshnessSeconds: meta.freshnessSeconds,
});

/**
 * The state after a poll that **read the body** — the parse, the `same-body`
 * check and the declared-timestamp check all read it. Every field is fresh,
 * including the body hash and the payload's own signals; the counters are not
 * touched here (`countFastPath` owns them, so one poll cannot move them twice).
 */
export const stateFromBody = (res: TransportOk, signals: PageSignals, previous: ValidatorState): ValidatorState => ({
  ...headerFieldsOf(res),
  bodyHash: res.bodyHash,
  declaredModifiedAt: signals.declaredModifiedAt,
  generator: signals.generator,
  ttlMinutes: signals.ttlMinutes,
  noCacheMeta: signals.noCacheMeta,
  fastPathHits: previous.fastPathHits,
  fastPathMisses: previous.fastPathMisses,
});

/**
 * The state after a `304`: the response's validators, and nothing invented about
 * the body.
 *
 * The three validator strings follow RFC 9110 §15.4.5: a `304` **updates** the
 * stored response, and a field the response does not send is not a field to
 * forget. Measured against a sloppy CDN (a `304` with no `Last-Modified`),
 * blanking them costs the source its fast path on every later poll — a safe
 * degradation, and one the counters show, but not the one the spec asks for.
 * The cache hints, `Vary` and the freshness figure stay as stored for the same
 * reason: a `304` carries the minimum needed to validate, not the full header
 * block of the stored entry.
 */
export const stateFromNotModified = (meta: TransportResponseMeta, previous: ValidatorState): ValidatorState => ({
  etag: meta.etag ?? previous.etag,
  lastModified: meta.lastModified ?? previous.lastModified,
  responseDate: meta.responseDate ?? previous.responseDate,
  cache: previous.cache,
  vary: meta.vary.length > 0 ? meta.vary : previous.vary,
  weakEtag: meta.etag === null ? previous.weakEtag : isWeakEtag(meta.etag),
  freshnessSeconds: meta.freshnessSeconds ?? previous.freshnessSeconds,
  bodyHash: previous.bodyHash,
  declaredModifiedAt: previous.declaredModifiedAt,
  generator: previous.generator,
  ttlMinutes: previous.ttlMinutes,
  noCacheMeta: previous.noCacheMeta,
  fastPathHits: previous.fastPathHits,
  fastPathMisses: previous.fastPathMisses,
});

/**
 * Layer 2. The payload declares its own newest timestamp (core's `pageSignals`:
 * a feed's `lastBuildDate`, a page's `article:modified_time`, JSON's
 * `dateModified`). Both sides must have one: `null` never matches, because "no
 * declared timestamp" is not evidence that nothing moved.
 */
export const declaredUnchanged = (previous: ValidatorState, signals: PageSignals): boolean =>
  previous.declaredModifiedAt !== null &&
  signals.declaredModifiedAt !== null &&
  signals.declaredModifiedAt === previous.declaredModifiedAt;

/** The ladder's verdict for a poll that read the body: the slow path, or the layer that skipped it. */
export type LadderOutcome = 'changed' | 'same-body' | 'declared-unchanged';

export const outcomeOf = (res: TransportOk, signals: PageSignals, previous: ValidatorState): LadderOutcome => {
  if (res.sameBody) return 'same-body';
  return declaredUnchanged(previous, signals) ? 'declared-unchanged' : 'changed';
};

/**
 * The counters' definition: a **hit** is a poll that skipped the parse. Layer 0
 * (`not-modified`), layer 1 (`same-body`) and layer 2 (`declared-unchanged`)
 * hit; a full parse and any failure miss. `fastPathHits: 0` with 400 misses is
 * the visible form of "this source stamps its HTML" — an optimization that
 * never fires is otherwise invisible.
 */
export const isFastPath = (outcome: SnapshotOutcome): boolean =>
  outcome === 'not-modified' || outcome === 'same-body' || outcome === 'declared-unchanged';
