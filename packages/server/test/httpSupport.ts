/**
 * The seam for the HTTP tests: a **real** `node:http` server on port 0, driven by
 * `fetch` over loopback, plus the two readers the routes need (a JSON answer, and
 * the first bytes of an open stream).
 *
 * A real server, not a fake request pair: the routes' contract is bytes on a
 * socket — the SSE headers, the `cache-control` a proxy obeys, a body a browser
 * shows. A mock would prove the mock, and the LAN requirement (D-034) is about
 * exactly those headers.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/** What the routes are built to: a request in, a response written. */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void;

export interface Served {
  readonly base: string;
  readonly server: Server;
  readonly port: number;
}

/** Bind `handler` for the duration of `run`, then close it. */
export const withServer = async (handler: RouteHandler, run: (served: Served) => Promise<void>): Promise<void> => {
  const server = createServer(handler);
  await new Promise<void>((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  try {
    await run({ base: `http://127.0.0.1:${String(port)}`, server, port });
  } finally {
    server.close();
  }
};

/** A JSON answer, with the status: a route test asserts on both. */
export const getJson = async (
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown>; text: string }> => {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as unknown);
  return {
    status: response.status,
    body: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed },
    text,
  };
};

/**
 * The first bytes of `/api/events`, then hang up. Returns the status, the headers
 * and the frames that arrived, so the test can assert the SSE contract and the
 * payload in the same read.
 */
export const readStream = async (
  base: string,
  path: string,
  frames = 1,
  timeoutMs = 2_000,
): Promise<{ status: number; headers: Headers; body: string }> => {
  const response = await fetch(`${base}${path}`);
  const reader = response.body?.getReader();
  if (reader === undefined) return { status: response.status, headers: response.headers, body: '' };
  const decoder = new TextDecoder();
  let body = '';
  const deadline = Date.now() + timeoutMs;
  while (body.split('\n\n').length <= frames && Date.now() < deadline) {
    const chunk = await reader.read();
    if (chunk.done) break;
    body += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return { status: response.status, headers: response.headers, body };
};
