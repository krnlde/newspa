/**
 * The sources routes (WP14), over a real socket, and the boundary that owns them.
 *
 * `sources-api.test.ts` drives the same handlers **directly** — the file system and
 * SQLite are the facts there. This file is about what a browser sees: the verbs, the
 * body limits, the answer shape, and the rule that makes a write route safe to have at
 * all: **the address** (D-034). A non-GET from a LAN peer is refused **before
 * routing**, with one narrowed room (W4): `POST /api/sources` is forwarded in the
 * **household scope**, where the body schema, not the socket, is what keeps the file's
 * private words out. `/api/sources` has no authentication of its own, and rule 20
 * forbids inventing one; a test pins that ordering, because a route that checked the
 * peer itself is how a second, weaker policy gets born.
 */

import type { SourcesScope } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import type { HttpDeps } from '../src/httpApp.ts';
import { builtDist, depsFor, getJson, serve } from './httpSupport.ts';

/** A routes bag that echoes what it was asked for, so the test sees the forwarding. */
const echoing = (seen: string[], removed: string[] = []): HttpDeps['sources'] => ({
  list: async (scope: SourcesScope) => {
    seen.push(`list:${scope}`);
    return { status: 200, body: { scope, ...(scope === 'full' ? { dir: 'sources' } : {}), files: [], writable: true } };
  },
  write: async (raw: unknown, scope: SourcesScope) => {
    seen.push(scope);
    return {
      status: 200,
      body: { ok: true, file: 'sources/x.json', messages: [JSON.stringify(raw).slice(0, 40)] },
    };
  },
  remove: async (id: string) => {
    removed.push(id);
    return { status: 200, body: { ok: true, file: `sources/${id}.json`, messages: [] } };
  },
});

describe('the sources routes, as a browser sees them', () => {
  it('answers GET with the list, and a loopback POST with the file it wrote', async () => {
    await serve(await builtDist(), async (base) => {
      const listed = await getJson(base, '/api/sources');
      expect(listed.status).toBe(200);
      expect(listed.body).toMatchObject({ scope: 'full', dir: 'sources', writable: true });

      const written = await getJson(base, '/api/sources', { method: 'POST', body: '{"text":"{}"}' });
      expect(written.status).toBe(200);
      expect(written.body).toMatchObject({ ok: true, file: 'sources/x.json' });
    });
  });

  it('forwards a DELETE ?id=… to the route, and answers its reply', async () => {
    const removed: string[] = [];
    await serve(
      await builtDist(),
      async (base) => {
        const answer = await getJson(base, '/api/sources?id=bbc', { method: 'DELETE' });
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ ok: true, file: 'sources/bbc.json' });
      },
      (deps) => ({ ...deps, sources: echoing([], removed) }),
    );
    expect(removed).toEqual(['bbc']);
  });

  it('forwards an empty id to the route, which answers 400 (the guard is the id schema)', async () => {
    const removed: string[] = [];
    await serve(
      await builtDist(),
      async (base) => {
        const answer = await getJson(base, '/api/sources', { method: 'DELETE' });
        expect(answer.status).toBe(200);
        expect(JSON.stringify(answer.body)).toContain('sources/.json');
      },
      (deps) => ({ ...deps, sources: echoing([], removed) }),
    );
    expect(removed).toEqual(['']);
  });

  it('refuses a verb the route cannot mean, with a sentence that names the verbs', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await getJson(base, '/api/sources', { method: 'PATCH', body: '{}' });
      expect(answer.status).toBe(405);
      expect(JSON.stringify(answer.body)).toContain('GET, POST');
    });
  });

  it('refuses a body over the cap with 413, in the write shape, without reading it all', async () => {
    await serve(await builtDist(), async (base) => {
      const huge = await getJson(base, '/api/sources', { method: 'POST', body: `"${'x'.repeat(70 * 1024)}"` });
      expect(huge.status).toBe(413);
      expect(huge.body).toMatchObject({ ok: false, file: null });
      expect(JSON.stringify(huge.body)).toContain('bytes is not read');
    });
  });

  it('answers a body that is not JSON with 400, in the same shape, and never a stack', async () => {
    await serve(await builtDist(), async (base) => {
      const broken = await getJson(base, '/api/sources', { method: 'POST', body: 'not json' });
      expect(broken.status).toBe(400);
      expect(JSON.stringify(broken.body)).toContain('not JSON');
      expect(broken.text).not.toContain('    at ');
    });
  });
});

describe('the write boundary (D-034), with the household room (W4)', () => {
  it('forwards a LAN POST to the route, in household scope — the one narrowed room', async () => {
    const seen: string[] = [];
    const removed: string[] = [];
    await serve(
      await builtDist(),
      async (base) => {
        const answer = await getJson(base, '/api/sources', {
          method: 'POST',
          body: '{"id":"bbc","patch":{"enabled":false}}',
        });
        expect(answer.status).toBe(200);
        // The route is reached, and the scope it is reached with is the fact: the
        // household write is a patch, and the desk's file-text write is not on this wire.
        expect(seen).toEqual(['household']);
        expect(removed).toEqual([]);
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42', sources: echoing(seen, removed) }),
    );
  });

  it('answers a LAN read in household scope: no dir, no text — the files stay on the desk (rule 18)', async () => {
    const seen: string[] = [];
    await serve(
      await builtDist(),
      async (base) => {
        const answer = await getJson(base, '/api/sources');
        expect(answer.status).toBe(200);
        expect(answer.body).toMatchObject({ scope: 'household', writable: true });
        expect(Object.keys(answer.body)).not.toContain('dir');
        expect(seen).toEqual(['list:household']);
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42', sources: echoing(seen) }),
    );
  });

  it('refuses a LAN DELETE before routing, and never reaches the route', async () => {
    const seen: string[] = [];
    const removed: string[] = [];
    await serve(
      await builtDist(),
      async (base, h) => {
        const answer = await getJson(base, '/api/sources?id=bbc', { method: 'DELETE' });
        expect(answer.status).toBe(403);
        expect(JSON.stringify(answer.body)).toContain('D-034');
        expect(h.logs.join('\n')).toContain('refused DELETE /api/sources');
        expect(removed).toEqual([]);
        expect(seen).toEqual([]);
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42', sources: echoing(seen, removed) }),
    );
  });

  it('answers a write to an unbuilt route from loopback with 404, not 403: the guard let it through', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await getJson(base, '/api/items', { method: 'POST', body: '{}' });
      expect(answer.status).toBe(404);
      expect(JSON.stringify(answer.body)).toContain('no such route');
    });
  });

  it('refuses the same unbuilt write from a LAN peer with 403: the address decides first', async () => {
    await serve(
      await builtDist(),
      async (base) => {
        expect((await getJson(base, '/api/items', { method: 'POST', body: '{}' })).status).toBe(403);
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42' }),
    );
  });

  it('the bag every route needs is present in full, so no verb is a silent zero', () => {
    const h = depsFor('nowhere');
    expect(Object.keys(h.deps.sources).sort()).toEqual(['list', 'remove', 'write']);
  });
});
