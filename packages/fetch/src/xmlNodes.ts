import { normalizeText } from 'newspa-core';
import type { XmlTag } from './xmlParse.ts';

/**
 * Navigating what fast-xml-parser returns. The rule that shapes this file:
 * **one occurrence arrives as an object, two as an array** (measured), and a
 * text node arrives as a string, as `#text` beside an attribute, or as a
 * concatenation of mixed content (`text<sub>z</sub>more` → `"textmore"`).
 * Anything that reads a feed must handle all of it, silently picking one shape
 * is how a single-item feed works in dev and breaks in production.
 */

export const asArray = (value: XmlTag): readonly unknown[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];

const textOfRecord = (record: Record<string, unknown>): string => {
  const parts: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (key.startsWith('@_')) continue;
    const text = nodeText(child as XmlTag);
    if (text.length > 0) parts.push(text);
  }
  return parts.join(' ');
};

/** Text of a node, in any of the shapes the parser produces. Whitespace-normalized. */
export const nodeText = (value: XmlTag): string => {
  if (typeof value === 'string') return normalizeText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  const parts: string[] = [];
  for (const entry of asArray(value)) {
    if (typeof entry === 'string') parts.push(normalizeText(entry));
    else if (typeof entry === 'number' || typeof entry === 'boolean') parts.push(String(entry));
    else if (typeof entry === 'object' && entry !== null) parts.push(textOfRecord(entry as Record<string, unknown>));
  }
  return normalizeText(parts.join(' '));
};

/**
 * Raw markup of a node. Feeds escape HTML into `description` (the Guardian
 * ships `<p>` blocks) and CDATA into `content:encoded`; the parser hands that
 * text over undecoded, so the caller turns it into text with `markupToText`.
 */
export const nodeMarkup = (value: XmlTag): string => {
  if (typeof value === 'string') return value;
  return nodeText(value);
};

export const nodeRecord = (value: XmlTag): Record<string, unknown> | null => {
  if (typeof value !== 'object' || value === null) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'object' && first !== null ? (first as Record<string, unknown>) : null;
  }
  return value as Record<string, unknown>;
};

/** An attribute value. The prefix is fixed by `xmlParse.ts` (`@_href`). */
export const nodeAttr = (value: XmlTag, name: string): string | null => {
  const record = nodeRecord(value);
  if (record === null) return null;
  const found = record[`@_${name}`];
  if (typeof found === 'string') return normalizeText(found);
  if (typeof found === 'number' || typeof found === 'boolean') return String(found);
  return null;
};

/**
 * The first of several **lower-cased** tag names. Feeds use namespace prefixes
 * for the same field (`content:encoded`, `dc:creator`, `media:content`) and
 * some publishers write the unprefixed form, so a field is a list of names.
 */
export const nodeTag = (node: Record<string, unknown> | null, names: readonly string[]): XmlTag => {
  if (node === null) return null;
  for (const name of names) {
    const value = node[name];
    if (value !== undefined && value !== null) return value as XmlTag;
  }
  return null;
};

/** Text of the first tag name that exists. `''` when none of them do. */
export const tagText = (node: Record<string, unknown> | null, names: readonly string[]): string =>
  nodeText(nodeTag(node, names));

/**
 * The first attribute that exists on the first of several tags. Enclosures and
 * `media:content` are the case: `url`, `src` and `file` all appear in the wild.
 */
export const tagAttr = (
  node: Record<string, unknown> | null,
  tagNames: readonly string[],
  attrNames: readonly string[],
): string | null => {
  if (node === null) return null;
  for (const tagName of tagNames) {
    const value = node[tagName];
    if (value === undefined || value === null) continue;
    for (const attr of attrNames) {
      const found = nodeAttr(value as XmlTag, attr);
      if (found !== null && found.length > 0) return found;
    }
  }
  return null;
};

/** Every record under a tag name (`media:content` appears more than once). */
export const tagRecords = (
  node: Record<string, unknown> | null,
  names: readonly string[],
): readonly Record<string, unknown>[] => {
  const found = nodeTag(node, names);
  const records: Record<string, unknown>[] = [];
  for (const entry of asArray(found)) {
    const record = nodeRecord(entry as XmlTag);
    if (record !== null) records.push(record);
  }
  return records;
};
