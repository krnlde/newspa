import { describe, expect, it } from 'vitest';
import { parseJsonPayload } from '../src/json.ts';
import { isRecord, itemsAt, keysAt, parsePath, resolvePath, scalar } from '../src/jsonPath.ts';
import { sniff } from '../src/sniff.ts';
import { failed, fixture, itemAt, jsonSource, linkKey, okItems } from './support.ts';

/**
 * A JSON endpoint, or the island inside a page. The two things a source author
 * needs from this file are the grammar the schema allows, and the failure that
 * names the keys that *were* there — a redesign renames the container, and the
 * health note has to make the fix visible.
 */
const parse = (name: string, itemsPath: string, fields: Record<string, unknown> = {}) => {
  const text = fixture(name);
  return parseJsonPayload(text, jsonSource(itemsPath, fields), sniff(text));
};

describe('the Hacker News front page (real Algolia API)', () => {
  const spec = jsonSource('hits', { title: 'title', link: 'url', date: 'created_at', image: 'thumbnail' });
  const result = () => {
    const text = fixture('json-hn-front-page.json');
    return parseJsonPayload(text, spec, sniff(text));
  };

  it('parses every hit', () => {
    const items = okItems(result());
    expect(items).toHaveLength(12);
    const first = itemAt(items, 0);
    expect(first.title).toBe('Goldman Sachs is pulling Claude Code from its bankers and traders');
    expect(first.link).toBe('https://www.thestateofai.com/news/goldman-sachs-claude-code-traders-bankers');
    expect(first.author).toBe('TheWiggles');
    expect(first.publishedAt).toBe('2026-11-08T18:16:07.000Z');
    expect(first.key).toMatch(linkKey);
    // Algolia's search index ships no image and no deck.
    expect(first.image).toBeNull();
    expect(first.summary).toBeNull();
    const resultValue = result();
    if (resultValue.ok === true) {
      expect(resultValue.matchCount).toBe(12);
      expect(resultValue.skipped).toBe(0);
      expect(resultValue.marker).toBe('{');
      expect(resultValue.sniffed).toBe('json');
    }
    expect(new Set(items.map((i) => i.key)).size).toBe(12);
  });

  it('keeps the fragment of a link, and strips nothing the parser was not asked to', () => {
    const items = okItems(result());
    const fragmented = items.filter((i) => i.link.includes('#'));
    expect(fragmented.length).toBeGreaterThan(0);
    // Identity is the canonical URL: core strips the fragment, so the display
    // link and the key differ here.
    expect(fragmented[0]?.key).toMatch(linkKey);
  });
});

