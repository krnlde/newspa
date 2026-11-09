import { describe, expect, it } from 'vitest';
import { bodyHashOf, declaredBytesOf, HASH_PREFIX, probeLimit, readCapped } from '../src/transportBody.ts';
import { classifyThrown } from '../src/transportErrors.ts';
import { describeTransport, failTransport, NO_CACHE_HINTS, type TransportNotModified } from '../src/transportTypes.ts';
import { chunkedBody } from './transportSupport.ts';

/**
 * The transport's arithmetic, apart from a response: the cap, the hash, the
 * failure record, the cause chain. The `fetchSource` suites pin the same
 * behaviour end-to-end; this file pins the parts, at the edges a real server
 * and a real socket produce.
 */

const freshSignal = (): AbortSignal => new AbortController().signal;

describe('the byte cap and the hash', () => {
  it('the empty body has the sha256 of nothing, which is a real hash to store', () => {
    expect(bodyHashOf(new Uint8Array(0))).toBe(
      `${HASH_PREFIX}e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`,
    );
  });

  it('content-length is read as a number to print, never as the cap', () => {
    expect(declaredBytesOf('1024')).toBe(1024);
    expect(declaredBytesOf(' 42 ')).toBe(42);
    expect(declaredBytesOf('0')).toBe(0);
    expect(declaredBytesOf(null)).toBeNull();
    expect(declaredBytesOf('gzip')).toBeNull();
    expect(declaredBytesOf('-5')).toBeNull();
  });

  it('the probe of a failure is a probe', () => {
    expect(probeLimit(33_554_432)).toBe(16_384);
    expect(probeLimit(2_048)).toBe(2_048);
  });

  it('a null body is an empty body, not a stream that must be read', async () => {
    const read = await readCapped(null, 1_024);
    expect(read.ok).toBe(true);
    expect(read.bytes.byteLength).toBe(0);
  });

  it('a stream is read to the end under the cap and stopped over it', async () => {
    const under = await readCapped(chunkedBody(['abc', 'def']), 12);
    expect(under.ok).toBe(true);
    expect(Buffer.from(under.bytes).toString()).toBe('abcdef');
    const over = await readCapped(chunkedBody(['abcdef', 'ghijkl']), 8);
    expect(over.ok).toBe(false);
    if (over.ok === false) {
      expect(over.seen).toBe(12);
      expect(over.bytes.byteLength).toBe(6);
    }
  });
});

describe('the failure record always carries every field, so a caller never writes a default', () => {
  const bare = failTransport({
    reason: 'transport',
    errorKind: 'network',
    detail: 'a bare failure',
    url: 'https://example.invalid',
    attempts: 1,
  });

  it('the defaults are zeros and nulls, never a missing key', () => {
    expect(bare.status).toBe(0);
    expect(bare.statusText).toBe('');
    expect(bare.bytes).toBe(0);
    expect(bare.etag).toBeNull();
    expect(bare.vary).toEqual([]);
    expect(bare.cache).toEqual(NO_CACHE_HINTS);
    expect(bare.freshnessSeconds).toBeNull();
    expect(bare.challenge).toBe(false);
    expect(bare.notes).toEqual([]);
  });

  it('a log line exists for every state of the union', () => {
    expect(describeTransport(bare)).toBe('failure/transport (network): a bare failure :: ');
    const asNotModified: TransportNotModified = { ...bare, state: 'not-modified', ok: true, bytes: 0, notes: [] };
    expect(describeTransport(asNotModified)).toContain(
      'not-modified: HTTP 0 of https://example.invalid in 1 attempt(s)',
    );
  });
});

describe('the cause chain, named', () => {
  it('an error with no message at all is still classified', () => {
    const info = classifyThrown(new Error(), freshSignal());
    expect(info.errorKind).toBe('network');
    expect(info.detail).toContain('Error');
    expect(info.notes).toContain('error names: Error');
  });

  it('an abort that is not ours is named aborted, not timeout', () => {
    const signal = AbortSignal.abort(new DOMException('shutting down', 'AbortError'));
    const info = classifyThrown(new Error('the socket closed'), signal);
    expect(info.reason).toBe('aborted');
    expect(info.errorKind).toBe('timeout');
  });

  it('a timeout signalled by the clock is named with the reason name', () => {
    const signal = AbortSignal.abort(new DOMException('the clock ran out', 'TimeoutError'));
    expect(classifyThrown(new Error('nope'), signal).detail).toContain('TimeoutError');
  });

  it('a headers timeout is a timeout by its code, with a message that says nothing', () => {
    const info = classifyThrown(
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('no reply'), { code: 'UND_ERR_HEADERS_TIMEOUT' }),
      }),
      freshSignal(),
    );
    expect(info.reason).toBe('timeout');
    expect(info.detail).toContain('never answered');
  });

  it('a TLS failure is named from the message alone, when there is no code', () => {
    const info = classifyThrown(
      new TypeError('fetch failed', { cause: new Error('unable to verify the first certificate') }),
      freshSignal(),
    );
    expect(info.errorKind).toBe('tls');
    expect(info.reason).toBe('tls');
  });

  it('a DNS failure is named from the message alone, when there is no code', () => {
    const info = classifyThrown(
      new TypeError('fetch failed', { cause: new Error('getaddrinfo EAI_AGAIN feeds.example.invalid') }),
      freshSignal(),
    );
    expect(info.errorKind).toBe('network');
    expect(info.detail).toContain('did not resolve');
  });

  it('a cause chain deeper than two is walked, bounded', () => {
    const deep = new TypeError('fetch failed', {
      cause: Object.assign(new Error('mid'), { cause: Object.assign(new Error('deep'), { code: 'ECONNREFUSED' }) }),
    });
    const info = classifyThrown(deep, freshSignal());
    expect(info.reason).toBe('network');
    expect(info.detail).toContain('mid');
    expect(info.detail).toContain('ECONNREFUSED');
    expect(classifyThrown('a bare string', freshSignal()).detail).toContain('a bare string');
  });
});
