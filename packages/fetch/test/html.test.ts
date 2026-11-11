import { itemId } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { parseHtmlPayload } from '../src/html.ts';
import type { ParseResult } from '../src/results.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, htmlSource, isoDate, itemAt, linkKey, okItems, okResult } from './support.ts';

/**
 * An index page, parsed with the source's selectors. Every zero is a name: the
 * selector that matched nothing (with the count the picker recorded), the
 * selector the CSS engine rejected, the wall that answered instead of the page.
 */
const parse = (
  name: string,
  list: string,
  fields: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): ParseResult => {
  const text = fixture(name);
  return parseHtmlPayload(text, htmlSource(list, fields, overrides), sniff(text));
};

describe('a card list', () => {
  const spec = {
    title: '.title',
    summary: '.deck',
    date: '.stamp',
    image: '.hero',
    imageAttr: 'srcset',
    body: '.card',
  };

  it('parses the cards, and counts the two it skipped', () => {
    const result = parse('html-card-list.html', '.card', spec, { strip: ['.promo', '.live-ticker'] });
    const items = okItems(result);
    expect(items).toHaveLength(2);
    expect(result.ok && result.matchCount).toBe(4);
    expect(result.ok && result.skipped).toBe(2);
    expect(result.ok && result.notes).toContain('item 3: no title');
    expect(result.ok && result.notes).toContain('item 4: no link');
    expect(result.ok && result.marker).toBe('<!doctype html');
    // D-029: item mode has **no ceiling** (D-026: one node, and a page's list is
    // read whole), so a successful HTML parse is a complete set by construction.
    expect(result.ok && result.capped).toBe(false);
  });

  it('reads every field of the first card', () => {
    const items = okItems(parse('html-card-list.html', '.card', spec, { strip: ['.promo', '.live-ticker'] }));
    const first = itemAt(items, 0);
    expect(first.title).toBe('One & Two');
    expect(first.link).toBe('https://example.invalid/world/one?utm_source=rss&ref=feed');
    expect(first.publishedAt).toBe('2026-11-09T10:00:00.000Z');
    // A srcset is candidates, not a URL: the largest one is the story image.
    expect(first.image).toBe('https://example.invalid/large.jpg');
    // A deck is one line of display text: core's normalizeText collapses the
    // markup's paragraph break, which is what keeps the diff stable when the
    // publisher reflows its own markup.
    expect(first.summary).toBe('Deck for one. Second line of the deck.');
    expect(first.author).toBe('By Ann Example');
    expect(first.key).toMatch(linkKey);
  });

  it('keeps the display link, and canonicalizes only the identity', () => {
    const items = okItems(parse('html-card-list.html', '.card', spec, { strip: ['.promo', '.live-ticker'] }));
    const first = itemAt(items, 0);
    expect(first.link).toContain('utm_source=rss');
    // Core strips the tracking parameter from the key, so the same story
    // reached with and without it is one story.
    expect(itemId('test-source', 'https://example.invalid/world/one?ref=feed', first.title, first.publishedAt)).toBe(
      first.key,
    );
  });

  it('strips the source’s noise, and keeps the story’s own text', () => {
    const items = okItems(parse('html-card-list.html', '.card', spec, { strip: ['.promo', '.live-ticker'] }));
    const body = itemAt(items, 0).body;
    expect(body).toContain('Deck for one.');
    expect(body).toContain('By Ann Example');
    expect(body).not.toContain('Subscribe for the full archive');
    expect(body).not.toContain('Updated 3 minutes ago');
    expect(body).not.toContain('window.adSlot');
    expect(body).not.toContain('color: red');
  });

  it('reads the second card with no image and no srcset', () => {
    const items = okItems(parse('html-card-list.html', '.card', spec, { strip: ['.promo', '.live-ticker'] }));
    const second = itemAt(items, 1);
    expect(second.title).toBe('Second story');
    expect(second.link).toBe('https://example.invalid/world/two');
    expect(second.image).toBeNull();
    expect(second.publishedAt).toBe('2026-11-09T09:00:00.000Z');
  });

  it('is the CNN lite page: the anchor is the item, and 100 headlines are 100 items', () => {
    const result = parse('html-cnn-lite.html', 'li.card--lite', { title: 'a' }, { url: 'https://edition.cnn.com/' });
    const items = okItems(result);
    expect(items).toHaveLength(100);
    expect(result.ok && result.skipped).toBe(0);
    const first = itemAt(items, 0);
    expect(first.title).toBe(
      'Former NYPD officer and teacher’s aide arrested in fatal stabbing of New York City jogger',
    );
    expect(first.link).toBe('https://edition.cnn.com/2026/11/08/us/new-york-jogger-fatal-stabbing-arrest');
    expect(first.summary).toBeNull();
    expect(first.image).toBeNull();
    expect(first.author).toBeNull();
    expect(first.publishedAt).toBeNull();
    expect(first.key).toMatch(linkKey);
    const links = new Set(items.map((i) => i.link));
    expect(links.size).toBe(100);
  });
});

