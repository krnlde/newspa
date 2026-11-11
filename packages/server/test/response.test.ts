import { describe, expect, it } from 'vitest';
import { pathOf, sendJson, sendText } from '../src/response.ts';

/**
 * The two answers the API writes, and the path they are addressed by.
 *
 * Small, and worth its own file: these are the two lines every failure of this
 * server is made of, and the claims are the ones rule 5 cares about — a body is
 * JSON with the reason in it, `no-store` unless a route says otherwise, and no
 * stack ever reaches a browser.
 */

interface Written {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const fakeResponse = (): { res: Parameters<typeof sendJson>[0]; out: Written } => {
  const out: Written = { status: 0, headers: {}, body: '' };
  const res = {
    writeHead: (status: number, headers: Record<string, string>): void => {
      out.status = status;
      out.headers = headers;
    },
    end: (chunk?: string): void => {
      out.body = chunk ?? '';
    },
  } as unknown as Parameters<typeof sendJson>[0];
  return { res, out };
};

const request = (url: string): Parameters<typeof pathOf>[0] => ({ url }) as Parameters<typeof pathOf>[0];

describe('the JSON answer', () => {
  it('is one line of JSON, typed, and never cached by default', () => {
    const { res, out } = fakeResponse();
    sendJson(res, 404, { error: 'no such route' });
    expect(out.status).toBe(404);
    expect(out.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(out.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(out.body)).toEqual({ error: 'no such route' });
    expect(out.body.endsWith('\n')).toBe(true);
  });

  it('takes a cache policy from the route that has one', () => {
    const { res, out } = fakeResponse();
    sendJson(res, 200, { ok: true }, 'public, max-age=5');
    expect(out.headers['cache-control']).toBe('public, max-age=5');
  });
});

describe('the sentence answer', () => {
  it('is plain text, un-cached, for the answers a human reads', () => {
    const { res, out } = fakeResponse();
    sendText(res, 404, 'the app is not built');
    expect(out.status).toBe(404);
    expect(out.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(out.headers['cache-control']).toBe('no-store');
    expect(out.body).toContain('not built');
  });
});

describe('the path a route is addressed by', () => {
  it('is the path, with the query stripped', () => {
    expect(pathOf(request('/api/sources?id=bbc'))).toBe('/api/sources');
    expect(pathOf(request('/'))).toBe('/');
    // A request line with no URL at all is the root, never a crash: the routes are
    // addressed by path, and a parser that throws is a 500 with no reason in it.
    expect(pathOf(request(''))).toBe('/');
    expect(pathOf({} as Parameters<typeof pathOf>[0])).toBe('/');
  });
});
