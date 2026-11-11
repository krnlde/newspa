/**
 * The seam for the HTTP tests: a **real** `node:http` server on port 0, driven by
 * `fetch` over loopback, plus the two readers the routes need (a JSON answer, and
 * the first bytes of an open stream), plus the deps bag on a real in-memory database
 * and a real `dist` in a temp directory.
 *
 * A real server, not a fake request pair: the routes' contract is bytes on a
 * socket — the SSE headers, the `cache-control` a proxy obeys, a body a browser
 * shows. A mock would prove the mock, and the LAN requirement (D-034) is about
 * exactly those headers.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Database, openInMemory } from 'newspa-db';
import { type HttpDeps, handleRequest } from '../src/httpApp.ts';
import type { PickRoutes } from '../src/pickApi.ts';
import type { SourcesRoutes } from '../src/sourcesApi.ts';
import { createHub, type Hub } from '../src/sse.ts';
import { addSource, anRssSpec, stateOfDb } from './support.ts';

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

/**
 * The deps bag, on a **real** in-memory database and a real dist in a temp
 * directory, so a route test asserts the facts the routes actually read (rows
 * SQLite returned, files on disk) and not a stub's opinions.
 *
 * Overrides arrive as a **function over the whole bag**, not a `Partial`: with
 * `exactOptionalPropertyTypes`, spreading a partial with an explicitly-`undefined`
 * key unsets a required dependency, and the compiler is right to be angry about it.
 */
export const depsFor = (
  dist: string,
  over: (deps: HttpDeps) => HttpDeps = (deps) => deps,
): { deps: HttpDeps; logs: string[]; hub: Hub; db: Database } => {
  const db = openInMemory({ now: () => new Date('2026-11-09T10:00:00Z'), token: 'tok-http' });
  addSource(db, anRssSpec());
  const logs: string[] = [];
  const hub = createHub({ log: (line) => logs.push(line) });
  const sources: SourcesRoutes = {
    list: async (writable: boolean) => ({ status: 200, body: { dir: 'sources', files: [], writable } }),
    write: async () => ({ status: 200, body: { ok: true, file: 'sources/x.json', messages: [] } }),
    remove: async () => ({ status: 200, body: { ok: true, file: 'sources/x.json', messages: [] } }),
  };
  const pick: PickRoutes = {
    // A stub that answers, never a browser: the http-app tests are about the
    // address gate (rule 20) and the verb shape, and a pick window has neither.
    start: async (id: string) => ({
      status: 202,
      body: { ok: true, state: 'running', sentence: `a pick window is open for ${id}`, messages: [], text: null },
    }),
    status: (id: string) => ({
      status: 200,
      body: { ok: true, state: 'picked', sentence: `the report for ${id}`, messages: [], text: null },
    }),
  };
  const deps = over({
    state: () => stateOfDb(db),
    hub,
    sources,
    pick,
    dist,
    log: (line) => logs.push(line),
    addressOf: () => '127.0.0.1',
  });
  return { deps, logs, hub, db };
};

/** A dist with an index and one hashed asset: the pair the cache rules are about. */
export const builtDist = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'newspa-dist-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>the paper</title>\n', 'utf8');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'assets', 'app-4f2a.js'), 'console.log(1);\n', 'utf8');
  return dir;
};

/** Serve the routes on port 0 for one test, with a temp dist. */
export const serve = async (
  dist: string,
  run: (base: string, h: ReturnType<typeof depsFor>) => Promise<void>,
  over: (deps: HttpDeps) => HttpDeps = (deps) => deps,
): Promise<void> => {
  const h = depsFor(dist, over);
  await withServer(handleRequest(h.deps), ({ base }) => run(base, h));
};
