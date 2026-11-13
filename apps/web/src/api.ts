import {
  type AddSourceRequest,
  type AddSourceResponse,
  addSourceResponseSchema,
  type PickRequest,
  type PickStatusResponse,
  parseServerEvent,
  pickStatusResponseSchema,
  type ServerEvent,
  type SourcesResponse,
  type StateResponse,
  sourcesResponseSchema,
  stateResponseSchema,
} from 'newspa-core';

/**
 * The API boundary.
 *
 * Every response is **parsed before the app sees it**: `response.json()` is
 * `unknown`, `stateResponseSchema` narrows it, and a server that answers
 * something else is a named failure — not a `TypeError` three frames down. The
 * same discipline applies to the SSE stream (`parseServerEvent` is core's, and
 * the union is discriminated, so a new event type is a compile error here).
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * The state, plus the one fact the page cannot get from the body: **was this
 * edition served from the worker's cache, and when was that cache written?**
 * `sw.js` stamps `/api/state` with `newspa-cached-at` at write time, and a live
 * answer carries no stamp — so the label "cached 06:12" appears exactly when it
 * is true (D-039: rule 5 in the browser; a stale edition that presents itself as
 * news is a silent zero with a masthead on it).
 */
export interface StateAnswer {
  readonly state: StateResponse;
  readonly cachedAt: string | null;
}

const CACHED_AT = 'newspa-cached-at';

