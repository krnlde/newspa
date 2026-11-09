import { type ServerEvent, type StateResponse, serverEventSchema, stateResponseSchema } from 'newspa-core';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiError, fetchState, openEvents } from '../../src/api.ts';

/**
 * The boundary between the server and the paper: every response is parsed
 * before the app sees it, and a failure is named. The tests are the four shapes
 * that can arrive — a good payload, a bad status, a body that parses to
 * something else, and a stream that pushes junk.
 *
 * The fixture is **typed through the schema**: `stateResponseSchema.parse` is
 * the contract, so a fixture that drifts from the wire format fails here, at
 * construction, not three frames down inside `api.ts`.
 */

const payload: StateResponse = stateResponseSchema.parse({
  masthead: {
    name: 'The Daily',
    tagline: 'As it happens, on your own machine',
    dayStartHour: 3,
    generatedAt: '2026-11-08T12:00:00.000Z',
  },
  edition: {
    id: '2026-11-08',
    generatedAt: '2026-11-08T12:00:00.000Z',
    dateline: 'November 8, 2026',
    lead: null,
    sections: [],
    edited: [],
    stats: { items: 2, newItems: 1, editedItems: 0, sourcesFetched: 3, sourcesUnhealthy: 0, cycles: 12 },
  },
  sources: [],
});

type FetchMock = Mock<(input: string, init?: RequestInit) => Promise<Response>>;

/** An object shaped like a `Response`, for the parts `api.ts` reads. `Response`
 * has ~30 members; the boundary only uses `ok`, `status` and `json`. */
const responseOf = (body: unknown, init: { ok: boolean; status: number }): Response =>
  ({ ok: init.ok, status: init.status, json: async () => body }) as unknown as Response;

const stubFetch = (respond: () => Response): FetchMock => {
  const mock = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => respond());
  vi.stubGlobal('fetch', mock);
  return mock;
};

/** The thrown value, narrowed: the whole point of `ApiError` is that the status
 * is readable, so the test has to read it typed, not off `any`. */
