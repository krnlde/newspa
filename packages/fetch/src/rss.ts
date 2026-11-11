import type { RssSource } from 'newspa-config';
import type { ParseResult } from './results.ts';
import { failWith, skipNotes, succeed } from './results.ts';
import { atomLinkOf, fieldsOf, rssLinkOf } from './rssFields.ts';
import { buildItems } from './rssItems.ts';
import type { Sniffed } from './sniff.ts';
import { nodeRecord, nodeTag } from './xmlNodes.ts';
import type { XmlDoc } from './xmlParse.ts';
import { elementKeys, parseXml } from './xmlParse.ts';

/**
 * A feed payload → items. The **root tag** decides the flavour, because the
 * `content-type` does not (D-006; measured: `ubuntu.com/blog/feed` answers
 * `application/rss+xml` for an RSS 2.0 document).
 */

interface FeedShape {
  readonly container: string;
  readonly feed: Record<string, unknown>;
  readonly items: readonly Record<string, unknown>[];
  readonly flavour: 'rss' | 'atom' | 'rdf';
}

const noShape = (container: string): { readonly container: string } => ({ container });

const records = (value: unknown): readonly Record<string, unknown>[] => {
  const list = value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
  const found: Record<string, unknown>[] = [];
  for (const entry of list) {
    const record = nodeRecord(entry);
    if (record !== null) found.push(record);
  }
  return found;
};

const itemRecords = (node: Record<string, unknown>, names: readonly string[]): readonly Record<string, unknown>[] => {
  for (const name of names) {
    const found = records(nodeTag(node, [name]));
    if (found.length > 0) return found;
  }
  return [];
};

/** `rss > channel > item`, `rdf:RDF > item`, `feed > entry`. */
export const feedShapeOf = (doc: XmlDoc): FeedShape | { readonly container: string } => {
  const channel = nodeRecord(nodeTag(doc.node, ['channel']));
  if (doc.root === 'rss') {
    const holder = channel === null ? doc.node : channel;
    const items = itemRecords(holder, ['item']);
    // A channel that exists — even empty — is a shape, so the caller can name
    // it and list its children. Measured: `<rss></rss>` and an empty
    // `<channel></channel>` both leave a `null` value, so "the element is in
    // the document" is the test, and the two names stay apart.
    const declared = 'channel' in doc.node;
    if (!declared && items.length === 0) return noShape('rss (no channel, no item)');
    // The container's name is the shape that was *written*: a `channel` element
    // whose content is empty is still `rss > channel`.
    return {
      container: declared ? 'rss > channel' : 'rss',
      // The feed node is the channel when one is written: its children are the
      // feed's own fields (`title`, `lastBuildDate`), not the rss wrapper's. An
      // empty channel is a node with no children, not the wrapper's attributes.
      feed: channel ?? {},
      items,
      flavour: 'rss',
    };
  }
  if (doc.root === 'rdf:rdf') {
    return { container: 'rdf:RDF', feed: doc.node, items: itemRecords(doc.node, ['item']), flavour: 'rdf' };
  }
  if (doc.root === 'feed') {
    return { container: 'feed', feed: doc.node, items: itemRecords(doc.node, ['entry']), flavour: 'atom' };
  }
  return noShape(doc.root);
};

const isShape = (shape: FeedShape | { readonly container: string }): shape is FeedShape => 'flavour' in shape;

const linkFor = (flavour: FeedShape['flavour']): ((node: Record<string, unknown>) => string) =>
  flavour === 'atom' ? atomLinkOf : rssLinkOf;

/** A zero-item result says which of the two it is: no container, or an empty one. */
const explainEmpty = (shape: FeedShape): string => {
  // Only element children: a `@_version` attribute is not a feed's content, and
  // listing it would send a source author hunting for a tag that isn't there.
  const keys = elementKeys(shape.feed);
  const children = keys.length > 0 ? `; its children are: ${keys.slice(0, 8).join(', ')}` : '; it has no children';
  return `${shape.container} was found and holds no item element${children}`;
};

const feedNotes = (sniffed: Sniffed, note: string | null): string[] =>
  note === null ? [sniffed.reason] : [sniffed.reason, note];

/** Parse a feed payload. `sniffed` is the caller's `sniff(text)`, so the note matches. */
export const parseRssPayload = (text: string, spec: RssSource, sniffed: Sniffed): ParseResult => {
  const parsed = parseXml(text);
  const base = { kind: spec.kind, sniffed: sniffed.kind, marker: sniffed.marker } as const;
  if (parsed.status.ok === false || parsed.doc === null) {
    const detail =
      parsed.status.ok === false
        ? parsed.status.detail
        : parsed.doc === null
          ? 'the payload parsed to no document'
          : '';
    return failWith({ ...base, reason: parsed.status.ok === false ? parsed.status.reason : 'malformed', detail });
  }
  const notes = feedNotes(sniffed, parsed.status.note);
  // A declared encoding the transport did not obey is visible, never silent:
  // the payload arrives decoded, and a feed that says ISO-8859-1 while being
  // read as UTF-8 shows up as mojibake in the paper, not as a fault.
  if (parsed.doc.encoding !== null && !/^utf-8$/i.test(parsed.doc.encoding)) {
    notes.push(`the document declares encoding '${parsed.doc.encoding}', which the transport does not decode`);
  }
  const shape = feedShapeOf(parsed.doc);
  if (!isShape(shape)) {
    return failWith({
      ...base,
      reason: 'no-items',
      detail: `no RSS, RSS 1.0 or Atom container: the document's root element is '${shape.container}'`,
      cause: shape.container,
      matchCount: 0,
      notes,
    });
  }
  if (shape.items.length === 0) {
    return failWith({
      ...base,
      reason: 'no-items',
      detail: explainEmpty(shape),
      cause: shape.container,
      matchCount: 0,
      notes,
    });
  }
  const built = buildItems(spec, shape.items, shape.feed, linkFor(shape.flavour), fieldsOf);
  notes.push(...skipNotes(built.skipped));
  if (built.capped)
    notes.push(`${String(shape.items.length - spec.maxItems)} item(s) past maxItems ${String(spec.maxItems)}`);
  if (built.items.length === 0) {
    return failWith({
      ...base,
      reason: 'no-usable-items',
      detail: `${String(built.seen)} item element(s) found, none usable`,
      cause: shape.container,
      matchCount: built.seen,
      notes,
    });
  }
  return succeed({
    items: built.items,
    kind: spec.kind,
    sniffed: 'rss',
    marker: sniffed.marker,
    notes,
    skipped: built.skipped.length,
    matchCount: built.seen,
    capped: built.capped,
  });
};
