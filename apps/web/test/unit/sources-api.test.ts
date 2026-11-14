import { type SourcesResponse, sourcesResponseSchema } from 'newspa-core';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiError, deleteSourceById, fetchSources, postSourceText } from '../../src/api.ts';

/**
 * The sources API boundary (WP14). What is pinned is the shape of the answers,
 * because the panel prints them and nothing else:
 *
 *  - **the list is parsed before the app sees it** — a 200 that is not a
 *    `sourcesResponseSchema` is a named `ApiError` with status 0, not a
 *    `TypeError` inside a row;
 *  - **a schema-shaped refusal is a value, a transport failure is a throw.**
 *    `POST` answers a file the loader refused with `{ ok, file, messages }` at
 *    status 400: those lines are the loader's own words and the reader has to
 *    read them, so they return. A 5xx, a rejected `fetch`, and a body that is
 *    not JSON at all (the static answers are text) are not answers, and throw;
 *  - the address guard's 403 is `{ error: '<sentence>' }` (D-034), which is not
 *    a write answer, so it arrives as one refusal line.
 */

const LIST: SourcesResponse = sourcesResponseSchema.parse({
  scope: 'full',
  dir: '/home/reader/newspa/sources',
  files: [
    {
      file: 'bbc-world.json',
      id: 'bbc-world',
      kind: 'rss',
      label: 'BBC World',
      text: '{"id":"bbc-world","kind":"rss"}',
      issues: [],
      enabled: true,
      state: 'ok',
    },
  ],
  writable: true,
});

type FetchMock = Mock<(input: string, init?: RequestInit) => Promise<Response>>;

/** An answer shaped like a `Response`: `api.ts` reads `ok`, `status`, `text`. */
const textAnswer = (text: string, status: number): Response =>
  ({ ok: status < 400, status, text: async () => text }) as unknown as Response;

const jsonAnswer = (body: unknown, status = 200): Response => textAnswer(JSON.stringify(body), status);

const refusedAnswer = (messages: readonly string[]): Response =>
  jsonAnswer({ ok: false, file: null, messages: [...messages] }, 400);

const stubFetch = (respond: (url: string, init?: RequestInit) => Response): FetchMock => {
  const mock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => respond(input, init));
  vi.stubGlobal('fetch', mock);
  return mock;
};

const theCall = (mock: FetchMock, method: string): { url: string; init: RequestInit | undefined } => {
  const call = mock.mock.calls.find((entry) => entry[1]?.method === method);
  const url = call?.[0];
  const init = call?.[1];
  if (url === undefined) throw new Error(`no ${method} call was made`);
  return { url, init };
};

const postedBody = (mock: FetchMock): Record<string, unknown> => {
  const body = theCall(mock, 'POST').init?.body;
  if (typeof body !== 'string') throw new Error(`the POST carried no text body: ${String(body)}`);
  return JSON.parse(body) as Record<string, unknown>;
};

const thrownBy = async (promise: Promise<unknown>): Promise<unknown> =>
  await promise.then(
    () => {
      throw new Error('the call was expected to fail');
    },
    (error: unknown) => error,
  );

