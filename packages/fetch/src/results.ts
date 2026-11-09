import type { PickedItem, SourceKind } from 'newspa-core';

/**
 * What a parser answers. Rule 5 (AGENTS.md) is the shape of this file: every
 * zero case gets a **name**, the thing that failed, and the counts that were
 * seen — so a `HealthState` note can say "`.card` matched 0 nodes" instead of
 * "no news today".
 */

export type ParseFailureReason =
  /** The payload has no content to parse. */
  | 'empty'
  /** A bot challenge / login wall / JS-required page (core's marker vocabulary). */
  | 'challenge'
  /** The bytes are a kind the source is not configured for (D-006). */
  | 'kind-mismatch'
  /** The document ends inside an element, so items are missing from it. */
  | 'truncated'
  /** Well-formed enough to sniff, not enough to read. */
  | 'malformed'
  /** A container was found and held no items. */
  | 'no-items'
  /** A CSS selector matched no element. `cause` + `matchCount` are the point. */
  | 'no-matches'
  /** The CSS engine rejected the selector itself (not a rot signal). */
  | 'invalid-selector'
  /** A JSON path resolved to nothing. `detail` lists the keys that were there. */
  | 'no-items-path'
  /** A script island (`script#__NEXT_DATA__`) was not in the document. */
  | 'no-island'
  /** The island's text is not JSON. */
  | 'island-not-json'
  /** Items were found, none usable. `notes` says why, one per node. */
  | 'no-usable-items';

export interface ParseSuccess {
  readonly ok: true;
  readonly items: readonly PickedItem[];
  /** The kind the source is configured for. */
  readonly kind: SourceKind;
  /** What the payload actually is, decided by `sniff.ts`, never by a header. */
  readonly sniffed: SourceKind;
  /** The sniff marker that decided it (`<?xml`, `<feed`, `<!doctype html`, `{`…). */
  readonly marker: string;
  /** Item nodes found in the container — feeds and `itemsPath` do not filter. */
  readonly matchCount: number;
  /** Item nodes dropped by the mapping, each one named in `notes`. */
  readonly skipped: number;
  readonly notes: readonly string[];
}

export interface ParseFailure {
  readonly ok: false;
  readonly reason: ParseFailureReason;
  /** One sentence, in the order the checks ran: the first fault explains the poll. */
  readonly detail: string;
  readonly kind: SourceKind;
  readonly sniffed: SourceKind | null;
  readonly marker: string | null;
  /** Selector, path, island, root tag or wall marker that failed; null when structural. */
  readonly cause: string | null;
  /** Nodes seen for `cause`. `0` is what makes selector rot visible. */
  readonly matchCount: number | null;
  readonly itemCount: 0;
  readonly notes: readonly string[];
}

export type ParseResult = ParseSuccess | ParseFailure;

/** Why an item node was not usable, in the parser's own words. */
export interface SkippedItem {
  readonly index: number;
  readonly why: string;
}

export interface SuccessInput {
  readonly items: readonly PickedItem[];
  readonly kind: SourceKind;
  readonly sniffed: SourceKind;
  readonly marker: string;
  readonly notes?: readonly string[];
  readonly skipped?: number;
  /** Defaults to the item count: the count that is always known. */
  readonly matchCount?: number;
}

export const succeed = (input: SuccessInput): ParseSuccess => ({
  ok: true,
  items: input.items,
  kind: input.kind,
  sniffed: input.sniffed,
  marker: input.marker,
  matchCount: input.matchCount ?? input.items.length,
  skipped: input.skipped ?? 0,
  notes: input.notes ?? [],
});

export interface FailFields {
  readonly reason: ParseFailureReason;
  readonly kind: SourceKind;
  readonly detail: string;
  readonly sniffed?: SourceKind | null;
  readonly marker?: string | null;
  readonly cause?: string | null;
  readonly matchCount?: number | null;
  readonly notes?: readonly string[];
}

export const failWith = (fields: FailFields): ParseFailure => ({
  ok: false,
  reason: fields.reason,
  detail: fields.detail,
  kind: fields.kind,
  sniffed: fields.sniffed ?? null,
  marker: fields.marker ?? null,
  cause: fields.cause ?? null,
  matchCount: fields.matchCount ?? null,
  itemCount: 0,
  notes: fields.notes ?? [],
});

/** One note per skipped node, capped: a 500-node page must not print 500 lines. */
export const skipNotes = (skipped: readonly SkippedItem[], cap = 8): string[] => {
  const head = skipped.slice(0, cap).map((item) => `item ${String(item.index + 1)}: ${item.why}`);
  const rest = skipped.length - head.length;
  return rest > 0 ? [...head, `${String(rest)} more item(s) skipped`] : head;
};
