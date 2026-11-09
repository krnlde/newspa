import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  compareIso,
  contentKey,
  hashKey,
  itemId,
  normalizeText,
  resolveLink,
  TRACKING_PARAMS,
} from '../src/normalize.ts';
import { sectionFor, sectionTitleFor } from '../src/sections.ts';

describe('hashKey', () => {
  it('is stable and collision-spread', () => {
    expect(hashKey('transit')).toBe(hashKey('transit'));
    expect(hashKey('transit')).not.toBe(hashKey('transit budget'));
    expect(hashKey('')).toHaveLength(8);
  });
});

describe('canonicalizeUrl', () => {
  it('strips the fragment, which is never identity', () => {
    expect(canonicalizeUrl('https://example.com/a/b#para-3')).toBe('https://example.com/a/b');
  });

  it('strips tracking params and sorts the rest', () => {
    const url = canonicalizeUrl('https://example.com/story?utm_source=x&b=2&a=1&fbclid=9');
    expect(url).toBe('https://example.com/story?a=1&b=2');
    expect(canonicalizeUrl('https://example.com/story?utm_custom=x')).toBe('https://example.com/story');
  });

  it('keeps ref/src/feature, because breaking a link costs an article', () => {
    expect(canonicalizeUrl('https://example.com/s?ref=nav')).toBe('https://example.com/s?ref=nav');
    expect(canonicalizeUrl('https://youtube.com/watch?v=abc&feature=share')).toContain('feature=share');
  });

  it('normalizes host, default port and www.', () => {
    expect(canonicalizeUrl('https://WWW.Example.COM:443/a')).toBe('https://example.com/a');
    expect(canonicalizeUrl('http://example.com:80/a')).toBe('http://example.com/a');
    expect(canonicalizeUrl('https://e.com:8443/a')).toBe('https://e.com:8443/a');
    expect(canonicalizeUrl('http://e.com:443/a')).toBe('http://e.com:443/a');
    expect(canonicalizeUrl('https://e.com/a', 'not a base')).toBe('https://e.com/a');
  });

  it('removes AMP markers', () => {
    expect(canonicalizeUrl('https://example.com/amp/story')).toBe('https://example.com/story');
    expect(canonicalizeUrl('https://example.com/story.amp')).toBe('https://example.com/story');
    expect(canonicalizeUrl('https://example.com/story?amp=1')).toBe('https://example.com/story');
  });

  it('keeps index.html visible for identity, then trims it cosmetically', () => {
    expect(canonicalizeUrl('https://example.com/news/index.html')).toBe('https://example.com/news/');
  });

  it('honours keepParams and the strip toggles', () => {
    expect(canonicalizeUrl('https://e.com/s?utm_source=x', undefined, { keepParams: ['utm_source'] })).toContain(
      'utm_source',
    );
    expect(canonicalizeUrl('https://e.com/s#x', undefined, { stripFragment: false })).toContain('#x');
    expect(canonicalizeUrl('https://e.com/amp/s', undefined, { stripAmp: false })).toContain('/amp/');
    expect(canonicalizeUrl('https://e.com/s/', undefined, { stripTrailingSlash: true })).toBe('https://e.com/s');
  });

  it('returns the input for a scheme it never fetches', () => {
    expect(canonicalizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(canonicalizeUrl('javascript:void(0)')).toBe('javascript:void(0)');
  });

  // The placeholder base is an internal default. Leaking it into the result gives
  // every linkless item on a source one shared identity.
  it('does not invent an origin for text that is not a URL', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
    expect(canonicalizeUrl('')).toBe('');
    expect(canonicalizeUrl('   ')).toBe('');
  });

  it('resolves relative links against the document URL', () => {
    expect(canonicalizeUrl('/news/a', 'https://example.com/deep/page')).toBe('https://example.com/news/a');
  });

  it('declares every utm_ param it strips', () => {
    expect(TRACKING_PARAMS.filter((p) => p.startsWith('utm_')).length).toBeGreaterThanOrEqual(6);
  });

  // Measured: `feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL` appends
  // `?.tsrc=rss` to every link, so the query key arrives as the literal `.tsrc`.
  // Identity is the canonical link (D-005), so one story must not become three
  // items because the feed wrote its parameter with a dot in front of it.
  it('strips Yahoo’s `?.tsrc=rss`, where the key is the literal “.tsrc”', () => {
    expect(canonicalizeUrl('https://finance.yahoo.com/markets/article/ai-stocks.html?.tsrc=rss')).toBe(
      'https://finance.yahoo.com/markets/article/ai-stocks.html',
    );
    expect(canonicalizeUrl('https://finance.yahoo.com/markets/article/ai-stocks.html?tsrc=rss&foo=1')).toBe(
      'https://finance.yahoo.com/markets/article/ai-stocks.html?foo=1',
    );
    expect(itemId('yahoo', 'https://finance.yahoo.com/m/x.html?.tsrc=rss', 'T', null)).toBe(
      itemId('yahoo', 'https://finance.yahoo.com/m/x.html', 'T', null),
    );
  });
});

