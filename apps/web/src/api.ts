import {
  type AddSourceRequest,
  type AddSourceResponse,
  addSourceResponseSchema,
  parseServerEvent,
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

export const fetchState = async (signal?: AbortSignal): Promise<StateResponse> => {
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
  return parsed.data;
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
