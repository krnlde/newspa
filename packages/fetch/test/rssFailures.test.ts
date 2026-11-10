import { itemId, pageKey } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import type { RawFields } from '../src/item.ts';
import { buildItem, emptyFields } from '../src/item.ts';
import { parseRssPayload } from '../src/rss.ts';
import { atomLinkOf, authorOf, imageOf, publishedAtOf, rssLinkOf } from '../src/rssFields.ts';
import { buildItems } from '../src/rssItems.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, okItems, rssSource } from './support.ts';

/**
 * Every zero a feed can produce, named. The counts are the point: `matchCount`
 * is the number the picker recorded a selector against, and the skip notes are
 * the only evidence that a feed restructured.
 */
const parse = (payload: string, overrides = {}) => parseRssPayload(payload, rssSource(overrides), sniff(payload));
const fromFixture = (name: string, overrides = {}) => parse(fixture(name), overrides);

describe('a feed with nothing in it', () => {
  it('names a channel that holds no item, and lists its children', () => {
    const failure = failed(fromFixture('rss-no-items.xml'));
    expect(failure.reason).toBe('no-items');
    expect(failure.cause).toBe('rss > channel');
    expect(failure.matchCount).toBe(0);
    expect(failure.detail).toContain('rss > channel was found and holds no item element');
    // fast-xml-parser lower-cases element names, so the note lists the tags
    // as the parser saw them, not as the publisher wrote them.
    expect(failure.detail).toContain(
      'its children are: title, link, description, language, copyright, lastbuilddate, ttl, image',
    );
    expect(failure.notes[0]).toBe("starts with '<?xml'");
  });

  it('names a channel whose only child is a title: the container is there, the ' + 'items are not', () => {
    const failure = failed(parse('<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>'));
    expect(failure.reason).toBe('no-items');
    expect(failure.cause).toBe('rss > channel');
    expect(failure.detail).toContain('rss > channel was found and holds no item element; its children are: title');
  });

  it('names an Atom feed with no entry', () => {
    const failure = failed(
      parse('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>F</title></feed>'),
    );
    expect(failure.reason).toBe('no-items');
    expect(failure.detail).toContain('holds no item element');
  });

  it('names an RSS 1.0 document with no item', () => {
    const failure = failed(
      parse(
        '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><title>x</title></rdf:RDF>',
      ),
    );
    expect(failure.reason).toBe('no-items');
    expect(failure.detail).toContain('rdf:RDF was found and holds no item element');
  });

  it('names a document that is not a feed at all', () => {
    const failure = failed(parse('<?xml version="1.0"?><html><body><p>news</p></body></html>'));
    expect(failure.reason).toBe('no-items');
    expect(failure.detail).toContain("the document's root element is 'html'");
  });

  it('names items that are all unusable, and says why for each', () => {
    const payload =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Broken</title>' +
      '<item><title>No link</title></item><item><link>https://example.invalid/a</link></item></channel></rss>';
    const failure = failed(parse(payload));
    expect(failure.reason).toBe('no-usable-items');
    expect(failure.matchCount).toBe(2);
    expect(failure.detail).toBe('2 item element(s) found, none usable');
    expect(failure.notes).toContain('item 1: no link');
    expect(failure.notes).toContain('item 2: no title');
  });

  it('caps the skip notes, so a 500-item feed does not print 500 lines', () => {
    const items = Array.from({ length: 12 }, (_, i) => `<item><title>No link ${String(i)}</title></item>`).join('');
    const failure = failed(
      parse(`<?xml version="1.0"?><rss version="2.0"><channel><title>Many</title>${items}</channel></rss>`),
    );
    expect(failure.matchCount).toBe(12);
    expect(failure.notes.filter((n) => n.startsWith('item '))).toHaveLength(8);
    expect(failure.notes).toContain('4 more item(s) skipped');
  });

  it(
    'surfaces a truncated stream as truncated, and reads a tolerant document ' + 'with the fault named in the notes',
    () => {
      expect(failed(fromFixture('rss-truncated.xml')).reason).toBe('truncated');
      expect(failed(fromFixture('rss-truncated.xml')).detail).toContain('document ends inside an element');
      const result = fromFixture('rss-sloppy-unclosed-element.xml');
      const items = okItems(result);
      // Measured on fast-xml-parser 5.12.0: the item whose `<description>` opens
      // an `<em>` that never closes swallows every element after it, so the
      // first item is the only one the document still has. Tolerance is a note,
      // not a silent short list: the note says the document is not well-formed.
      expect(items).toHaveLength(1);
      // Measured order: the parser puts an element child's text (`<p>`) before
      // the character data that preceded it, so the line order is the parse
      // order, not the publisher's.
      expect(itemSummary(items[0]?.summary)).toBe('A paragraph Second line First line');
      if (result.ok === true) {
        // The note quotes the validator's own code and message; asserting the
        // whole string would pin fast-xml-parser's wording.
        expect(result.notes.filter((n) => n.startsWith('the document is not well-formed XML'))).toHaveLength(1);
        expect(result.notes.join('\n')).toContain('InvalidTag');
        expect(result.matchCount).toBe(1);
      }
    },
  );
});

