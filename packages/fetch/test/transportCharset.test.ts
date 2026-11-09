import { describe, expect, it } from 'vitest';
import { charsetFromContentType, decodeBody, mediaTypeOf, xmlDeclaredCharset } from '../src/charset.ts';
import { bodyHashOf, fetchSource, NO_BASELINE, probeLimit } from '../src/index.ts';
import { rssSource } from './support.ts';
import type { ResponderInit } from './transportSupport.ts';
import { chunkedBody, failedTransport, fixtureBytes, harness, notesText, okTransport } from './transportSupport.ts';

/**
 * The bytes and the charset — the two things `parsePayload` documents as the
 * transport's job ("text is the **decoded** body: the transport layer owns the
 * charset").
 *
 * The cap is on **decoded** bytes, because `content-length` is the gzipped size
 * (measured, D-006: `61508` for a 370 436-byte body), and crossing it is a
 * failure, never truncated text: a 400 KB page cut at 64 KB parses into three
 * items, and the paper prints three items. Rule 5, in its most literal form.
 */

const FEED_URL = 'https://feeds.example.invalid/world.xml';
const UTF8_FIXTURE = 'transport-feed-utf8.xml';
const LATIN1_FIXTURE = 'transport-feed-latin1.xml';
const PROLOG_FIXTURE = 'transport-prolog-utf8-bytes.xml';

const poll = async (
  body: string | Uint8Array | ReadableStream<Uint8Array> | null,
  init: ResponderInit = {},
  overrides: Record<string, unknown> = {},
  baseline: Parameters<typeof fetchSource>[1] = NO_BASELINE,
): Promise<ReturnType<typeof fetchSource>> => {
  const h = harness(() => new Response(body, init));
  return fetchSource(rssSource({ url: FEED_URL, ...overrides }), baseline, h.deps);
};

const FEED_BODY = '<rss><channel><title>World</title></channel></rss>';

describe('maxBytes, on decoded bytes', () => {
  it('a body over the cap is a named failure with no text, not a truncated success', async () => {
    const bytes = fixtureBytes(UTF8_FIXTURE);
    const result = failedTransport(
      await poll(bytes, { headers: { 'content-type': 'application/rss+xml' } }, { maxBytes: 1_024 }),
    );
    expect(result.reason).toBe('too-large');
    // 'parse', because the status is a 2xx and `classifyFetch` reads the http kind
    // through the status: an http kind here composes to `unknown`, a quiet zero.
    expect(result.errorKind).toBe('parse');
    expect(result.status).toBe(200);
    expect('text' in result).toBe(false);
    expect(result.detail).toContain(`maxBytes (${String(bytes.byteLength)} > 1024 decoded bytes)`);
    expect(notesText(result)).toContain('a truncated body is a silent zero');
    expect(notesText(result)).toContain('the cap is on decoded bytes');
  });

  it('the cap is the decoded size, and the byte count reported is the decoded size', async () => {
    const bytes = fixtureBytes(UTF8_FIXTURE);
    const result = okTransport(await poll(bytes, { headers: { 'content-type': 'application/rss+xml' } }));
    expect(result.bytes).toBe(bytes.byteLength);
  });

  it('a body of exactly maxBytes passes: the cap is `>`, not `>=`', async () => {
    const bytes = fixtureBytes(UTF8_FIXTURE);
    const result = okTransport(
      await poll(bytes, { headers: { 'content-type': 'application/rss+xml' } }, { maxBytes: bytes.byteLength }),
    );
    expect(result.bytes).toBe(bytes.byteLength);
  });

  it('a stream is capped while it arrives, and the bytes read before the cap are counted', async () => {
    const chunks = ['a'.repeat(400), 'b'.repeat(400), 'c'.repeat(400)];
    const result = failedTransport(
      await poll(chunkedBody(chunks), { headers: { 'content-type': 'text/html' } }, { maxBytes: 1_024 }),
    );
    expect(result.reason).toBe('too-large');
    expect(result.bytes).toBe(800);
    expect(result.detail).toContain('(1200 > 1024 decoded bytes)');
  });

  it('the probe of a failed response is capped far below maxBytes, because a wall is early', () => {
    expect(probeLimit(8_388_608)).toBe(16_384);
    expect(probeLimit(1_024)).toBe(1_024);
  });
});

