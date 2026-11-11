import type { RssSource } from 'newspa-config';
import { itemId } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import type { ParseResult } from '../src/results.ts';
import { parseRssPayload } from '../src/rss.ts';
import { sniff } from '../src/sniff.ts';
import { fixture, isoDate, itemAt, linkKey, okItems, okResult, rssSource } from './support.ts';

/**
 * Real feeds, captured 2026-11-09 (`test/fixtures/README.md` says how). These
 * are the pins that keep a parser honest about the web: a BBC permalink guid,
 * the Guardian's namespaced fields, Atom's link ladder, and a blog whose text
 * arrives in `content:encoded`.
 */
const parse = (name: string, overrides: Partial<RssSource> = {}): ParseResult => {
  const text = fixture(name);
  return parseRssPayload(text, rssSource(overrides), sniff(text));
};

describe('the BBC world feed (RSS 2.0)', () => {
  it('parses every item, with an identity and a usable link', () => {
    const result = parse('feed-bbc-world.xml');
    const items = okItems(result);
    expect(items.length).toBeGreaterThan(20);
    if (result.ok === true) {
      expect(result.matchCount).toBe(items.length);
      expect(result.skipped).toBe(0);
      expect(result.kind).toBe('rss');
      expect(result.sniffed).toBe('rss');
      expect(result.marker).toBe('<?xml');
      expect(result.notes[0]).toBe("starts with '<?xml'");
    }
    const first = itemAt(items, 0);
    expect(first.link).toMatch(/^https:\/\/www\.bbc\.co\.uk\/news\//);
    expect(first.title.length).toBeGreaterThan(10);
    expect(first.publishedAt).toMatch(isoDate);
    expect(first.summary).not.toBeNull();
    expect(first.body.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.key).toMatch(linkKey);
      expect(item.link).not.toContain('<');
      expect(item.title).not.toContain('\n');
    }
  });

  it('takes identity from the permalink guid, exactly as D-005 orders it', () => {
    const items = okItems(parse('feed-bbc-world.xml'));
    const first = itemAt(items, 0);
    expect(first.title).toBe('Krakow shooting suspect has died in hospital, police say');
    expect(itemId('test-source', first.link, first.title, first.publishedAt)).toBe(first.key);
  });

  it('is deterministic: the same payload parses to the same keys', () => {
    const keys = okItems(parse('feed-bbc-world.xml')).map((i) => i.key);
    const again = okItems(parse('feed-bbc-world.xml')).map((i) => i.key);
    expect(again).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('caps the items at maxItems, counts the nodes it saw, and says the cap cut them', () => {
    const full = okItems(parse('feed-bbc-world.xml', { maxItems: 500 }));
    const result = parse('feed-bbc-world.xml', { maxItems: 5 });
    const items = okItems(result);
    expect(items.length).toBe(5);
    expect(full.length).toBeGreaterThan(5);
    if (result.ok === true) {
      expect(result.matchCount).toBe(full.length);
      expect(result.notes).toContain(`${String(full.length - 5)} item(s) past maxItems 5`);
      // D-029's precondition: `capped` is the machine-readable form of that
      // note. A list cut by the source's own ceiling is the **front** of the
      // set, not the set, so the poll that cut it is never evidence that an
      // item is gone — and a note is prose, so the rule needs the flag.
      expect(result.capped).toBe(true);
    }
  });

  it('is not capped when the ceiling was never reached, the arm the disappearance ladder reads', () => {
    const result = parse('feed-bbc-world.xml', { maxItems: 500 });
    expect(okResult(result).capped).toBe(false);
  });

  it('reports the encoding a feed declares, because the transport decoded it as UTF-8', () => {
    const latin1 =
      '<?xml version="1.0" encoding="ISO-8859-1"?><rss version="2.0"><channel><title>Frédéric</title>' +
      '<item><title>T</title><link>https://example.invalid/a</link></item></channel></rss>';
    const result = parseRssPayload(latin1, rssSource(), sniff(latin1));
    const items = okItems(result);
    // Measured: fast-xml-parser 5.12.0 decodes the declared encoding itself, so
    // the items are intact. What the parser cannot know is the bytes the
    // transport were given, so the declaration is reported, not obeyed.
    expect(itemAt(items, 0).title).toBe('T');
    expect(itemAt(items, 0).link).toBe('https://example.invalid/a');
    expect(result.ok && result.notes).toContain(
      "the document declares encoding 'ISO-8859-1', which the transport does not decode",
    );
    // A declaration of UTF-8 is the normal case and says nothing.
    const utf8 = latin1.replace('ISO-8859-1', 'utf-8');
    const plain = parseRssPayload(utf8, rssSource(), sniff(utf8));
    expect(plain.ok && plain.notes).not.toContain(
      "the document declares encoding 'utf-8', which the transport does not decode",
    );
  });
});

describe('the Guardian world feed (namespaced RSS 2.0)', () => {
  it('reads the namespaced fields the publisher actually writes', () => {
    const items = okItems(parse('feed-guardian-world.xml', { maxItems: 500 }));
    expect(items.length).toBeGreaterThan(30);
    const first = itemAt(items, 0);
    // The author is `dc:creator`, which the Guardian sets to the byline.
    expect(first.author).toBe('Associated Press');
    expect(first.image).toMatch(/^https:\/\/i\.guim\.co\.uk\//);
    expect(first.publishedAt).toMatch(isoDate);
    expect(first.title.length).toBeGreaterThan(10);
    expect(first.link).toMatch(/^https:\/\/www\.theguardian\.com\/\w/);
  });

  it('turns the escaped markup in description into text, capped as evidence', () => {
    const items = okItems(parse('feed-guardian-world.xml'));
    const first = itemAt(items, 0);
    // The teaser sentence is the description's first paragraph; core's
    // normalizeText collapses the `<p>` boundaries, so a PickedItem carries one
    // line, never `\n\n`. The teaser builder, not the parser, owns the split.
    expect(first.summary).toContain('President orders prompt investigation after one train derails');
    expect(first.summary).not.toContain('\n');
    expect(first.summary).not.toContain('<p>');
    expect(first.summary).not.toContain('<a');
    // The publisher's boilerplate tail survives on purpose: the parser does not
    // rewrite a publisher's text, the teaser builder truncates it.
    expect(first.summary).toContain('Continue reading');
    // This description fits under core's evidence cap, so `body` is the same
    // text: an item with no body field of its own keeps one copy, not two.
    expect(first.summary).toBe(first.body);
    expect(first.body.length).toBeLessThanOrEqual(1_200);
  });

  it('dates every item of the feed, with no duplicates', () => {
    const items = okItems(parse('feed-guardian-world.xml', { maxItems: 500 }));
    expect(items.filter((i) => i.publishedAt !== null)).toHaveLength(items.length);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});

describe('GitHub releases (Atom) and Ubuntu’s blog (content:encoded)', () => {
  it('takes the Atom entry link, not the feed’s own', () => {
    const items = okItems(parse('feed-github-releases.atom.xml', { maxItems: 500 }));
    // GitHub's Atom feed carries exactly ten releases; the capture keeps them.
    expect(items).toHaveLength(10);
    for (const item of items) {
      expect(item.link).toContain('/releases/tag/');
      expect(item.link).not.toContain('releases.atom');
    }
    const first = itemAt(items, 0);
    expect(first.publishedAt).toMatch(isoDate);
    // The capture's newest release is v5.0.5; GitHub orders the feed newest first.
    expect(first.title).toBe('v5.0.5');
  });

  it('keys each release by its release URL; the `tag:` atom:id never reaches the key', () => {
    const items = okItems(parse('feed-github-releases.atom.xml'));
    const first = itemAt(items, 0);
    // The identity is the canonical link. A release URL carries its tag, so a
    // new release is a new key. The accepted cost of one rule with no
    // configuration: a release that is **re-tagged** (the URL moves) prints
    // again beside the old one.
    expect(first.key).toMatch(linkKey);
    expect(first.link).toContain('/releases/tag/');
  });

  it('reads content:encoded as the body, capped as evidence', () => {
    const items = okItems(parse('feed-ubuntu-blog.xml', { maxItems: 500 }));
    // The capture keeps all twelve items of the feed.
    expect(items).toHaveLength(12);
    const first = itemAt(items, 0);
    expect(first.body.length).toBeGreaterThan(200);
    // capBody keeps the evidence under its cap, and normalizeText leaves one
    // line: the parser never hands the paper `\n\n`.
    expect(first.body.length).toBeLessThanOrEqual(1_200);
    expect(first.body).not.toContain('\n');
    expect(first.publishedAt).toMatch(isoDate);
    // No item of this feed carries enclosure, media or image: the body is
    // escaped HTML inside content:encoded, and the paper links out. Media tags
    // are covered by the grammar fixture.
    expect(items.filter((i) => i.image !== null)).toHaveLength(0);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
  });
});
