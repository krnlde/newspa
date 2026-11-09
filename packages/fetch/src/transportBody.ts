import { createHash } from 'node:crypto';

/**
 * Reading the body, and hashing it. Two measured facts shape this file:
 *
 * - **The cap is on decoded bytes.** `content-length` is the gzipped size
 *   (measured: `61508` for a 370 436-byte decoded BBC body, D-006), so a cap
 *   checked against a header is a cap that does not exist. `maxBytes` is
 *   therefore applied to the stream **after** undici decompresses it.
 * - **Over the cap is a failure, never truncated text.** A 400 KB page cut at
 *   64 KB parses into three items, and the paper prints three items: the
 *   silent-zero rule (AGENTS.md rule 5) in its most literal form. So the stream
 *   is abandoned and the outcome is named.
 */

/** The stored-hash format. The DB stores what this emits, and compares it verbatim. */
export const HASH_PREFIX = 'sha256:';

export const bodyHashOf = (bytes: Uint8Array): string =>
  `${HASH_PREFIX}${createHash('sha256').update(bytes).digest('hex')}`;

export type CappedRead =
  | { readonly ok: true; readonly bytes: Uint8Array }
  /** Cap crossed. `bytes` is what was read **before** the cap, for a wall probe. */
  | { readonly ok: false; readonly bytes: Uint8Array; readonly seen: number };

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
};

/**
 * Read a body up to `maxBytes`, then stop.
 *
 * A `null` body is an empty body (a `204`, a `304`), not a zero-length stream:
 * the caller names which one it is. A `read()` rejection — the timeout firing
 * mid-body, a socket reset — propagates, because a half-read body is not a
 * body: the caller maps the cause to `timeout`/`network`.
 */
export const readCapped = async (body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<CappedRead> => {
  if (body === null) return { ok: true, bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      // Teardown, not data: a body that is already over the cap has nothing left
      // to learn, and a rejected `cancel()` says the socket is already broken.
      await reader.cancel('maxBytes exceeded').catch(() => undefined);
      return { ok: false, bytes: concat(chunks), seen: total };
    }
    chunks.push(chunk.value);
  }
  return { ok: true, bytes: concat(chunks) };
};

/**
 * How much of a **failed** response to read. A bot wall is the whole document,
 * so its marker is early (`challenge.ts`'s window is 8 000 characters); reading
 * more of a 403 buys nothing and a 403 can be a 5 MB HTML page.
 */
export const PROBE_BYTES = 16_384;

export const probeLimit = (maxBytes: number): number => Math.min(maxBytes, PROBE_BYTES);

/** The `content-length`, as reported by the server — a number to print, never the cap. */
export const declaredBytesOf = (contentLength: string | null): number | null => {
  if (contentLength === null) return null;
  const n = Number(contentLength.trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
};