const itemSummary = (summary: string | null | undefined): string => summary ?? '';

describe('the field ladders, on the shapes fast-xml-parser produces', () => {
  it('finds the story image, in the order the tags are evidence', () => {
    expect(imageOf({ enclosure: { '@_url': 'a.mp3', '@_type': 'audio/mpeg' } })).toBeNull();
    expect(imageOf({ enclosure: { '@_url': 'a.jpg', '@_type': 'image/jpeg' } })).toBe('a.jpg');
    expect(imageOf({ enclosure: { '@_url': 'a.jpg', '@_medium': 'image' } })).toBe('a.jpg');
    expect(imageOf({ enclosure: { '@_src': 'a.jpg', '@_medium': 'image' } })).toBe('a.jpg');
    expect(imageOf({ 'media:content': [{ '@_url': 'a.mp3', '@_type': 'audio/mpeg' }, { '@_url': 'b.jpg' }] })).toBe(
      'b.jpg',
    );
    expect(imageOf({ 'media:thumbnail': { '@_url': 'thumb.jpg' } })).toBe('thumb.jpg');
    expect(imageOf({ 'media:image': { '@_url': 'image.jpg' } })).toBe('image.jpg');
    expect(imageOf({ image: { '@_url': 'logo.jpg' } })).toBe('logo.jpg');
    expect(imageOf({ thumbnail: { '@_href': 'thumb.jpg' } })).toBe('thumb.jpg');
    expect(imageOf({})).toBeNull();
    // An enclosure that declares an image type under a `src` attribute, and one
    // with no URL at all: the ladder reads `url`, `src` and `file`, and an
    // element without a URL is not an image.
    expect(imageOf({ enclosure: { '@_type': 'image/png', '@_src': 'c.png' } })).toBe('c.png');
    expect(imageOf({ enclosure: { '@_type': 'image/png' } })).toBeNull();
    // A `video` medium is not an image even when the type says image.
    expect(imageOf({ 'media:content': { '@_url': 'a.png', '@_type': 'image/png', '@_medium': 'video' } })).toBe(
      'a.png',
    );
  });

  it('reads the Atom link ladder: alternate, then any, then the feed’s own', () => {
    expect(atomLinkOf({})).toBe('');
    expect(atomLinkOf({ link: [{ '@_rel': 'self', '@_href': 'feed.atom' }] })).toBe('feed.atom');
    expect(atomLinkOf({ link: [{ '@_rel': 'self', '@_href': 'feed.atom' }, { '@_href': '/story' }] })).toBe('/story');
    expect(
      atomLinkOf({
        link: [
          { '@_rel': 'alternate', '@_type': 'application/atom+xml', '@_href': '/atom' },
          { '@_rel': 'alternate', '@_type': 'text/html', '@_href': '/html' },
        ],
      }),
    ).toBe('/html');
    // A `link` with no `href` is a shape GitHub-adjacent feeds write: it is not
    // a story link, and the parser says so with `''`, never with a guess.
    expect(atomLinkOf({ link: [{ '@_rel': 'self' }] })).toBe('');
  });

  it('reads the author ladder: Atom’s author/name, RSS’s dc:creator, and arrays', () => {
    expect(authorOf({ author: { name: 'Ann Example' } })).toBe('Ann Example');
    // An `author` with no `name` child: the ladder falls back to the RSS tags.
    expect(authorOf({ author: { uri: 'https://example.invalid/ann' }, 'dc:creator': 'Ben Example' })).toBe(
      'Ben Example',
    );
    // Cloudflare's blog writes several `dc:creator` elements: the parser hands
    // them over as an array, and the ladder joins them into one byline.
    expect(authorOf({ 'dc:creator': ['Ann Example', 'Ben Example'] })).toBe('Ann Example Ben Example');
    expect(authorOf({})).toBeNull();
  });

  it('reads the publication date, and the feed’s date as the last resort', () => {
    expect(publishedAtOf({ published: '2025-11-09T10:00:00Z' }, null)).toBe('2025-11-09T10:00:00Z');
    expect(publishedAtOf({ 'dcterms:created': '2025-11-08T10:00:00Z' }, null)).toBe('2025-11-08T10:00:00Z');
    expect(publishedAtOf({ updated: '2025-11-07T10:00:00Z' }, { updated: '2025-11-01T00:00:00Z' })).toBe(
      '2025-11-07T10:00:00Z',
    );
    // The feed's own date: the parser lower-cases element names, and so does
    // the ladder that reads them.
    expect(publishedAtOf({}, { lastbuilddate: 'Sun, 09 Nov 2025 12:00:00 GMT' })).toBe('Sun, 09 Nov 2025 12:00:00 GMT');
    expect(publishedAtOf({}, { updated: '2025-11-01T00:00:00Z' })).toBe('2025-11-01T00:00:00Z');
    // RSS 1.0 writes the date under `dc:date`, which is a nested arm.
    expect(publishedAtOf({ 'dc:date': '2025-11-06T10:00:00Z' }, {})).toBe('2025-11-06T10:00:00Z');
    expect(publishedAtOf({}, {})).toBeNull();
  });

  it('reads the link of RSS 2.0, RSS 1.0 and a link element carrying an attribute', () => {
    expect(rssLinkOf({ link: 'https://example.invalid/a' })).toBe('https://example.invalid/a');
    expect(rssLinkOf({ '@_rdf:about': 'https://example.invalid/b' })).toBe('https://example.invalid/b');
    expect(rssLinkOf({ '@_rdf:about': '', link: { '@_href': 'https://example.invalid/c' } })).toBe(
      'https://example.invalid/c',
    );
    expect(rssLinkOf({})).toBe('');
  });

  it('builds items, counts what it saw, and reports the cap', () => {
    const fields = (): RawFields => ({
      title: 'T',
      link: 'https://example.invalid/x',
      publishedAt: null,
      summary: null,
      image: null,
      author: null,
      body: '',
    });
    const nodes = [
      { title: 'A', link: 'https://example.invalid/a' },
      { title: 'B', link: 'https://example.invalid/b' },
      { title: 'C', link: 'https://example.invalid/c' },
    ];
    const built = buildItems(rssSource({ maxItems: 2 }), nodes, null, rssLinkOf, fields);
    expect(built.items).toHaveLength(2);
    expect(built.seen).toBe(3);
    expect(built.capped).toBe(true);
    expect(built.skipped).toEqual([]);
    const unusable = buildItems(rssSource(), nodes, null, rssLinkOf, emptyFields);
    expect(unusable.items).toEqual([]);
    expect(unusable.skipped.map((s) => s.why)).toEqual(['no title', 'no title', 'no title']);
    expect(unusable.capped).toBe(false);
  });
});

describe('the key a PickedItem gets', () => {
  const spec = { id: 'src', url: 'https://example.invalid/' };
  const raw: RawFields = {
    title: 'T',
    link: 'https://example.invalid/a',
    publishedAt: null,
    summary: null,
    image: null,
    author: null,
    body: '',
  };

  it('is the canonical link, and a declared guid never reaches it', () => {
    expect(buildItem(spec, raw).key).toBe(itemId('src', 'https://example.invalid/a', 'T', null));
    // No link: title+day. The degradation is core's rule, not this package's.
    expect(buildItem(spec, emptyFields()).key).toBe(itemId('src', '', '', null));
  });

  it('is the caller’s key and cap when they are given — the page-level source', () => {
    // The page parser owns both: identity is an address (core's `pageKey`,
    // D-028), and the body window is `capPageBody`, because for that source the
    // stored text is what the diff compares.
    const key = pageKey('src');
    expect(buildItem(spec, raw, key).key).toBe(key);
    const long = { ...raw, body: 'x'.repeat(9000) };
    expect(buildItem(spec, long).body).toHaveLength(1201);
    expect(buildItem(spec, long, key, (text) => text).body).toHaveLength(9000);
  });
});
