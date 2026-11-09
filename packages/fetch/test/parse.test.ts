import type { SourceSpec } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import { parsePayload, sniffPayload } from '../src/index.ts';
import {
  failed,
  fixture,
  htmlSource,
  isoDate,
  itemAt,
  jsonSource,
  linkKey,
  okItems,
  okResult,
  rssSource,
} from './support.ts';

/**
 * The one entry point. The order of its checks is the policy: the **bytes**
 * decide the parser (D-006), a wall outranks the kind mismatch, and an empty
 * payload is a fetch problem, never "no news".
 */
const redditFeed =
  '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>r/worldnews</title>' +
  '<item><title>Headline</title><link>https://www.reddit.com/comments/1abc</link>' +
  '<guid isPermaLink="false">t3_1abc</guid><pubDate>Sun, 09 Nov 2025 10:00:00 GMT</pubDate></item></channel></rss>';

describe('the payload decides the parser', () => {
  it('parses a feed that a server served as text/html (the reddit case)', () => {
    // Measured 2026-11-09: old.reddit.com/r/worldnews/.rss answers 200 with
    // content-type text/html, and the body is a feed. A header that lies,
    // trusted, is a quiet zero-item poll.
    const items = okItems(
      parsePayload(redditFeed, rssSource({ id: 'reddit-world', url: 'https://old.reddit.com/r/worldnews/.rss' })),
    );
    expect(items).toHaveLength(1);
    expect(itemAt(items, 0).link).toBe('https://www.reddit.com/comments/1abc');
    expect(itemAt(items, 0).publishedAt).toBe('2025-11-09T10:00:00.000Z');
  });

  it('refuses to parse an HTML page as a feed, and says which is which', () => {
    const failure = failed(parsePayload(fixture('html-card-list.html'), rssSource()));
    expect(failure.reason).toBe('kind-mismatch');
    expect(failure.kind).toBe('rss');
    expect(failure.sniffed).toBe('html');
    expect(failure.marker).toBe('<!doctype html');
    expect(failure.detail).toContain('the payload is html');
    expect(failure.detail).toContain("the source is a 'rss' source");
    expect(failure.detail).toContain('D-006');
    expect(failure.cause).toBe('<!doctype html');
    expect(failure.matchCount).toBeNull();
    expect(failure.itemCount).toBe(0);
  });

  it('refuses to parse a feed as a page, and as JSON', () => {
    expect(failed(parsePayload(redditFeed, htmlSource('li.card'))).reason).toBe('kind-mismatch');
    const asJson = failed(parsePayload(redditFeed, jsonSource('hits')));
    expect(asJson.reason).toBe('kind-mismatch');
    expect(asJson.sniffed).toBe('rss');
    expect(asJson.marker).toBe('<?xml');
  });

  it('refuses a JSON endpoint as a page, and a page as a JSON endpoint', () => {
    expect(failed(parsePayload(fixture('json-hn-front-page.json'), htmlSource('li.card'))).sniffed).toBe('json');
    const islandAsHtml = parsePayload(
      fixture('json-island-nextdata.html'),
      htmlSource('div#__next', { title: 'div#__next' }),
    );
    // The island is markup-shaped, so the HTML parser runs, finds the node, and
    // has no link to give it. That is why `kind: 'json'` and `island` exist.
    expect(failed(islandAsHtml).reason).toBe('no-usable-items');
  });

  it('routes each kind to its own parser', () => {
    const rss = okResult(parsePayload(fixture('feed-bbc-world.xml'), rssSource()));
    expect(rss.kind).toBe('rss');
    expect(rss.sniffed).toBe('rss');
    expect(rss.items.length).toBeGreaterThan(20);
    const html = okResult(
      parsePayload(
        fixture('html-cnn-lite.html'),
        htmlSource('li.card--lite', { title: 'a' }, { url: 'https://edition.cnn.com/' }),
      ),
    );
    expect(html.kind).toBe('html');
    expect(html.items).toHaveLength(100);
    const json = okResult(
      parsePayload(
        fixture('json-hn-front-page.json'),
        jsonSource('hits', { title: 'title', link: 'url', date: 'created_at' }),
      ),
    );
    expect(json.kind).toBe('json');
    expect(itemAt(json.items, 0).publishedAt).toMatch(isoDate);
    expect(itemAt(json.items, 0).key).toMatch(linkKey);
  });

  it('parses the island the page ships its data in, through the same door', () => {
    const items = okItems(
      parsePayload(
        fixture('json-island-nextdata.html'),
        jsonSource(
          'topStories',
          { title: 'headline.en', link: 'url', date: 'publishedAt', image: 'image.url' },
          {
            island: 'script#__NEXT_DATA__',
          },
        ),
      ),
    );
    expect(items).toHaveLength(2);
    expect(itemAt(items, 0).image).toBe('https://example.invalid/hero-one.jpg');
  });
});

