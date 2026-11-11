import { act } from '@testing-library/react';
import { type PickStatusResponse, pickStatusResponseSchema, sourcesResponseSchema } from 'newspa-core';
import { vi } from 'vitest';
import { answer, LIST, one, type SourcesFetchMock } from './sourcesWire.tsx';

/**
 * The pick's wire (WP6, D-036), shared by the two suites that read it:
 * `pick-api.test.tsx` (the boundary in `src/api.ts`) and `sources-pick.test.tsx`
 * (the job in `src/SourcesSection.tsx`), so neither invents its own shape of the
 * server's answer.
 *
 * The report goes through **`pickStatusResponseSchema`**, never a hand-typed
 * literal: an answer that drifts from `packages/core/src/apiPick.ts` fails here, at
 * construction. The list is one `html` source in item mode — the only kind the
 * picker is cut to (D-028) — with a `list` the row can read, because the row offers
 * the control only for a file that declares one.
 *
 * `PICKED_TEXT` is the merged file the report carries: **text to fill, never a
 * write** (D-036), and the suites assert that no `POST /api/sources` follows it.
 */

export const PAGE = 'page.json';
export const PAGE_TEXT = '{"id":"page","kind":"html","list":"ul.cards > li"}';
export const PICKED_TEXT = '{"id":"page","kind":"html","list":"ul.cards > li","matchCount":12}';
export const ROW = `[data-part='source-row'][data-file='${PAGE}']`;
export const PICK = "[data-part='source-pick']";

export const report = (over: Partial<PickStatusResponse> = {}): Response =>
  answer(
    pickStatusResponseSchema.parse({ ok: true, state: 'running', sentence: '', messages: [], text: null, ...over }),
  );

/** A refusal in the shape `pickHttp.ts` answers: the lines are the page's to print. */
export const refusalOf = (messages: readonly string[], status: number): Response =>
  answer({ ok: false, state: 'idle', sentence: '', messages: [...messages], text: null }, status);

export const PICK_LIST = sourcesResponseSchema.parse({
  dir: LIST.dir,
  files: [
    {
      file: PAGE,
      id: 'page',
      kind: 'html',
      label: 'Example Page',
      text: PAGE_TEXT,
      issues: [],
      enabled: true,
      state: 'ok',
    },
  ],
  writable: true,
});

export const callsOf = (mock: SourcesFetchMock, method: string, url: string): number =>
  mock.mock.calls.filter((call) => (call[1]?.method ?? 'GET') === method && call[0].startsWith(url)).length;

/** The wire a running job needs: the list on read, one start, a queue of reports. */
export const stubPickWire = (reports: readonly Response[]): SourcesFetchMock => {
  let asked = 0;
  const mock: SourcesFetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    if (input.startsWith('/api/sources'))
      return method === 'GET' ? answer(PICK_LIST) : answer({ ok: true, file: null, messages: [] });
    if (method === 'POST') return report();
    const next = reports[asked];
    asked += 1;
    return next ?? reports.at(-1) ?? report();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

/** The start answered by `respond`, which may throw: a 409, a 403, a dead socket. */
export const stubPickStart = (respond: () => Response): SourcesFetchMock => {
  const mock: SourcesFetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && input.startsWith('/api/pick')) return respond();
    return method === 'GET' ? answer(PICK_LIST) : answer({ ok: true, file: null, messages: [] });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

/** A report the test decides the moment of: the modal can close while it is in flight. */
export const hanging = (): {
  readonly promise: Promise<Response>;
  readonly open: () => void;
  readonly fail: () => void;
} => {
  let open: () => void = (): void => undefined;
  let fail: () => void = (): void => undefined;
  const promise = new Promise<Response>((resolve, reject) => {
    open = () => {
      resolve(report({ state: 'picked', sentence: 'picked 12 items', messages: [], text: PICKED_TEXT }));
    };
    fail = () => {
      reject(new Error('the report request died on the way'));
    };
  });
  return { promise, open, fail };
};

export const stubHangingPick = (asked: () => Promise<Response>): SourcesFetchMock => {
  const mock: SourcesFetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    if (input.startsWith('/api/sources'))
      return method === 'GET' ? answer(PICK_LIST) : answer({ ok: true, file: null, messages: [] });
    if (method === 'POST') return report();
    return await asked();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

export const pickButton = (): HTMLButtonElement => one<HTMLButtonElement>(PICK);
export const boxOf = (): HTMLTextAreaElement => one<HTMLTextAreaElement>(`${ROW} [data-part='source-text']`);

/** Move the clock, and let the report's promises land inside `act`. */
export const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
