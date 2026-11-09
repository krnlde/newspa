import { describe, expect, it } from 'vitest';
import { OPML_VERSION, parseOpml, serializeOpml } from '../src/opml.ts';

const opml = (body: string, head = '<title>Subscriptions</title>'): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>${head}</head>\n  <body>\n${body}\n  </body>\n</opml>\n`;

describe('parseOpml', () => {
  it('reads flat feeds, preferring title over text', () => {
    const result = parseOpml(
      opml(
        '    <outline type="rss" text="NPR" title="NPR World" xmlUrl="https://feeds.npr.org/1001/rss.xml" htmlUrl="https://npr.org"/>\n' +
          '    <outline text="BBC" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml"/>',
      ),
    );
    expect(result.issues).toEqual([]);
    expect(result.feeds).toEqual([
      { title: 'NPR World', xmlUrl: 'https://feeds.npr.org/1001/rss.xml', htmlUrl: 'https://npr.org' },
      { title: 'BBC', xmlUrl: 'https://feeds.bbci.co.uk/news/rss.xml' },
    ]);
  });

  it('uses a label-only outline as the group for the feeds below it', () => {
    const result = parseOpml(
      opml(
        '    <outline text="Local">\n      <outline title="City Blog" xmlUrl="https://cityblog.test/feed"/>\n    </outline>\n' +
          '    <outline title="Loose" xmlUrl="https://loose.test/feed"/>',
      ),
    );
    expect(result.feeds.map((feed) => feed.group)).toEqual(['Local', undefined]);
    expect(result.feeds[1]?.title).toBe('Loose');
  });

  it('decodes the entities that appear in every real export', () => {
    const result = parseOpml(
      opml(
        '    <outline title="The &amp; Guardian &lt;daily&gt;" xmlUrl="https://theguardian.test/rss?q=1&amp;p=2" htmlUrl="https://g.test/&quot;x&quot;"/>',
      ),
    );
    expect(result.feeds[0]?.title).toBe('The & Guardian <daily>');
    expect(result.feeds[0]?.xmlUrl).toBe('https://theguardian.test/rss?q=1&p=2');
    expect(result.feeds[0]?.htmlUrl).toBe('https://g.test/"x"');
  });

  it('decodes numeric character references, the only way an exporter writes non-ASCII', () => {
    // Named entities past the five XML built-ins are deliberately not decoded
    // (`&mdash;` stays literal), and a plain XML 1.0 document cannot use them
    // without a DTD, so `&#8212;` is what an export writes for an em dash.
    const result = parseOpml(opml('    <outline text="News &#38; Bits &#8212; live" xmlUrl="https://bits.test/rss"/>'));
    expect(result.feeds[0]?.title).toBe('News & Bits — live');
    expect(result.issues).toEqual([]);
  });

  it('decodes numeric refs before &amp;, so a double-escaped ref stays literal', () => {
    // Decode order is the point: `&#38;` is resolved first, and `&amp;` is
    // resolved last, so decoding never runs twice — `&amp;#38;` unescapes to
    // the literal text `&#38;`, not to `&`.
    const result = parseOpml(opml('    <outline text="Amp &#38; hash &amp;#38;" xmlUrl="https://amp.test/rss"/>'));
    expect(result.feeds[0]?.title).toBe('Amp & hash &#38;');
  });

  it('reports an outline with a broken url instead of dropping it silently', () => {
    const result = parseOpml(opml('    <outline title="Broken" xmlUrl="npr.org/rss"/>'));
    expect(result.feeds).toEqual([]);
    expect(result.issues[0]).toContain('npr.org/rss');
  });

  it('reports a document that is not OPML at all', () => {
    expect(parseOpml('<html><body>hi</body></html>').issues[0]).toContain('no <opml> element');
  });

  it('reports an opml file with no feeds in it', () => {
    // The message counts the outlines it saw: "no outlines" and "one outline
    // with no url" are different diagnoses, and the second is what a
    // quote-style or scanner bug on a real export looks like.
    const result = parseOpml(opml('    <outline text="Empty folder"/>'));
    expect(result.feeds).toEqual([]);
    expect(result.issues).toEqual(['1 outline element(s), none with a usable xmlUrl']);
  });

  it('ignores an outline with neither url nor label', () => {
    const result = parseOpml(opml('    <outline/>\n    <outline title="Real" xmlUrl="https://real.test/rss"/>'));
    expect(result.feeds).toHaveLength(1);
    expect(result.feeds[0]?.group).toBeUndefined();
  });

  it('falls back to the url as the title when there is no label', () => {
    const result = parseOpml(opml('    <outline xmlUrl="https://labelless.test/rss"/>'));
    expect(result.feeds[0]?.title).toBe('https://labelless.test/rss');
  });

  it('reads single-quoted attributes, because they are legal XML and readers emit them', () => {
    // Measured on the first cut, which matched only `name="…"`: this document
    // returned `feeds: [good]` with `issues: []`, and an all-single-quoted file
    // reported the generic "no outlines with xmlUrl". A feed that vanishes
    // without a word is a silent zero (rule 5), and importing a reader's
    // subscription list is exactly where this shape shows up.
    const single = "<outline text='Single' xmlUrl='https://single.test/rss' htmlUrl='https://single.test'/>";
    const result = parseOpml(opml(`    ${single}\n    <outline title="Double" xmlUrl="https://double.test/rss"/>`));
    expect(result.issues).toEqual([]);
    expect(result.feeds.map((feed) => [feed.title, feed.xmlUrl])).toEqual([
      ['Single', 'https://single.test/rss'],
      ['Double', 'https://double.test/rss'],
    ]);
    expect(result.feeds[0]?.htmlUrl).toBe('https://single.test');
  });

  it('does not treat an apostrophe in a title as a quote, in either style', () => {
    // A quoted run is closed by its own quote character, so a `'` inside a
    // double-quoted value cannot start a tag-spanning match.
    const result = parseOpml(
      opml(
        '    <outline text="The Players\' Club" xmlUrl="https://club.test/rss"/>\n    <outline title="Next" xmlUrl="https://next.test/rss"/>',
      ),
    );
    expect(result.feeds.map((feed) => feed.title)).toEqual(["The Players' Club", 'Next']);
    expect(result.issues).toEqual([]);
  });

  it('keeps a `>` inside an attribute value from ending the tag', () => {
    // `>` is legal inside an attribute value. Measured on the first cut
    // (`[^>]*`): `text="A > B"` truncated the tag before `xmlUrl`, so that feed
    // disappeared from a mixed document with no issue at all.
    const result = parseOpml(
      opml(
        '    <outline text="A > B" xmlUrl="https://gt.test/rss"/>\n    <outline title="Keep" xmlUrl="https://keep.test/rss"/>',
      ),
    );
    expect(result.issues).toEqual([]);
    expect(result.feeds.map((feed) => feed.xmlUrl)).toEqual(['https://gt.test/rss', 'https://keep.test/rss']);
  });

  it('reads a tag written across lines', () => {
    const result = parseOpml(
      opml('    <outline\n      text="Wrapped"\n      xmlUrl="https://wrapped.test/rss"\n    />'),
    );
    expect(result.feeds.map((feed) => feed.title)).toEqual(['Wrapped']);
    expect(result.issues).toEqual([]);
  });

  it('will not read `xmlUrl` out of a longer attribute name', () => {
    // No leading `(^|\s)` and `data-xmlUrl` matches as `xmlUrl`: measured, the
    // first cut produced a feed for `https://decoy.test/rss` from a document
    // that has no feed in it. An outline with no url is a folder, so the
    // honest answer here is one group and no feed.
    const result = parseOpml(opml('    <outline data-xmlUrl="https://decoy.test/rss" text="Decoy"/>'));
    expect(result.feeds).toEqual([]);
    expect(result.issues).toEqual(['1 outline element(s), none with a usable xmlUrl']);
  });

  it('names what it found when a document yields no feed', () => {
    // Three different zeros, and the caller (and the health note) must be able
    // to tell them apart: no outlines, outlines with no usable url, outlines
    // that failed the schema (named individually, above).
    expect(parseOpml(opml('')).issues).toEqual(['no outlines with xmlUrl']);
    expect(parseOpml('<opml version="2.0"><body></body></opml>').issues).toEqual(['no outlines with xmlUrl']);
    expect(parseOpml(opml('    <outline type="rss"/>')).issues).toEqual([
      '1 outline element(s), none with a usable xmlUrl',
    ]);
  });
});

