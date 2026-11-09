import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * The dev-only API (see `dev/seed.ts`): `pnpm seed` writes `dev/state.json` from
 * the parser fixtures, and this middleware answers `/api/state` and
 * `/api/events` with it, so `pnpm dev` shows a paper with **real publisher
 * text** before `packages/server` exists.
 *
 * It is registered in `vite.config.ts` and is never part of the built bundle:
 * `pnpm start` serves the app and the API from one process on 8787. The state
 * file is read per request, so re-running `pnpm seed` while the dev server is up
 * refreshes the paper.
 */
const stateFile = new URL('state.json', import.meta.url);

const sendJson = (res: ServerResponse, body: string): void => {
  res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body);
};

/** An open stream: the app's SSE path is real code, so it gets exercised in dev. */
const openStream = (req: IncomingMessage, res: ServerResponse): void => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': the dev api keeps the stream open so the app exercises its SSE path\n\n');
  const keepAlive = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    res.end();
  });
};

export const devApi = (): Plugin => ({
  name: 'newspa-dev-api',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url ?? '';
      if (url.startsWith('/api/events')) {
        openStream(req, res);
        return;
      }
      if (url.startsWith('/api/state')) {
        try {
          sendJson(res, readFileSync(stateFile, 'utf8'));
        } catch {
          sendJson(res, JSON.stringify({ error: 'no dev fixture: run pnpm seed in apps/web' }));
        }
        return;
      }
      if (url.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":"the dev api serves /api/state and /api/events only; run the server for the rest"}');
        return;
      }
      next();
    });
  },
});
