import { XMLParser, XMLValidator } from 'fast-xml-parser';

/**
 * The XML layer every feed parser sits on. fast-xml-parser **5.12.0** is pinned
 * in the catalog, and its defaults are the v4 defaults with two changes that
 * matter, both measured with probes before this file was written:
 *
 * - `ignoreAttributes` defaults to **`true`** (v4: `false`). Left alone, every
 *   `guid isPermaLink`, `enclosure url`, `media:content url` and Atom
 *   `link href` disappears — a feed of items with no link and no image.
 * - the text node key defaults to **`#text`** (v4: `__text`).
 *
 * Also measured:
 * - `parseTagValue` (default `true`) coerces `42` → number and `true` →
 *   boolean, so a numeric `guid` loses the text identity it was written as.
 *   `parseTagValue: false` keeps every value a string.
 * - XML built-ins and numeric refs decode; **named HTML entities do not**
 *   (`&copy;` stays literal). `htmlEntities: true` decodes them, `&nbsp;`
 *   included, and core's `normalizeText` turns that U+00A0 into a space.
 * - CDATA merges into the text value and its content is **not** entity-decoded,
 *   which is what makes `content:encoded` usable as HTML.
 * - namespace prefixes stay in the key as written (`dc:creator`,
 *   `content:encoded`), so tag lookup is by lower-cased prefixed name.
 * - a **truncated document does not throw**: the truncated `<item>` came back
 *   with `title: ""`. Silence is exactly the bug rule 5 is about, so
 *   `XMLValidator.validate` runs first and its `code` decides the outcome.
 * - `maxNestedTags` (default 100) **throws**, and `unpairedTags` is a trap:
 *   adding HTML's `link` makes the parser throw on real feeds ("Unpaired tag
 *   can not be used as closing tag: `</link>`", measured on the BBC feed).
 * - the XML **declaration is not surfaced**: with `ignoreDeclaration: false` the
 *   parsed object still has no `?xml` key (measured), so the declared encoding
 *   is read from the payload's first line and reported as a note (`rss.ts`).
 * - validate costs ~5 ms and parse ~14 ms on a 1.1 MB feed, so the ladder's
 *   expensive rung is not this.
 */

/** What the parser hands back for one element: text, a record, an array, a number, a flag. */
export type XmlTag = string | number | boolean | Record<string, unknown> | readonly unknown[] | null | undefined;

export interface XmlDoc {
  /** Lower-cased root element name, prefixes kept (`rdf:rdf`). */
  readonly root: string;
  readonly node: Record<string, unknown>;
  /** The document's declared encoding, from the `<?xml?>` declaration, if any. */
  readonly encoding: string | null;
}

export type XmlStatus =
  | { readonly ok: true; readonly note: string | null }
  | { readonly ok: false; readonly reason: 'truncated' | 'malformed'; readonly detail: string };

export interface XmlParse {
  readonly doc: XmlDoc | null;
  readonly status: XmlStatus;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true,
  ignoreDeclaration: false,
  ignorePiTags: true,
  transformTagName: (tag) => tag.toLowerCase(),
  transformAttributeName: (attr) => attr.toLowerCase(),
});

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const nonElement = (key: string): boolean => key.startsWith('!') || key.startsWith('?');

/** The keys of a node that are **element children** (not attributes, not the declaration). */
export const elementKeys = (node: Record<string, unknown>): readonly string[] =>
  Object.keys(node).filter((key) => !nonElement(key) && !key.startsWith('@_'));

/**
 * The declared encoding, read from the payload's own declaration: measured on
 * 5.12.0, the parser does not surface the declaration at all (`ignoreDeclaration:
 * false` still returns an object with no `?xml` key), and a feed that declares
 * ISO-8859-1 while the transport decodes UTF-8 is mojibake in the paper with no
 * fault anywhere. A declaration is one line, so the scan is bounded to it.
 */
const ENCODING = /<\?xml[^>]*encoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/;

const declaredEncoding = (text: string): string | null => {
  const found = ENCODING.exec(text.slice(0, 200));
  return found?.[1] ?? null;
};

/**
 * The validator's measured `code` decides the failure name:
 * `InvalidXml` = the document ends inside an element (truncation, unclosed
 * CDATA); `InvalidTag` = one element is unclosed **inside** a text field, the
 * shape of a feed that puts raw HTML in `<description>`, which real publishers
 * do and the parser reads anyway; `InvalidChar` = not XML at all.
 */
const classify = (err: {
  code: string;
  msg: string;
}): { readonly ok: false; readonly reason: 'truncated' | 'malformed'; readonly detail: string } => {
  if (err.code === 'InvalidXml' && err.msg.includes('Extra text at the end')) {
    return { ok: false, reason: 'malformed', detail: `text after the root element: ${err.msg}` };
  }
  if (err.code === 'InvalidXml')
    return { ok: false, reason: 'truncated', detail: `document ends inside an element: ${err.msg}` };
  return { ok: false, reason: 'malformed', detail: `${err.code}: ${err.msg}` };
};

const tolerance = (err: { code: string; msg: string }): string =>
  `the document is not well-formed XML and was read anyway (${err.code}: ${err.msg})`;

/** Validate, then parse. The document's own shape decides whether items are trustworthy. */
export const parseXml = (payload: string): XmlParse => {
  const text = stripBom(payload);
  const checked = XMLValidator.validate(text);
  let note: string | null = null;
  if (checked !== true) {
    const err = checked.err;
    if (err.code === 'InvalidTag') note = tolerance(err);
    else return { doc: null, status: classify(err) };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(text) as Record<string, unknown>;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { doc: null, status: { ok: false, reason: 'malformed', detail: `parse failed: ${message}` } };
  }
  const root = Object.keys(parsed).find((key) => !nonElement(key));
  const value = root === undefined ? undefined : parsed[root];
  // Defensive: measured, an empty root — self-closing or not — arrives as a
  // `null` value, which the next arm names, so this arm has no payload shape.
  if (root === undefined) {
    return { doc: null, status: { ok: false, reason: 'malformed', detail: 'no element in the document' } };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { doc: null, status: { ok: false, reason: 'malformed', detail: `root '${root}' has no element children` } };
  }
  const node = value as Record<string, unknown>;
  return {
    doc: { root, node, encoding: declaredEncoding(text) },
    status: { ok: true, note },
  };
};
