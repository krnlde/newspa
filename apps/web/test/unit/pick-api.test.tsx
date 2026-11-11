import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, pickStatus, RefusalError, startPick } from '../../src/api.ts';
import { PICKED_TEXT, refusalOf, report } from './support/pickWire.tsx';
import { answer, stubSourcesWire } from './support/sourcesWire.tsx';

/**
 * The picker's **boundary** (WP6, D-036): `startPick` and `pickStatus` in `src/api.ts`.
 *
 * `POST /api/pick` is an **id**, never a url — the url, the headers, the limits and
 * the `profile: true` fact belong to the source file (D-011), and a route that
 * fetched an address a peer named is the wall D-034 refuses to lower. Both verbs
 * answer with `pickStatusResponseSchema`, and the boundary **parses** the answer: a
 * body that is not a report is a named `ApiError`, not a `TypeError` three frames
 * down inside a poll.
 *
 * A 4xx is a **refusal**, carried as `RefusalError.lines`, because the 400 (this
 * source is not `html`), the 404 (no such file, or no pick in this process), the 409
 * (a window is already open, and `messages` names the id that owns it) and the 403
 * (the address guard, D-034) are each a sentence the reader has to read, in the
 * server's own words (rule 5, D-019). The 202 of a window that opened is the same
 * shape, with `state: 'running'`: the cursor arrives later, through `GET`.
 */

describe('the pick boundary (api.ts)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens a window by id, and parses the 202 report the route answers', async () => {
    const mock = stubSourcesWire(() => report({ startedAt: '2026-11-11T10:00:00.000Z' }));
    const started = await startPick('page');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/pick');
    expect(mock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(mock.mock.calls[0]?.[1]?.body).toBe('{"id":"page"}');
    expect(mock.mock.calls[0]?.[1]?.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    });
    expect(started.state).toBe('running');
    expect(started.startedAt).toBe('2026-11-11T10:00:00.000Z');
  });

  it('asks for the report with the id escaped in the query, and parses it', async () => {
    const mock = stubSourcesWire(undefined, () =>
      report({ state: 'picked', sentence: 'picked 12 items', messages: ['the list matched 12'], text: PICKED_TEXT }),
    );
    const answered = await pickStatus('a b/c');
    expect(mock.mock.calls[0]?.[0]).toBe('/api/pick?id=a%20b%2Fc');
    expect(mock.mock.calls[0]?.[1]?.method).toBe('GET');
    expect(answered.state).toBe('picked');
    expect(answered.text).toBe(PICKED_TEXT);
  });

  it('carries a 409’s own lines: the id that already owns the window (D-036)', async () => {
    stubSourcesWire(() => refusalOf(["a pick window is open for 'tech'"], 409));
    const thrown = await startPick('page').catch((cause: unknown) => cause);
    expect(thrown).toBeInstanceOf(RefusalError);
    expect((thrown as RefusalError).lines).toEqual(["a pick window is open for 'tech'"]);
  });

  it('carries the 404 of a report the process does not have, and the guard’s 403 sentence', async () => {
    stubSourcesWire(undefined, () => refusalOf(['no source file named page.json'], 404));
    const missing = await pickStatus('page').catch((cause: unknown) => cause);
    expect((missing as RefusalError).lines).toEqual(['no source file named page.json']);
    stubSourcesWire(() => answer({ error: 'POST /api/pick from 10.0.0.5 is refused: loopback-only (D-034)' }, 403));
    const guard = await startPick('page').catch((cause: unknown) => cause);
    expect((guard as RefusalError).lines).toEqual(['POST /api/pick from 10.0.0.5 is refused: loopback-only (D-034)']);
  });

  it('is a named ApiError when a 200 answers something that is not a report', async () => {
    stubSourcesWire(undefined, () => answer({ ok: true, state: 'sleeping', messages: 'not an array' }));
    const thrown = await pickStatus('page').catch((cause: unknown) => cause);
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(0);
    expect((thrown as ApiError).message).toContain('GET /api/pick');
    expect((thrown as ApiError).message).toContain('pick report');
  });
});