describe('the path grammar the schema allows', () => {
  const fields = { title: 'title', link: 'url', date: 'created_utc', summary: 'selftext', image: 'thumbnail' };

  it('walks an array with [], and reads the wrapper array Reddit writes', () => {
    const items = okItems(parse('json-path-array.json', 'data.children[].data', fields));
    expect(items).toHaveLength(2);
    const first = itemAt(items, 0);
    expect(first.title).toBe('First post');
    expect(first.link).toBe('https://example.invalid/posts/one');
    expect(first.author).toBe('ann');
    expect(first.publishedAt).toBe('2026-11-09T10:00:00.000Z');
    expect(first.image).toBe('https://example.invalid/thumb-one.jpg');
    expect(first.summary).toBe('Body one, first line. Second paragraph.');
    expect(first.body).toBe('Body one, first line. Second paragraph.');
  });

  it('reads an author object, and drops a date that is not a date', () => {
    const items = okItems(parse('json-path-array.json', 'data.children[].data', fields));
    const second = itemAt(items, 1);
    expect(second.author).toBe('Ben Example');
    expect(second.publishedAt).toBeNull();
    // An empty thumbnail is no image, not the empty string.
    expect(second.image).toBeNull();
    expect(second.key).toMatch(linkKey);
  });

  it('counts a node with no title as skipped, and says which one', () => {
    const result = parse('json-path-array.json', 'data.children[].data', fields);
    expect(result.ok).toBe(true);
    if (result.ok === false) return;
    expect(result.matchCount).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.notes).toContain('item 3: no title');
  });

  it('picks one element with [n]', () => {
    const items = okItems(parse('json-path-array.json', 'data.posts[1]', { title: 'title', link: 'url' }));
    expect(items.map((i) => i.title)).toEqual(['Indexed item two']);
  });

  it('names a path that is not there, with the keys that are', () => {
    const failure = failed(parse('json-path-array.json', 'data.stories[0]', fields));
    expect(failure.reason).toBe('no-items-path');
    expect(failure.cause).toBe('data.stories[0]');
    expect(failure.detail).toContain("'data.stories[0]' resolved to nothing");
    expect(failure.detail).toContain('the keys there are: children, after, posts, tags, count, byline');
    expect(failure.matchCount).toBe(0);
  });

  it('names an index past the end, and a path into a scalar', () => {
    expect(failed(parse('json-path-array.json', 'data.posts[9]', fields)).detail).toContain('resolved to nothing');
    const scalarPath = failed(parse('json-path-array.json', 'data.count', fields));
    expect(scalarPath.detail).toBe("'data.count' resolved to number, not an array of objects");
    const strings = failed(parse('json-path-array.json', 'data.children[].data.title', fields));
    expect(strings.detail).toBe("'data.children[].data.title' resolved to string, not an array of objects");
  });

  it('names an array of scalars', () => {
    const failure = failed(parse('json-path-array.json', 'data.tags', fields));
    expect(failure.reason).toBe('no-items-path');
    expect(failure.detail).toBe("'data.tags' resolved to an array, not an array of objects");
  });

  it('a path at the top level, and a path to one object that is not a story', () => {
    // One object with no usable link is not "one story with no title": an
    // object is only a story when it can be linked.
    const result = parse('json-no-items.json', 'data.posts', { title: 'title', link: 'url' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-usable-items');
    const list = parseJsonPayload(
      '[{"title": "Top level", "url": "/a"}]',
      jsonSource('.', { title: 'title', link: 'url' }),
      sniff('[{"title": "Top level", "url": "/a"}]'),
    );
    expect(okItems(list).map((i) => i.link)).toEqual(['https://example.invalid/a']);
  });

  it('parses the grammar itself', () => {
    expect(parsePath('a.b[2][]')).toEqual([
      { key: 'a', index: null, each: false },
      { key: 'b', index: null, each: false },
      { key: '', index: 2, each: false },
      { key: '', index: null, each: true },
    ]);
    expect(parsePath('')).toEqual([]);
    const root = { data: { children: [{ data: { title: 'one' } }, { data: { title: 'two' } }] } };
    expect(resolvePath(root, 'data.children[].data.title').values).toEqual(['one', 'two']);
    expect(resolvePath(root, 'nope.deeper').values).toEqual([]);
    expect(keysAt(root, 'data.children')).toEqual(['children']);
    expect(keysAt(root, 'nope')).toEqual(['data']);
  });

  it('reads a scalar out of the wrappers publishers use', () => {
    expect(scalar('text')).toBe('text');
    expect(scalar(7)).toBe('7');
    expect(scalar(false)).toBe('false');
    expect(scalar(null)).toBeNull();
    expect(scalar(undefined)).toBeNull();
    expect(scalar(['a', 'b'])).toBe('a, b');
    expect(scalar([{ label: 'world' }, { label: 'politics' }])).toBe('world, politics');
    expect(scalar({ url: 'https://e.test/a.jpg' })).toBe('https://e.test/a.jpg');
    expect(scalar({ nothing: 1 })).toBeNull();
    expect(scalar({})).toBeNull();
    expect(scalar([])).toBeNull();
  });

  it('answers itemsAt for a path that resolves to a plain value', () => {
    expect(itemsAt({ a: { title: 'T', url: '/u' } }, 'a')).toEqual({ ok: true, items: [{ title: 'T', url: '/u' }] });
    expect(itemsAt({ a: 1 }, 'a')).toEqual({ ok: false, detail: "'a' resolved to number, not an array of objects" });
    expect(itemsAt({}, 'a')).toEqual({
      ok: false,
      detail: "'a' resolved to nothing; there is no object at that depth",
    });
    // A resolved array is kept element by element; scalars in it are not items,
    // and an array of nothing but scalars is a named fault, not an empty day.
    expect(itemsAt([1, 2], 'a[0]')).toEqual({
      ok: false,
      detail: "'a[0]' resolved to nothing; there is no object at that depth",
    });
    expect(itemsAt({ a: [{ title: 'T' }, 'text'] }, 'a')).toEqual({ ok: true, items: [{ title: 'T' }] });
    expect(itemsAt({ a: ['text'] }, 'a')).toEqual({
      ok: false,
      detail: "'a' resolved to an array, not an array of objects",
    });
  });

  it('reads a key out of a wrapper array, and ignores the shapes that cannot carry it', () => {
    // `data.children[].data.title` is the Reddit-shaped payload: the key belongs
    // to every element of the array, not to the array.
    const root = { data: { children: [{ data: { title: 'one' } }, { data: { title: 'two' } }, 'note'] } };
    expect(resolvePath(root, 'data.children[].data.title').values).toEqual(['one', 'two']);
    // The wrapper arm: no `[]`, and the key is meant for every element.
    expect(resolvePath(root, 'data.children.data').values).toEqual([{ title: 'one' }, { title: 'two' }]);
    expect(resolvePath('text', 'a[0]').values).toEqual([]);
    expect(resolvePath({ a: { b: 1 } }, 'a[0]').values).toEqual([]);
    expect(isRecord([])).toBe(false);
    expect(isRecord({})).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('text')).toBe(false);
  });
});

