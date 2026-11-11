import type { NodeSet } from '../htmlSelectors.ts';
import { tagOf } from './mapPath.ts';
import type { PathStep } from './types.ts';

/**
 * The selector strings the derivation is allowed to propose (WP6).
 *
 * Everything here is **reader-writable CSS**: a class hook, a tag, a `:nth-child`.
 * That is a constraint, not a style — cheerio's CSS engine evaluates what the
 * source file says (D-031: selectors are CSS, tier by tier), so a Playwright
 * locator, an XPath, or a `:has-text()` is not a candidate at all.
 *
 * The class filter is the measured part. A CSS class is any string, and
 * Tailwind's `text-sm/6`, `md:top-0` and `p-[0.3rem]` are all real class names
 * that a bare `.text-sm/6` selector does **not** mean — the engine would read an
 * attribute selector, a pseudo-class, or throw. So a class is a candidate only
 * while it survives the plain-identifier rule; anything else is skipped, and the
 * ladder falls to a tag, an ancestor, or a positional path.
 */

/** `html > body > div:nth-child(3)`, from a path. Step 0 is the root tag, unindexed. */
export const chainOf = (steps: readonly PathStep[]): string =>
  steps.map((step, depth) => (depth === 0 ? step.tag : `${step.tag}:nth-child(${String(step.index)})`)).join(' > ');

const SAFE_CLASS = /^-?[_a-zA-Z][\w-]*$/u;

/** The classes a CSS selector can carry verbatim, in the element's own order. */
export const classesOf = (node: NodeSet): string[] =>
  (node.attr('class') ?? '').split(/\s+/u).filter((name) => name.length > 0 && SAFE_CLASS.test(name));

/** The tag with each of its safe classes: `li.card`, `li.news-item`, … */
export const classCandidates = (node: NodeSet): string[] => {
  const tag = tagOf(node);
  const classes = classesOf(node);
  const singles = classes.map((name) => `.${name}`).concat(classes.map((name) => `${tag}.${name}`));
  const pairs: string[] = [];
  classes.forEach((name, at) => {
    classes.slice(at + 1).forEach((other) => {
      pairs.push(`${tag}.${name}.${other}`);
    });
  });
  return singles.concat(pairs);
};

/**
 * The ancestor-anchored candidates, **shortest chain first**: the higher the
 * ancestor, the more of the page the selector describes, so a climb from the
 * parent upward is a climb from precise to general. The caller keeps the first
 * one whose match set is exactly the captured item set.
 */
export const climbCandidates = (parentChain: readonly PathStep[], tag: string): string[] => {
  const out: string[] = [];
  for (let depth = parentChain.length; depth >= 1; depth -= 1) {
    out.push(`${chainOf(parentChain.slice(0, depth))} > ${tag}`);
  }
  return out;
};

/**
 * The positional last resorts, and they are named as such to the reader. Both join
 * one selector per captured item with `,`: a selector **list**, which is valid CSS
 * and stable only while the page keeps its shape — so the note that travels with
 * it says "positional", and D-026's `matchCount` is what catches the day it lies.
 */
export const positionalCandidates = (
  parentChain: readonly PathStep[],
  siblings: readonly { tag: string; index: number }[],
): string[] => {
  const parentPath = chainOf(parentChain);
  const underParent = siblings.map((sib) => `${parentPath} > ${sib.tag}:nth-child(${String(sib.index)})`);
  const fullChains = siblings.map((sib) => chainOf(parentChain.concat([{ tag: sib.tag, index: sib.index }])));
  return [underParent.join(', '), fullChains.join(', ')];
};

/** The siblings, as path steps: each child's tag and its 1-based index under the parent. */
export const stepsOfSiblings = (siblings: NodeSet): { tag: string; index: number }[] =>
  siblings.get().map((_node, at) => ({ tag: tagOf(siblings.eq(at)), index: at + 1 }));