const asApiError = (thrown: unknown): ApiError => {
  if (!(thrown instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(thrown)}`);
  return thrown;
};

const thrownBy = async (promise: Promise<unknown>): Promise<unknown> =>
  await promise.then(
    () => {
      throw new Error('the call was expected to fail');
    },
    (error: unknown) => error,
  );

describe('fetchState', () => {
  it('returns the parsed edition, from exactly the endpoint the paper reads', async () => {
    const mock = stubFetch(() => responseOf(payload, { ok: true, status: 200 }));
    const state = await fetchState();
    expect(state).toEqual(payload);
    expect(state.edition.dateline).toBe('November 8, 2026');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/state');
  });

  it('forwards the abort signal and asks for JSON', async () => {
    const mock = stubFetch(() => responseOf(payload, { ok: true, status: 200 }));
    const controller = new AbortController();
    await fetchState(controller.signal);
    expect(mock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  });

  it('names a non-2xx answer with the status it came with', async () => {
    stubFetch(() => responseOf({ error: 'no edition yet' }, { ok: false, status: 503 }));
    const error = asApiError(await thrownBy(fetchState()));
    expect(error.status).toBe(503);
    expect(error.name).toBe('ApiError');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('503');
    expect(error.message).toContain('/api/state');
  });

  it('is status 0, not a `TypeError`, when the body is not an edition', async () => {
    // A server answering 200 with something else is the interesting case: the
    // app must not discover it three frames down as "cannot read dateline".
    stubFetch(() => responseOf({ masthead: { name: 'The Daily' } }, { ok: true, status: 200 }));
    const error = asApiError(await thrownBy(fetchState()));
    expect(error.status).toBe(0);
    expect(error.message).toContain('/api/state');
    expect(error.message).toContain('edition');
  });

  it('is status 0 for a body that is not an object at all', async () => {
    stubFetch(() => responseOf('a string, not an edition', { ok: true, status: 200 }));
    expect(asApiError(await thrownBy(fetchState())).status).toBe(0);
  });
});

/** happy-dom has no `EventSource`, so the stream is the one place a fake is
 * honest: it records the URL, counts `close`, and hands messages to `onmessage`. */
const opened: FakeSource[] = [];

class FakeSource {
  readonly url: string;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  readonly close = vi.fn();

  constructor(url: string) {
    this.url = url;
    opened.push(this);
  }
}

const source = (): FakeSource => {
  const at = opened.at(-1);
  if (at === undefined) throw new Error('no EventSource was opened');
  return at;
};

const deliver = (data: string): void => {
  const handler = source().onmessage;
  if (handler === null) throw new Error('openEvents did not install onmessage');
  handler(new MessageEvent<string>('message', { data }));
};

describe('openEvents', () => {
  beforeEach(() => {
    opened.length = 0;
    vi.stubGlobal('EventSource', FakeSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the stream the server publishes', () => {
    openEvents(vi.fn<(event: ServerEvent) => void>());
    expect(opened).toHaveLength(1);
    expect(source().url).toBe('/api/events');
  });

  it('hands the callback a parsed event', () => {
    const event: ServerEvent = serverEventSchema.parse({
      type: 'cycle:done',
      at: '2026-11-08T12:00:00.000Z',
      fetched: 3,
      newItems: 1,
      editedItems: 0,
    });
    const onEvent = vi.fn<(event: ServerEvent) => void>();
    openEvents(onEvent);
    deliver(JSON.stringify(event));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toEqual(event);
  });

  it('passes every member of the union through, untouched', () => {
    const health: ServerEvent = serverEventSchema.parse({
      type: 'source:health',
      at: '2026-11-08T12:00:00.000Z',
      source: 'bbc-world',
      state: 'no-matches',
      note: 'selector matched 0 of 14',
    });
    const onEvent = vi.fn<(event: ServerEvent) => void>();
    openEvents(onEvent);
    deliver(JSON.stringify(health));
    expect(onEvent.mock.calls[0]?.[0]).toEqual(health);
  });

  it('reports a message that is not JSON, and does not throw', () => {
    const onEvent = vi.fn<(event: ServerEvent) => void>();
    const onMalformed = vi.fn<(message: string) => void>();
    openEvents(onEvent, onMalformed);
    expect(() => deliver('this is not json')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
    expect(onMalformed).toHaveBeenCalledOnce();
    const message = onMalformed.mock.calls[0]?.[0] ?? '';
    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(0);
  });

  it('reports an event shape the contract does not know', () => {
    const onEvent = vi.fn<(event: ServerEvent) => void>();
    const onMalformed = vi.fn<(message: string) => void>();
    openEvents(onEvent, onMalformed);
    deliver(JSON.stringify({ type: 'server:on-fire', at: '2026-11-08T12:00:00.000Z' }));
    expect(onEvent).not.toHaveBeenCalled();
    expect(onMalformed).toHaveBeenCalledOnce();
    deliver(JSON.stringify({ type: 'edition:updated' }));
    expect(onMalformed).toHaveBeenCalledTimes(2);
  });

  it('survives a malformed push: the stream keeps delivering', () => {
    const onEvent = vi.fn<(event: ServerEvent) => void>();
    openEvents(onEvent, vi.fn<(message: string) => void>());
    deliver('{');
    deliver('null');
    const start: ServerEvent = serverEventSchema.parse({ type: 'cycle:start', at: '2026-11-08T12:00:00.000Z' });
    deliver(JSON.stringify(start));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toEqual(start);
  });

  it('does not throw on junk when nobody asked to be told', () => {
    openEvents(vi.fn<(event: ServerEvent) => void>());
    expect(() => deliver('nope')).not.toThrow();
  });

  it('closes the source when React unmounts', () => {
    const close = openEvents(vi.fn<(event: ServerEvent) => void>());
    expect(source().close).not.toHaveBeenCalled();
    close();
    expect(source().close).toHaveBeenCalledOnce();
  });
});
