/**
 * The rungs of the ladder, each as a **verdict**: one outcome, one health state,
 * one line of evidence, and the ladder state to leave behind (D-020).
 *
 * `poll.ts` decides which rung fired and writes; the functions here decide what
 * that rung *means*, and they are pure — no repository is reached. That split is
 * what keeps the write path in one place: one `PollSnapshot`, one validator
 * row, one health patch, and the item pass, all inside one transaction.
 *
 * The fields that are deliberately **not** filled in are the interesting ones:
 *
 *  - `itemCount: null` for every rung that skipped the parse, and for a request
 *    that never left. `0` would be a claim that something was counted, and the
 *    paper prints a snapshot's count as the source's `matchCount`.
 *  - `state: null` for a failure: the stored baseline describes the body the
 *    item set was built from, and a poll that produced no items has no standing
 *    to move it (the argument in full is in `pollBaseline.ts`).
 *  - `health: current` for a skipped rung: a `304` is not a verdict about the
 *    content, and `unknown` written over `ok` puts a quiet source on the health
 *    strip (rule 5).
 *
 * The rungs here are pure, so the disappearance ladder's keys (D-029) are handed
 * in, not computed: an unchanged set is evidence that an absent key is still
 * absent, and deciding that needs the stored rows, which is `pollGone.ts`'s job.
 */
import type { SourceSpec } from 'newspa-config';
import type { PageSignals } from 'newspa-core';
import type { ErrorKind, HealthState, SnapshotOutcome, ValidatorState } from 'newspa-db';
import type { ParseFailure, TransportFailure, TransportNotModified, TransportOk, TransportResult } from 'newspa-fetch';
import { stateFromBody, stateFromNotModified } from './pollBaseline.ts';
import {
  healthOfFailure,
  healthOfParseFailure,
  healthOfSuccess,
  noteOfNotModified,
  noteOfParseFailure,
  noteOfSkipped,
  noteOfSuccess,
  noteOfTransport,
  parseErrorKind,
  type SkippedOutcome,
} from './pollHealth.ts';
import { type ItemPass, NO_PASS } from './pollTypes.ts';

/** What one rung concluded, in the shape the commit needs. */
export interface Verdict {
  readonly outcome: SnapshotOutcome;
  readonly status: number;
  readonly bytes: number;
  /** Items this poll counted. `null` = it counted nothing (skipped, or never asked). */
  readonly itemCount: number | null;
  readonly errorKind: ErrorKind | null;
  readonly health: HealthState;
  /** The line for `sources.note`: a sentence in the paper's health strip. */
  readonly note: string;
  /** The line for `snapshots.note`: the log, so it keeps the transport's detail. */
  readonly log: string;
  readonly pass: ItemPass;
  /** The ladder state to leave behind. `null` = keep the stored one. */
  readonly state: ValidatorState | null;
  /** The source answered with usable state, so "gone quiet" restarts. */
  readonly succeeded: boolean;
}

/** The transport's sentence, plus the parser's first note when it left one. */
const logOf = (res: TransportResult, notes: readonly string[]): string => {
  const tail = notes[0];
  return tail === undefined ? noteOfTransport(res) : `${noteOfTransport(res)} · ${tail}`;
};

/**
 * `refusalOf` answers with a `TransportFailure` — that is what it builds, for
 * all three refusals — while the barrel types its return as the union. Narrowing
 * it here, with a throw for the case the builder cannot produce, keeps the cast
 * out of the pipeline: an `as` would hide the day the builder changes.
 */
export const refusalFailure = (refusal: TransportResult): TransportFailure => {
  if (refusal.state === 'failure') return refusal;
  throw new Error(`refusalOf answered '${refusal.state}'; a refusal is a failure by construction`);
};

/** A request that never left (render, credential, bad URL) and any transport fault. */
export const failureVerdict = (spec: SourceSpec, res: TransportFailure): Verdict => ({
  outcome: 'error',
  status: res.status,
  bytes: res.bytes,
  // Nothing was counted: a failure is not a source with zero items.
  itemCount: null,
  errorKind: res.errorKind,
  health: healthOfFailure(spec, res),
  note: noteOfTransport(res),
  log: noteOfTransport(res),
  pass: NO_PASS,
  state: null,
  succeeded: false,
});

/** A body that arrived and the parser refused. The baseline stays at the last body we have items for. */
export const parseVerdict = (spec: SourceSpec, res: TransportOk, failure: ParseFailure): Verdict => ({
  outcome: 'error',
  status: res.status,
  bytes: res.bytes,
  // The parse ran and counted zero. That is a measurement, so it is a number.
  itemCount: 0,
  errorKind: parseErrorKind(failure.reason),
  health: healthOfParseFailure(spec, res, failure),
  note: noteOfParseFailure(failure),
  log: logOf(res, [failure.detail, ...failure.notes]),
  pass: NO_PASS,
  state: null,
  succeeded: false,
});

/**
 * The tally of a rung that skipped the item pass: no items counted, no keys
 * published, and the doors its **unchanged set** closed (D-029). A `304` proves
 * the source is serving the list it last showed us, which is evidence that an
 * absent key is still absent — `pollGone.ts` is where that is decided.
 */
const skipPass = (goneKeys: readonly string[]): ItemPass => ({ ...NO_PASS, goneItems: goneKeys.length, goneKeys });

/** Layer 0: the validators matched. The body was never read, so the body-derived fields stay. */
export const notModifiedVerdict = (
  current: HealthState,
  res: TransportNotModified,
  previous: ValidatorState,
  goneKeys: readonly string[],
): Verdict => ({
  outcome: 'not-modified',
  status: res.status,
  bytes: res.bytes,
  itemCount: null,
  errorKind: null,
  health: current,
  note: noteOfNotModified(),
  log: logOf(res, res.notes),
  pass: skipPass(goneKeys),
  state: stateFromNotModified(res, previous),
  succeeded: true,
});

/** Layers 1 and 2: the body was read, and a cheap signal said the news did not move. */
export const skippedVerdict = (
  current: HealthState,
  res: TransportOk,
  outcome: Exclude<SkippedOutcome, 'not-modified'>,
  signals: PageSignals,
  selection: string | null,
  previous: ValidatorState,
  goneKeys: readonly string[],
): Verdict => ({
  outcome,
  status: res.status,
  bytes: res.bytes,
  itemCount: null,
  errorKind: null,
  health: current,
  note: noteOfSkipped(outcome),
  log: logOf(res, res.notes),
  pass: skipPass(goneKeys),
  // The body was read, so every field of the state is fresh — including the
  // selection hash, which is the thing layer 2 just compared.
  state: stateFromBody(res, signals, previous, selection),
  succeeded: true,
});

/** The slow path: the parse ran, the items are written, and the item count is measured. */
export const changedVerdict = (
  spec: SourceSpec,
  res: TransportOk,
  signals: PageSignals,
  selection: string | null,
  previous: ValidatorState,
  pass: ItemPass,
  notes: readonly string[],
): Verdict => ({
  outcome: 'changed',
  status: res.status,
  bytes: res.bytes,
  itemCount: pass.items,
  errorKind: null,
  health: healthOfSuccess(spec, res, pass.items),
  note: noteOfSuccess(pass.items, notes),
  log: logOf(res, notes),
  pass,
  state: stateFromBody(res, signals, previous, selection),
  succeeded: true,
});
