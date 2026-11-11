import { collectNodes, loadDocument, type NodeSet } from '../htmlSelectors.ts';
import { deriveFields } from './deriveFields.ts';
import { generalize } from './generalize.ts';
import { mapPath } from './mapPath.ts';
import { type PickFingerprint, type PickOutcome, pickFail } from './types.ts';

/**
 * The pick, end to end: a fingerprint and the **raw bytes** in, a selector and a
 * verdict out (WP6, D-036).
 *
 * The order is the design, and each rung is a refusal with a sentence attached:
 *
 *  1. `mapPath` — the click's nth-child path, walked in the fetched document.
 *     A path that does not walk is D-007 spoken plainly: the browser's DOM and the
 *     poller's bytes are not the same page, so no selector derived from the
 *     browser would survive a poll. Nothing is written (`path-unmapped`).
 *  2. `generalize` — the shortest selector whose match set is **exactly** the
 *     captured siblings (set equality, node for node — not a count).
 *  3. `collectNodes` — the parser's own reader, on the derived selector. This
 *     rung is not redundant: it is the proof that the string the source file will
 *     carry resolves **in the code that will poll it**, and it is where
 *     `invalid-selector` and `no-matches` would speak if they ever could.
 *  4. `deriveFields` — title, link and summary, each only when it resolves on
 *     every item, read back on the item that was clicked.
 *
 * The `matchCount` written to the source is the count **the bytes produced**
 * (D-026's rot baseline), and when the browser showed a different number the note
 * says both — a page that differs between a browser and a fetch is a fact about
 * the source, not a rounding error to absorb.
 */

const itemsOf = (nodes: NodeSet): NodeSet[] => {
  const items: NodeSet[] = [];
  for (let at = 0; at < nodes.length; at += 1) items.push(nodes.eq(at));
  return items;
};

export const derivePick = (fp: PickFingerprint, rawHtml: string): PickOutcome => {
  const $ = loadDocument(rawHtml);

  const mapped = mapPath($, fp.path);
  if (!mapped.ok) return mapped;

  const derived = generalize($, mapped.node, mapped.siblings, mapped.parentChain);
  if (!derived.ok) return derived;

  const collected = collectNodes($, derived.list, mapped.siblings.length);
  if (!collected.ok) {
    // Unreachable by construction — the ladder proved set equality on this same
    // document one rung above — and kept, because this file's claim is that the
    // source is authored **through the code that will poll it**. The coverage
    // report shows this arm uncovered, and that is the honest reading: no page
    // produces it. Deleting the rung would raise the number and drop the claim.
    return pickFail(
      'generalize-failed',
      `'${derived.list}' did not resolve in the parser's own reader: ${collected.detail}`,
      [
        'the list is written from the same document the parser reads, so a fault here is a fault the poll will report too',
      ],
    );
  }

  const fields = deriveFields(itemsOf(collected.nodes), mapped.selfIndex);
  if (!fields.ok) return fields;

  const notes = [...derived.notes, ...fields.notes];
  if (fp.siblings !== collected.seen) {
    notes.push(
      `the browser showed ${String(fp.siblings)} items and the fetched bytes match ${String(collected.seen)}: this page is not the same to a browser and to a fetch, so re-pick after a poll, and expect render: true (D-007)`,
    );
  }
  notes.push(
    `derived from the bytes the poller fetches, not the browser's DOM: ${fp.path.map((step) => `${step.tag}:nth-child(${String(step.index)})`).join(' > ')}`,
  );

  return {
    ok: true,
    list: derived.list,
    fields: fields.fields,
    matchCount: collected.seen,
    positional: derived.positional,
    sample: fields.sample,
    notes,
  };
};
