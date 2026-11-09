import { describe, expect, it } from 'vitest';
import { parseJsonPayload } from '../src/json.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, itemAt, jsonSource, linkKey, okItems } from './support.ts';

/**
 * The JSON island inside a page: the shape D-008 exists for (the BBC probe
 * found 91 KB of `__NEXT_DATA__` inside a 370 KB page). What a source author
 * needs from this file is the island's grammar, and a failure that names the
 * script and the keys around the path that missed.
 */
const islandFields = { title: 'headline.en', link: 'url', date: 'publishedAt', summary: 'deck.en', image: 'image.url' };
const islandSpec = (overrides: Record<string, unknown> = {}) =>
  jsonSource('topStories', islandFields, { island: 'script#__NEXT_DATA__', ...overrides });
const parseIsland = (overrides: Record<string, unknown> = {}, text = fixture('json-island-nextdata.html')) =>
  parseJsonPayload(text, islandSpec(overrides), sniff(text));

describe('the island inside a page', () => {
  it('reads the JSON out of the script tag, and ignores the markup beside it', () => {
    const items = okItems(parseIsland());
    expect(items).toHaveLength(2);
    const first = itemAt(items, 0);
    // Inside <script> the HTML parser decodes nothing: the island's own
    // ampersand arrives as the publisher wrote it.
    expect(first.title).toBe('Story one &amp; its ampersand');
    expect(first.link).toBe('https://example.invalid/world/one');
    expect(first.summary).toBe('Deck one');
    expect(first.image).toBe('https://example.invalid/hero-one.jpg');
    expect(first.author).toBe('Ann Example');
    expect(first.publishedAt).toBe('2026-11-09T10:00:00.000Z');
    const second = itemAt(items, 1);
    expect(second.publishedAt).toBeNull();
    expect(second.author).toBe('Ben Example');
    expect(second.title).toBe('Story two');
  });

  it('counts the hit with no headline as skipped', () => {
    const result = parseIsland();
    if (result.ok === false) throw new Error(result.detail);
    expect(result.matchCount).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.notes).toContain('item 3: no title');
    expect(result.notes[0]).toBe("starts with '<!doctype html'");
  });

  it('reads a full path from the island itself when islandRoot is empty', () => {
    const text = fixture('json-island-nextdata.html');
    const spec = jsonSource('props.pageProps.topStories', islandFields, {
      island: 'script#__NEXT_DATA__',
      islandRoot: '',
    });
    const items = okItems(parseJsonPayload(text, spec, sniff(text)));
    expect(items).toHaveLength(2);
    expect(itemAt(items, 0).key).toMatch(linkKey);
  });

  it('names an island that is not in the page', () => {
    const failure = failed(parseIsland({ island: 'script#DATA' }));
    expect(failure.reason).toBe('no-island');
    expect(failure.cause).toBe('script#DATA');
    expect(failure.detail).toBe("'script#DATA' matched 0 elements, so the page has no island to read");
  });

  it('names an island element that is present and empty', () => {
    const failure = failed(parseIsland({ island: 'script#EMPTY' }));
    expect(failure.reason).toBe('no-island');
    expect(failure.detail).toContain("script#EMPTY' matched an element with no content in it");
  });

  it('names an island whose text is not JSON', () => {
    const failure = failed(parseIsland({ island: 'title' }));
    expect(failure.reason).toBe('island-not-json');
    expect(failure.detail).toContain('not JSON:');
  });

  it('names an islandRoot that is not there, with the keys that are', () => {
    const failure = failed(parseIsland({ islandRoot: 'props.pageProps.missing' }));
    expect(failure.reason).toBe('no-items-path');
    // The cause names the island that was read, not the path that missed: the
    // path is in the detail, the script is what a source author has to find.
    expect(failure.cause).toBe('script#__NEXT_DATA__');
    expect(failure.detail).toContain("'props.pageProps.missing' resolved to nothing");
    expect(failure.detail).toContain("the keys at 'props.pageProps' are: topStories, ticker");
  });

  it('names an islandRoot that points at an array, and one that points at a scalar', () => {
    // An array is not a payload root: the items live under an object.
    const arrayRoot = failed(parseIsland({ islandRoot: 'props.pageProps.ticker' }));
    expect(arrayRoot.reason).toBe('no-items-path');
    expect(arrayRoot.detail).toContain("the keys at 'props.pageProps' are: topStories, ticker");
    // A scalar root has no items under it; the detail names the document's own
    // keys, which is where the path started.
    const scalarRoot = failed(parseIsland({ islandRoot: 'buildId' }));
    expect(scalarRoot.reason).toBe('no-items-path');
    expect(scalarRoot.detail).toContain('the keys at the root are: buildId, props');
  });

  it('names an island whose payload is not an object', () => {
    const text = '<!doctype html><html><body><script id="__NEXT_DATA__">[1, 2]</script></body></html>';
    const failure = failed(parseIsland({}, text));
    expect(failure.reason).toBe('no-items-path');
    expect(failure.detail).toContain('the payload is not an object, so no path can resolve');
  });
});
