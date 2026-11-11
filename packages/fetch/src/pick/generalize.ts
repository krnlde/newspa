import type { CheerioAPI } from 'cheerio';
import type { NodeSet } from '../htmlSelectors.ts';
import { chainOf, classCandidates, climbCandidates, positionalCandidates, stepsOfSiblings } from './cssPath.ts';
import { tagOf } from './mapPath.ts';
import { type PathStep, type PickFault, pickFail } from './types.ts';

/**
 * The generalisation (WP6): the captured item set → the **shortest CSS selector
 * whose match set is exactly that set**.
 *
 * Set equality is the whole test, and it is a stricter bar than a count. "It
 * matched 4" is true of `li`, of `div`, and of `.card` on a page with three nav
 * links and four cards; only one of them is the list the reader clicked. So every
 * candidate is checked node for node, by **identity**, against the siblings
 * captured in the fetched document — the fault D-026 measured (`1076-77`, a
 * selector that matched almost the page) cannot survive that test.
 *
 * The ladder is ordered from general to positional, and the first survivor wins:
 *
 *  1. the bare tag — `li`;
 *  2. the element's own classes — `.card`, `li.card`, and pairs of them;
 *  3. an ancestor-anchored tag, **shortest chain first** — `ul.news > li`;
 *  4. positional selector lists — `ul > li:nth-child(2), …` and full nth-child
 *     chains. Valid CSS, and true only while the page keeps its shape, so the
 *     note that travels with it says the word, and `matchCount` is what catches
 *     the day it stops being true.
 *
 * A selector the CSS engine rejects is not a candidate: cheerio 1.2 throws for
 * what CSS does not parse ("Empty sub-selector", measured), and a candidate list
 * must not be able to throw the pick away.
 */

export type Generalized =
  | {
      readonly ok: true;
      readonly list: string;
      readonly positional: boolean;
      readonly notes: readonly string[];
    }
  | { readonly ok: false; readonly reason: PickFault; readonly detail: string; readonly notes: readonly string[] };

const positionalNote =
  'the selector is positional (:nth-child): it holds while the page keeps this shape, and matchCount is what reports the day it does not';

/** Does this selector match **exactly** these nodes? Count first, then identity. */
const matchesExactly = ($: CheerioAPI, selector: string, siblings: NodeSet): boolean => {
  let got: NodeSet;
  try {
    got = $(selector);
  } catch {
    return false;
  }
  if (got.length !== siblings.length) return false;
  const want = new Set(siblings.get());
  for (const node of got.get()) {
    if (!want.has(node)) return false;
  }
  return true;
};

export const generalize = (
  $: CheerioAPI,
  node: NodeSet,
  siblings: NodeSet,
  parentChain: readonly PathStep[],
): Generalized => {
  const tag = tagOf(node);
  const candidates: { readonly selector: string; readonly positional: boolean }[] = [
    { selector: tag, positional: false },
    ...classCandidates(node).map((selector) => ({ selector, positional: false })),
    ...climbCandidates(parentChain, tag).map((selector) => ({ selector, positional: false })),
    ...positionalCandidates(parentChain, stepsOfSiblings(siblings)).map((selector) => ({
      selector,
      positional: true,
    })),
  ];

  for (const candidate of candidates) {
    if (matchesExactly($, candidate.selector, siblings)) {
      return {
        ok: true,
        list: candidate.selector,
        positional: candidate.positional,
        notes: candidate.positional ? [positionalNote] : [],
      };
    }
  }

  return pickFail(
    'generalize-failed',
    `no selector matched exactly the ${String(siblings.length)} nodes captured under ${chainOf(parentChain)}`,
    [
      'the items are not siblings of one shape, so the list needs an author: write a selector by hand, and matchCount is your proof',
    ],
  );
};
