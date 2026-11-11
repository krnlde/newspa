import type { IncomingMessage } from 'node:http';

/**
 * The request body, read with a ceiling.
 *
 * A body is the one part of a request the server cannot answer about without
 * reading, so it is where a limit has to live: `MAX_SOURCE_BODY_BYTES` in
 * `sourcesApi.ts` is the policy, and this is the enforcement. A body that is too
 * large is answered **413 while it is still arriving**, not after it is buffered —
 * a server that reads a 2 GB POST to decide it is too big has already lost.
 *
 * A body that is not JSON is a 400 with the parse error, and an empty body is `{}`:
 * the route's schema then says which field is missing, which is a better sentence
 * than "no body" (rule 5: answer with a line the reader can act on).
 */
export class BodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BodyError';
    this.status = status;
  }
}

export const readJsonBody = (req: IncomingMessage, maxBytes: number): Promise<unknown> =>
  new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        // Stop reading, and answer. `destroy()` here kills the **connection**, and a
        // client that gets a reset sees a failed fetch, not the 413 — measured: the
        // test asked for 413 and got `TypeError: fetch failed`. Pausing leaves the
        // server free to flush the answer it is about to write.
        req.pause();
        rejectBody(new BodyError(413, `a request body over ${String(maxBytes)} bytes is not read`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (cause: unknown) => {
      // `String(cause)`, not `cause.message`: a stream that reports a failure that is
      // not an `Error` (measured: a destroyed `Readable` hands the listener
      // `undefined`) would otherwise answer "the request body did not arrive:
      // undefined", which names nothing.
      rejectBody(
        new BodyError(
          400,
          `the request body did not arrive: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      );
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (text === '') {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(text) as unknown);
      } catch (cause) {
        rejectBody(
          new BodyError(400, `the body is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`),
        );
      }
    });
  });
