/**
 * The HTTP surface (WP4, MVP): the two routes the app calls, the SSE stream, and
 * the built page — one process, one port (D-002).
 *
 * `apps/web/src/api.ts` calls exactly two things: `GET /api/state` and
 * `EventSource('/api/events')`. So that is what exists. `/api/items` and
 * `/api/search` are **named as not built** rather than absent, and a request for
 * them is answered with the sentence that says so: a 404 with no body is a silent
 * zero (rule 5), and the difference between "not built yet" and "not there" is the
 * difference a reader can act on.
 *
 * Every answer is a **line, not a stack**: a 4xx/5xx body is JSON with the reason in
 * it, and the cause goes to the log. The guard in `net.ts` (D-034) runs before
 * routing, so a write from the LAN is refused on the address, not by a route that
 * happens to check.
 *
 * Three functions, because the ladder has three kinds of answer: the API, the page,
 * and the boundary.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StateResponse } from 'newspa-core';
import { isLoopback, mutationAllowed } from './net.ts';
import { BodyError, readJsonBody } from './requestBody.ts';
import { MAX_SOURCE_BODY_BYTES, type SourcesRoutes } from './sourcesApi.ts';
import type { Hub } from './sse.ts';
import { staticFor } from './staticFiles.ts';

export interface HttpDeps {
  /** The paper, read from the db: `stateOf` wired to the repositories. */
  readonly state: () => StateResponse;
  readonly hub: Hub;
  /** The reading list, as files (WP14). */
  readonly sources: SourcesRoutes;
  /** `apps/web/dist`. */
  readonly dist: string;
  readonly log: (line: string) => void;
  /** The peer address. `socket.remoteAddress` in production; a test's string. */
  readonly addressOf: (req: IncomingMessage) => string | undefined;
}

const pathOf = (req: IncomingMessage): string => (req.url ?? '/').split('?')[0] ?? '/';

const sendJson = (res: ServerResponse, status: number, body: unknown, cache = 'no-store'): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache });
  res.end(`${JSON.stringify(body)}\n`);
};

const sendText = (res: ServerResponse, status: number, text: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${text}\n`);
};

/** What the API is, in the body: the routes, and the ones that are not built. */
const API_INDEX = {
  state: '/api/state',
  events: '/api/events (text/event-stream)',
  sources: '/api/sources (GET) · POST writes sources/<id>.json · DELETE ?id=… — writes are loopback-only (D-034)',
  items: 'not built: the app has no items page in the MVP',
  search: 'not built: FTS5 exists in `packages/db`; the route and the box are WP7',
} as const;

/** The sources route: the list, a write of raw file text, a removal by id. */
const sourcesRoute = async (
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  writable: boolean,
): Promise<void> => {
  if (method === 'GET') {
    const answer = await deps.sources.list(writable);
    sendJson(res, answer.status, answer.body);
    return;
  }
  if (method === 'POST') {
    await sourcesWrite(deps, req, res);
    return;
  }
  if (method === 'DELETE') {
    const query = new URL(req.url ?? '/api/sources', 'http://internal');
    const answer = await deps.sources.remove(query.searchParams.get('id') ?? '');
    sendJson(res, answer.status, answer.body);
    return;
  }
  sendJson(res, 405, { error: '/api/sources is GET, POST (write a source file) and DELETE ?id=…' });
};

/** A POST: read the body with a ceiling, then let the route decide. */
const sourcesWrite = async (deps: HttpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  try {
    const raw = await readJsonBody(req, MAX_SOURCE_BODY_BYTES);
    const answer = await deps.sources.write(raw);
    sendJson(res, answer.status, answer.body);
  } catch (cause) {
    // A body that cannot be read is the same shape as a write that cannot land:
    // `{ok, file, messages}`, so the form renders one kind of answer, not two.
    const status = cause instanceof BodyError ? cause.status : 400;
    const message = cause instanceof Error ? cause.message : String(cause);
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    };
    if (status === 413) {
      // The body was never read to the end, so the connection cannot be reused: say
      // so in the same answer, or the client's next request on that socket fails in
      // a way that looks like the server is flaky.
      headers['connection'] = 'close';
    }
    res.writeHead(status, headers);
    res.end(`${JSON.stringify({ ok: false, file: null, messages: [message] })}\n`);
  }
};

/** The API: the routes, a 405 for a verb a route cannot mean, a named 404 for the rest. */
const apiRoute = async (
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  writable: boolean,
): Promise<void> => {
  if (path === '/api/sources') {
    await sourcesRoute(deps, req, res, method, writable);
    return;
  }
  if (path === '/api/events') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: '/api/events is a GET: it is an open stream, not a POST target' });
      return;
    }
    deps.hub.subscribe(req, res);
    return;
  }
  if (path === '/api/state') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: '/api/state is a GET: the paper is written by the poller, not by a client' });
      return;
    }
    sendJson(res, 200, deps.state());
    return;
  }
  sendJson(res, 404, { error: 'no such route', api: API_INDEX });
};

/** The page: the built app, a missing build named, a missing asset a real 404. */
const staticRoute = async (deps: HttpDeps, res: ServerResponse, path: string, head: boolean): Promise<void> => {
  const found = await staticFor(deps.dist, path);
  if (found === 'no-build') {
    deps.log(`static: no build in ${deps.dist}`);
    sendText(
      res,
      404,
      `the app is not built. Run \`pnpm build\` (the built page lives in ${deps.dist}); the API is up: /api/state answers.`,
    );
    return;
  }
  if (found === 'not-found') {
    sendText(res, 404, `not found: ${path}`);
    return;
  }
  res.writeHead(200, { 'content-type': found.type, 'cache-control': found.cache });
  res.end(head ? undefined : found.body);
};

/** The verb ladder, once the boundary has let the request through. */
const route = (
  deps: HttpDeps,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  path: string,
  writable: boolean,
): Promise<void> => {
  if (path.startsWith('/api/')) return apiRoute(deps, req, res, method, path, writable);
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: `${method} is not supported on ${path}` });
    return Promise.resolve();
  }
  return staticRoute(deps, res, path, method === 'HEAD');
};

/** A failure answered: a line to the client, the cause to the log, no stack in the body. */
const fail = (deps: HttpDeps, res: ServerResponse, method: string, path: string, cause: unknown): void => {
  // A stack in a browser's response body is a leak, and a silent 500 is rule 5's zero.
  const reason = cause instanceof Error ? cause.message : String(cause);
  deps.log(`request failed: ${method} ${path} — ${reason}`);
  if (res.headersSent) {
    // A stream that already sent its headers has nowhere to put a status: end it, and
    // let the log be the report.
    res.end();
    return;
  }
  sendJson(res, 500, { error: `the server could not answer ${path}`, cause: reason });
};

/**
 * The handler, as a function of `HttpDeps`, so a test drives it with a real request
 * pair (it is `node:http`'s own callback shape: the socket is the contract, and the
 * LAN requirement is about headers a proxy obeys).
 */
export const handleRequest =
  (deps: HttpDeps) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET';
    const path = pathOf(req);
    try {
      const address = deps.addressOf(req);
      const guard = mutationAllowed(method, address);
      if (guard.allowed === false) {
        deps.log(`refused ${method} ${path}: ${guard.reason}`);
        sendJson(res, 403, { error: guard.reason });
        return;
      }
      // The same fact the guard just used, told to the client so a form on a phone
      // can say "editing is from this machine only" instead of offering a button
      // that is guaranteed to fail (D-034).
      await route(deps, req, res, method, path, isLoopback(address));
    } catch (cause) {
      fail(deps, res, method, path, cause);
    }
  };
