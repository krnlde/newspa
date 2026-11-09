import { markupToText } from './htmlText.ts';
import type { RawFields } from './item.ts';
import { nodeAttr, nodeMarkup, nodeRecord, nodeTag, nodeText, tagAttr, tagRecords } from './xmlNodes.ts';
import type { XmlTag } from './xmlParse.ts';

/**
 * The fields a feed can carry, measured on four feeds captured from real
 * publishers (BBC, the Guardian, Cloudflare's blog, Ubuntu's blog) plus Atom:
 * the same field arrives under three different names, and a publisher that
 * ships `content:encoded` usually ships a truncated `description` beside it.
 *
 * fast-xml-parser keeps namespace prefixes in the key and this file's keys are
 * lower-cased (`xmlParse.ts` transforms tag names), hence `content:encoded` and
 * `dc:creator` — the spellings the feeds actually write.
 */

/** Namespaced tags appear with and without the prefix across publishers. */
export const TITLE_TAGS = ['title'];
export const LINK_TAGS = ['link'];
export const DESCRIPTION_TAGS = ['description', 'summary', 'subtitle'];
export const BODY_TAGS = ['content:encoded', 'encoded', 'content', 'body', 'full-text'];
export const AUTHOR_TAGS = [
  'dc:creator',
  'creator',
  'author',
  'dc:contributor',
  'itunes:author',
  'media:credit',
  'byline',
];
export const PUBLISHED_TAGS = ['published', 'pubdate', 'date', 'dc:date', 'dcterms:created', 'updated'];

/** The attributes an image URL hides behind, in the order publishers write them. */
const IMAGE_ATTRS = ['url', 'src', 'file', 'href'];

const isImageType = (value: string | null): boolean =>
  value !== null && (value.toLowerCase().startsWith('image/') || value.toLowerCase() === 'image');

const enclosureImage = (node: Record<string, unknown>): string | null => {
  for (const record of tagRecords(node, ['enclosure'])) {
    const type = nodeAttr(record, 'type');
    const medium = nodeAttr(record, 'medium');
    const url = nodeAttr(record, 'url') ?? nodeAttr(record, 'src') ?? nodeAttr(record, 'file');
    if (url === null) continue;
    if (isImageType(type) || medium === 'image') return url;
  }
  return null;
};

const mediaImage = (node: Record<string, unknown>): string | null => {
  for (const tag of ['media:content', 'media:thumbnail', 'media:image']) {
    for (const record of tagRecords(node, [tag])) {
      const medium = nodeAttr(record, 'medium');
      const type = nodeAttr(record, 'type');
      const url = nodeAttr(record, 'url');
      // A declared type that is not an image rules the element out, whatever
      // `medium` says: a video `media:content` with no `medium` is the case.
      if (url === null || (type !== null && !isImageType(type))) continue;
      if (medium === 'image' || isImageType(type) || medium === null) return url;
    }
  }
  return null;
};

/**
 * The item's image, in the order the tags are evidence of a **story** image:
 * an enclosure of `type="image/…"`, then `media:` (the Guardian ships
 * `media:content` with a `media:credit` child, Cloudflare an `enclosure`),
 * then a plain `image`/`thumbnail` child. The `<image>` under a **channel** is
 * the feed's logo and is never reached from here.
 */
export const imageOf = (node: Record<string, unknown>): string | null =>
  enclosureImage(node) ?? mediaImage(node) ?? tagAttr(node, ['image', 'thumbnail'], IMAGE_ATTRS);

/**
 * An Atom author is `<author><name>…</name></author>`; RSS is
 * `<dc:creator>…</dc:creator>`, and Cloudflare's blog ships several
 * `<dc:creator>` elements, which the parser hands over as an array.
 */
export const authorOf = (node: Record<string, unknown>): string | null => {
  const author = nodeTag(node, ['author']);
  const record = nodeRecord(author);
  if (record !== null) {
    const name = nodeText(nodeTag(record, ['name']));
    if (name.length > 0) return name;
  }
  const text = nodeText(nodeTag(node, AUTHOR_TAGS));
  return text.length > 0 ? text : null;
};

/**
 * `atom:updated` is not a publication date, and D-020 says so of pages ("a page
 * whose newest story is old has not changed"). RSS 2.0's `pubDate` and Atom's
 * `published` are, so they are looked for first and `updated` is the last
 * resort — a feed that only declares `updated` is a feed that only declares it.
 */
export const publishedAtOf = (node: Record<string, unknown>, feed: Record<string, unknown> | null): string | null => {
  for (const tag of PUBLISHED_TAGS) {
    const value = nodeText(nodeTag(node, [tag]));
    if (value.length > 0) return value;
  }
  const nested = nodeTag(node, ['dc:date', 'dcterms:modified']);
  const nestedText = nodeText(nested);
  if (nestedText.length > 0) return nestedText;
  if (feed === null) return null;
  for (const tag of ['lastbuilddate', 'updated']) {
    const value = nodeText(nodeTag(feed, [tag]));
    if (value.length > 0) return value;
  }
  return null;
};

/** Text of a field that HTML is allowed in. `''` when the tag is absent. */
export const htmlTextOf = (node: Record<string, unknown>, tags: readonly string[]): string => {
  const value: XmlTag = nodeTag(node, tags);
  const markup = nodeMarkup(value);
  return markup.length === 0 ? '' : markupToText(markup);
};

const firstText = (node: Record<string, unknown>, tags: readonly string[]): string => nodeText(nodeTag(node, tags));

/** RSS 2.0's `link` is text; RSS 1.0's is the item's own `rdf:about`. */
export const rssLinkOf = (node: Record<string, unknown>): string => {
  const direct = nodeText(nodeTag(node, LINK_TAGS));
  if (direct.length > 0) return direct;
  const about = nodeAttr(node, 'rdf:about');
  if (about !== null && about.length > 0) return about;
  return tagAttr(node, ['link', 'url'], ['href', 'about', 'rdf:about']) ?? '';
};

/**
 * Atom links carry a `rel`: `alternate` is the story (and is the default when
 * `rel` is absent), `self` is the feed's own URL and `enclosure` is an asset.
 * Measured on GitHub's `releases.atom`: an entry has two links, and taking the
 * first is how a parser prints `…/releases.atom` as the article link.
 */
export const atomLinkOf = (node: Record<string, unknown>): string => {
  const links = tagRecords(node, ['link']);
  const hrefOf = (record: Record<string, unknown>): string | null => nodeAttr(record, 'href');
  const alternates = links.filter((record) => {
    const rel = nodeAttr(record, 'rel');
    return rel === null || rel.toLowerCase() === 'alternate';
  });
  const html = alternates.find((record) => {
    const type = nodeAttr(record, 'type');
    return type === null || type.toLowerCase() === 'text/html';
  });
  const chosen = html ?? alternates[0] ?? links[0];
  if (chosen === undefined) return '';
  return hrefOf(chosen) ?? '';
};

/** One item node → the fields a `PickedItem` is built from. */
export const fieldsOf = (
  node: Record<string, unknown>,
  feed: Record<string, unknown> | null,
  link: string,
): RawFields => {
  const summary = htmlTextOf(node, DESCRIPTION_TAGS);
  const bodyMarkup = nodeMarkup(nodeTag(node, BODY_TAGS));
  const body = bodyMarkup.length > 0 ? markupToText(bodyMarkup) : summary;
  return {
    title: firstText(node, TITLE_TAGS),
    link,
    publishedAt: publishedAtOf(node, feed),
    summary: summary.length > 0 ? summary : null,
    image: imageOf(node),
    author: authorOf(node),
    body,
  };
};
