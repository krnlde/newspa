import { htmlSourceSchema } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import { parsePayload } from '../src/index.ts';
import { failed, fixture, itemAt, okItems, pageSource } from './support.ts';

/**
 * Page mode: an HTML source with **no `list`**. The document is one item and
 * its identity is the hash of its text, so the whole change model is "the text
 * differs from the cache". The fixture is a version page — a page with no
 * repeating article list, where what the paper needs is the *text*, not a list.
 */
const page = fixture('html-page-version.html');
const first = (text: string, overrides: Record<string, unknown> = {}) =>
  itemAt(okItems(parsePayload(text, pageSource(overrides))), 0);

describe('the page as one item', () => {
  const result = parsePayload(page, pageSource());

  it('is exactly one item, keyed by content', () => {
    const items = okItems(result);
    expect(items).toHaveLength(1);
    if (result.ok === false) return;
    expect(result.matchCount).toBe(1);
    expect(items[0]?.key.startsWith('node-versions:h')).toBe(true);
    expect(result.notes.some((note) => note.startsWith('the page is one item:'))).toBe(true);
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

describe('what is a change, and what is not', () => {
  const keyOf = (text: string, overrides: Record<string, unknown> = {}): string => first(text, overrides).key;

  it('a re-indented page is the same item: the hash runs on normalized text', () => {
    expect(keyOf(page.replace('</td><td>', '</td>\n      <td>'))).toBe(keyOf(page));
  });

  it('a new version line is a new item', () => {
    expect(keyOf(page.replace('Node.js v25.3.0', 'Node.js v25.4.0'))).not.toBe(keyOf(page));
  });

  it('a ticking timestamp churns the identity until `strip` names it', () => {
    const later = page.replace('Last updated 3 minutes ago', 'Last updated 9 minutes ago');
    expect(keyOf(later)).not.toBe(keyOf(page));
    const strip = { strip: ['.updated'] };
    expect(keyOf(later, strip)).toBe(keyOf(page, strip));
  });

  it('the key covers the whole page, not the stored body', () => {
    const tail = (text: string) => `<!doctype html><html><body><p>head</p><p>${text}</p></body></html>`;
    const long = tail(`x${'y'.repeat(2_000)}tail`);
    // The stored body is capped evidence: it cannot see the end of the page.
    expect(first(long).body).not.toContain('tail');
    // The key can, because it is taken before the cap. A key derived from the
    // stored body would report "no change" for a page that changed.
    expect(keyOf(tail(`x${'y'.repeat(2_000)}changed`))).not.toBe(keyOf(long));
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
