/**
 * The body reader, driven directly.
 *
 * The route tests reach the happy paths and the 413 through a socket; the arms that
 * need a **stream**, not a request — an empty body, a stream that dies mid-flight, a
 * body that is not JSON — are pinned here, because each one is an answer the client
 * gets, and an untested arm is a status code that is a guess.
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { BodyError, readJsonBody } from '../src/requestBody.ts';

const streamOf = (chunks: readonly (string | Buffer)[]): IncomingMessage => {
  const source = Readable.from(chunks.map((chunk) => (typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk)));
  return source as unknown as IncomingMessage;
};

const failWith = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    (value) => {
      throw new Error(`resolved with ${JSON.stringify(value)}`);
    },
    (cause: unknown) => cause,
  );

describe('readJsonBody', () => {
  it('reads a JSON body whole', async () => {
    expect(await readJsonBody(streamOf(['{"text":"{}"}']), 1024)).toEqual({ text: '{}' });
  });

  it('answers an empty body as {}, so the schema names the missing field (rule 5)', async () => {
    expect(await readJsonBody(streamOf([]), 1024)).toEqual({});
  });

  it('refuses a body over the cap, with 413, and stops reading at the chunk that crossed it', async () => {
    const cause = await failWith(readJsonBody(streamOf([Buffer.alloc(1024), Buffer.alloc(1024)]), 1500));
    expect(cause).toBeInstanceOf(BodyError);
    if (!(cause instanceof BodyError)) return;
    expect(cause.status).toBe(413);
    expect(cause.message).toContain('1500');
  });

  it('refuses a body that is not JSON with 400 and the parse reason', async () => {
    const cause = await failWith(readJsonBody(streamOf(['{ "id": ']), 1024));
    expect(cause).toBeInstanceOf(BodyError);
    if (!(cause instanceof BodyError)) return;
    expect(cause.status).toBe(400);
    expect(cause.message).toContain('not JSON');
  });

  it('names a stream that dies mid-body, with 400, and never hangs', async () => {
    const source = Readable.from([Buffer.from('{"a":', 'utf8')]);
    const req = source as unknown as IncomingMessage;
    const promise = readJsonBody(req, 1024);
    source.destroy(new Error('the socket went'));
    const cause = await failWith(promise);
    expect(cause).toBeInstanceOf(BodyError);
    if (!(cause instanceof BodyError)) return;
    expect(cause.status).toBe(400);
    expect(cause.message).toContain('socket went');
  });

  it('prints a stream failure that is not an Error in its string form', async () => {
    // A real stream will not hand a listener a non-`Error` on demand (measured:
    // `destroy('a string')` arrives as `undefined`), so the arm is driven through
    // the same shape `node:http` presents: an object that answers `on(...)`.
    const source = new EventEmitter();
    const promise = readJsonBody(source as unknown as IncomingMessage, 1024);
    queueMicrotask(() => {
      source.emit('error', 'a plain string, not an Error');
    });
    const cause = await failWith(promise);
    expect(cause).toBeInstanceOf(BodyError);
    if (!(cause instanceof BodyError)) return;
    expect(cause.status).toBe(400);
    expect(cause.message).toContain('a plain string, not an Error');
  });
});
