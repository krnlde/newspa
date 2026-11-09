import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { rejectedSelector } from '../src/html.ts';
import {
  AUTHOR_SELECTOR,
  collectNodes,
  fieldNode,
  fieldsOfItem,
  loadDocument,
  pickCandidate,
} from '../src/htmlSelectors.ts';
import { absoluteLink } from '../src/item.ts';
import { fixture, htmlSource } from './support.ts';

/**
 * The selector layer. The measured fact that shapes it: cheerio answers
 * `length: 0`, `.text(): ''`, `.attr(): undefined` for a miss, and every one of
 * those is also a plausible value for a real element — so the count is the only
 * honest signal, and the note has to name the selector that produced it.
 */
describe('collectNodes', () => {
  const html = fixture('html-selector-rot.html');

  it('returns the nodes it matched and counts them', () => {
    const outcome = collectNodes(loadDocument(html), '.story-grid .card');
    expect(outcome.ok).toBe(true);
    if (outcome.ok === false) return;
    expect(outcome.seen).toBe(2);
    expect(outcome.nodes.first().find('h2').text()).toContain('A story the old selector cannot see');
  });

  it('names a selector that matched nothing, quoting the count the picker recorded', () => {
    const outcome = collectNodes(loadDocument(html), '.legacy-rail .card', 14);
    expect(outcome.ok).toBe(false);
    if (outcome.ok === true) return;
    expect(outcome.reason).toBe('no-matches');
    expect(outcome.detail).toBe("'.legacy-rail .card' matched 0 elements; the source recorded 14 when it was picked");
  });

  it('says nothing about a picker-recorded count when there is none', () => {
    const outcome = collectNodes(loadDocument(html), '.nope');
    expect(outcome.ok).toBe(false);
    if (outcome.ok === true) return;
    expect(outcome.detail).toBe("'.nope' matched 0 elements");
  });

  it('separates a selector the CSS engine rejects from one that matched nothing', () => {
    // `$(sel)` does not throw for a selector CSS understands and **does** throw
    // for one it does not, and the two messages differ by selector.
    const empty = collectNodes(loadDocument(html), 'a >>');
    expect(empty.ok).toBe(false);
    if (empty.ok === true) return;
    expect(empty.reason).toBe('invalid-selector');
    // Measured on cheerio 1.2.0: both forms fail inside `find`, and the
    // message quotes the selector, so the note can name the source's text.
    expect(empty.detail).toContain("'a >>' is not a selector the CSS engine accepts");
    expect(empty.detail).toContain('Did not expect successive traversals');
    const traversals = collectNodes(loadDocument(html), 'h2 >> > >');
    expect(traversals.ok).toBe(false);
    if (traversals.ok === true) return;
    expect(traversals.reason).toBe('invalid-selector');
    expect(traversals.detail).toContain('Did not expect successive traversals');
  });

  it('matches tag names case-insensitively, because html mode is not xml mode', () => {
    const outcome = collectNodes(loadDocument('<article><h2>T</h2></article>'), 'ARTICLE');
    expect(outcome.ok).toBe(true);
    expect(load('<ARTICLE><H2>T</H2></ARTICLE>', { xml: false })('article h2').text()).toBe('T');
  });
});

describe('fieldNode', () => {
  it('finds a field below the item, then the item itself, and nothing after that', () => {
    const $ = loadDocument(fixture('html-self-title.html'));
    const item = $('.headline').eq(0);
    expect(fieldNode(item, 'a')?.text()).toBe('Heading item, anchor inside');
    expect(fieldNode(item, '.headline')?.length).toBe(1);
    expect(fieldNode(item, '.missing')).toBeNull();
  });

  it('excludes the root from find, which is why the self arm exists', () => {
    const $ = loadDocument('<li class="card"><p>Deck</p></li>');
    const item = $('.card');
    expect(item.find('.card').length).toBe(0);
    expect(item.filter('.card').length).toBe(1);
  });
});

describe('pickCandidate', () => {
  it('takes the largest candidate of a srcset', () => {
    expect(pickCandidate('small.jpg 640w, large.jpg 1920w')).toBe('large.jpg');
    expect(pickCandidate('a.jpg 1x, b.jpg 2x')).toBe('b.jpg');
    expect(pickCandidate('only.jpg')).toBe('only.jpg');
    // A trailing comma is an empty last candidate, and the last candidate wins.
    expect(pickCandidate('a, b ,')).toBe('');
  });
});

describe('rejectedSelector', () => {
  it('names the first source selector the CSS engine rejects', () => {
    const $ = loadDocument(fixture('html-card-list.html'));
    const probe = $('.card').eq(0);
    expect(rejectedSelector(probe, htmlSource('.card', { title: '.title' }))).toBeNull();
    // The selector is returned exactly as the source wrote it: the note has to
    // point at the text in the source file, not at a normalised form of it.
    expect(rejectedSelector(probe, htmlSource('.card', { title: 'p >>' }))).toBe('p >>');
    expect(rejectedSelector(probe, htmlSource('.card', { title: '.title' }, { strip: ['((('] }))).toBe('(((');
    expect(rejectedSelector(probe, htmlSource('.card', { title: '.title', body: 'x >>' }))).toBe('x >>');
  });
});

