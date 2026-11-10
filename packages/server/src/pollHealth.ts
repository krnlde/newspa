/**
 * Health: the poll's verdict as a state the **paper** can print, and the one
 * line of evidence beside it (rule 5).
 *
 * `classifyFetch` is core's, and it is the only classifier used here: the
 * states, and the order they are decided in, are core's contract, tested there.
 * What this file adds is the mapping from a `ParseFailureReason` to the
 * `errorKind` the snapshot's CHECK allows — the reason a parse failed, in the
 * one vocabulary the database accepts.
 *
 * Two of those mappings deliberately pass `null` for `errorKind`, and that is
 * the subtle part: `classifyFetch` checks `errorKind` **first**, so a reason
 * that already has a state of its own (`no-matches` → `no-matches`,
 * `challenge` → `blocked`) must not arrive as an error kind, or it is flattened
 * to `error` and the paper loses the distinction between "the selectors stopped
 * matching" and "the parser threw".
 */
import type { SourceSpec } from 'newspa-config';
import { classifyFetch, type ErrorKind, type HealthState, type PageSignals } from 'newspa-core';
import type { SourceHealthPatch, StoredSource } from 'newspa-db';
import {
  describeTransport,
  type ParseFailure,
  type ParseFailureReason,
  type TransportFailure,
  type TransportOk,
  type TransportResult,
} from 'newspa-fetch';

/** A health note is a line in the paper's strip, not a stack trace. */
export const NOTE_MAX_CHARS = 200;

const cap = (text: string): string => (text.length > NOTE_MAX_CHARS ? `${text.slice(0, NOTE_MAX_CHARS - 1)}…` : text);

/** A parse fault's `errorKind`, in the schema's vocabulary (`CHECK_ERROR_KINDS`). */
export const parseErrorKind = (reason: ParseFailureReason): ErrorKind | null => {
  if (reason === 'kind-mismatch') return 'kind-mismatch';
  // These two have their own state, so they must not be flattened to `error`:
  // `no-matches` is decided by the item count, `challenge` by the challenge flag.
  if (reason === 'no-matches' || reason === 'challenge') return null;
  return 'parse';
};

/** A transport failure, including a refusal: `attempts: 0` says the request never left. */
export const healthOfFailure = (spec: SourceSpec, failure: TransportFailure): HealthState =>
  classifyFetch({
    status: failure.status,
    ok: false,
    itemCount: 0,
    expectedMatchCount: spec.matchCount ?? null,
    challenge: failure.challenge,
    errorKind: failure.errorKind,
  });

/** A body that arrived and did not parse. */
export const healthOfParseFailure = (spec: SourceSpec, meta: TransportOk, failure: ParseFailure): HealthState =>
  classifyFetch({
    status: meta.status,
    // The transport succeeded: only the parse failed. Reporting `ok: false` here
    // would let a 200 answer be read as an HTTP fault by core's classifier.
    ok: true,
    itemCount: 0,
    expectedMatchCount: spec.matchCount ?? null,
    challenge: meta.challenge || failure.reason === 'challenge',
    errorKind: parseErrorKind(failure.reason),
  });

/** A parse that produced items: the item count is measured against the authored `matchCount`. */
export const healthOfSuccess = (spec: SourceSpec, meta: TransportOk, itemCount: number): HealthState =>
  classifyFetch({
    status: meta.status,
    ok: true,
    itemCount,
    expectedMatchCount: spec.matchCount ?? null,
    challenge: meta.challenge,
    errorKind: null,
  });

/**
 * The state of a poll that skipped the parse. It has **no verdict about the
 * content** — a `304` says "your copy is current", a matching body hash says the
 * bytes are the ones already stored — so the last real verdict stands. `unknown`
 * only for a source that has never had one: writing `unknown` over `ok` would
 * turn a quiet day into a strip of broken sources.
 */
export const keptHealth = (current: StoredSource | undefined): HealthState => current?.health ?? 'unknown';

/** The transport's own sentence: status, url, attempts, bytes, and its notes. */
export const noteOfTransport = (result: TransportResult): string => cap(describeTransport(result));

/** The parser's own sentence, with its reason named. */
export const noteOfParseFailure = (failure: ParseFailure): string =>
  cap(`parse/${failure.reason}: ${failure.detail}${failure.cause === null ? '' : ` :: ${failure.cause}`}`);

/** The three outcomes that skipped the parse, so a typo in a caller is a compile error. */
export type SkippedOutcome = 'not-modified' | 'same-body' | 'declared-unchanged';

/** Layer 0's line: the validators matched, and nothing about the content was learned. */
export const noteOfNotModified = (): string =>
  cap('not modified since the last poll (HTTP 304: the validators matched)');

/**
 * Layers 1 and 2, in words a reader can act on: what the poll trusted.
 *
 * The declared-timestamp sentence interpolates the payload's own instant with no
 * fallback, because layer 2 only fires when both sides **have** one — "no
 * declared timestamp" is not evidence that nothing moved (`declaredUnchanged` in
 * `pollBaseline.ts`), so there is no `null` left to describe here.
 */
export const noteOfSkipped = (outcome: Exclude<SkippedOutcome, 'not-modified'>, signals: PageSignals): string =>
  cap(
    outcome === 'same-body'
      ? 'body unchanged: the stored hash matched, so no parse was needed'
      : `declared timestamp unchanged (${String(signals.declaredModifiedAt)}), so no parse was needed`,
  );

/** A parse that ran: the count, and the parser's first note when it has one. */
export const noteOfSuccess = (itemCount: number, notes: readonly string[]): string =>
  cap(`${String(itemCount)} item(s) parsed${notes[0] === undefined ? '' : ` · ${notes[0]}`}`);

export interface HealthInput {
  readonly health: HealthState;
  /** The response's status; `0` for a request that was never made. */
  readonly status: number;
  readonly takenAt: string;
  /** The source answered **and** its state is usable, so "gone quiet" restarts. */
  readonly succeeded: boolean;
  readonly note: string;
}

/**
 * The patch for `sources.setHealth`. Every field is written every poll —
 * `setHealth` `coalesce`s, so a `null` here means "keep the old value" and a
 * poll that leaves a field out leaves a stale one behind. `lastSuccessAt` is the
 * one that is only written on a success: `isStale` reads it, and a source that
 * is failing must age into `stale` rather than look quiet.
 */
export const healthPatchOf = (input: HealthInput): SourceHealthPatch => ({
  health: input.health,
  note: input.note,
  lastStatus: input.status,
  lastPolledAt: input.takenAt,
  ...(input.succeeded ? { lastSuccessAt: input.takenAt } : {}),
});
