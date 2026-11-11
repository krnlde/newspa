import type { SourceSpec } from 'newspa-config';
import { hashKey, normalizeText } from 'newspa-core';
import { loadDocument } from './htmlSelectors.ts';
import { NOISE_SELECTOR } from './htmlText.ts';

/**
 * The third rung's cheap signal (D-027): the text of the **node the source
 * watches**, as the parser would read it.
 *
 * A source with a `list` is a subscription to one node (D-026). When the bytes
 * move and that node's text does not, the news did not: a footer timestamp, a
 * build nonce, a rotating sponsor, a re-navigated breadcrumb. Without this
 * signal the poll parses, rebuilds the item, and reports an **edit** the reader
 * cannot see — the noise that makes a source's history worthless.
 *
 * `null` is the answer that keeps the ladder honest, and it means "no opinion":
 *
 * - no `list` (page mode, feeds, JSON): there is no selection to speak of, and
 *   rung 2's bytes hash is the stronger cheap signal for those;
 * - the selector matched **nothing**: a broken selector must never read as
 *   "nothing changed" — that is the silent zero rule 5 forbids, so the rung
 *   declines and the parse reports `no-matches`;
 * - the selector is CSS the engine rejects: the parse names that fault
 *   (`invalid-selector`), so this function says nothing rather than swallowing
 *   it. The `catch` has no opinion to trade; it does not decide the poll.
 *
 * `strip` and `NOISE_SELECTOR` are applied exactly as the item extraction
 * applies them. A hash of text the parser would not have produced is a signal
 * that fires on the wrong bytes.
 *
 * Cost, measured: cheerio's load is 2.2–52 ms of a 1 171 ms poll, so the value
 * here is the **named outcome** and the honest counters, not wall-clock.
 */
export const selectionText = (payload: string, spec: SourceSpec): string | null => {
  if (spec.kind !== 'html' || spec.list === null) return null;
  let text: string;
  try {
    const $ = loadDocument(payload);
    const node = $(spec.list);
    if (node.length === 0) return null;
    const scoped = spec.strip.length > 0 ? `${NOISE_SELECTOR}, ${spec.strip.join(', ')}` : NOISE_SELECTOR;
    node.find(scoped).remove();
    text = normalizeText(node.text());
  } catch {
    return null;
  }
  return text.length === 0 ? null : text;
};

/** The rung's comparison value: `null` says this poll has no opinion. */
export const selectionHash = (payload: string, spec: SourceSpec): string | null => {
  const text = selectionText(payload, spec);
  return text === null ? null : hashKey(text);
};
