import { parseServerEvent, type ServerEvent, type StateResponse, stateResponseSchema } from 'newspa-core';

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
