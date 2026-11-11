/**
 * The pick route, over a real socket (WP6, D-036).
 *
 * `pick-routes.test.ts` drives the job; this file is what a browser sees, and the
 * claim it exists to prove is the wall: **`/api/pick` is loopback's, for every
 * verb.** Launching a browser on a machine is a write (rule 20), and a pick reads
 * the reading list (rule 18), so the address answers before the route does — and
 * the refusal is logged, because a refusal the reader cannot find is a silent zero.
 *
 * The order of the two refusals is the rule. A LAN `POST` dies at the **mutation
 * guard**, before routing; a LAN `GET` — a verb the guard lets through, because the
 * paper is readable from anywhere it is bound — reaches the route and dies at the
 * reading-list wall. A test that only asserted the second would hide the first.
 */
import { pickStatusResponseSchema } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import { builtDist, getJson, serve } from './httpSupport.ts';

describe('the pick route is loopback’s, on both verbs', () => {
  it('refuses a LAN POST at the mutation guard, before routing, and logs it', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        const post = await getJson(base, '/api/pick', { method: 'POST', body: '{"id":"bbc"}' });
        expect(post.status).toBe(403);
        expect(String(post.body['error'])).toContain('POST from 192.168.1.42');
        expect(h.logs.join('\n')).toContain('refused POST /api/pick');
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42' }),
    );
  });

  it('refuses a LAN GET at the reading-list wall, naming this route and logging it', async () => {
    await serve(
      await builtDist(),
      async (base, h) => {
        const get = await getJson(base, '/api/pick?id=bbc');
        expect(get.status).toBe(403);
        // The reason names `/api/pick`, not the sources route it shares its wall with:
        // a refusal that points at another URL is a dead end for the reader.
        expect(String(get.body['error'])).toContain('GET /api/pick from 192.168.1.42 is refused');
        expect(h.logs.join('\n')).toContain('refused GET /api/pick');
      },
      (deps) => ({ ...deps, addressOf: () => '192.168.1.42' }),
    );
  });

  it('answers a loopback POST with the job it started, and a GET with its report', async () => {
    await serve(await builtDist(), async (base) => {
      const started = await getJson(base, '/api/pick', { method: 'POST', body: '{"id":"bbc"}' });
      expect(started.status).toBe(202);
      expect(pickStatusResponseSchema.parse(started.body)).toMatchObject({ state: 'running', text: null });

      const report = await getJson(base, '/api/pick?id=bbc');
      expect(report.status).toBe(200);
      expect(pickStatusResponseSchema.parse(report.body)).toMatchObject({ state: 'picked' });
    });
  });
});

describe('the pick body, which is an id', () => {
  it('answers a body that is not an id with 400 and the schema’s line, and opens no window', async () => {
    const seen: string[] = [];
    await serve(
      await builtDist(),
      async (base) => {
        const empty = await getJson(base, '/api/pick', { method: 'POST', body: '{}' });
        expect(empty.status).toBe(400);
        const lines = (empty.body['messages'] as string[] | undefined) ?? [];
        expect(lines.join(' ')).toContain('the pick body is {"id": "<source id>"}');
        expect(lines.join(' ')).toContain('id');

        const notJson = await getJson(base, '/api/pick', { method: 'POST', body: 'not json' });
        expect(notJson.status).toBe(400);
        expect(((notJson.body['messages'] as string[] | undefined) ?? []).join(' ')).toContain('not JSON');

        const tooLong = await getJson(base, '/api/pick', { method: 'POST', body: `"${'x'.repeat(4096)}"` });
        expect(tooLong.status).toBe(413);
        expect(((tooLong.body['messages'] as string[] | undefined) ?? []).join(' ')).toContain('bytes is not read');

        const notAnId = await getJson(base, '/api/pick', { method: 'POST', body: '{"id":"Not A Source Id"}' });
        expect(notAnId.status).toBe(400);
        expect(((notAnId.body['messages'] as string[] | undefined) ?? []).join(' ')).toContain('kebab-case');
      },
      (deps) => ({
        ...deps,
        pick: {
          start: async (id: string) => {
            seen.push(id);
            return { status: 202, body: { ok: true, state: 'running', sentence: '', messages: [], text: null } };
          },
          status: () => ({ status: 404, body: { ok: false, state: 'idle', sentence: '', messages: [], text: null } }),
        },
      }),
    );
    // The id schema is the guard: nothing reaches the browser tier with a name the
    // reading list never agreed to (`profile: true` and the url live in the file).
    expect(seen).toEqual([]);
  });

  it('answers a GET with no id with the route’s own 404, and a body that is not an object with the root issue', async () => {
    await serve(
      await builtDist(),
      async (base) => {
        const noId = await getJson(base, '/api/pick');
        expect(noId.status).toBe(404);
        expect(((noId.body['messages'] as string[] | undefined) ?? []).join(' ')).toContain('POST /api/pick');

        const array = await getJson(base, '/api/pick', { method: 'POST', body: '[]' });
        expect(array.status).toBe(400);
        expect(((array.body['messages'] as string[] | undefined) ?? []).join(' ')).toContain('(root)');
      },
      (deps) => ({
        ...deps,
        pick: {
          start: async () => ({
            status: 202,
            body: { ok: true, state: 'running', sentence: '', messages: [], text: null },
          }),
          status: (id: string) => ({
            status: id === '' ? 404 : 200,
            body: {
              ok: id === '',
              state: id === '' ? 'idle' : 'picked',
              sentence: '',
              messages: [`no pick has run for '${id}' in this process: start one with POST /api/pick`],
              text: null,
            },
          }),
        },
      }),
    );
  });

  it('refuses a verb the route cannot mean, naming the two it has', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await getJson(base, '/api/pick', { method: 'DELETE' });
      expect(answer.status).toBe(405);
      expect(String(answer.body['error'])).toContain('POST {"id": "…"} to open a pick window');
    });
  });

  it('names the route in the 404 index, as every other route is named', async () => {
    await serve(await builtDist(), async (base) => {
      const answer = await getJson(base, '/api/nothing');
      expect(answer.status).toBe(404);
      expect(JSON.stringify(answer.body)).toContain('/api/pick (POST');
    });
  });
});
