/**
 * The record schema. One shape for RSS, scraped HTML and JSON endpoints, because
 * the newspaper cannot render "the page changed" — it renders items.
 *
 * This module is browser-safe: it must never import node builtins, because the
 * web app imports these types and the scoring/diff logic unchanged.
 */

export type SourceKind = 'rss' | 'html' | 'json';

export const SOURCE_KINDS: readonly SourceKind[] = ['rss', 'html', 'json'];

export const isSourceKind = (value: string): value is SourceKind => (SOURCE_KINDS as readonly string[]).includes(value);

/** A single story, as parsed out of one source. The atomic publishable unit. */
export interface PickedItem {
  /** Stable identity: canonicalized link, falling back to a title+day hash. */
  key: string;
  title: string;
  link: string;
  publishedAt: string | null;
  /**
   * Deck/dek text: the publisher's own one-liner. This is what the paper prints
   * under a headline when it exists.
   */
  summary: string | null;
  image: string | null;
  author: string | null;
  /**
   * Evidence, not content. Capped at `BODY_MAX_CHARS` by `capBody` — wider
   * (`PAGE_BODY_MAX_CHARS`, `capPageBody`) for a page-mode source, whose stable
   * address (D-028) makes this text the diff input. Used only for stealth-edit
   * detection and scoring. It is deliberately absent from `ItemView`: the
   * browser never receives full text (docs/decisions-tooling.md D-017).
   */
  body: string;
}

export interface ItemRecord extends PickedItem {
  sourceId: string;
  kind: SourceKind;
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt: string | null;
  editCount: number;
  readAt: string | null;
  scoreRealtime: number;
  scoreDigest: number;
}

export type EventKind = 'new' | 'edited' | 'gone';

export interface ItemEventRecord {
  id: number;
  sourceId: string;
  itemKey: string;
  kind: EventKind;
  at: string;
  title: string;
  link: string;
  score: number;
  /** Word-level diff, stored as JSON for `edited` events. */
  report: EditReport | null;
}

/** Health states. `no-matches` and `blocked` must be visible, never silent. */
export type HealthState = 'unknown' | 'ok' | 'blocked' | 'no-matches' | 'restructured' | 'error' | 'stale';

export type ErrorKind = 'network' | 'timeout' | 'tls' | 'http' | 'parse' | 'kind-mismatch' | 'render';

export interface FetchOutcome {
  status: number;
  ok: boolean;
  itemCount: number;
  /** Match count recorded when the source was authored; null when not applicable. */
  expectedMatchCount: number | null;
  /** Body markers that indicate a bot challenge / paywall wall. */
  challenge: boolean;
  errorKind: ErrorKind | null;
}

export interface DiffOpBase {
  added: number;
  removed: number;
  similarity: number;
  meaningful: boolean;
}

export type DiffOpType = 'equal' | 'insert' | 'delete';

export interface DiffOp {
  type: DiffOpType;
  text: string;
}

export interface EditReport extends DiffOpBase {
  ops: DiffOp[];
}

// Wire views (ItemView, SourceHealthView, Edition, …) live in api.ts, defined
// once in zod and inferred, so the SSE boundary is narrowed before the app
// touches it. This file holds domain records only.

export type StoryTier = 'lead' | 'front' | 'section' | 'brief';

export interface Masthead {
  name: string;
  tagline: string;
  timezone: string;
  dayStartHour: number;
}
