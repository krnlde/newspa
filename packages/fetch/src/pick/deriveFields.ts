import type { NodeSet } from '../htmlSelectors.ts';
import { fieldNode } from '../htmlSelectors.ts';
import { markupToText } from '../htmlText.ts';
import { type PickFields, type PickSample, pickFail } from './types.ts';

/**
 * The fields a pick writes, derived from the item set it captured (WP6).
 *
 * The rule that shapes this file is the parser's, not the picker's: a field is
 * only worth writing when it **resolves for every item**, because
 * `fieldsOfItem` reads one item at a time — a field that resolves on three of
 * four items is a source that prints three stories and skips one in silence.
 * "Every item, non-empty" is therefore the eligibility test for every candidate,
 * and the sample printed for the reader is read out of the item they clicked.
 *
 * Three measurements decide the ladders:
 *
 *  - on a card list the anchor **is** the story link, and on CNN's lite page the
 *    anchor is the item itself (`li.card--lite > a`), so a source whose item
 *    carries `href` gets **no** `fields.link`: the parser reads the item's own
 *    attribute first (the order is written in `htmlSelectors.ts:linkFrom`).
 *  - `fields.title` is required by the schema, so a set with no title that
 *    resolves everywhere is a refusal, not a source with an empty title.
 *  - `summary` is optional and the teaser falls back to the item text, so a deck
 *    that does not resolve everywhere is **omitted and said**, never written.
 */

const textAt = (item: NodeSet, selector: string): string => {
  const node = fieldNode(item, selector);
  if (node === null) return '';
  const html = node.html();
  return markupToText(html === null ? node.text() : html);
};

const hrefAt = (item: NodeSet, selector: string): string => {
  const node = fieldNode(item, selector);
  const value = node?.attr('href');
  return value === undefined ? '' : value.trim();
};

const ownHrefOf = (item: NodeSet): string => (item.attr('href') ?? '').trim();

/** The text of one selector for every item, or null when it comes up empty somewhere. */
const textsForAll = (items: readonly NodeSet[], selector: string): string[] | null => {
  const texts: string[] = [];
  for (const item of items) {
    const text = textAt(item, selector);
    if (text.length === 0) return null;
    texts.push(text);
  }
  return texts;
};

/** How many items a selector reads as non-empty text. */
const hitsOf = (items: readonly NodeSet[], read: (item: NodeSet) => string): number =>
  items.filter((item) => read(item).length > 0).length;

const bestOf = <T>(scored: readonly T[], score: (entry: T) => number): T | undefined => {
  let winner: T | undefined;
  let best = -1;
  for (const entry of scored) {
    const value = score(entry);
    if (value > best) {
      best = value;
      winner = entry;
    }
  }
  return winner;
};

const LINK_CANDIDATES = ['a', 'a[href]', '[href]'] as const;
const TITLE_CANDIDATES = ['a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[class*=title]', '[class*=headline]'] as const;
const SUMMARY_CANDIDATES = ['[class*=deck]', '[class*=summary]', '[class*=description]', '[class*=lead]', 'p'] as const;

type LinkArm =
  | { readonly ok: true; readonly link: string | null; readonly notes: readonly string[] }
  | ReturnType<typeof pickFail>;

/**
 * The story link: the item's own `href` first — on CNN's lite page the anchor
 * **is** the card — then the candidate selectors, in order. A `null` link means
 * "write no `fields.link`".
 */
const deriveLink = (items: readonly NodeSet[]): LinkArm => {
  if (items.every((item) => ownHrefOf(item).length > 0)) {
    return {
      ok: true,
      link: null,
      notes: [
        "fields.link is not written: every item carries its own href, and linkFrom reads the item's own attribute first",
      ],
    };
  }
  for (const selector of LINK_CANDIDATES) {
    if (items.every((item) => hrefAt(item, selector).length > 0)) {
      return { ok: true, link: selector, notes: [] };
    }
  }
  const best = bestOf(
    LINK_CANDIDATES.map((selector) => ({ selector, hits: hitsOf(items, (item) => hrefAt(item, selector)) })),
    (entry) => entry.hits,
  );
  return pickFail(
    'no-anchor',
    `no link selector resolves on every item: the best, '${String(best?.selector)}', carried an href on ${String(best?.hits)} of ${String(items.length)}`,
  );
};

type TitleArm = { readonly ok: true; readonly title: string } | ReturnType<typeof pickFail>;

/** The title: the longest text among the selectors that resolve on **every** item. */
const deriveTitle = (items: readonly NodeSet[], self: NodeSet): TitleArm => {
  const eligible: { readonly selector: string; readonly length: number }[] = [];
  for (const selector of TITLE_CANDIDATES) {
    if (textsForAll(items, selector) !== null) {
      eligible.push({ selector, length: textAt(self, selector).length });
    }
  }
  const winner = bestOf(eligible, (entry) => entry.length);
  if (winner === undefined) {
    return pickFail(
      'no-title',
      `no title selector resolves with text on every item of ${String(items.length)} (tried ${TITLE_CANDIDATES.join(', ')})`,
    );
  }
  return { ok: true, title: winner.selector };
};

/** The deck: written when it resolves on every item, omitted and named when it does not. */
const deriveSummary = (
  items: readonly NodeSet[],
): { readonly summary: string | null; readonly notes: readonly string[] } => {
  for (const selector of SUMMARY_CANDIDATES) {
    if (textsForAll(items, selector) !== null) {
      return { summary: selector, notes: [] };
    }
  }
  const best = bestOf(
    SUMMARY_CANDIDATES.map((selector) => ({ selector, hits: hitsOf(items, (item) => textAt(item, selector)) })),
    (entry) => entry.hits,
  );
  return {
    summary: null,
    notes: [
      `fields.summary is not set: '${String(best?.selector)}' had text on ${String(best?.hits)} of ${String(items.length)} items, and the teaser falls back to the item text`,
    ],
  };
};

export type DerivedFields =
  | {
      readonly ok: true;
      readonly fields: PickFields;
      readonly sample: PickSample;
      readonly notes: readonly string[];
    }
  | ReturnType<typeof pickFail>;

/**
 * Derive `fields` for the captured item set. `selfIndex` is the clicked item's
 * 1-based position, so the sample the reader sees is what their own click
 * produced — and SAVE is what writes it (D-036).
 */
export const deriveFields = (items: readonly NodeSet[], selfIndex: number): DerivedFields => {
  const self = items[selfIndex - 1];
  if (self === undefined) {
    return pickFail('not-a-list', 'the captured set is empty, so there is no item to read a field from');
  }

  const link = deriveLink(items);
  if (!link.ok) return { ...link, notes: [] };

  const title = deriveTitle(items, self);
  if (!title.ok) return { ...title, notes: [] };

  const summary = deriveSummary(items);
  const fields: PickFields = {
    title: title.title,
    ...(link.link === null ? {} : { link: link.link }),
    ...(summary.summary === null ? {} : { summary: summary.summary }),
  };

  return {
    ok: true,
    fields,
    sample: {
      title: textAt(self, fields.title),
      link: fields.link === undefined ? ownHrefOf(self) : hrefAt(self, fields.link),
      summary: fields.summary === undefined ? '' : textAt(self, fields.summary),
    },
    notes: [...link.notes, ...summary.notes],
  };
};