describe('serializeOpml', () => {
  const feeds = [
    { title: 'Zeta', xmlUrl: 'https://zeta.test/rss', group: 'Science' },
    { title: 'Alpha', xmlUrl: 'https://alpha.test/rss', group: 'Science' },
    { title: 'Loose & Co', xmlUrl: 'https://loose.test/rss', htmlUrl: 'https://loose.test' },
  ];
  const text = serializeOpml(feeds, 'My feeds');

  it('writes an opml 2.0 document with the title in the head', () => {
    expect(text).toContain('<opml version="2.0">');
    expect(text).toContain('<title>My feeds</title>');
    expect(OPML_VERSION).toBe('opml2.0');
    expect(text.trimEnd().endsWith('</opml>')).toBe(true);
  });

  it('nests groups and sorts by title inside them', () => {
    expect(text).toContain('<outline text="Science" title="Science">');
    expect(text.indexOf('Alpha')).toBeLessThan(text.indexOf('Zeta'));
    expect(text).toContain('xmlUrl="https://loose.test/rss"');
  });

  it('files ungrouped feeds before the named groups, whichever order they arrive in', () => {
    // The group sort is `(a[0] ?? '').localeCompare(b[0] ?? '')`, so the
    // ungrouped bucket (key `undefined`) sorts first. It has to be the *first*
    // argument of a comparison for that arm to run, which needs three groups
    // with the ungrouped one inserted second (feeds are sorted by title first).
    const text = serializeOpml(
      [
        { title: 'Alpha', xmlUrl: 'https://alpha.test/rss', group: 'News' },
        { title: 'Loose', xmlUrl: 'https://loose.test/rss' },
        { title: 'Zeta', xmlUrl: 'https://zeta.test/rss', group: 'Science' },
      ],
      'Order',
    );
    const body = text.slice(text.indexOf('<body>'));
    expect(body.indexOf('Loose"')).toBeLessThan(body.indexOf('<outline text="News"'));
    expect(body.indexOf('<outline text="News"')).toBeLessThan(body.indexOf('<outline text="Science"'));
    expect(parseOpml(text).issues).toEqual([]);

    // The mirror case: the ungrouped bucket is the *first* entry, so the
    // comparator's right operand is the `undefined` key.
    const flatFirst = serializeOpml(
      [
        { title: 'Alpha', xmlUrl: 'https://alpha.test/rss' },
        { title: 'Zeta', xmlUrl: 'https://zeta.test/rss', group: 'News' },
      ],
      'Order',
    );
    expect(flatFirst.indexOf('Alpha"')).toBeLessThan(flatFirst.indexOf('<outline text="News"'));
    expect(parseOpml(flatFirst).issues).toEqual([]);
  });

  it('escapes ampersands so the file is parseable', () => {
    expect(text).toContain('title="Loose &amp; Co"');
    expect(parseOpml(text).issues).toEqual([]);
  });

  it('round-trips: serialize then parse yields the same feeds', () => {
    const back = parseOpml(text);
    expect(back.feeds.map((feed) => [feed.title, feed.xmlUrl, feed.group]).sort()).toEqual([
      ['Alpha', 'https://alpha.test/rss', 'Science'],
      ['Loose & Co', 'https://loose.test/rss', undefined],
      ['Zeta', 'https://zeta.test/rss', 'Science'],
    ]);
  });
});