export const fetchState = async (signal?: AbortSignal): Promise<StateAnswer> => {
  const accept = { accept: 'application/json' };
  // Built as a whole object, not `{ signal }`: with `exactOptionalPropertyTypes`
  // a `signal: undefined` property is not an absent one, and `RequestInit`
  // declares `signal?: AbortSignal | null`. (Measured: tsc 7 rejects the shorthand.)
  const response = await fetch('/api/state', signal === undefined ? { headers: accept } : { signal, headers: accept });
  if (!response.ok) {
    throw new ApiError(response.status, `the server answered ${String(response.status)} for /api/state`);
  }
  const parsed = stateResponseSchema.safeParse((await response.json()) as unknown);
  if (!parsed.success) {
    throw new ApiError(
      0,
      `/api/state answered something that is not an edition: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }
  return { state: parsed.data, cachedAt: response.headers.get(CACHED_AT) };
};

/**
 * The sources routes (WP14): the reading list, as files, over HTTP.
 *
 * The decision this file makes, and `test/unit/sources-api.test.ts` pins: **a
 * schema-shaped refusal is a value, a transport failure is a throw.** `POST`
 * answers a file the loader refused with `{ ok: false, file: null, messages }`
 * at status 400, and the panel's job is to print those lines in the loader's own
 * words — a throw would bury them in a mutation error state. A 5xx, a body that
 * is not JSON (the missing-build and static answers are text), and a list that
 * does not parse **are** throws: they are not answers, and rule 5 forbids
 * rendering one as "nothing happened".
 *
 * The 403 the address guard answers (D-034) is `{ error: '<sentence>' }`, not a
 * write answer, so it arrives as a refusal line: the reader on a phone reads the
 * sentence, rather than a stack frame.
 */

/** What a body is: the text it carries, and the JSON in it when there is JSON. */
interface AnswerBody {
  readonly text: string;
  readonly json: unknown;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON. The caller names the status, so this is a stated shape, not a zero.
    return null;
  }
};

const bodyOf = async (response: Response): Promise<AnswerBody> => {
  const text = await response.text().catch(() => '');
  return { text, json: parseJson(text) };
};

/** The lines to print, from the three shapes a failure answer has. */
const linesOf = (body: AnswerBody, status: number): readonly string[] => {
  if (typeof body.json === 'object' && body.json !== null) {
    const record = body.json as Record<string, unknown>;
    const messages = record['messages'];
    if (Array.isArray(messages)) return messages.filter((line): line is string => typeof line === 'string');
    const error = record['error'];
    if (typeof error === 'string' && error.length > 0) return [error];
  }
  if (body.text.length > 0) return [body.text];
  return [`the server answered ${String(status)}`];
};

/** The answer to a write, in the one shape every write answer has. */
const answerOf = (body: AnswerBody, status: number): AddSourceResponse => {
  const parsed = addSourceResponseSchema.safeParse(body.json);
  if (parsed.success) return parsed.data;
  return { ok: false, file: null, messages: [...linesOf(body, status)] };
};

/**
 * A write the server **refused**, carried as a failure.
 *
 * `postSourceText` and `deleteSourceById` *return* the answer, because a refusal is
 * data: the loader's own lines about the file the reader posted (D-014), and the 404
 * of a removal is the route's answer, not a broken wire. The panel needs the same
 * fact as a **failure**, in the case that costs the reader most: `SourceEditor.tsx`
 * keeps the box open with the reader's bytes in it and prints the reason beside them,
 * and typed JSON that vanishes on a refused write is a loss the page can prevent.
 * So the shell throws this, and prints `lines` — the loader's lines, not one joined
 * sentence — in the status region.
 */
export class RefusalError extends Error {
  readonly lines: readonly string[];

  constructor(lines: readonly string[]) {
    super(lines.join(' · '));
    this.name = 'RefusalError';
    this.lines = lines;
  }
}

/** A request for the API: headers whole, and `signal` only when there is one. */
const initOf = (
  signal: AbortSignal | undefined,
  method: 'GET' | 'POST' | 'DELETE',
  body: string | undefined,
): RequestInit => {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const init: RequestInit = body === undefined ? { method, headers } : { method, headers, body };
  // Built as a whole object, not `{ ...init, signal }` with an `undefined` key:
  // with `exactOptionalPropertyTypes` a `signal: undefined` property is not an
  // absent one. (Measured: tsc 7 rejects the shorthand.)
  return signal === undefined ? init : { ...init, signal };
};

export const fetchSources = async (signal?: AbortSignal): Promise<SourcesResponse> => {
  const response = await fetch('/api/sources', initOf(signal, 'GET', undefined));
  const body = await bodyOf(response);
  if (!response.ok) {
    throw new ApiError(response.status, linesOf(body, response.status).join(' · '));
  }
  const parsed = sourcesResponseSchema.safeParse(body.json);
  if (!parsed.success) {
    throw new ApiError(
      0,
      `/api/sources answered something that is not the reading list: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }
  return parsed.data;
};

/**
 * A write of raw file text. `filename` names the file the reader is editing, and
 * the server checks it against the posted id (D-011) — a skeleton posts none, so
 * the server names the file itself.
 */
export const postSourceText = async (
  text: string,
  filename: string | undefined,
  signal?: AbortSignal,
): Promise<AddSourceResponse> => {
  const request: AddSourceRequest = filename === undefined ? { text } : { text, filename };
  const response = await fetch('/api/sources', initOf(signal, 'POST', JSON.stringify(request)));
  const body = await bodyOf(response);
  if (response.status >= 500) {
    throw new ApiError(response.status, linesOf(body, response.status).join(' · '));
  }
  return answerOf(body, response.status);
};

/** A removal by id: the file goes, the row is disabled, and the answer says so. */
export const deleteSourceById = async (id: string, signal?: AbortSignal): Promise<AddSourceResponse> => {
  const response = await fetch(`/api/sources?id=${encodeURIComponent(id)}`, initOf(signal, 'DELETE', undefined));
  const body = await bodyOf(response);
  if (response.status >= 500) {
    throw new ApiError(response.status, linesOf(body, response.status).join(' · '));
  }
  return answerOf(body, response.status);
};

/**
 * The picker's report, parsed (WP6, D-036).
 *
 * Both verbs answer with the **same shape**: `POST` reports the window it has just
 * opened (`202`, `state: 'running'`), and `GET` reports where the job got to. A
 * refusal is a **throw** here, not a value: 400 (this source is not an `html`
 * source, or is a page source with no list to pick), 404 (the file is gone, or no
 * pick has run in this process) and 409 (a window is already open, and `messages`
 * names the id that owns it) each carry the sentence the reader has to read, and
 * `RefusalError.lines` is how the panel prints them in the status region.
 *
 * Unlike a refused write, nothing is lost by throwing: a pick has no box of the
 * reader's bytes to keep open, because **the pick never writes** — its text fills
 * the editor and SAVE stays the reader's act (D-036).
 */
const pickOf = async (response: Response, route: string): Promise<PickStatusResponse> => {
  const body = await bodyOf(response);
  if (!response.ok) throw new RefusalError(linesOf(body, response.status));
  const parsed = pickStatusResponseSchema.safeParse(body.json);
  if (!parsed.success) {
    throw new ApiError(
      0,
      `${route} answered something that is not a pick report: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    );
  }
  return parsed.data;
};

/**
 * Open a pick window for a source the reader already has. The body is the **id**,
 * never a url: the url, the headers and the `profile: true` fact belong to the
 * source file (D-011), and a route that fetched an address a peer named is the wall
 * D-034 refuses to lower. The answer is immediate — a request that waits for a
 * cursor dies in a proxy — so the job arrives through `pickStatus`.
 */
export const startPick = async (id: string, signal?: AbortSignal): Promise<PickStatusResponse> => {
  const request: PickRequest = { id };
  const response = await fetch('/api/pick', initOf(signal, 'POST', JSON.stringify(request)));
  return await pickOf(response, 'POST /api/pick');
};

/** The job's report, as the page prints it: `state: 'running'` means ask again. */
export const pickStatus = async (id: string, signal?: AbortSignal): Promise<PickStatusResponse> => {
  const response = await fetch(`/api/pick?id=${encodeURIComponent(id)}`, initOf(signal, 'GET', undefined));
  return await pickOf(response, 'GET /api/pick');
};

/**
 * The live stream. Returns the close function, which React calls on unmount:
 * an `EventSource` left open is a socket that outlives the page.
 *
 * A message that does not parse is **reported and ignored** — one malformed
 * push must not end the stream, and must not be swallowed either.
 */
export const openEvents = (
  onEvent: (event: ServerEvent) => void,
  onMalformed?: (message: string) => void,
): (() => void) => {
  const source = new EventSource('/api/events');
  source.onmessage = (message: MessageEvent<string>) => {
    const parsed = parseServerEvent(message.data);
    if (parsed.ok === true) {
      onEvent(parsed.event);
      return;
    }
    onMalformed?.(parsed.message);
  };
  return () => {
    source.close();
  };
};