describe('the charset label, apart from a response', () => {
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('is read from every shape a server writes', () => {
    expect(charsetFromContentType('text/html; charset=UTF-8')).toBe('utf-8');
    expect(charsetFromContentType('text/html;charset=US-ASCII')).toBe('us-ascii');
    expect(charsetFromContentType('text/html; charset="ISO-8859-1"')).toBe('iso-8859-1');
    expect(charsetFromContentType("text/html; charset='windows-1252'")).toBe('windows-1252');
    expect(charsetFromContentType('application/json; charset=utf-8; x=y')).toBe('utf-8');
    expect(charsetFromContentType('application/rss+xml; charset=x; charset=utf-8')).toBe('x');
  });

  it('is null when there is none, and when the parameter is empty', () => {
    expect(charsetFromContentType(null)).toBeNull();
    expect(charsetFromContentType('text/html')).toBeNull();
    expect(charsetFromContentType('text/html; charset=')).toBeNull();
    expect(charsetFromContentType('text/html; charset=   ')).toBeNull();
    expect(charsetFromContentType('charset')).toBeNull();
  });

  it('the media type is separable from the parameters', () => {
    expect(mediaTypeOf('application/rss+xml; charset=utf-8')).toBe('application/rss+xml');
    expect(mediaTypeOf('text/html')).toBe('text/html');
    expect(mediaTypeOf('  ')).toBeNull();
    expect(mediaTypeOf('; charset=utf-8')).toBeNull();
    expect(mediaTypeOf(null)).toBeNull();
  });

  it('the XML prolog is read, and only inside the document start', () => {
    expect(xmlDeclaredCharset('<?xml version="1.0" encoding="UTF-8"?>\n<rss>')).toBe('utf-8');
    expect(xmlDeclaredCharset("<?xml version='1.0' encoding='ISO-8859-1'?>\n<rss>")).toBe('iso-8859-1');
    expect(xmlDeclaredCharset('<?xml version="1.0" encoding=UTF-8?>\n<rss>')).toBe('utf-8');
    expect(xmlDeclaredCharset('<?xml version="1.0" encoding="windows-1252"')).toBe('windows-1252');
    expect(xmlDeclaredCharset('<?xml version="1.0"?>\n<rss>')).toBeNull();
    expect(xmlDeclaredCharset('<html><body>no prolog</body></html>')).toBeNull();
    expect(xmlDeclaredCharset(`${'x'.repeat(240)}<?xml encoding="UTF-8"?>`)).toBeNull();
  });

  it('bytes decode by the label, and a label the runtime lacks is said out loud', () => {
    const latin = new Uint8Array([0x70, 0xe9, 0x72]);
    const decoded = decodeBody(latin, 'text/html; charset=iso-8859-1');
    expect(decoded.text).toBe('pér');
    expect(decoded.charset).toBe('iso-8859-1');
    expect(decoded.notes).toEqual([]);
    const fallback = decodeBody(latin, 'text/html; charset=newspa-9');
    expect(fallback.charset).toBe('utf-8');
    expect(fallback.notes.join(' ')).toContain('not a label this runtime can decode');
    expect(fallback.text).toContain('\uFFFD');
  });

  it('the default is UTF-8, and the default is reported', () => {
    const decoded = decodeBody(bytes('café'), null);
    expect(decoded.charset).toBe('utf-8');
    expect(decoded.text).toBe('café');
    expect(decoded.notes.join(' ')).toContain('decoded as UTF-8 (the default)');
  });

  it('a prolog is reported when it disagrees, and is a note only', () => {
    const decoded = decodeBody(
      bytes('<?xml version="1.0" encoding="ISO-8859-1"?><rss>café</rss>'),
      'application/rss+xml; charset=utf-8',
    );
    expect(decoded.declaredCharset).toBe('iso-8859-1');
    expect(decoded.text).toContain('café');
    expect(decoded.notes.join(' ')).toContain('reported, not obeyed');
  });

  it('alias labels are the same bytes, so no note is printed for utf8 vs UTF-8', () => {
    expect(
      decodeBody(bytes('<?xml version="1.0" encoding="utf8"?><rss/>'), 'application/rss+xml; charset=UTF-8').notes,
    ).toEqual([]);
    expect(
      decodeBody(
        bytes('<?xml version="1.0" encoding="UTF-8"?><rss/>'),
        'application/rss+xml; charset=latin1',
      ).notes.join(' '),
    ).toContain('reported, not obeyed');
  });

  it('a byte-order mark is stripped, and the media type plays no part in the decode (D-006)', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('<rss/>')]);
    expect(decodeBody(bom, 'application/rss+xml').text).toBe('<rss/>');
    expect(decodeBody(bytes('{'), 'text/html; charset=utf-8').charset).toBe('utf-8');
  });
});

