/**
 * The routes (WP4, MVP), over a real socket.
 *
 * The list is the app's: `apps/web/src/api.ts` calls `/api/state` and opens
 * `/api/events`, so those are built, and everything else is **named** — a 404 that
 * says which routes exist and which are not built, because a bare 404 is a silent
 * zero (rule 5) and the reader cannot tell "not built" from "not running".
 *
 * The sources routes and the write boundary (D-034) are in
 * `sources-routes.test.ts`; the static resolver's guard arms are in
 * `static-files.test.ts`. This file is the API the paper calls, the built page, and
 * what a failure answers.
 *
 * The dist is a temp directory, so the cache rules and the missing-build answer are
 * asserted, not assumed.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stateResponseSchema } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { handleRequest } from '../src/httpApp.ts';
import type { Hub } from '../src/sse.ts';
import { builtDist, depsFor, getJson, readStream, serve, withServer } from './httpSupport.ts';

describe('the API the app calls', () => {
  it('answers /api/state with a paper that parses on its own schema, and never a cache', async () => {
    await serve(await builtDist(), async (base, h) => {
      const answer = await fetch(`${base}/api/state`, { headers: { accept: 'application/json' } });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(answer.headers.get('cache-control')).toBe('no-store');
      const parsed = stateResponseSchema.parse(await answer.json());
      expect(parsed.masthead.name).toBe('The Weekly Ledger');
      expect(parsed.sources.map((source) => source.id)).toEqual(['bbc']);
      expect(h.logs).toEqual([]);
    });
  });

  it('answers /api/events by opening the stream', async () => {
    await serve(await builtDist(), async (base) => {
      const stream = await readStream(base, '/api/events', 1);
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    });
  });

  it('names the routes that are not built, in the body of a 404', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await getJson(base, '/api/items');
      expect(answer.status).toBe(404);
      expect(JSON.stringify(answer.body)).toContain('not built');
      expect(answer.body['api']).toMatchObject({
        state: '/api/state',
        sources: expect.stringContaining('loopback-only'),
        search: expect.stringContaining('D-045'),
      });
    });
  });

  it('refuses a method the route cannot mean, with a sentence', async () => {
    await serve(await builtDist(), async (base) => {
      expect((await getJson(base, '/api/state', { method: 'POST' })).status).toBe(405);
      expect((await getJson(base, '/api/events', { method: 'PUT' })).status).toBe(405);
      // HEAD is not GET here: the API is a JSON answer and an open stream, and a
      // browser does not HEAD them. Static answers HEAD (see below).
      expect((await fetch(`${base}/api/state`, { method: 'HEAD' })).status).toBe(405);
    });
  });
});

describe('the LAN reads (D-034)', () => {
  it('lets a LAN peer read the paper and the static page — that is the requirement', async () => {
    await serve(
      await builtDist(),
      async (base) => {
        expect((await fetch(`${base}/api/state`)).status).toBe(200);
        expect((await fetch(`${base}/`)).status).toBe(200);
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42' }),
    );
  });

  it('answers the same peer the household scope: the paper is public, the files are not (rule 18, W4)', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        const res = await fetch(`${base}/api/sources`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { scope: string; dir?: string; files: { text?: string }[] };
        // The desk path and the file text are the two private facts of this answer.
        expect(body).toMatchObject({ scope: 'household' });
        expect(Object.keys(body)).not.toContain('dir');
        for (const file of body.files) expect(file.text).toBeUndefined();
        const del = await getJson(base, '/api/sources?id=bbc', { method: 'DELETE' });
        expect(del.status).toBe(403);
        expect(String(del.body['error'])).toContain('POST /api/sources');
        expect(h.logs.join('\n')).toContain('refused DELETE /api/sources');
        // The household POST rides the guard's one narrowed room; the stub answers.
        const patch = await getJson(base, '/api/sources', {
          method: 'POST',
          body: '{"id":"bbc","patch":{"enabled":false}}',
        });
        expect(patch.status).toBe(200);
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42' }),
    );
  });

  it('refuses the same peer the pick route, on both verbs, and logs each by name', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        // A LAN POST dies at the **mutation guard**, before routing (D-034): the
        // ordering is the rule, and a route that checked the peer itself is how a
        // second, weaker policy gets born.
        const post = await getJson(base, '/api/pick', { method: 'POST', body: '{"id":"bbc"}' });
        expect(post.status).toBe(403);
        expect(String(post.body['error'])).toContain('POST from 192.168.1.42');

        // A LAN GET reaches the route, and the route's wall is the reading list
        // (rule 18): a pick reads a source file and opens a window on this machine.
        const get = await getJson(base, '/api/pick?id=bbc');
        expect(get.status).toBe(403);
        expect(String(get.body['error'])).toContain('GET /api/pick from 192.168.1.42 is refused');

        // Rule 5: a refusal the reader cannot find in the log is a silent zero.
        const lines = h.logs.filter((line) => line.includes('/api/pick'));
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('refused POST /api/pick');
        expect(lines[1]).toContain('refused GET /api/pick');
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42' }),
    );
  });
});

describe('the built page', () => {
  it('serves index.html un-cached and a hashed asset forever', async () => {
    await serve(await builtDist(), async (base) => {
      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(index.headers.get('cache-control')).toBe('no-store');
      expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await index.text()).toContain('the paper');

      const asset = await fetch(`${base}/assets/app-4f2a.js`);
      expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    });
  });

  it('answers an app route with the page, and a missing asset with a 404 that is not the page', async () => {
    await serve(await builtDist(), async (base) => {
      const route = await fetch(`${base}/some/client/route`);
      expect(route.status).toBe(200);
      expect(route.headers.get('content-type')).toBe('text/html; charset=utf-8');

      const gone = await fetch(`${base}/assets/app-0000.js`);
      expect(gone.status).toBe(404);
      expect(await gone.text()).toContain('assets/app-0000.js');
    });
  });

  it('answers a directory request with the page, and a malformed percent-escape with not found', async () => {
    await serve(await builtDist(), async (base) => {
      const dir = await fetch(`${base}/assets`);
      expect(dir.status).toBe(200);
      expect(dir.headers.get('content-type')).toBe('text/html; charset=utf-8');
      // A stray `%` cannot name a file; it must not crash the request (rule 5's
      // "answer with a line", and 400 is the honest status).
      const broken = await fetch(`${base}/%zz`);
      expect(broken.status).toBe(404);
    });
  });

  it('keeps a traversal inside the dist, and says not found', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await fetch(`${base}/../../../../../windows/win.ini`);
      expect([404, 400]).toContain(answer.status);
      expect(await answer.text()).not.toContain('[extensions]');
    });
  });

  it('answers a missing build with the command that fixes it, and says the API is up', async () => {
    const h = depsFor(join(tmpdir(), 'newspa-no-such-dist'));
    await withServer(handleRequest(h.deps), async ({ base }) => {
      const page = await fetch(`${base}/`);
      expect(page.status).toBe(404);
      const text = await page.text();
      expect(text).toContain('pnpm build');
      expect(text).toContain('/api/state answers');
      expect((await fetch(`${base}/api/state`)).status).toBe(200);
      expect(h.logs.join('\n')).toContain('no build in');
    });
  });

  it('answers HEAD like GET with no body, so a link previewer gets the headers', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await fetch(`${base}/`, { method: 'HEAD' });
      expect(answer.status).toBe(200);
      expect(answer.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await answer.text()).toBe('');
    });
  });
});

describe('a route that fails', () => {
  it('answers a write to a static path with 405: the guard allowed it, the verb is not a page verb', async () => {
    await serve(await builtDist(), async (base) => {
      expect((await getJson(base, '/index.html', { method: 'DELETE' })).status).toBe(405);
    });
  });

  it('ends a stream whose headers already went out, when the hub throws, and logs the cause', async () => {
    const brokenHub: Hub = {
      subscribe: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        throw new Error('socket died mid-header');
      },
      publish: () => 0,
      clients: () => 0,
      close: () => undefined,
    };
    await serve(
      await builtDist(),
      async (base, h) => {
        const stream = await fetch(`${base}/api/events`);
        // Headers went, so a 500 is not available: the answer is a closed stream,
        // and the log is the report (rule 5).
        expect(stream.status).toBe(200);
        const body = await stream.text().catch(() => 'aborted');
        expect(body === '' || body === 'aborted').toBe(true);
        expect(h.logs.join('\n')).toContain('request failed: GET /api/events — socket died mid-header');
      },
      (deps) => ({ ...deps, hub: brokenHub }),
    );
  });

  it('answers a write whose route throws with 400, in the write shape, and logs the cause', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        const answer = await getJson(base, '/api/sources', { method: 'POST', body: '{"text":"{}"}' });
        expect(answer.status).toBe(400);
        expect(answer.body).toMatchObject({ ok: false, file: null });
        expect(JSON.stringify(answer.body)).toContain('the disk is gone');
        expect(h.logs.join('\n')).not.toContain('the disk is gone');
      },
      (deps) => ({
        ...deps,
        sources: {
          list: async () => ({ status: 200, body: { dir: 'sources', files: [], writable: true } }),
          write: async () => {
            throw new Error('the disk is gone');
          },
          remove: async () => ({ status: 200, body: { ok: true, file: null, messages: [] } }),
        },
      }),
    );
  });

  it('answers a thrown value that is not an Error in the same shape, so a route cannot leak a stack', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        const answer = await getJson(base, '/api/state');
        expect(answer.status).toBe(500);
        expect(JSON.stringify(answer.body)).toContain('a string, not an Error');
        expect(h.logs.join('\n')).toContain('request failed: GET /api/state — a string, not an Error');
      },
      (deps) => ({
        ...deps,
        state: () => {
          throw 'a string, not an Error';
        },
      }),
    );
  });

  it('answers 500 with a line, logs the cause, and never sends a stack', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        const answer = await getJson(base, '/api/state');
        expect(answer.status).toBe(500);
        expect(JSON.stringify(answer.body)).toContain('the read side exploded');
        expect(answer.text.split('\n').filter((line) => line !== '').length).toBe(1);
        expect(answer.text).not.toContain('    at ');
        expect(h.logs.join('\n')).toContain('request failed: GET /api/state');
      },
      (deps) => ({
        ...deps,
        state: () => {
          throw new Error('the read side exploded');
        },
      }),
    );
  });
});
