import { itemId } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { parseRssPayload } from '../src/rss.ts';
import { sniff } from '../src/sniff.ts';
import { itemAt, okItems, rssSource } from './support.ts';

/**
 * Identity, one rule, no configuration (decided 2026-11, after the guid
 * machinery was built and read): **the canonical link, else title+day.** A
 * feed's `guid` / Atom `id` is not part of any key.
 *
 * These tests pin the rule and the cost that came with it, because the cost is
 * the part a future reader will be tempted to "fix": a story whose **headline
 * is its only identity** reprints when the headline is edited. The paper
 * accepts that — an item with a link is stable, and the feeds where a retitle
 * matters (GitHub releases, changelogs) publish a link per item.
 */

const atomWith = (title: string): string => `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <id>tag:example.invalid,2026:feed</id>
    <entry>
      <id>tag:example.invalid,2026:one</id>
      <title>${title}</title>
      <link rel="alternate" type="text/html" href="https://example.invalid/one"/>
      <published>2026-11-09T10:00:00Z</published>
    </entry>
  </feed>`;

const firstKeyOf = (payload: string): string =>
  itemAt(okItems(parseRssPayload(payload, rssSource(), sniff(payload))), 0).key;

describe('identity is the link, not the guid', () => {
  it('a re-titled item keeps its key, because the link did not move', () => {
    const before = firstKeyOf(atomWith('Headline the publisher will edit'));
    const after = firstKeyOf(atomWith('Headline the publisher edited twice'));
    expect(after).toBe(before);
  });

  it('an opaque `tag:` id never reaches the key', () => {
    const key = firstKeyOf(atomWith('Headline'));
    expect(key.startsWith('test-source:')).toBe(true);
    // The two guid arms the machinery used to have. Neither appears.
    expect(key.startsWith('test-source:i')).toBe(false);
    expect(key.startsWith('test-source:t')).toBe(false);
  });

  it('the key is the canonical link: tracking parameters and `www` cost nothing', () => {
    expect(itemId('src', 'https://www.example.invalid/one?utm_source=rss', 'T', null)).toBe(
      itemId('src', 'https://example.invalid/one', 'Other Headline', '2026-11-10T00:00:00Z'),
    );
  });

  it('the accepted cost: no link, so the headline is the identity and an edit is a new story', () => {
    const before = itemId('src', '', 'v22.19.0', '2026-11-08T10:00:00Z');
    const after = itemId('src', '', 'v22.19.0 (security)', '2026-11-08T10:00:00Z');
    expect(after).not.toBe(before);
    expect(before.startsWith('src:t')).toBe(true);
  });
});
