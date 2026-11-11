import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * The two answers the API writes, in one place, so a route cannot invent a third.
 *
 * The rule they carry is rule 5: **a failure is a line, not a stack.** Every
 * non-2xx body is JSON with the reason in it, and every one is `no-store` — a paper
 * that was cached by a proxy is a paper that lies about what is new. The cause of a
 * failure goes to the log by the caller that has it; a browser gets a sentence.
 */
export const sendJson = (res: ServerResponse, status: number, body: unknown, cache = 'no-store'): void => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache });
  res.end(`${JSON.stringify(body)}\n`);
};

/** A sentence, for the answers a human reads (the missing build, a missing asset). */
export const sendText = (res: ServerResponse, status: number, text: string): void => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(`${text}\n`);
};

/**
 * The path, with the query stripped: the routes are addressed by path, never by
 * query. A missing or empty request target is the root — `''` is what a proxy that
 * rewrote the request line has been known to hand over, and a path that is `''`
 * falls past every route and out of the server with no reason attached to it.
 */
export const pathOf = (req: IncomingMessage): string => {
  const path = (req.url ?? '').split('?')[0] ?? '';
  return path === '' ? '/' : path;
};
