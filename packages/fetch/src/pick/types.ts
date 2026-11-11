import type { HtmlFields } from 'newspa-config';

/**
 * The shapes the picker moves around (WP6, D-036).
 *
 * The rule that splits them is the one D-036 records: **the page is a witness, not
 * an author.** The browser sends a structural fingerprint — where the click landed,
 * in the DOM the browser happens to have — and the selector is derived in Node,
 * against the bytes the poller will fetch, through the parser's own functions
 * (`../htmlSelectors.ts`). So the type that crosses the browser boundary is
 * deliberately dumb, and every type with a selector in it is produced here, in
 * Node, and validated against the same DOM the parser reads.
 *
 * One consequence is worth stating: the derivation running on the raw bytes is what
 * makes D-007 measurable at pick time. A path that does not map into the raw fetch
 * means the DOM that was clicked is not the DOM the poller fetches, and the picker
 * says so by name (`path-unmapped`) instead of writing a selector that matches
 * nothing.
 */

/** One step of the nth-child path: the element's tag, and its 1-based index among its parent's element children. */
export interface PathStep {
  readonly tag: string;
  readonly index: number;
}

/** What a click sends: enough to find the node again in the raw bytes, and nothing to obey. */
export interface PickFingerprint {
  /** The document the click happened in, as the browser saw it. */
  readonly url: string;
  /** `<html>` → the clicked node, so `path[0].tag === 'html'`. */
  readonly path: readonly PathStep[];
  /** The nearest `a[href]` at or above the click, resolved absolutely, or `null`. */
  readonly href: string | null;
  /** The clicked node's markup, capped at `outerHtmlCap`. */
  readonly outerHtml: string;
  /** Its visible text, capped at `textCap`. */
  readonly text: string;
  /** Element children of the clicked node's parent, including the clicked node. */
  readonly siblings: number;
}

/** The fields a pick can write. Everything else in a source file is the reader's. */
export type PickFields = Pick<HtmlFields, 'title' | 'link' | 'summary'>;

/** What the derived selectors read on the item that was clicked. Proof, in the reader's own words. */
export interface PickSample {
  readonly title: string;
  readonly link: string;
  readonly summary: string;
}

/**
 * Why a pick wrote nothing. Every arm is a sentence the reader can act on: a fault
 * that only says "failed" is the silent zero rule 5 forbids, one step further up.
 */
export type PickFault =
  /** The payload is not a fingerprint: a missing path, a zero index, a runaway cap. */
  | 'bad-fingerprint'
  /** The path does not exist in the raw bytes — the page is built by script (D-007). */
  | 'path-unmapped'
  /** The clicked node has no siblings: a page with no repeating item set needs no `list` (D-028). */
  | 'not-a-list'
  /** No item in the set carries a usable link, so the paper could not point anywhere. */
  | 'no-anchor'
  /** No item in the set carries a usable title. */
  | 'no-title'
  /** No selector was found whose match set is exactly the captured item set. */
  | 'generalize-failed';

/** A pick that wrote a selector: the fields, the measured count, and the notes that travel with them. */
export interface PickSuccess {
  readonly ok: true;
  /** The `list` selector: repeating item nodes, not the container. */
  readonly list: string;
  readonly fields: PickFields;
  /**
   * The count `list` matched **in the raw bytes**. It is written to the source as
   * `matchCount`, the rot baseline D-026 reads; it is not the count the browser showed.
   */
  readonly matchCount: number;
  /** True when only a positional selector held: stable for this page, not for a reordered one. */
  readonly positional: boolean;
  readonly sample: PickSample;
  readonly notes: readonly string[];
}

/** A pick that wrote nothing, and the reason. */
export interface PickFailure {
  readonly ok: false;
  readonly reason: PickFault;
  readonly detail: string;
  readonly notes: readonly string[];
}

export type PickOutcome = PickSuccess | PickFailure;

/** The fingerprint's caps. `pathMax` is the runaway guard: a 40-deep click is a bug, not a card. */
export const pathMax = 40;
export const outerHtmlCap = 4_096;
export const textCap = 512;

/** The fault shape, with the notes that make it actionable. */
export const pickFail = (reason: PickFault, detail: string, notes: readonly string[] = []): PickFailure => ({
  ok: false,
  reason,
  detail,
  notes,
});
