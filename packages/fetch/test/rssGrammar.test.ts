import type { RssSource } from 'newspa-config';
import { itemId } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import type { ParseResult } from '../src/results.ts';
import { parseRssPayload } from '../src/rss.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, isoDate, itemAt, linkKey, okItems, rssSource, titleKey } from './support.ts';

/**
 * The feed grammar: `guid` spellings, the Atom link ladder, RSS 1.0's
 * attribute link. The fixtures state why each one is pinned; the assertions
 * state what the parser promises.
 */
const parse = (name: string, overrides: Partial<RssSource> = {}): ParseResult => {
  const text = fixture(name);
  return parseRssPayload(text, rssSource(overrides), sniff(text));
};

const firstItem = (result: ParseResult) => {
  const items = okItems(result);
  const first = items[0];
  if (first === undefined) throw new Error('no items');
  return first;
};

describe('the guid grammar (rss-guid-permalink.xml)', () => {
  const result = parse('rss-guid-permalink.xml');

  it('parses the six publishable items and counts the two it skipped', () => {
    const items = okItems(result);
    expect(items).toHaveLength(6);
    if (result.ok === false) return;
    expect(result.matchCount).toBe(8);
    expect(result.skipped).toBe(2);
    expect(result.notes).toContain('item 4: no link');
    expect(result.notes).toContain('item 8: no title');
  });

  it('keys a permalink-guided item by its canonical link, not by the guid', () => {
    const first = itemAt(okItems(result), 0);
    expect(first.title).toBe('Permalink guid, tracking parameters on both');
    expect(first.link).toBe('https://example.invalid/permalink?utm_source=rss&ref=feed');
    expect(first.publishedAt).toBe('2025-11-09T10:00:00.000Z');
    // The identity is the link, and `utm_source` is stripped from it.
    expect(first.key).toBe(
      itemId('test-source', 'https://example.invalid/permalink?ref=feed', first.title, first.publishedAt),
    );
    expect(first.key).toMatch(linkKey);
    // `ref` is deliberately not stripped by core (plenty of sites need it), so
    // it is part of this key, and the guid's parameters are beside the point:
    // the guid is not in the key at all.
    expect(first.key).not.toBe(
      itemId('test-source', 'https://example.invalid/permalink', first.title, first.publishedAt),
    );
    expect(first.key).not.toBe(
      itemId('test-source', 'https://example.invalid/permalink?utm_source=news', first.title, first.publishedAt),
    );
  });

  it('ignores a guid that declares itself not a permalink, and uses the link', () => {
    const items = okItems(result);
    const opaque = itemAt(items, 1);
    expect(opaque.link).toBe('https://example.invalid/opaque');
    expect(opaque.publishedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(opaque.key).toBe(itemId('test-source', opaque.link, opaque.title, opaque.publishedAt));
    expect(opaque.key).not.toContain('tag:example.invalid');
    const numeric = itemAt(items, 2);
    expect(numeric.title).toBe('Numeric guid stays text');
    expect(numeric.key).toBe(
      itemId('test-source', 'https://example.invalid/numeric', numeric.title, numeric.publishedAt),
    );
  });

  it('decodes the entity forms a real feed mixes, and leaves CDATA markup alone', () => {
    const items = okItems(result);
    const cdata = itemAt(items, 3);
    expect(cdata.title).toBe('CDATA title &amp; ampersand');
    expect(cdata.summary).toBe('CDATA deck & more');
    // The item declares no date, so the channel's lastBuildDate is its date.
    expect(cdata.publishedAt).toBe('2025-11-09T12:00:00.000Z');
    const entities = itemAt(items, 4);
    expect(entities.title).toBe('Unescaped entity and © and ‘quoted’');
    expect(entities.link).toBe('https://example.invalid/entities?a=1&b=2');
    expect(entities.image).toBe('https://example.invalid/hero.jpg');
    // An audio enclosure is not the story image.
    expect(entities.image).not.toContain('podcast');
  });

  it('prefers the image enclosure, resolves a relative link, and reads dc:creator', () => {
    const items = okItems(result);
    const enclosure = itemAt(items, 5);
    expect(enclosure.title).toBe('Enclosure image wins over the audio one');
    expect(enclosure.link).toBe('https://example.invalid/relative/enclosure');
    expect(enclosure.image).toBe('https://example.invalid/hero.jpg');
    expect(enclosure.author).toBe('Ann Example');
    expect(enclosure.summary).toBeNull();
    // normalizeText collapses the description's paragraph breaks: a PickedItem
    // is one line, and the teaser builder owns the split.
    expect(enclosure.body).toBe('Long body & paragraphs. Second paragraph.');
  });
});

describe('a guid never decides identity', () => {
  const payload =
    '<?xml version="1.0"?><rss version="2.0"><channel><title>Strategy</title>' +
    '<item><title>One</title><link>https://example.invalid/link</link>' +
    '<guid isPermaLink="true">https://example.invalid/guid</guid></item></channel></rss>';
  const keyOf = (text: string): string => firstItem(parseRssPayload(text, rssSource(), sniff(text))).key;
  const fromLink = itemId('test-source', 'https://example.invalid/link', 'One', null);

  it('takes the link when the guid claims to be the permalink', () => {
    expect(keyOf(payload)).toBe(fromLink);
    // The declared identifier is not the key, and its absence is visible in the
    // key's shape: no `:i` arm, no `:t` arm, a plain link hash.
    expect(keyOf(payload)).toMatch(linkKey);
  });

  it('is indifferent to `isPermaLink`, to an opaque id, and to no guid at all', () => {
    const variants = [
      payload.replace('isPermaLink="true"', 'isPermaLink="false"'),
      payload.replace('>https://example.invalid/guid<', '>tag:example,2026:one<'),
      payload.replace('>https://example.invalid/guid<', '>9182736455<'),
      payload.replace(/<guid[\s\S]*?<\/guid>/, ''),
    ];
    for (const variant of variants) expect(keyOf(variant)).toBe(fromLink);
  });

  it('falls back to title+day when the link is not a story URL', () => {
    // A scraped `mailto:` is not a story address, so it is not an identity.
    const mailto = payload.replace('https://example.invalid/link', 'mailto:tips@example.invalid');
    expect(keyOf(mailto)).toMatch(titleKey);
  });
});

describe('the Atom ladder (atom-links.xml)', () => {
  const result = parse('atom-links.xml');

  it('takes the alternate link, and skips the entry with no link at all', () => {
    const items = okItems(result);
    expect(items).toHaveLength(2);
    if (result.ok === false) return;
    expect(result.matchCount).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.notes).toContain('item 3: no link');
  });

  it('prefers a text/html alternate over the feed’s own link, and keeps the query', () => {
    const first = itemAt(okItems(result), 0);
    expect(first.link).toBe('https://example.invalid/entries/one?utm_source=atom');
    expect(first.publishedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(first.summary).toBe('Deck & more');
    expect(first.body).toBe('Body paragraph one. Body paragraph two.');
    expect(first.author).toBe('Ann Example');
  });

  it('falls back to updated, reads a string author, and takes a media image', () => {
    const items = okItems(result);
    const second = itemAt(items, 1);
    expect(second.link).toBe('https://example.invalid/entries/two');
    expect(second.publishedAt).toBe('2025-11-08T10:00:00.000Z');
    expect(second.author).toBe('Ben Example');
    expect(second.image).toBe('https://example.invalid/media.jpg');
    // xhtml content arrives as elements, so its paragraphs flatten to one line.
    expect(second.body).toBe('XHTML body & text Second paragraph.');
  });

  it('parses the real GitHub feed with the same ladder', () => {
    const items = okItems(parse('feed-github-releases.atom.xml', { maxItems: 500 }));
    // The capture keeps ten entries: GitHub serves ten, and every one parses.
    expect(items).toHaveLength(10);
    for (const item of items) expect(item.link).toContain('/releases/tag/');
  });
});

describe('RSS 1.0 (rss-rdf-1.0.xml)', () => {
  const result = parse('rss-rdf-1.0.xml');

  it('reaches the items with no channel, and reads the link from rdf:about', () => {
    const items = okItems(result);
    expect(items).toHaveLength(2);
    const first = itemAt(items, 0);
    expect(first.link).toBe('https://example.invalid/rdf/one');
    expect(first.author).toBe('Ann Example');
    expect(first.publishedAt).toBe('2025-11-09T10:00:00.000Z');
    const second = itemAt(items, 1);
    expect(second.title).toBe('No link element, only about');
    expect(second.link).toBe('https://example.invalid/rdf/two');
    expect(second.publishedAt).toBe('2025-11-08T10:00:00.000Z');
  });

  it('is sniffed as a feed by its root element', () => {
    // The fixture keeps its XML declaration, so that is the marker: the sniff
    // reads the first markup token, and `<?xml` is a feed container's first
    // token as often as the root element is.
    expect(sniff(fixture('rss-rdf-1.0.xml')).marker).toBe('<?xml');
  });
});

describe('the container, not the label, decides the shape', () => {
  it('finds items written directly under an rss root, and says so by container', () => {
    // Measured shape: a publisher that writes no `channel`. The items are the
    // point, so the parser reads them; the container in the notes stays truthful.
    const payload =
      '<?xml version="1.0"?><rss version="2.0"><item><title>Direct</title>' +
      '<link>https://example.invalid/direct</link></item></rss>';
    const items = okItems(parseRssPayload(payload, rssSource(), sniff(payload)));
    expect(itemAt(items, 0).title).toBe('Direct');
    expect(itemAt(items, 0).link).toBe('https://example.invalid/direct');
  });

  it('names the shape of each empty document, in its own words', () => {
    const expectFailure = (payload: string, container: string, tail: string): void => {
      const failure = failed(parseRssPayload(payload, rssSource(), sniff(payload)));
      expect(failure.reason).toBe('no-items');
      expect(failure.cause).toBe(container);
      expect(failure.detail).toContain(tail);
    };
    // A `channel` is the RSS container; without one the document is an rss root
    // that carries no feed at all, and the name says so.
    expectFailure(
      '<?xml version="1.0"?><rss version="2.0"></rss>',
      'rss (no channel, no item)',
      "the document's root element is 'rss (no channel, no item)'",
    );
    expectFailure(
      '<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>',
      'rss > channel',
      'rss > channel was found and holds no item element; it has no children',
    );
    // RSS 1.0 and Atom have no channel: the root is the container.
    expectFailure(
      '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>',
      'rdf:RDF',
      'rdf:RDF was found and holds no item element',
    );
    expectFailure(
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
      'feed',
      'feed was found and holds no item element',
    );
  });
});

describe('dates', () => {
  it('falls back to the feed’s own date when an item has none', () => {
    const payload =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Dates</title>' +
      '<lastBuildDate>Sun, 09 Nov 2025 12:00:00 GMT</lastBuildDate>' +
      '<item><title>No date</title><link>https://example.invalid/a</link></item></channel></rss>';
    const items = okItems(parseRssPayload(payload, rssSource(), sniff(payload)));
    expect(itemAt(items, 0).publishedAt).toBe('2025-11-09T12:00:00.000Z');
  });

  it('leaves an item undated when the feed says nothing about time', () => {
    const payload =
      '<?xml version="1.0"?><rss version="2.0"><channel><title>Undated</title>' +
      '<item><title>No date</title><link>https://example.invalid/a</link></item></channel></rss>';
    expect(firstItem(parseRssPayload(payload, rssSource(), sniff(payload))).publishedAt).toBeNull();
  });

  it('reads dc:date from the item, and pubDate as RFC 1123', () => {
    const payload =
      '<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>DC</title>' +
      '<item><title>DC date</title><link>https://example.invalid/a</link><dc:date>2025-11-09T10:00:00Z</dc:date></item>' +
      '<item><title>RFC</title><link>https://example.invalid/b</link><pubDate>Sun, 09 Nov 2025 10:00:00 +0200</pubDate></item>' +
      '</channel></rss>';
    const items = okItems(parseRssPayload(payload, rssSource(), sniff(payload)));
    expect(itemAt(items, 0).publishedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(itemAt(items, 1).publishedAt).toBe('2025-11-09T08:00:00.000Z');
    expect(itemAt(items, 1).key).toMatch(linkKey);
    expect(itemAt(items, 0).publishedAt).toMatch(isoDate);
  });
});