describe('a selector that is not the page', () => {
  it('names the selector that matched nothing, with the count it used to make', () => {
    // D-026's `matchCount` is a contract at both ends: this is the under-count.
    // The over-count is `multi-match`, in `htmlMultiMatch.test.ts` (rule 1).
    const failure = failed(parse('html-selector-rot.html', '.legacy-rail .card', { title: 'h2' }, { matchCount: 14 }));
    expect(failure.reason).toBe('no-matches');
    expect(failure.kind).toBe('html');
    expect(failure.sniffed).toBe('html');
    expect(failure.cause).toBe('.legacy-rail .card');
    expect(failure.matchCount).toBe(0);
    expect(failure.detail).toContain('the source recorded 14 when it was picked');
    expect(failure.notes).toContain('the payload has no <noscript> block');
  });

  it('parses the same page once the selector names its cards', () => {
    const items = okItems(parse('html-selector-rot.html', '.story-grid .card', { title: 'h2', summary: 'p' }));
    expect(items).toHaveLength(2);
    expect(itemAt(items, 0).link).toBe('https://example.invalid/world/one');
    expect(itemAt(items, 1).summary).toBe('Also invisible to the old selector.');
  });

  it('separates a typo in the list from a page that changed', () => {
    const failure = failed(parse('html-selector-rot.html', 'h2 >> > >', { title: 'h2' }));
    expect(failure.reason).toBe('invalid-selector');
    expect(failure.cause).toBe('h2 >> > >');
    expect(failure.matchCount).toBeNull();
  });

  it('separates a typo in a field selector from a page that changed', () => {
    const failure = failed(parse('html-card-list.html', '.card', { title: 'p >>' }));
    expect(failure.reason).toBe('invalid-selector');
    expect(failure.cause).toBe('p >>');
    expect(failure.matchCount).toBe(4);
  });

  it('names items that have neither a headline nor a link', () => {
    const failure = failed(parse('html-card-list.html', '.deck', { title: 'h2' }));
    expect(failure.reason).toBe('no-usable-items');
    expect(failure.matchCount).toBe(4);
    expect(failure.detail).toBe("4 element(s) matched '.deck', none with a title and a link");
    expect(failure.notes).toContain('item 1: no title');
  });

  it('says what a rendered source means when it matches nothing', () => {
    const failure = failed(parse('html-selector-rot.html', '.nope', { title: 'h2' }, { render: true }));
    expect(failure.reason).toBe('no-matches');
    expect(failure.notes).toContain('the source is marked render: true, so these selectors expect a hydrated DOM');
  });
});

describe('the item that is the field', () => {
  it('takes the title from the item itself when nothing is below it', () => {
    const items = okItems(parse('html-self-title.html', '.headline', { title: '.title' }));
    expect(items).toHaveLength(2);
    expect(itemAt(items, 0).title).toBe('Heading item, anchor inside');
    expect(itemAt(items, 0).link).toBe('https://example.invalid/world/one');
    expect(itemAt(items, 1).title).toBe('Third heading');
    expect(itemAt(items, 1).link).toBe('https://example.invalid/world/three?utm_source=hl');
  });

  it('counts the heading with no link as skipped', () => {
    const result = okResult(parse('html-self-title.html', '.headline', { title: '.title' }));
    expect(result.matchCount).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.notes).toContain('item 2: no link');
  });

  it('reads the date by convention when the source names no date selector', () => {
    const items = okItems(
      parse(
        'html-noise-strip.html',
        '.story',
        { title: '.head', summary: '.deck' },
        {
          strip: ['.live-blog', '.weather'],
        },
      ),
    );
    expect(items).toHaveLength(2);
    expect(itemAt(items, 0).publishedAt).toBe('2026-11-08T21:30:00.000Z');
    expect(itemAt(items, 0).image).toBeNull();
    expect(itemAt(items, 1).publishedAt).toBe('2026-11-08T20:00:00.000Z');
  });

  it('names a strip selector that eats the title, and counts what it saw', () => {
    const failure = failed(
      parse(
        'html-card-list.html',
        '.card',
        { title: '.title', summary: '.deck' },
        {
          strip: ['.title'],
        },
      ),
    );
    expect(failure.reason).toBe('no-usable-items');
    expect(failure.matchCount).toBe(4);
    expect(failure.detail).toBe("4 element(s) matched '.card', none with a title and a link");
    expect(failure.notes).toContain('item 1: no title');
    expect(failure.notes).toContain('item 4: no title');
  });

  it('points a page that rendered nothing at render: true', () => {
    const payload =
      '<!doctype html><html><body><div id="root"></div><noscript>Sign up to see the live blog.</noscript></body></html>';
    const failure = failed(parseHtmlPayload(payload, htmlSource('.nothing', { title: 'h1' }), sniff(payload)));
    expect(failure.reason).toBe('no-matches');
    expect(failure.notes).toContain('the page has a <noscript> block: render: true is the fix');
  });
});