describe('a JSON payload that is not JSON', () => {
  it('reports the parse error, not an empty day', () => {
    const text = fixture('json-malformed.json');
    const failure = failed(parseJsonPayload(text, jsonSource('hits', { title: 'title', link: 'url' }), sniff(text)));
    expect(failure.reason).toBe('malformed');
    expect(failure.detail).toContain('not JSON:');
    expect(failure.kind).toBe('json');
    expect(failure.itemCount).toBe(0);
  });

  it('names a wall that answered instead of the endpoint', () => {
    const text = fixture('challenge-cloudflare.html');
    const failure = failed(parseJsonPayload(text, jsonSource('hits', { title: 'title', link: 'url' }), sniff(text)));
    expect(failure.reason).toBe('challenge');
    expect(failure.detail).toContain("'just a moment'");
  });

  it('names a payload whose objects carry no title and no link', () => {
    const text = fixture('json-no-items.json');
    const failure = failed(
      parseJsonPayload(text, jsonSource('data.stories', { title: 'title', link: 'url' }), sniff(text)),
    );
    expect(failure.reason).toBe('no-items-path');
    expect(failure.detail).toContain("'data.stories' resolved to nothing");
    const noneUsable = failed(parseJsonPayload(text, jsonSource('meta', { title: 'title', link: 'url' }), sniff(text)));
    expect(noneUsable.reason).toBe('no-usable-items');
    expect(noneUsable.detail).toBe("1 object(s) at 'meta', none with a title and a link");
    expect(noneUsable.notes).toContain('item 1: no title');
  });

  it('keeps a relative link by resolving it, and refuses an empty one', () => {
    const payload = '[{"title": "Only a title", "url": ""}]';
    const result = parseJsonPayload(payload, jsonSource('.', { title: 'title', link: 'url' }), sniff(payload));
    expect(failed(result).reason).toBe('no-usable-items');
    const withLink = parseJsonPayload(
      '[{"title": "T", "url": "x/relative"}]',
      jsonSource('.', { title: 'title', link: 'url' }),
      sniff('[{"title": "T", "url": "x/relative"}]'),
    );
    expect(itemAt(okItems(withLink), 0).link).toBe('https://example.invalid/x/relative');
    expect(itemAt(okItems(withLink), 0).key).toMatch(linkKey);
  });
});