describe('itemId', () => {
  it('is link-driven and fragment-insensitive', () => {
    const a = itemId('npr', 'https://npr.org/story/1?utm_source=fb#x', 'Title', null);
    const b = itemId('npr', 'https://www.npr.org/story/1', 'Completely different title', null);
    expect(a).toBe(b);
  });

  it('namespaces by source so two sites cannot collide', () => {
    expect(itemId('a', 'https://x.com/s', 'T', null)).not.toBe(itemId('b', 'https://x.com/s', 'T', null));
  });

  // `canonicalizeUrl('')` is empty, not the placeholder origin, so an item with
  // no link falls back to title+day instead of colliding with every other.
  it('falls back to title+day when there is no usable link', () => {
    const key = itemId('blog', '', 'Transit Budget Passes', '2026-11-08T10:00:00Z');
    expect(key.startsWith('blog:t')).toBe(true);
    expect(itemId('blog', '', 'transit budget passes', '2026-11-08T23:00:00Z')).toBe(key);
    expect(itemId('blog', '', 'Transit Budget Passes', '2026-11-09T10:00:00Z')).not.toBe(key);
    expect(itemId('blog', '', 'Transit Budget Passes', null)).not.toBe(key);
  });

  it('uses the title+day key for a link that is not a story URL', () => {
    const key = itemId('blog', 'mailto:tips@example.com', 'Transit Budget Passes', '2026-11-08T10:00:00Z');
    expect(key.startsWith('blog:t')).toBe(true);
    expect(itemId('blog', 'mailto:tips@example.com', 'transit budget passes', '2026-11-08T23:00:00Z')).toBe(key);
    expect(itemId('blog', 'mailto:tips@example.com', 'Transit Budget Passes', '2026-11-09T10:00:00Z')).not.toBe(key);
    expect(itemId('blog', 'mailto:tips@example.com', 'Transit Budget Passes', null)).not.toBe(key);
  });
});

describe('contentKey', () => {
  it('is the page identity from its text: same words, same key', () => {
    const a = contentKey('node', 'Node.js Releases\n  v24.10.0   (LTS)\n\n  Security update');
    const b = contentKey('node', 'Node.js Releases v24.10.0 (LTS) Security update');
    expect(b).toBe(a);
    expect(a.startsWith('node:h')).toBe(true);
  });

  it('is sensitive to the words, and namespaces by source', () => {
    expect(contentKey('node', 'v24.10.0')).not.toBe(contentKey('node', 'v24.10.1'));
    expect(contentKey('a', 'same page')).not.toBe(contentKey('b', 'same page'));
  });

  it('the empty page is a key, not null: the parser decides whether to ask', () => {
    expect(contentKey('x', '')).toBe(contentKey('x', '   \n  '));
  });
});

describe('normalizeText', () => {
  it('collapses whitespace and nbsp', () => {
    expect(normalizeText(' a\u00a0b \n  c\t')).toBe('a b c');
    expect(normalizeText('')).toBe('');
  });
});

describe('resolveLink', () => {
  it('resolves and normalizes what URL accepts, and passes through the rest', () => {
    expect(resolveLink('../a', 'https://e.com/x/y')).toBe('https://e.com/a');
    expect(resolveLink('   ', 'https://e.com/')).toBe('https://e.com/');
    expect(resolveLink('mailto:a@b.c', 'https://e.com/')).toBe('mailto:a@b.c');
    expect(resolveLink('#top', 'not a url')).toBe('#top');
  });
});

describe('section routing', () => {
  it('routes by subject words', () => {
    expect(sectionFor('Market report for the week')).toBe('business');
    expect(sectionFor('New AI model benchmarks')).toBe('technology');
    expect(sectionFor('Election results declared')).toBe('politics');
    expect(sectionFor('Sport: league fixtures')).toBe('sport');
    expect(sectionFor('Space sample returns')).toBe('science');
    expect(sectionFor('Editorial: the mayor must go')).toBe('opinion');
    expect(sectionFor('World affairs briefing')).toBe('world');
    expect(sectionFor('Culture night at the museum')).toBe('culture');
    expect(sectionFor('nothing relevant here')).toBe('top');
    expect(sectionFor('nothing', 'feed')).toBe('feed');
  });

  // A bare `ai`/`sport`/`arts` substring routed "Central bank raises rates" to
  // Technology and "Transport committee" to Sport. The router is keyword-based,
  // so the honest assertion is "not a substring artefact": a rates story with no
  // business keyword belongs on the general page, not in a section it merely
  // contains letters of.
  it('routes by subject, not by a substring', () => {
    expect(sectionFor('Central bank raises rates')).toBe('top');
    expect(sectionFor('Ukraine talks continue')).toBe('top');
    expect(sectionFor('Transport committee meets')).toBe('top');
    expect(sectionFor('Parts of the museum open')).toBe('top');
    expect(sectionFor('Workspace reform announced')).toBe('top');
    expect(sectionFor('The AI in the room')).toBe('technology');
    expect(sectionFor('Sports car review')).toBe('sport');
  });

  it('names sections for the paper', () => {
    expect(sectionTitleFor('technology')).toBe('Technology');
    expect(sectionTitleFor('top')).toBe('Top Stories');
  });
});

describe('compareIso', () => {
  it('sorts newest-first with nulls last', () => {
    expect(compareIso('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareIso('2026-01-01', '2026-01-01')).toBe(0);
    expect(compareIso(null, '2026-01-01')).toBe(-1);
    expect(compareIso('2026-01-01', null)).toBe(1);
  });
});