describe('the charset is decoded from Content-Type, and the prolog is only reported', () => {
  it('a charset=ISO-8859-1 feed decodes: 0xE9 is é, and U+FFFD would be the bug', async () => {
    const bytes = fixtureBytes(LATIN1_FIXTURE);
    const result = okTransport(
      await poll(bytes, { headers: { 'content-type': 'application/rss+xml; charset=ISO-8859-1' } }),
    );
    expect(result.charset).toBe('iso-8859-1');
    expect(result.text).toContain('Le Café « Zürich »');
    expect(result.text).not.toContain('\uFFFD');
  });

  it('no charset in the header means UTF-8, and the default is said out loud', async () => {
    const bytes = fixtureBytes(UTF8_FIXTURE);
    const result = okTransport(await poll(bytes, { headers: { 'content-type': 'application/rss+xml' } }));
    expect(result.charset).toBe('utf-8');
    expect(result.text).toContain('Café World');
    expect(notesText(result)).toContain('no charset in content-type: decoded as UTF-8 (the default)');
  });

  it('a quoted charset parameter is read, and the label decides the decode, not the bytes', async () => {
    const result = okTransport(await poll('café', { headers: { 'content-type': 'text/html; charset="ISO-8859-1"' } }));
    expect(result.charset).toBe('iso-8859-1');
    expect(result.text).toContain('cafÃ©');
  });

  it('an undecodable label is a note, not a silent substitution', async () => {
    const result = okTransport(
      await poll(FEED_BODY, { headers: { 'content-type': 'application/rss+xml; charset=newspa-x-9' } }),
    );
    expect(result.charset).toBe('utf-8');
    expect(notesText(result)).toContain("content-type charset 'newspa-x-9' is not a label this runtime can decode");
  });

  it('UTF-8 bytes under a prolog that declares ISO-8859-1: decoded as UTF-8, the declaration reported, never obeyed', async () => {
    const bytes = fixtureBytes(PROLOG_FIXTURE);
    const result = okTransport(
      await poll(bytes, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } }),
    );
    expect(result.charset).toBe('utf-8');
    expect(result.declaredCharset).toBe('iso-8859-1');
    expect(result.text).toContain('Café UTF-8');
    expect(notesText(result)).toContain('the XML prolog declares encoding="iso-8859-1"');
    expect(notesText(result)).toContain('reported, not obeyed');
  });

  it('the same prolog is silent when the header agrees with it', async () => {
    const bytes = fixtureBytes(PROLOG_FIXTURE);
    const result = okTransport(
      await poll(bytes, { headers: { 'content-type': 'application/rss+xml; charset=iso-8859-1' } }),
    );
    expect(result.charset).toBe('iso-8859-1');
    expect(result.declaredCharset).toBe('iso-8859-1');
    expect(notesText(result)).not.toContain('the XML prolog declares');
  });

  it('a prolog that agrees through an alias label is silent too: utf8 is utf-8', async () => {
    const result = okTransport(
      await poll('<?xml version="1.0" encoding="utf8"?><rss><channel><title>World</title></channel></rss>', {
        headers: { 'content-type': 'application/rss+xml; charset=UTF-8' },
      }),
    );
    expect(result.declaredCharset).toBe('utf8');
    expect(notesText(result)).not.toContain('the XML prolog declares');
  });

  it('a byte-order mark is stripped, because it shifts every offset and breaks `<?xml`', async () => {
    const withBom = new TextEncoder().encode('\uFEFF<rss><channel><title>World</title></channel></rss>');
    const result = okTransport(
      await poll(withBom, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } }),
    );
    expect(result.text.startsWith('<rss')).toBe(true);
  });
});

describe('the body hash, which is layer 1', () => {
  const hash = bodyHashOf(new TextEncoder().encode(FEED_BODY));

  it('the hash format is the stored format: a prefix and a full sha256', () => {
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bodyHashOf(new TextEncoder().encode(FEED_BODY))).toBe(hash);
    expect(bodyHashOf(new TextEncoder().encode(`${FEED_BODY} `))).not.toBe(hash);
  });

  it('bytes that match the stored hash are the strong fast path, and the note says so', async () => {
    const result = okTransport(await poll(FEED_BODY, {}, {}, { etag: null, lastModified: null, bodyHash: hash }));
    expect(result.sameBody).toBe(true);
    expect(result.bodyHash).toBe(hash);
    expect(notesText(result)).toContain('layer 1 (body hash): the bytes match the stored baseline');
  });

  it('bytes that differ are a full parse, and the miss is named', async () => {
    const result = okTransport(
      await poll(FEED_BODY, {}, {}, { etag: null, lastModified: null, bodyHash: 'sha256:00000000' }),
    );
    expect(result.sameBody).toBe(false);
    expect(notesText(result)).toContain('layer 1 (body hash) missed');
  });

  it('the first poll has no hash to compare, and says that instead of claiming a miss', async () => {
    const result = okTransport(await poll(FEED_BODY));
    expect(result.sameBody).toBe(false);
    expect(notesText(result)).toContain('first poll for this source: layer 1 has no stored body hash');
  });
});