describe('a payload that is none of ours', () => {
  it('names an empty body as a fetch problem', () => {
    for (const text of ['', '   \n', '\t']) {
      const failure = failed(parsePayload(text, rssSource()));
      expect(failure.reason).toBe('empty');
      expect(failure.detail).toBe('the payload has no bytes to parse');
      expect(failure.notes).toEqual(['an empty body is a fetch problem, never "no news"']);
      expect(failure.sniffed).toBeNull();
      expect(failure.marker).toBeNull();
    }
  });

  it('names a payload that is a comment, and nothing else, as a document with no kind', () => {
    const failure = failed(parsePayload('  <!-- a proxy note -->  ', htmlSource('li.card')));
    expect(failure.reason).toBe('kind-mismatch');
    expect(failure.marker).toBe('<!--');
    expect(failure.detail).toContain('comment and nothing else');
  });

  it('names a payload of an XML declaration and one comment as a stream that never ' + 'reached a root element', () => {
    // Measured: XMLValidator says InvalidXml "Start tag expected.", the same
    // code a truncated document gives, and a comment-only payload is that
    // shape. The reason is the code, so the ladder stays honest.
    const failure = failed(parsePayload('<?xml version="1.0"?><!-- feed moved -->', rssSource()));
    expect(failure.reason).toBe('truncated');
    expect(failure.detail).toContain('Start tag expected');
  });

  it('names plain text as a kind mismatch for every kind', () => {
    const text = fixture('plain-text.txt');
    const specs: SourceSpec[] = [rssSource(), htmlSource('li'), jsonSource('hits')];
    for (const spec of specs) {
      const failure = failed(parsePayload(text, spec));
      expect(failure.reason).toBe('kind-mismatch');
      expect(failure.kind).toBe(spec.kind);
      expect(failure.sniffed).toBeNull();
      expect(failure.marker).toBe('p');
      expect(failure.detail).toContain('the payload is not one');
      expect(failure.notes[0]).toContain('no feed, HTML or JSON marker');
    }
  });

  it('names a wall ahead of the kind mismatch, because the wall is actionable', () => {
    const failure = failed(parsePayload(fixture('challenge-cloudflare.html'), rssSource()));
    expect(failure.reason).toBe('challenge');
    expect(failure.kind).toBe('rss');
    expect(failure.sniffed).toBe('html');
    expect(failure.cause).toBe('just a moment');
    expect(failure.detail).toContain("served as html to a 'rss' source");
    expect(failure.notes).toContain("marker from core's CHALLENGE_MARKERS");
    expect(failure.notes[0]).toContain('starts with');
  });

  it('names a wall in a payload that has no markup at all', () => {
    const text = 'Pardon our interruption - our systems have detected unusual traffic from your network.';
    const failure = failed(parsePayload(text, jsonSource('hits')));
    expect(failure.reason).toBe('challenge');
    expect(failure.cause).toBe('pardon our interruption');
    expect(failure.notes).toContain('marker from the extended wall list');
  });

  it('hands a payload of the configured kind to its parser even when it is a wall', () => {
    // The wall outranks a *mismatch*; a matching kind is parsed, and the parser
    // names the wall when it finds no items. An article about captchas stays news.
    const html = parsePayload(fixture('login-wall.html'), htmlSource('main form', { title: 'h1' }));
    expect(failed(html).reason).toBe('challenge');
    const article = parsePayload(
      '<!doctype html><ul><li class="card"><h2>Captchas are disappearing</h2><a href="/c">C</a></li></ul>',
      htmlSource('li.card', { title: 'h2' }),
    );
    expect(itemAt(okItems(article), 0).title).toBe('Captchas are disappearing');
  });

  it('exposes the sniff of a payload to a caller that wants it before parsing', () => {
    expect(sniffPayload(redditFeed).kind).toBe('rss');
    expect(sniffPayload(fixture('json-hn-front-page.json')).marker).toBe('{');
  });
});