describe('fieldsOfItem', () => {
  it('reads the byline conventions an index page uses', () => {
    const $ = loadDocument(
      '<ul><li class="card"><h2>Headline</h2><a href="/a">A</a><address>By Ann Example</address><p>Deck</p></li>' +
        '<li class="card"><h2>Second</h2><a href="/b">B</a><a href="https://e.test/a" rel="author">By Ben Example</a></li></ul>',
    );
    const spec = htmlSource('li.card', { title: 'h2', summary: 'p' });
    expect(fieldsOfItem($('li.card').eq(0), spec).author).toBe('By Ann Example');
    expect(fieldsOfItem($('li.card').eq(1), spec).author).toBe('By Ben Example');
    expect(AUTHOR_SELECTOR).toContain('address');
  });

  it('answers no author for a byline element with no text in it', () => {
    const $ = loadDocument('<ul><li class="card"><h2>T</h2><a href="/a">A</a><span class="byline"></span></li></ul>');
    expect(fieldsOfItem($('li.card').eq(0), htmlSource('li.card', { title: 'h2' })).author).toBeNull();
  });

  it('takes the largest srcset candidate, and answers nothing to an empty value', () => {
    expect(pickCandidate('a.jpg 1x, b.jpg 2x')).toBe('b.jpg');
    expect(pickCandidate('a.jpg')).toBe('a.jpg');
    // Measured: the ladder takes the **last** comma-separated candidate, so a
    // trailing comma — an empty second candidate — yields the empty string. A
    // publisher that writes one has a broken `srcset`, and the item's image
    // falls back to the markup's own `img`, which is the honest answer.
    expect(pickCandidate('a.jpg,')).toBe('');
    expect(pickCandidate('a.jpg, ')).toBe('');
    expect(pickCandidate('   ')).toBe('');
  });

  it('answers no image for an image selector that matches nothing', () => {
    const $ = loadDocument('<ul><li class="card"><h2>T</h2><a href="/a">A</a></li></ul>');
    expect(fieldsOfItem($('li.card').eq(0), htmlSource('li.card', { title: 'h2', image: 'img' })).image).toBeNull();
  });

  it('falls back along the link ladder, and refuses an empty href', () => {
    // The selector first, then the item's own attribute, then the first element
    // inside carrying one (a card list's anchor *is* the item).
    const $ = loadDocument(
      '<ul><li class="card"><h2>Headline</h2><a href="/a">A</a></li><li class="card"><h2>No anchor</h2></li></ul>',
    );
    const withSelector = fieldsOfItem($('li.card').eq(1), htmlSource('li.card', { title: 'h2', link: 'a' }));
    expect(withSelector.link).toBe('');
    const fallback = fieldsOfItem($('li.card').eq(0), htmlSource('li.card', { title: 'h2', link: 'a[href]' }));
    expect(fallback.link).toBe('/a');
    // An attribute that exists and is empty is not a story link.
    const empty = loadDocument('<ul><li class="card"><h2>T</h2><a href="">A</a></li></ul>')('li.card').eq(0);
    expect(fieldsOfItem(empty, htmlSource('li.card', { title: 'h2' })).link).toBe('');
  });

  it('decodes entities, collapses whitespace and takes the link of a nested anchor', () => {
    const $ = loadDocument(
      '<ul><li class="card"><h2>One &amp; <em>Two</em></h2><a href="/a?x=1&amp;y=2">A</a><p>Deck.</p></li></ul>',
    );
    const fields = fieldsOfItem($('li.card').eq(0), htmlSource('li.card', { title: 'h2', summary: 'p' }));
    expect(fields.title).toBe('One & Two');
    expect(fields.link).toBe('/a?x=1&y=2');
    expect(fields.summary).toBe('Deck.');
    expect(fields.publishedAt).toBeNull();
    expect(fields.image).toBeNull();
  });

  it('strips the source’s noise from a clone, not from the document', () => {
    const $ = loadDocument(fixture('html-noise-strip.html'));
    const spec = htmlSource(
      '.story',
      { title: '.head', summary: '.deck', body: '.story' },
      {
        strip: ['.live-blog', '.weather'],
      },
    );
    const fields = fieldsOfItem($('.story').eq(0), spec);
    expect(fields.title).toBe('Live blog entry');
    expect(fields.body).toContain('The paragraph that is the story.');
    expect(fields.body).not.toContain('Updated 12 seconds ago');
    expect(fields.body).not.toContain('London');
    expect(fields.body).not.toContain('window.liveTick');
    expect(fields.body).not.toContain('animation');
    expect(fields.body).not.toContain('Enable JavaScript');
    // The document is untouched: the same node still has its deck.
    expect($('.story').eq(0).find('.deck').text()).toBe('The paragraph that is the story.');
  });
});

describe('absoluteLink', () => {
  it('resolves a relative link, keeps a fragment, decodes an entity, and answers "" to nothing', () => {
    expect(absoluteLink('/world/2026/a', 'https://example.invalid/index')).toBe('https://example.invalid/world/2026/a');
    expect(absoluteLink('story?a=1&amp;b=2#x', 'https://example.invalid/news/')).toBe(
      'https://example.invalid/news/story?a=1&b=2#x',
    );
    expect(absoluteLink('   ', 'https://example.invalid/')).toBe('');
    expect(absoluteLink('https://other.test/a', 'https://example.invalid/')).toBe('https://other.test/a');
  });
});