const asApiError = (thrown: unknown): ApiError => {
  if (!(thrown instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(thrown)}`);
  return thrown;
};

afterEach(vi.unstubAllGlobals);

describe('fetchSources', () => {
  it('parses the list, from the route the server publishes, as a GET', async () => {
    const mock = stubFetch(() => jsonAnswer(LIST));
    expect(await fetchSources()).toEqual(LIST);
    const { url, init } = theCall(mock, 'GET');
    expect(url).toBe('/api/sources');
    expect(init?.headers).toMatchObject({ accept: 'application/json' });
    expect(init?.body).toBeUndefined();
  });

  it('forwards the abort signal, so an unmount cancels the read', async () => {
    const mock = stubFetch(() => jsonAnswer(LIST));
    const controller = new AbortController();
    await fetchSources(controller.signal);
    expect(theCall(mock, 'GET').init?.signal).toBe(controller.signal);
  });

  it('names a non-2xx answer with the server’s own sentence', async () => {
    stubFetch(() => jsonAnswer({ error: 'no source directory: sources/ is missing' }, 503));
    const error = asApiError(await thrownBy(fetchSources()));
    expect(error.status).toBe(503);
    expect(error.message).toBe('no source directory: sources/ is missing');
  });

  it('is the text of a body that is not JSON at all, with the status beside it', async () => {
    stubFetch(() => textAnswer('the web build is missing: pnpm build', 404));
    const error = asApiError(await thrownBy(fetchSources()));
    expect(error.status).toBe(404);
    expect(error.message).toContain('the web build is missing: pnpm build');
  });

  it('is status 0, not a `TypeError`, when the answer is not the reading list', async () => {
    stubFetch(() => jsonAnswer({ masthead: { name: 'The Daily' } }));
    const error = asApiError(await thrownBy(fetchSources()));
    expect(error.status).toBe(0);
    expect(error.message).toContain('/api/sources');
    expect(error.message).toContain('reading list');
  });

  it('names the status when the body is empty, because a blank answer is not an answer', async () => {
    stubFetch(() => textAnswer('', 503));
    const error = asApiError(await thrownBy(fetchSources()));
    expect(error.status).toBe(503);
    expect(error.message).toBe('the server answered 503');
  });

  it('names the status when the body cannot be read at all', async () => {
    stubFetch(
      () =>
        ({
          ok: false,
          status: 500,
          text: async (): Promise<string> => {
            throw new Error('socket closed mid-body');
          },
        }) as unknown as Response,
    );
    const error = asApiError(await thrownBy(fetchSources()));
    expect(error.status).toBe(500);
    expect(error.message).toBe('the server answered 500');
  });

  it('prints a body that is JSON but not an object, because the server said something', async () => {
    stubFetch(() => textAnswer('42', 502));
    const error = asApiError(await thrownBy(fetchSources()));
    expect(error.status).toBe(502);
    expect(error.message).toBe('42');
  });

  it('throws on a transport failure, which is not an answer', async () => {
    stubFetch(() => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:8787');
    });
    await expect(fetchSources()).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:8787');
  });
});

describe('postSourceText', () => {
  it('posts the text and the file it is editing, and returns the answer', async () => {
    const mock = stubFetch(() => jsonAnswer({ ok: true, file: '/sources/bbc-world.json', messages: ['wrote it'] }));
    const answer = await postSourceText('{"id":"bbc-world"}', 'bbc-world.json');
    expect(answer.ok).toBe(true);
    expect(answer.file).toBe('/sources/bbc-world.json');
    expect(answer.messages).toEqual(['wrote it']);
    expect(theCall(mock, 'POST').url).toBe('/api/sources');
    expect(postedBody(mock)).toStrictEqual({ text: '{"id":"bbc-world"}', filename: 'bbc-world.json' });
    expect(theCall(mock, 'POST').init?.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('sends no filename for a skeleton, so the server names the file from the id', async () => {
    const mock = stubFetch(() => jsonAnswer({ ok: true, file: '/sources/new-source.json', messages: [] }));
    await postSourceText('{"id":"new-source"}', undefined);
    expect(Object.keys(postedBody(mock))).toEqual(['text']);
  });

  it('returns a 400 refusal as the answer it is, with the loader’s lines', async () => {
    stubFetch(() => refusedAnswer(['id: the filename is the id (D-011)', 'cadenceMinutes: Expected number']));
    const answer = await postSourceText('{ "id": "Bad Id" }', 'bad.json');
    expect(answer).toStrictEqual({
      ok: false,
      file: null,
      messages: ['id: the filename is the id (D-011)', 'cadenceMinutes: Expected number'],
    });
  });

  it('turns the guard’s 403 into one refusal line, naming D-034', async () => {
    stubFetch(() => jsonAnswer({ error: 'POST from 10.0.0.5 is refused: writes are loopback-only (D-034)' }, 403));
    const answer = await postSourceText('{}', undefined);
    expect(answer.ok).toBe(false);
    expect(answer.messages.join('')).toContain('loopback-only (D-034)');
  });

  it('keeps the lines a broken answer carries, and drops what is not a line', async () => {
    stubFetch(() => jsonAnswer({ ok: false, file: null, messages: ['the loader refused', 42, null] }, 400));
    const answer = await postSourceText('{}', undefined);
    expect(answer.ok).toBe(false);
    expect(answer.messages).toEqual(['the loader refused']);
  });

  it('falls back to the text when the answer has an error with nothing in it', async () => {
    stubFetch(() => textAnswer('{"error":""}', 403));
    const answer = await postSourceText('{}', undefined);
    expect(answer.ok).toBe(false);
    expect(answer.messages.join('')).toContain('{');
  });

  it('throws on a 5xx, because a broken server has not refused the file', async () => {
    stubFetch(() => jsonAnswer({ error: 'sqlite is busy' }, 500));
    const error = asApiError(await thrownBy(postSourceText('{}', undefined)));
    expect(error.status).toBe(500);
    expect(error.message).toBe('sqlite is busy');
  });

  it('throws on a transport failure', async () => {
    stubFetch(() => {
      throw new Error('socket hang up');
    });
    await expect(postSourceText('{}', undefined)).rejects.toThrow('socket hang up');
  });
});

describe('deleteSourceById', () => {
  it('sends DELETE with the id in the query, the route the server answers', async () => {
    const mock = stubFetch(() => jsonAnswer({ ok: true, file: '/sources/bbc-world.json', messages: ['removed'] }));
    expect((await deleteSourceById('bbc-world')).messages).toEqual(['removed']);
    const { url, init } = theCall(mock, 'DELETE');
    expect(url).toBe('/api/sources?id=bbc-world');
    expect(init?.method).toBe('DELETE');
  });

  it('encodes the id, so a path can never be one', async () => {
    const mock = stubFetch(() => jsonAnswer({ ok: false, file: null, messages: ['id: not a source id'] }));
    await deleteSourceById('../evil');
    expect(theCall(mock, 'DELETE').url).toBe('/api/sources?id=..%2Fevil');
  });

  it('throws on a 5xx: the server broke, it did not refuse the removal', async () => {
    stubFetch(() => jsonAnswer({ error: 'sqlite is busy' }, 500));
    const error = asApiError(await thrownBy(deleteSourceById('bbc-world')));
    expect(error.status).toBe(500);
    expect(error.message).toBe('sqlite is busy');
  });

  it('returns a 404 as the answer it is: no such file, in the server’s words', async () => {
    stubFetch(() =>
      jsonAnswer({ ok: false, file: null, messages: ['no source file named gone.json in /sources'] }, 404),
    );
    const answer = await deleteSourceById('gone');
    expect(answer.ok).toBe(false);
    expect(answer.messages[0]).toContain('no source file named gone.json');
  });
});
