import { describe, expect, it } from 'vitest';
import { parseFingerprint } from '../src/pick/fingerprint.ts';
import { outerHtmlCap, pathMax, textCap } from '../src/pick/types.ts';

/**
 * The fingerprint boundary (WP6): the browser's JSON in, a named verdict out.
 *
 * The claims are the ones a boundary earns:
 *
 *  - every problem is named, in one sentence. A payload with two bad fields gets
 *    two, because a refusal that reports one sends the reader on a hunt (rule 5's
 *    posture, upstream of the parser);
 *  - the tag is **lower-cased**, because the path is compared against a cheerio
 *    document (`xml: false`) while a browser's `tagName` is upper-case for HTML;
 *  - the caps **truncate** the evidence and **refuse** the runaway path: long
 *    markup is a normal page, a 400-deep click is a bug in the injected script, and
 *    a derivation over a path that deep is a hang waiting to happen.
 */

const good = {
  url: 'https://example.invalid/world',
  path: [
    { tag: 'HTML', index: 1 },
    { tag: 'BODY', index: 2 },
    { tag: 'LI', index: 3 },
  ],
  href: 'https://example.invalid/a1',
  outerHtml: '<li class="card">Story one</li>',
  text: 'Story one',
  siblings: 12,
};

const clone = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...good, ...over });

describe('a payload that is a fingerprint', () => {
  it('narrows, and lower-cases the tags on the way in', () => {
    const parsed = parseFingerprint(clone());
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.fp.path.map((step) => step.tag)).toEqual(['html', 'body', 'li']);
    expect(parsed.fp.siblings).toBe(12);
    expect(parsed.fp.href).toBe('https://example.invalid/a1');
  });

  it('accepts a null href: a click with no link is a fact, not a fault', () => {
    const parsed = parseFingerprint(clone({ href: null }));
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.fp.href).toBeNull();
  });

  it('treats a missing href as a null href, and says nothing about it', () => {
    const missing = clone();
    delete missing['href'];
    const parsed = parseFingerprint(missing);
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.fp.href).toBeNull();
  });

  it('truncates the evidence it caps, and keeps the rest', () => {
    const parsed = parseFingerprint(
      clone({ outerHtml: 'x'.repeat(outerHtmlCap + 900), text: 'y'.repeat(textCap + 40) }),
    );
    if (!parsed.ok) throw new Error(parsed.detail);
    expect(parsed.fp.outerHtml).toHaveLength(outerHtmlCap);
    expect(parsed.fp.text).toHaveLength(textCap);
  });
});

describe('a payload that is not', () => {
  it('refuses a non-object, and names the fields it needed', () => {
    const parsed = parseFingerprint('a list of nodes');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe('bad-fingerprint');
    expect(parsed.notes.join(' ')).toContain('url, path, href');
  });

  it('names every problem at once', () => {
    const parsed = parseFingerprint({ url: '', path: 'not-an-array', siblings: 0, outerHtml: 12 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    for (const field of ['url', 'path', 'siblings', 'outerHtml']) expect(parsed.detail).toContain(field);
  });

  it('refuses a path that does not start at html', () => {
    const parsed = parseFingerprint(
      clone({
        path: [
          { tag: 'body', index: 2 },
          { tag: 'li', index: 1 },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain('starts at <html>');
  });

  it('refuses a zero index, because nth-child is 1-based', () => {
    const parsed = parseFingerprint(
      clone({
        path: [
          { tag: 'html', index: 1 },
          { tag: 'li', index: 0 },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain('1-based');
  });

  it('refuses a runaway path, rather than trimming it', () => {
    const deep = Array.from({ length: pathMax + 1 }, () => ({ tag: 'div', index: 1 }));
    deep[0] = { tag: 'html', index: 1 };
    const parsed = parseFingerprint(clone({ path: deep }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain(`over the guard of ${String(pathMax)}`);
  });

  it('refuses a siblings count that is not a positive integer', () => {
    for (const value of [-1, 2.5, 'twelve', undefined]) {
      const parsed = parseFingerprint(clone({ siblings: value }));
      expect(parsed.ok, `${String(value)} is not a siblings count`).toBe(false);
    }
  });

  it('refuses an href that is neither a string nor null', () => {
    const parsed = parseFingerprint(clone({ href: { url: '/a1' } }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain('href');
  });
});
