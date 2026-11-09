import { describe, expect, it } from 'vitest';
import {
  asArray,
  nodeAttr,
  nodeMarkup,
  nodeRecord,
  nodeTag,
  nodeText,
  tagAttr,
  tagRecords,
  tagText,
} from '../src/xmlNodes.ts';
import type { XmlDoc, XmlTag } from '../src/xmlParse.ts';
import { parseXml } from '../src/xmlParse.ts';
import { fixture } from './support.ts';

/**
 * The XML layer under every feed parse. Each assertion is a measured behaviour
 * of fast-xml-parser 5.12.0 (see the header of `xmlParse.ts`), so this file is
 * the evidence that the configuration is what the feeds need.
 */
const record = (value: XmlTag): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) throw new Error(`not a record: ${String(value)}`);
  return value as Record<string, unknown>;
};

const asTag = (value: unknown): XmlTag => value as XmlTag;

const parse = (text: string): XmlDoc => {
  const parsed = parseXml(text);
  if (parsed.doc === null) throw new Error(`no document: ${JSON.stringify(parsed.status)}`);
  return parsed.doc;
};

/** The channel record of a parsed document. */
const channelOf = (doc: XmlDoc): Record<string, unknown> => record(asTag(doc.node['channel']));
const itemOf = (doc: XmlDoc): Record<string, unknown> => record(asTag(channelOf(doc)['item']));

/** The status of a parse, narrowed to the failure arm. */
const failure = (text: string): { reason: string; detail: string } => {
  const status = parseXml(text).status;
  if (status.ok === true) throw new Error(`expected a failure: ${String(status.note)}`);
  return status;
};

describe('parseXml', () => {
  it('reads a feed, its attributes and its declaration', () => {
    const doc = parse(
      '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>T</title></channel></rss>',
    );
    expect(doc.root).toBe('rss');
    expect(doc.encoding).toBe('UTF-8');
    expect(parseXml('<?xml version="1.0"?><rss><channel><title>T</title></channel></rss>').status).toEqual({
      ok: true,
      note: null,
    });
    expect(channelOf(doc)['title']).toBe('T');
  });

  it('keeps attributes, because a feed’s fields live in them', () => {
    const doc = parse(
      '<rss><channel><item><guid isPermaLink="false">42</guid><enclosure url="https://e.test/a.jpg" type="image/jpeg"/></item></channel></rss>',
    );
    const item = itemOf(doc);
    expect(item['guid']).toEqual({ '@_ispermalink': 'false', '#text': '42' });
    expect(record(asTag(item['enclosure']))['@_url']).toBe('https://e.test/a.jpg');
  });

  it('keeps a numeric tag value as text, so a guid stays an identity', () => {
    const doc = parse('<rss><channel><item><guid>42</guid><views>0</views><flag>true</flag></item></channel></rss>');
    const item = itemOf(doc);
    expect(item['guid']).toBe('42');
    expect(item['views']).toBe('0');
    expect(item['flag']).toBe('true');
  });

  it('decodes named HTML entities and leaves CDATA alone', () => {
    const doc = parse(
      '<rss><channel><item><title>a &copy; &#8216;q&#8217; &amp; &nbsp; b</title><description><![CDATA[<p>x &amp; y</p>]]></description></item></channel></rss>',
    );
    const item = itemOf(doc);
    // `&nbsp;` decodes to U+00A0 and stays; core's normalizeText is what turns
    // it into a space, so the raw value is asserted first.
    expect(item['title']).toBe('a © ‘q’ & \u00a0 b');
    expect(nodeText(asTag(item['title']))).toBe('a © ‘q’ & b');
    expect(item['description']).toBe('<p>x &amp; y</p>');
  });

  it('names a stream that ends inside an element, and publishes nothing from it', () => {
    const status = failure(fixture('rss-truncated.xml'));
    expect(status.reason).toBe('truncated');
    expect(status.detail).toContain('document ends inside an element');
  });

  it('names text after the root element as malformed, not truncated', () => {
    const status = failure('<rss><channel><title>T</title></channel></rss>trailing');
    expect(status.reason).toBe('malformed');
    expect(status.detail).toContain('text after the root element');
  });

  it('tolerates an unclosed tag inside a text field, and says so', () => {
    const parsed = parseXml(fixture('rss-sloppy-unclosed-element.xml'));
    expect(parsed.status.ok).toBe(true);
    if (parsed.status.ok === false) return;
    expect(parsed.status.note).toContain('the document is not well-formed XML and was read anyway');
    expect(parsed.status.note).toContain('InvalidTag');
    expect(parsed.doc?.root).toBe('rss');
  });

  it('names a character the XML grammar rejects', () => {
    const status = failure('<rss><title>a & b</title></rss>');
    expect(status.reason).toBe('malformed');
    expect(status.detail).toContain("char '&' is not expected");
  });

  it('reports the parser’s own throw, so a crash is a named fault', () => {
    const deep = `<a>${'<a>'.repeat(150)}</a>${'</a>'.repeat(150)}`;
    const status = failure(deep);
    expect(status.reason).toBe('malformed');
    expect(status.detail).toContain('parse failed');
    expect(status.detail).toContain('Maximum nested tags exceeded');
  });

  it('names a root with no element children, and a payload with no start tag', () => {
    expect(failure('<rss></rss>').detail).toBe("root 'rss' has no element children");
    expect(failure('').reason).toBe('truncated');
    expect(failure('<?xml version="1.0"?>').detail).toContain('Start tag expected');
  });

  it('names a payload that is not markup at all, by the character that gave it away', () => {
    // Measured: a JSON body reaches the validator as `InvalidChar`, so the
    // detail names the character that gave the payload away.
    const status = failure('{"json": true}');
    expect(status.reason).toBe('malformed');
    expect(status.detail).toContain("char '{' is not expected");
  });

  it('reads a document that starts with a byte-order mark', () => {
    const doc = parse('<?xml version="1.0"?><rss><channel><title>T</title></channel></rss>');
    expect(doc.root).toBe('rss');
    expect(doc.encoding).toBeNull();
  });

  it('reports the encoding a document declares, and says nothing when it does not', () => {
    expect(parse('<?xml version="1.0" encoding="utf-8"?><rss><channel><title>T</title></channel></rss>').encoding).toBe(
      'utf-8',
    );
    expect(
      parse('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>T</title></channel></rss>').encoding,
    ).toBe('ISO-8859-1');
    expect(parse('<rss><channel><title>T</title></channel></rss>').encoding).toBeNull();
  });
});

