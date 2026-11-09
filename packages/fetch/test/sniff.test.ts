import { describe, expect, it } from 'vitest';
import { isFeedPayload, leadIn, sniff } from '../src/sniff.ts';

/**
 * D-006: the bytes decide the parser. These pins are the ladder in document
 * order, the lead-in a publisher or proxy writes in front of the document, and
 * the window that stops prose about `<rss>` from deciding anything.
 */
describe('sniff', () => {
  it('names a feed by its declaration, whatever the header claimed', () => {
    const fed = sniff('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>');
    expect(fed.kind).toBe('rss');
    expect(fed.marker).toBe('<?xml');
    expect(fed.reason).toBe("starts with '<?xml'");
    expect(fed.offset).toBe(0);
    expect(isFeedPayload('<?xml version="1.0"?><feed xmlns="x"></feed>')).toBe(true);
  });

  it('names each feed marker the web uses, in the order the ladder declares them', () => {
    expect(sniff('<!DOCTYPE rss><rss></rss>').marker).toBe('<!doctype rss');
    expect(sniff('<rdf:RDF xmlns:rdf="x"><item/></rdf:RDF>').marker).toBe('<rdf:rdf');
    expect(sniff('<RSS version="2.0"></RSS>').marker).toBe('<rss');
    expect(sniff('\n\n  <feed xmlns="http://www.w3.org/2025/Atom"></feed>').marker).toBe('<feed');
    expect(sniff('<feed></feed>').kind).toBe('rss');
  });

  it('names HTML by its doctype, its root, and a bare body', () => {
    expect(sniff('<!doctype html>\n<html></html>').marker).toBe('<!doctype html');
    expect(sniff('<HTML lang="en"></HTML>').marker).toBe('<html');
    expect(sniff('<xhtml:html></xhtml:html>').marker).toBe('<xhtml');
    expect(sniff('<BODY></BODY>').marker).toBe('<body');
  });

  it('names JSON by its first character, and never by markup it contains', () => {
    expect(sniff('{"hits": []}').kind).toBe('json');
    expect(sniff('{"hits": []}').marker).toBe('{');
    expect(sniff('  [1, 2, 3]').marker).toBe('[');
    // A page that quotes a feed in prose is a page: markup wins, and the JSON
    // arm is only reached when the payload *starts* with a brace.
    expect(sniff('<!doctype html><body><p>the &lt;rss&gt; feed and {"a": 1}</p></body>').kind).toBe('html');
  });

  it('reads past a byte-order mark and says so', () => {
    const fed = sniff('\uFEFF<?xml version="1.0"?><rss></rss>');
    expect(fed.kind).toBe('rss');
    expect(fed.offset).toBe(1);
    expect(fed.reason).toBe("starts with '<?xml' after a byte-order mark");
  });

  it('reads past leading comments, and several of them', () => {
    const text = '<!-- proxy -->\n  <!-- publisher -->\n<html lang="en"></html>';
    const fed = sniff(text);
    expect(fed.kind).toBe('html');
    expect(fed.marker).toBe('<html');
    expect(fed.reason).toBe("starts with '<html' after a comment");
    expect(leadIn(text).comment).toBe(true);
    expect(leadIn(text).from).toBe(text.indexOf('<html'));
    expect(leadIn(text).unterminated).toBe(false);
    expect(leadIn('x<!-- c -->').comment).toBe(false);
  });

  it('names a payload that is only a lead-in', () => {
    expect(leadIn('<!-- c -->').blank).toBe(true);
    expect(leadIn('')).toEqual({ from: 0, bom: false, comment: false, blank: true, unterminated: false });
    const comment = sniff('<!-- nothing else -->');
    expect(comment.kind).toBeNull();
    expect(comment.marker).toBe('<!--');
    expect(comment.reason).toBe('a comment and nothing else');
    const empty = sniff('   \n\t ');
    expect(empty.kind).toBeNull();
    expect(empty.marker).toBe('');
    expect(empty.reason).toBe('no bytes');
  });

  it('reports an unterminated comment as the lead-in it is', () => {
    const base = leadIn('<!-- never closed');
    expect(base.unterminated).toBe(true);
    expect(base.comment).toBe(true);
    expect(base.blank).toBe(false);
    const fed = sniff('<!-- never closed');
    expect(fed.kind).toBeNull();
    expect(fed.marker).toBe('<');
    expect(fed.reason).toBe('no feed, HTML or JSON marker in the first 17 characters');
  });

  it('only reads the first 512 characters, so prose cannot decide the kind', () => {
    const padded = `${'x'.repeat(520)}<html><body>news</body></html>`;
    const fed = sniff(padded);
    expect(fed.kind).toBeNull();
    expect(fed.reason).toContain('no feed, HTML or JSON marker in the first 512 characters');
    // The same page with its markup inside the window is a page.
    expect(sniff(`<html><body>${'x'.repeat(520)}</body></html>`).kind).toBe('html');
  });

  it('decides a feed served as text/html by the bytes (the reddit case)', () => {
    // Measured: old.reddit.com/r/worldnews/.rss answers 200 text/html, and the
    // body is a feed. The payload, not the header, is what reaches this file.
    const servedAsHtml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>r/worldnews</title><item><title>T</title><link>https://reddit.com/comments/x</link></item></channel></rss>`;
    expect(sniff(servedAsHtml).kind).toBe('rss');
    expect(isFeedPayload(servedAsHtml)).toBe(true);
    expect(isFeedPayload('<!doctype html><html></html>')).toBe(false);
  });
});
