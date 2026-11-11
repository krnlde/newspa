import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';
import type { HtmlFields } from 'newspa-config';
import { markupToText, NOISE_SELECTOR } from './htmlText.ts';
import type { RawFields } from './item.ts';

/**
 * Reading an index page with the source's selectors. The rule that shapes this
 * file is measured: **a selector that matches nothing is a fault, not an empty
 * page**. cheerio answers `length: 0`, `.text(): ''`, `.attr(): undefined`,
 * `.html(): null` for a miss — every one of those is also a plausible value for
 * a real element, so the only honest signal is the count, and the note must
 * name the selector that produced it.
 */

/**
 * The set cheerio hands back for a selector, named once. cheerio 1.2 does not
 * export its node type (`Element` is a `domhandler` type, and that is not a
 * dependency of this package), so it is taken from the API itself.
 */
export type NodeSet = ReturnType<CheerioAPI>;

/**
 * One node of such a set, taken from the API the same way: cheerio 1.2 does not
 * export its node type, so it is read out of the API: `get()` is declared
 * `(): T[]`, and the element type is what the set is a list **of**.
 */
export type NodeOne = NodeSet extends { get(): (infer N)[] } ? N : never;

export type CollectOutcome =
  | { readonly ok: true; readonly nodes: NodeSet; readonly seen: number }
  | { readonly ok: false; readonly reason: 'no-matches' | 'invalid-selector'; readonly detail: string };

/** The document. `xml: false` is not cosmetic: in XML mode tag matching is case-sensitive. */
export const loadDocument = (text: string): CheerioAPI => load(text, { xml: false });

/**
 * The item nodes. `$(sel)` does not throw for a selector CSS understands and
 * **does** throw for one it does not ("Empty sub-selector", measured), so the
 * two cases are separated: a throw is `invalid-selector` (a typo in the source
 * file), a zero length is the rot that the source's `matchCount` exists to catch.
 */
export const collectNodes = ($: CheerioAPI, list: string, matchCount?: number): CollectOutcome => {
  let nodes: NodeSet;
  try {
    nodes = $(list);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      reason: 'invalid-selector',
      detail: `'${list}' is not a selector the CSS engine accepts: ${message}`,
    };
  }
  if (nodes.length === 0) {
    const expected = matchCount === undefined ? '' : `; the source recorded ${String(matchCount)} when it was picked`;
    return { ok: false, reason: 'no-matches', detail: `'${list}' matched 0 elements${expected}` };
  }
  return { ok: true, nodes, seen: nodes.length };
};

/**
 * The node a field selector points at: below the item, **or the item itself**.
 * The self arm is not decoration — `list: '.card .title'` with
 * `fields.title: '.title'` is what a picker writes for a heading list, and
 * cheerio's `find` excludes the root, so without it a correct source reports
 * "matched nothing" on a page that is fine.
 */
export const fieldNode = (item: NodeSet, selector: string): NodeSet | null => {
  const below = item.find(selector);
  if (below.length > 0) return below;
  const self = item.filter(selector);
  return self.length > 0 ? self : null;
};

const attrOf = (node: NodeSet | null, attr: string): string | null => {
  if (node === null) return null;
  const value = node.attr(attr);
  return value === undefined || value.trim().length === 0 ? null : value;
};

/** A `srcset` value is candidates, not a URL (`a.jpg 1x, b.jpg 2x`): take the largest. */
export const pickCandidate = (value: string): string => {
  const parts = value.split(',');
  const last = parts[parts.length - 1] ?? '';
  return (last.trim().split(/\s+/)[0] ?? '').trim();
};

const attrValue = (node: NodeSet | null, attr: string): string | null => {
  const raw = attrOf(node, attr);
  if (raw === null) return null;
  return attr === 'srcset' || attr === 'imagesrcset' ? pickCandidate(raw) : raw;
};

const imageFrom = (item: NodeSet, fields: HtmlFields): string | null => {
  const attr = fields.imageAttr;
  const direct = fields.image === undefined ? null : fieldNode(item, fields.image);
  const fromSelector = attrValue(direct, attr);
  if (fromSelector !== null) return fromSelector;
  return attrValue(item.find(`img[${attr}], [${attr}]`), attr);
};

/** Text of a field, broken at block boundaries (see `htmlText.ts`). */
const textOf = (item: NodeSet, selector: string | undefined): string => {
  if (selector === undefined) return '';
  const node = fieldNode(item, selector);
  if (node === null) return '';
  const html = node.html();
  return markupToText(html === null ? node.text() : html);
};

/**
 * The story link. `fields.link` is optional in the schema, and on a card list
 * the anchor **is** the item (CNN's lite page is 100 `li.card--lite > a`), so
 * the order is: the selector, the item's own attribute, then the first element
 * inside carrying one.
 */
const linkFrom = (item: NodeSet, fields: HtmlFields): string => {
  if (fields.link !== undefined) {
    const attr = attrOf(fieldNode(item, fields.link), fields.linkAttr);
    if (attr !== null) return attr;
  }
  const own = attrOf(item, fields.linkAttr);
  if (own !== null) return own;
  return attrOf(item.find(`[${fields.linkAttr}]`), fields.linkAttr) ?? '';
};

/**
 * The declared date: `fields.date` + `fields.dateAttr` (default `datetime`),
 * then any element carrying that attribute, then the field's text. Text is a
 * publisher's display string, so core's `parseHttpDate` decides later whether
 * it is a date at all — "3 hours ago" becomes `null`, not a guess.
 */
const dateFrom = (item: NodeSet, fields: HtmlFields): string | null => {
  if (fields.date !== undefined) {
    const node = fieldNode(item, fields.date);
    const attr = attrOf(node, fields.dateAttr);
    if (attr !== null) return attr;
    const text = textOf(item, fields.date);
    if (text.length > 0) return text;
  }
  return attrOf(item.find(`time[${fields.dateAttr}], [${fields.dateAttr}]`), fields.dateAttr);
};

/**
 * The byline. `HtmlFields` carries no author selector — a schema gap, named in
 * the report — so the fallback is the HTML convention: `a[rel=author]`, an
 * hCard/hAtom `.author`/`.byline`, `itemprop=author`, or an `address`.
 */
export const AUTHOR_SELECTOR = 'a[rel=author], [rel=author], .author, .byline, [itemprop=author], address';

const authorFrom = (item: NodeSet): string | null => {
  const found = item.find(AUTHOR_SELECTOR);
  if (found.length === 0) return null;
  const text = markupToText(found.text());
  return text.length > 0 ? text : null;
};

/**
 * One item node, stripped of the page's own noise and the source's `strip`
 * list, as fields. The stripping runs on a **clone**: a strip selector may
 * match an element that `fields.title` points at, and removing nodes from the
 * live document would empty that item, and every one after it.
 */
export const fieldsOfItem = (
  item: NodeSet,
  spec: { readonly fields: HtmlFields; readonly strip: readonly string[] },
): RawFields => {
  const fields = spec.fields;
  const scoped = spec.strip.length > 0 ? `${NOISE_SELECTOR}, ${spec.strip.join(', ')}` : NOISE_SELECTOR;
  const stripped = item.clone();
  stripped.find(scoped).remove();
  const summary = textOf(stripped, fields.summary);
  const body = textOf(stripped, fields.body);
  return {
    title: textOf(stripped, fields.title),
    link: linkFrom(stripped, fields),
    publishedAt: dateFrom(stripped, fields),
    summary: summary.length > 0 ? summary : null,
    image: imageFrom(stripped, fields),
    author: authorFrom(stripped),
    body: body.length > 0 ? body : summary,
  };
};