describe('xmlNodes', () => {
  it('turns every shape the parser produces into text', () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(['a'])).toEqual(['a']);
    expect(asArray('a')).toEqual(['a']);
    expect(nodeText('  a   b  ')).toBe('a b');
    expect(nodeText(42)).toBe('42');
    expect(nodeText(true)).toBe('true');
    expect(nodeText(null)).toBe('');
    expect(nodeText(undefined)).toBe('');
    expect(nodeText(['one', 2, true, { '#text': 'three' }])).toBe('one 2 true three');
    expect(nodeText({ '#text': 'main', '@_x': 'ignored', sub: 'child' })).toBe('main child');
    expect(nodeText([])).toBe('');
  });

  it('hands markup over untouched, and reads a record out of an array', () => {
    expect(nodeMarkup('<p>Body</p>')).toBe('<p>Body</p>');
    expect(nodeMarkup({ '#text': '<p>Body</p>' })).toBe('<p>Body</p>');
    expect(nodeRecord({ a: 1 })).toEqual({ a: 1 });
    expect(nodeRecord([{ a: 1 }, { b: 2 }])).toEqual({ a: 1 });
    expect(nodeRecord(['text'])).toBeNull();
    expect(nodeRecord('text')).toBeNull();
    expect(nodeRecord(null)).toBeNull();
  });

  it('reads attributes with the parser’s prefix, and keeps their type', () => {
    expect(nodeAttr(asTag({ '@_url': 'https://e.test/a.jpg' }), 'url')).toBe('https://e.test/a.jpg');
    expect(nodeAttr(asTag({ '@_length': 12 }), 'length')).toBe('12');
    expect(nodeAttr(asTag({ '@_flag': true }), 'flag')).toBe('true');
    expect(nodeAttr(asTag({ '@_url': '  spaced  ' }), 'url')).toBe('spaced');
    expect(nodeAttr(asTag({ '@_url': { nested: 1 } }), 'url')).toBeNull();
    expect(nodeAttr(asTag('text'), 'url')).toBeNull();
    expect(nodeAttr(null, 'url')).toBeNull();
  });

  it('finds a field under the first tag name that exists', () => {
    const node = { 'content:encoded': 'Body', description: 'Deck', 'dc:creator': 'Ann' };
    expect(nodeTag(node, ['content:encoded', 'description'])).toBe('Body');
    expect(nodeTag(node, ['missing', 'description'])).toBe('Deck');
    expect(nodeTag(node, ['nope'])).toBeNull();
    expect(nodeTag(null, ['nope'])).toBeNull();
    expect(tagText(node, ['missing', 'dc:creator'])).toBe('Ann');
    expect(tagText(node, ['nope'])).toBe('');
  });

  it('takes the first attribute that exists on the first tag that exists', () => {
    const node = {
      enclosure: { '@_type': 'audio/mpeg' },
      'media:content': { '@_url': 'https://e.test/a.jpg', '@_medium': 'image' },
    };
    expect(tagAttr(node, ['enclosure', 'media:content'], ['url', 'src'])).toBe('https://e.test/a.jpg');
    expect(tagAttr(node, ['enclosure'], ['url', 'src'])).toBeNull();
    expect(tagAttr(node, ['nope'], ['url'])).toBeNull();
    expect(tagAttr(null, ['enclosure'], ['url'])).toBeNull();
  });

  it('collects every record under a tag, including the single-record case', () => {
    const node = { 'media:content': [{ '@_url': 'a' }, 'text', { '@_url': 'b' }] };
    expect(tagRecords(node, ['media:content'])).toEqual([{ '@_url': 'a' }, { '@_url': 'b' }]);
    expect(tagRecords({ 'media:content': { '@_url': 'a' } }, ['media:content'])).toEqual([{ '@_url': 'a' }]);
    expect(tagRecords(node, ['nope'])).toEqual([]);
  });
});
