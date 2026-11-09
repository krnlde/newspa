import { describe, expect, it } from 'vitest';
import { pageSignals } from '../src/signals.ts';

const html = (head: string, body = '<h1>Story</h1>'): string =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('pageSignals: html', () => {
  it('reads the page-level change stamps and keeps the newest', () => {
    const signals = pageSignals(
      html(`
        <meta name="dcterms.modified" content="2025-11-08T10:00:00Z">
        <meta property="article:modified_time" content="2025-11-09T10:00:00Z">
        <meta http-equiv="last-modified" content="Sun, 09 Nov 2025 08:00:00 GMT">
      `),
      'html',
    );
    expect(signals.declaredModifiedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(signals.signals).toContain('article:modified_time');
    expect(signals.signals).toContain('last-modified');
  });

  it('does not care about attribute order, quote style, or case', () => {
    expect(
      pageSignals(html(`<meta content="2025-11-09T10:00:00Z" name="last-modified">`), 'html').declaredModifiedAt,
    ).toBe('2025-11-09T10:00:00.000Z');
    expect(
      pageSignals(html(`<meta NAME='Last-Modified' CONTENT='2025-11-09T10:00:00Z'>`), 'html').declaredModifiedAt,
    ).toBe('2025-11-09T10:00:00.000Z');
  });

  it('reads the RFC 822 link a news site puts in its head', () => {
    const signals = pageSignals(html('<link rel="lastmod" href="Sun, 09 Nov 2025 10:00:00 GMT">'), 'html');
    expect(signals.declaredModifiedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(signals.signals).toEqual(['link[rel=lastmod]']);
  });

  it('does not treat a publish date as a change date', () => {
    // A page whose newest article is months old has not changed. A publish
    // stamp says when the story happened, not when the page moved.
    const signals = pageSignals(
      html(
        '<meta property="article:published_time" content="2020-01-01T00:00:00Z"><meta name="date" content="2020-01-01">',
      ),
      'html',
    );
    expect(signals.declaredModifiedAt).toBeNull();
    expect(signals.signals).toEqual([]);
  });

  it('names the generator, because a CMS change predicts a broken selector', () => {
    expect(pageSignals(html('<meta name="generator" content="WordPress 6.7">'), 'html')).toMatchObject({
      generator: 'WordPress 6.7',
      signals: ['generator'],
    });
    expect(pageSignals(html('<title>bare</title>'), 'html').generator).toBeNull();
  });

  it('knows when the page says it must not be cached', () => {
    // A meta `Expires` counts on its own: the classic idiom is a 1997 date, and
    // browsers ignore meta Expires, so it is only ever a statement about the
    // response. Reading it needs no clock, which keeps `pageSignals` pure.
    for (const head of [
      '<meta http-equiv="Cache-Control" content="no-cache">',
      '<meta http-equiv="Pragma" content="no-store">',
      '<meta http-equiv="Expires" content="Mon, 25 Jul 1997 07:00:00 GMT">',
      '<meta http-equiv="cache-control" content="max-age=0, must-revalidate">',
    ]) {
      expect(pageSignals(html(head), 'html').noCacheMeta, head).toBe(true);
    }
    expect(pageSignals(html('<meta http-equiv="Cache-Control" content="max-age=600">'), 'html').noCacheMeta).toBe(
      false,
    );
  });

  it('reads attribute order, quote style, and unquoted values', () => {
    expect(
      pageSignals(html(`<meta content="2025-11-09T10:00:00Z" name="last-modified">`), 'html').declaredModifiedAt,
    ).toBe('2025-11-09T10:00:00.000Z');
    expect(
      pageSignals(html(`<meta NAME='Last-Modified' CONTENT='2025-11-09T10:00:00Z'>`), 'html').declaredModifiedAt,
    ).toBe('2025-11-09T10:00:00.000Z');
    // Real markup: minifiers strip the quotes, and the value is the bare token.
    expect(pageSignals(html('<meta name=last-modified content=2025-11-09T10:00:00Z>'), 'html').declaredModifiedAt).toBe(
      '2025-11-09T10:00:00.000Z',
    );
    // A repeated attribute: the first wins, which is what browsers do.
    expect(
      pageSignals(html('<meta name="last-modified" name="generator" content="2025-11-09T10:00:00Z">'), 'html')
        .generator,
    ).toBeNull();
  });

  it('tolerates a tag with no attributes and a meta with no value', () => {
    const signals = pageSignals(html('<meta><link><meta name="last-modified">'), 'html');
    expect(signals.declaredModifiedAt).toBeNull();
    expect(signals.signals).toEqual([]);
  });

  it('scans the head, not the whole document', () => {
    const inBody = pageSignals(
      html('<title>x</title>', '<meta name="last-modified" content="2025-11-09T10:00:00Z">'),
      'html',
    );
    expect(inBody.declaredModifiedAt).toBeNull();
  });

  it('is empty, not a guess, for a payload that declares nothing or is unparseable', () => {
    const empty = { declaredModifiedAt: null, generator: null, ttlMinutes: null, noCacheMeta: false, signals: [] };
    expect(pageSignals('', 'html')).toEqual(empty);
    expect(pageSignals(html('<meta name="last-modified" content="yesterday">'), 'html')).toEqual(empty);
    expect(pageSignals(html('<meta name="last-modified" content="">'), 'html')).toEqual(empty);
  });

  it('lists each signal once, whatever the count of tags', () => {
    const signals = pageSignals(
      html(
        '<meta name="generator" content="A"><meta name="generator" content=""><meta name="last-modified" content="2025-11-09T10:00:00Z">',
      ),
      'html',
    );
    expect(signals.signals).toEqual(['generator', 'last-modified']);
    expect(signals.generator).toBe('A');
  });
});

describe('pageSignals: rss and atom', () => {
  it('reads the feed-level stamps, the generator and the ttl', () => {
    const signals = pageSignals(
      `<?xml version="1.0"?><rss><channel>
        <generator>WordPress 6.7</generator>
        <lastBuildDate>Sun, 09 Nov 2025 10:00:00 GMT</lastBuildDate>
        <ttl>60</ttl>
        <item><pubDate>Sun, 09 Nov 2025 09:00:00 GMT</pubDate></item>
      </channel></rss>`,
      'rss',
    );
    expect(signals.declaredModifiedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(signals.generator).toBe('WordPress 6.7');
    expect(signals.ttlMinutes).toBe(60);
    expect(signals.signals).toEqual(['lastBuildDate', 'pubDate']);
  });

  it('takes the newest pubDate when the feed has no build stamp', () => {
    const signals = pageSignals(
      '<rss><channel><item><pubDate>Sat, 08 Nov 2025 10:00:00 GMT</pubDate></item><item><pubDate>Sun, 09 Nov 2025 08:00:00 GMT</pubDate></item></channel></rss>',
      'rss',
    );
    expect(signals.declaredModifiedAt).toBe('2025-11-09T08:00:00.000Z');
  });

  it('reads an Atom feed’s updated stamps', () => {
    const signals = pageSignals(
      '<feed><updated>2025-11-09T10:00:00Z</updated><entry><updated>2025-11-09T09:00:00Z</updated></entry></feed>',
      'rss',
    );
    expect(signals.declaredModifiedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(signals.signals).toEqual(['updated']);
  });

  it('is silent for a feed that declares nothing, and for junk ttl values', () => {
    expect(pageSignals('<rss><channel><title>x</title></channel></rss>', 'rss').declaredModifiedAt).toBeNull();
    expect(
      pageSignals('<rss><channel><ttl>abc</ttl><lastBuildDate>x</lastBuildDate></channel></rss>', 'rss'),
    ).toMatchObject({
      ttlMinutes: null,
      declaredModifiedAt: null,
    });
    // A `<ttl>` over 20 000 minutes is not a cadence hint, it is a broken
    // number: an honest health note says "no hint", never "poll in two weeks".
    expect(pageSignals('<rss><channel><ttl>99999</ttl></channel></rss>', 'rss').ttlMinutes).toBeNull();
    expect(pageSignals('<rss><channel><ttl>0</ttl></channel></rss>', 'rss').ttlMinutes).toBe(0);
  });
});

describe('pageSignals: json', () => {
  it('reads a top-level timestamp and generator', () => {
    const signals = pageSignals('{"modified":"2025-11-09T10:00:00Z","generator":"Feather 1.2","items":[]}', 'json');
    expect(signals.declaredModifiedAt).toBe('2025-11-09T10:00:00.000Z');
    expect(signals.generator).toBe('Feather 1.2');
    expect(signals.signals).toEqual(['modified']);
  });

  it('prefers the newest of several stamps, and ignores stamps it cannot place', () => {
    expect(
      pageSignals('{"updated":"2025-11-08T00:00:00Z","lastModified":"2025-11-09T00:00:00Z"}', 'json')
        .declaredModifiedAt,
    ).toBe('2025-11-09T00:00:00.000Z');
    expect(pageSignals('{"modified":"yesterday","generator":42}', 'json')).toMatchObject({
      declaredModifiedAt: null,
      generator: null,
    });
  });

  it('is silent for malformed JSON, an array root, and a non-object root', () => {
    const empty = { declaredModifiedAt: null, generator: null, ttlMinutes: null, noCacheMeta: false, signals: [] };
    expect(pageSignals('{"modified":', 'json')).toEqual(empty);
    expect(pageSignals('[{"modified":"2025-11-09T00:00:00Z"}]', 'json')).toEqual(empty);
    expect(pageSignals('"a string"', 'json')).toEqual(empty);
    expect(pageSignals('', 'json')).toEqual(empty);
  });
});
