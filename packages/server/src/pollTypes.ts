/**
 * The shapes of **one** poll (WP2, D-001: `fetch → parse → normalize → diff →
 * score → publish`, hard-coded, no agent graph).
 *
 * The dependency bag is the same style as `state.ts`'s `StateDeps`: repositories
 * handed in, clock handed in, so a poll of a fixture is a deterministic test and
 * nothing in the pipeline reaches for `globalThis` on its own.
 */
import type { ScoreRules } from 'newspa-core';
import type {
  ErrorKind,
  HealthState,
  ItemEventsRepository,
  ItemsRepository,
  SnapshotOutcome,
  SnapshotRepository,
  SourcesRepository,
  ValidatorRepository,
} from 'newspa-db';
import type { FetchLike } from 'newspa-fetch';

/** The pipeline's write budget: the five repositories a poll touches, in one transaction. */
export interface PollDeps {
  readonly sources: SourcesRepository;
  readonly items: ItemsRepository;
  readonly itemEvents: ItemEventsRepository;
  readonly snapshots: SnapshotRepository;
  readonly validators: ValidatorRepository;
  /**
   * Runs a poll's writes as **one unit**, so a paper never shows half a poll:
   * items without the events that explain them, or a snapshot with no health.
   * The composition root passes `db.tx.transaction`; a test may pass
   * `(work) => work()`. `itemEvents.insertMany` opens its own transaction, and
   * `statement.ts` nests that as a `SAVEPOINT`, so the two compose.
   */
  readonly inTx: <T>(work: () => T) => T;
  /**
   * The socket. Required, because the pipeline never reaches for a global: the
   * composition root (`pollDepsOf`) supplies `globalThis.fetch`, a fixture test
   * supplies a handler. An optional seam here would mean a poll that silently
   * starts talking to the internet when a caller forgets to inject one.
   */
  readonly fetch: FetchLike;
  /** The seam for a deterministic test. Also the clock `durationMs` is measured on. */
  readonly now?: () => Date;
  /** The retry wait. A test records it; no wall time passes. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly backoffMaxMs?: number;
  /** Scoring. Default is the source's own knobs (`weight`, `watchwords`, `blockwords`). */
  readonly rules?: ScoreRules;
}

/**
 * What one poll did, as data: the scheduler logs it, SSE publishes the keys,
 * a test asserts on it. The numbers are the poll's own count — the paper's
 * counts are read back from the rows (`state.ts`), never trusted from here.
 */
export interface PollResult {
  readonly sourceId: string;
  /** The instant the poll began, ISO. The same string the snapshot and the items carry. */
  readonly takenAt: string;
  /** The ladder's verdict, exactly the `snapshots.outcome` CHECK's vocabulary. */
  readonly outcome: SnapshotOutcome;
  readonly status: number;
  /** Decoded bytes the transport read; 0 for a `304` (D-006: caps count decoded bytes). */
  readonly bytes: number;
  readonly durationMs: number;
  /**
   * Items this poll **counted**. `null` = this poll did not count any, because
   * the ladder skipped the item pass (a `304`, a matching body hash, a matching
   * selection hash) or no request was made. Not a zero.
   */
  readonly itemCount: number | null;
  readonly newItems: number;
  readonly editedItems: number;
  /** The keys behind those counts, for the SSE push. */
  readonly newKeys: readonly string[];
  readonly editedKeys: readonly string[];
  /** The state written to `sources.health` — the paper's, not a log's. */
  readonly health: HealthState;
  readonly errorKind: ErrorKind | null;
  /** The line written to `sources.note`: one line of evidence, always non-empty. */
  readonly note: string;
}

/** One item pass's tally. */
export interface ItemPass {
  readonly items: number;
  readonly newItems: number;
  readonly editedItems: number;
  readonly newKeys: readonly string[];
  readonly editedKeys: readonly string[];
}

/** A poll that wrote no items: the ladder's skipped layers and every failure. */
export const NO_PASS: ItemPass = { items: 0, newItems: 0, editedItems: 0, newKeys: [], editedKeys: [] };