describe('a wall instead of a page', () => {
  it('names a JS-only page as a wall', () => {
    const failure = failed(parse('challenge-noscript.html', '.nothing', { title: 'h1' }));
    expect(failure.reason).toBe('challenge');
    expect(failure.cause).toBe('enable javascript');
    expect(failure.matchCount).toBe(0);
    expect(failure.detail).toContain("'enable javascript' ('.nothing' matched 0 elements)");
    expect(failure.notes).toContain("the marker came from core's CHALLENGE_MARKERS");
  });

  it('names the wall that matched a selector and produced no item', () => {
    const failure = failed(parse('login-wall.html', 'main form', { title: 'h1' }));
    expect(failure.reason).toBe('challenge');
    expect(failure.cause).toBe('subscribe to continue');
    expect(failure.matchCount).toBe(1);
    expect(failure.notes).toContain("the marker came from core's CHALLENGE_MARKERS");
  });

  it('names a wall only the extended list covers, and says where the marker came from', () => {
    // A bot manager's interstitial answers 200 with no core marker in it: the
    // note has to name the list that caught it, because the fix differs.
    const payload =
      '<!doctype html><html><body><h1>Request Tycoon</h1>' +
      '<p>Unusual traffic from your network was detected.</p></body></html>';
    const failure = failed(parseHtmlPayload(payload, htmlSource('.card', { title: 'h1' }), sniff(payload)));
    expect(failure.reason).toBe('challenge');
    expect(failure.cause).toBe('request tycoon');
    expect(failure.notes).toContain('the marker came from the extended wall list');
  });

  it('parses an article that only mentions a wall marker', () => {
    const payload =
      '<!doctype html><html><body><ul><li class="card"><h2>Why captchas are disappearing</h2>' +
      '<a href="/c">C</a><p>Sign in to read the comments is a phrase, not a wall.</p></li></ul></body></html>';
    const result = parseHtmlPayload(payload, htmlSource('li.card', { title: 'h2', summary: 'p' }), sniff(payload));
    const items = okItems(result);
    expect(items).toHaveLength(1);
    expect(itemAt(items, 0).title).toBe('Why captchas are disappearing');
  });

  it('names an empty payload as a selector that saw nothing', () => {
    const failure = parseHtmlPayload('', htmlSource('li.card', { title: 'h2' }), sniff('<!doctype html>'));
    expect(failure.ok).toBe(false);
    if (failure.ok === true) return;
    expect(failure.reason).toBe('no-matches');
    expect(failure.matchCount).toBe(0);
    expect(failure.marker).toBe('<!doctype html');
  });
});

describe('dates a source cannot use', () => {
  it('keeps a display string out of the item, and says nothing invented', () => {
    const payload =
      '<!doctype html><ul><li class="card"><h2>T</h2><a href="/a">A</a><time class="stamp">3 hours ago</time></li></ul>';
    const items = okItems(
      parseHtmlPayload(payload, htmlSource('li.card', { title: 'h2', date: '.stamp' }), sniff(payload)),
    );
    expect(itemAt(items, 0).publishedAt).toBeNull();
  });

  it('takes an ISO date out of the declared attribute', () => {
    const payload =
      '<!doctype html><ul><li class="card"><h2>T</h2><a href="/a">A</a><time class="stamp" datetime="2026-11-09T10:00:00Z">10:00</time></li></ul>';
    const items = okItems(
      parseHtmlPayload(payload, htmlSource('li.card', { title: 'h2', date: '.stamp' }), sniff(payload)),
    );
    expect(itemAt(items, 0).publishedAt).toMatch(isoDate);
  });
});
