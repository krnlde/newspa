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
import { mutationAllowed } from './net.ts';
import type { Hub } from './sse.ts';
import { staticFor } from './staticFiles.ts';

export interface HttpDeps {
  /** The paper, read from the db: `stateOf` wired to the repositories. */
  readonly state: () => StateResponse;
  readonly hub: Hub;
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
  items: 'not built: the app has no items page in the MVP',
  search: 'not built: FTS5 exists in `packages/db`; the route and the box are WP7',
} as const;

/** The API: two routes, a 405 for a verb a route cannot mean, a named 404 for the rest. */
const apiRoute = (deps: HttpDeps, req: IncomingMessage, res: ServerResponse, method: string, path: string): void => {
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
): Promise<void> => {
  if (path.startsWith('/api/')) {
    apiRoute(deps, req, res, method, path);
    return Promise.resolve();
  }
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
      const guard = mutationAllowed(method, deps.addressOf(req));
      if (guard.allowed === false) {
        deps.log(`refused ${method} ${path}: ${guard.reason}`);
        sendJson(res, 403, { error: guard.reason });
        return;
      }
      await route(deps, req, res, method, path);
    } catch (cause) {
      fail(deps, res, method, path, cause);
    }
  };
