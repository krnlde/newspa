import { htmlSourceSchema } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '../src/index.ts';
import { failed, fixture, itemAt, okItems, pageSource } from './support.ts';

/**
 * Page mode: an HTML source with **no `list`**. The document is one item at a
 * stable address (`<id>:page`), so the whole change model is "the text differs
 * from the cache", reported as an **edit**. The fixture is a version page — a
 * page with no repeating article list, where what the paper needs is the
 * *text*, not a list.
 */
const page = fixture('html-page-version.html');
const first = (text: string, overrides: Record<string, unknown> = {}) =>
  itemAt(okItems(parsePayload(text, pageSource(overrides))), 0);

describe('the page as one item', () => {
  const result = parsePayload(page, pageSource());

  it('is exactly one item, at an address', () => {
    const items = okItems(result);
    expect(items).toHaveLength(1);
    if (result.ok === false) return;
    expect(result.matchCount).toBe(1);
    expect(items[0]?.key).toBe('node-versions:page');
    expect(result.notes.some((note) => note.startsWith('the page is one item:'))).toBe(true);
  });

  it('is the same address for every edit, and its stored text is the page (D-028)', () => {
    // The key used to be a hash of the page's text, so every edit printed a new
    // story and asked for a fresh read marker. It is an address now, and the diff
    // compares the **stored text** — which is why that text gets `capPageBody`
    // (6 000) and not the 1 200-char display window: a version line below the
    // window has to be visible to the diff, not only to the reader.
    const filler = '<p>The runtime keeps a long index of downloads for old platforms.</p>'.repeat(60);
    const text = `<html><head><title>Node.js downloads</title></head><body>${filler}<p>Node.js v99.0.0 (LTS) Security release.</p></body></html>`;
    const item = first(text);
    expect(item.key).toBe('node-versions:page');
    expect(first(page).key).toBe(item.key);
    expect(item.body.length).toBeGreaterThan(1200);
    expect(item.body).toContain('v99.0.0');
  });

  it('carries the page’s own title, description, image, date and URL', () => {
    const item = first(page);
    expect(item.title).toBe('Node.js downloads · Node.js');
    expect(item.summary).toBe('Download the Node.js source code or a pre-built installer for your platform.');
    expect(item.link).toBe('https://nodejs.org/en/download');
    expect(item.image).toBe('https://nodejs.org/static/images/logo.svg');
    expect(item.publishedAt).toBe('2026-11-02T09:00:00.000Z');
    expect(item.body).toContain('Node.js v24.10.0');
  });

  it('never reads a script, a style or a noscript block as the news', () => {
    const item = first(page);
    expect(item.body).not.toContain('tracker');
    expect(item.body).not.toContain('Enable JavaScript');
  });

  it('is the schema’s own shape: a source file that says nothing is a page source', () => {
    const spec = htmlSourceSchema.parse({
      id: 'page-src',
      kind: 'html',
      label: 'Page source',
      url: 'https://nodejs.org/en/download',
    });
    expect(spec.list).toBeNull();
  });

  it('a <noscript> fallback is not a wall: a reader with JavaScript never sees it', () => {
    // The wall check runs on the stripped text, so `enable JavaScript` in a
    // noscript block does not block a page that is serving its content.
    expect(first(page).title).toContain('Node.js downloads');
  });
});

describe('what is a change, and what is not: the address is stable, the text is the signal', () => {
  const keyOf = (text: string, overrides: Record<string, unknown> = {}): string => first(text, overrides).key;
  const bodyOf = (text: string, overrides: Record<string, unknown> = {}): string => first(text, overrides).body;

  it('a re-indented page is the same item, and the same text', () => {
    const reindented = page.replace('</td><td>', '</td>\n      <td>');
    expect(keyOf(reindented)).toBe(keyOf(page));
    expect(bodyOf(reindented)).toBe(bodyOf(page));
  });

  it('a new version line is the same item, edited — the text carries the news', () => {
    // D-028 replaced this contract on purpose: the key used to move, so a page
    // edit printed a new story and asked for a fresh read marker. `pollItems`
    // finds the row by key and compares `textOf`, so this is now an edit with a
    // word diff, which is what the reader acts on.
    const next = page.replace('Node.js v25.3.0', 'Node.js v25.4.0');
    expect(keyOf(next)).toBe(keyOf(page));
    expect(bodyOf(next)).toContain('Node.js v25.4.0');
    expect(bodyOf(next)).not.toBe(bodyOf(page));
  });

  it('a ticking timestamp churns the compared text until `strip` names it', () => {
    // The identity no longer moves, so this is not a reprinted page — it is an
    // edit reported on every poll: the same noise, in a new shape. `strip` is
    // therefore not a nicety in page mode, it is the only knob there is.
    const later = page.replace('Last updated 3 minutes ago', 'Last updated 9 minutes ago');
    expect(keyOf(later)).toBe(keyOf(page));
    expect(bodyOf(later)).not.toBe(bodyOf(page));
    const strip = { strip: ['.updated'] };
    expect(bodyOf(later, strip)).toBe(bodyOf(page, strip));
  });

  it('the compared text reaches far past the window an item-mode body gets', () => {
    const tail = (text: string) => `<!doctype html><html><body><p>head</p><p>${text}</p></body></html>`;
    const deep = `x${'y'.repeat(2_000)}tail`;
    // 1 200 chars is the display window for an article's evidence; for a page
    // source the stored text is the diff input, so `capPageBody` (6 000) keeps a
    // change below the fold visible to the diff, not only to the reader.
    expect(bodyOf(tail(deep))).toContain('tail');
  });
});

describe('a page that yields nothing is named, never silence', () => {
  it('a page with no text is a failure that says so', () => {
    const empty = '<!doctype html><html><head><title>Blank</title></head><body>   \n  </body></html>';
    const failure = failed(parsePayload(empty, pageSource()));
    expect(failure.reason).toBe('no-usable-items');
    expect(failure.detail).toContain('no text content left after stripping its noise');
  });

  it('a wall answering instead of the page is the wall, named', () => {
    const failure = failed(parsePayload(fixture('challenge-cloudflare.html'), pageSource()));
    expect(failure.reason).toBe('challenge');
  });

  it('a strip selector the CSS engine rejects is named', () => {
    const failure = failed(parsePayload(page, pageSource({ strip: ['a >>'] })));
    expect(failure.reason).toBe('invalid-selector');
    expect(failure.cause).toBe('a >>');
  });
});
