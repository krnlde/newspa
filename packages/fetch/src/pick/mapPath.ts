import type { CheerioAPI } from 'cheerio';
import type { NodeOne, NodeSet } from '../htmlSelectors.ts';
import { type PathStep, pickFail } from './types.ts';

/**
 * The nth-child path → a node in the **fetched** document (WP6).
 *
 * This is D-007's measurement, and it is the reason the derivation runs in Node:
 * the click happened in the browser's DOM, and the poller reads the bytes. If the
 * path does not walk in the bytes — the step is missing, or the tag there is
 * another tag — then the node the reader aimed at does not exist for the parser,
 * and any selector derived from the browser's markup would be a selector that
 * matches nothing. So this refuses, by name, and the note says what was found.
 *
 * The steps are compared by **tag and 1-based element index**, which is exactly
 * `:nth-child` semantics: `parent.children()` in cheerio is element children only,
 * so text and comment nodes never shift an index, and the browser's
 * `Element.children` agrees.
 */

export type MappedNode =
  | {
      readonly ok: true;
      readonly node: NodeSet;
      readonly siblings: NodeSet;
      /** The clicked node's 1-based index among its parent's element children. */
      readonly selfIndex: number;
      /** The steps from `<html>` to the **parent**, so `parentChain[length-1]` is the parent. */
      readonly parentChain: readonly PathStep[];
    }
  | ReturnType<typeof pickFail>;

/**
 * The lower-cased tag name, as the fetched document spells it. `name` is
 * domhandler's spelling, and `Element` is the member of the node set's union that
 * carries one, so the `in` guard is the whole narrowing — no cast, and no
 * `prop('tagName')`: cheerio 1.2's `prop` generic is the **node** type, so the
 * property name cannot be typed through it.
 */
export const tagOf = (node: NodeSet): string => {
  const element = node.get(0);
  return element !== undefined && 'name' in element ? element.name.toLowerCase() : '';
};

export const mapPath = ($: CheerioAPI, path: readonly PathStep[]): MappedNode => {
  const stepLabel = (step: PathStep, depth: number): string =>
    `<${step.tag}> at index ${String(step.index)} (step ${String(depth + 1)})`;

  let current: NodeSet = $.root();
  const walked: PathStep[] = [];

  for (const [depth, step] of path.entries()) {
    const kids = current.children();
    const next = kids.get(step.index - 1);
    if (next === undefined) {
      return pickFail(
        'path-unmapped',
        `the fetched document has no ${stepLabel(step, depth)}: that parent has ${String(kids.length)} element children`,
        [
          'the click happened in the browser, and the poller reads the bytes',
          'a page whose list is built by script needs render: true (D-007), which the transport refuses by name today',
        ],
      );
    }
    const found = $(next);
    const tag = tagOf(found);
    if (tag !== step.tag) {
      return pickFail(
        'path-unmapped',
        `the fetched document has <${tag}> where the click said ${stepLabel(step, depth)}`,
        [
          'the browser and the bytes disagree about this node, so a selector from the browser would not survive a poll',
          'render: true is the honest answer for a hydrated DOM (D-007)',
        ],
      );
    }
    walked.push(step);
    current = found;
  }

  const parent = current.parent();
  const siblings = parent.children();
  const self: NodeOne | undefined = current.get(0);
  let selfIndex = 0;
  siblings.each((at, node) => {
    if ((node as NodeOne) === self) selfIndex = at + 1;
  });

  if (selfIndex === 0 || siblings.length < 2) {
    return pickFail(
      'not-a-list',
      `the clicked node has ${String(siblings.length)} element sibling${siblings.length === 1 ? '' : 's'} under its parent`,
      [
        'a page with no repeating item set needs no list at all: a source with no list is one item at the page address (D-028)',
        'click a node inside the list you meant, or write a page source',
      ],
    );
  }

  return { ok: true, node: current, siblings, selfIndex, parentChain: walked.slice(0, -1) };
};
