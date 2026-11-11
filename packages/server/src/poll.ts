/**
 * WP2 — one source, end to end: `fetch → parse → normalize → diff → score →
 * publish` (D-001, hard-coded).
 *
 * This file is the ladder and the **commit**. The ladder decides what work is
 * needed (D-020, D-027): layer 0 a `304`, layer 1 a matching body hash, layer 2
 * a matching **selection hash** (the node the source watches), and only then the
 * parse and the item pass. Each rung's meaning is in `pollVerdicts.ts`; this file
 * decides the order, and is the only place the package writes — one transaction,
 * one `PollSnapshot` with its `outcome`, the ladder state and its counters, the
 * source's `HealthState`, and on the slow path the items and their events.
 *
 * The two numbers a reader judges this pipeline by:
 *
 *  - `snapshots.item_count` is `null` when a rung skipped the parse, never `0`:
 *    the paper prints a snapshot's count as the source's `matchCount`, and a
 *    quiet day must not read as a dead source (rule 5).
 *  - `source_validators.fast_path_hits` counts the rungs that skipped work.
 *    `hits: 0, misses: 400` is the visible form of "this source rewrites its
 *    bytes on every poll" — an optimization that never fires is otherwise
 *    invisible, so the counter is written on every poll that has a state row.
 *
 * Nothing here catches. `fetchSource` classifies its own throws (a transport
 * error becomes a `TransportFailure`, which becomes a health state), and a
 * repository that throws has a real defect: the exception belongs to the
 * scheduler that called us, and a missing snapshot is a louder report than a
 * swallowed one.
 *
 * The source must already be in `sources` — the CLI owns authoring. `items` has
 * a foreign key to it, so a poll of an unregistered source fails loudly, which
 * is the honest answer and not a zero.
 */
import type { SourceSpec } from 'newspa-config';
import { pageSignals } from 'newspa-core';
import { fetchSource, parsePayload, refusalOf, selectionHash, type TransportDeps, withBase } from 'newspa-fetch';
import { baselineOf, isFastPath, outcomeOf, previousStateOf } from './pollBaseline.ts';
import { healthPatchOf, keptHealth } from './pollHealth.ts';
import { publishItems, rulesOf } from './pollItems.ts';
import type { PollDeps, PollResult } from './pollTypes.ts';
import {
  changedVerdict,
  failureVerdict,
  notModifiedVerdict,
  parseVerdict,
  refusalFailure,
  skippedVerdict,
  type Verdict,
} from './pollVerdicts.ts';

/**
 * The write, in one transaction: snapshot → ladder state → counters → health.
 * `countFastPath` needs a row, so the state is written first: a source's first
 * poll counts its own miss, and an optimization that never fires stays visible.
 */
const commit = (
  spec: SourceSpec,
  deps: PollDeps,
  clock: () => Date,
  started: Date,
  takenAt: string,
  verdict: Verdict,
): PollResult =>
  deps.inTx(() => {
    const durationMs = Math.max(0, clock().getTime() - started.getTime());
    deps.snapshots.record({
      sourceId: spec.id,
      takenAt,
      outcome: verdict.outcome,
      status: verdict.status,
      bytes: verdict.bytes,
      durationMs,
      itemCount: verdict.itemCount,
      errorKind: verdict.errorKind,
      note: verdict.log,
    });
    if (verdict.state !== null) {
      deps.validators.write(spec.id, verdict.state);
      deps.validators.countFastPath(spec.id, isFastPath(verdict.outcome));
    }
    deps.sources.setHealth(
      spec.id,
      healthPatchOf({
        health: verdict.health,
        status: verdict.status,
        takenAt,
        succeeded: verdict.succeeded,
        note: verdict.note,
      }),
    );
    return {
      sourceId: spec.id,
      takenAt,
      outcome: verdict.outcome,
      status: verdict.status,
      bytes: verdict.bytes,
      durationMs,
      itemCount: verdict.itemCount,
      newItems: verdict.pass.newItems,
      editedItems: verdict.pass.editedItems,
      newKeys: verdict.pass.newKeys,
      editedKeys: verdict.pass.editedKeys,
      health: verdict.health,
      errorKind: verdict.errorKind,
      note: verdict.note,
    };
  });

/** The transport's deps: the socket and the clock are ours, the retry policy stays the transport's. */
const transportDepsOf = (deps: PollDeps, clock: () => Date): TransportDeps => ({
  now: clock,
  fetch: deps.fetch,
  ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
  ...(deps.backoffMaxMs === undefined ? {} : { backoffMaxMs: deps.backoffMaxMs }),
});

/**
 * Poll one source. The clock is read **once**, at the start: the snapshot's
 * `takenAt`, the items' `lastSeenAt`, the events' `at` and the scoring instant
 * are all that one instant, so a poll's rows sort in one order and a test
 * asserts on an instant it supplied.
 */
export const pollOne = async (spec: SourceSpec, deps: PollDeps): Promise<PollResult> => {
  const clock = deps.now ?? (() => new Date());
  const started = clock();
  const takenAt = started.toISOString();
  // The state a poll with no content verdict must leave behind: the last real
  // one, or `unknown` for a source that has never had one (rule 5).
  const current = keptHealth(deps.sources.get(spec.id));

  const refusal = refusalOf(spec);
  if (refusal !== null) {
    // `refusalOf` answers with a `TransportFailure` (`attempts: 0`), so the
    // failure path is the same write: a source we must not fetch is a source
    // that is not reporting, and it reaches the paper as one.
    return commit(spec, deps, clock, started, takenAt, failureVerdict(spec, refusalFailure(refusal)));
  }

  const read = deps.validators.read(spec.id);
  const previous = previousStateOf(read);
  const res = await fetchSource(spec, baselineOf(read), transportDepsOf(deps, clock));

  if (res.state === 'failure') return commit(spec, deps, clock, started, takenAt, failureVerdict(spec, res));
  if (res.state === 'not-modified') {
    return commit(spec, deps, clock, started, takenAt, notModifiedVerdict(current, res, previous));
  }

  const signals = pageSignals(res.text, spec.kind);
  // D-030: relative links resolve against the URL that **answered**. After a
  // permanent redirect the payload is from the new place; resolving it against
  // the recorded URL yields a link that dies with the old host. Making the move
  // permanent is the reader's (`pnpm sources:migrate`), not the poller's.
  const source = withBase(spec, res.url);
  // The rung's cheap signal: `null` for a page/feed source and for a selector
  // that matched nothing, and a `null` never matches (pollBaseline).
  const selection = selectionHash(res.text, source);
  const outcome = outcomeOf(res, selection, previous);
  if (outcome === 'changed') {
    const parsed = parsePayload(res.text, source);
    if (parsed.ok === false) return commit(spec, deps, clock, started, takenAt, parseVerdict(spec, res, parsed));
    const pass = publishItems(
      { items: deps.items, itemEvents: deps.itemEvents },
      spec,
      parsed.items,
      takenAt,
      started,
      deps.rules ?? rulesOf(spec),
    );
    return commit(
      spec,
      deps,
      clock,
      started,
      takenAt,
      changedVerdict(spec, res, signals, selection, previous, pass, parsed.notes),
    );
  }

  // `outcomeOf` answers `changed` only for the slow path, so the rung that fired
  // names itself in the note.
  return commit(
    spec,
    deps,
    clock,
    started,
    takenAt,
    skippedVerdict(current, res, outcome, signals, selection, previous),
  );
};
