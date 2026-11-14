import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type SourcesResponse, sourcesResponseSchema } from 'newspa-core';
import { type Mock, vi } from 'vitest';
import { SourcesSection } from '../../../src/SourcesSection.tsx';

/**
 * The wire the sources shell (WP14) talks to, and the tree it renders into —
 * shared by `sources-section.test.tsx` (the list, and the states around reading
 * it) and `sources-write.test.tsx` (the two mutations), so the two files cannot
 * drift into two different stubs of the same route.
 *
 * The list goes through **`sourcesResponseSchema`**, never a hand-typed literal:
 * an object that drifts from `packages/core/src/api.ts` fails here, at
 * construction, naming the field — not inside the panel as a `TypeError`.
 *
 * `text` is the file's **verbatim bytes**, because that is what the route answers
 * and what the editor posts back: the contract is a JSON editor over a file, not
 * a field form (`sourcesApi.ts`, D-011).
 */

/** The desk's list: every file, verbatim. What a loopback peer is answered. */
const deskList = sourcesResponseSchema.parse({
  scope: 'full',
  dir: '/home/reader/newspa/sources',
  files: [
    {
      file: 'bbc-world.json',
      id: 'bbc-world',
      kind: 'rss',
      label: 'BBC World',
      text: '{"id":"bbc-world","kind":"rss"}',
      issues: [],
      enabled: true,
      state: 'ok',
    },
    {
      file: 'broken.json',
      id: null,
      kind: null,
      label: null,
      text: '{ not json',
      issues: ['[json] the file is not valid JSON'],
      enabled: false,
      state: null,
    },
  ],
  writable: true,
});
// Narrowed at construction, not by a cast: the tests read `.dir` and `.text`, and
// those keys exist only in the arm a loopback peer is answered with.
if (deskList.scope !== 'full') throw new Error('the desk fixture must answer the full scope');
export const LIST = deskList;

/**
 * The household peer's answer (D-034, W4): the switches, and nothing private. No
 * `dir`, no `text` — a form built from this view cannot leak what it was never sent.
 */
export const HOUSEHOLD: SourcesResponse = sourcesResponseSchema.parse({
  scope: 'household',
  files: [
    {
      file: 'bbc-world.json',
      id: 'bbc-world',
      kind: 'rss',
      label: 'BBC World',
      url: 'https://bbc.example/news',
      section: 'World',
      group: null,
      weight: 3,
      enabled: true,
      cadenceMinutes: 20,
      issues: [],
      state: 'ok',
    },
    {
      file: 'broken.json',
      id: null,
      kind: null,
      label: null,
      url: null,
      section: null,
      group: null,
      enabled: false,
      issues: ['[json] the file is not valid JSON'],
      state: null,
    },
  ],
  writable: true,
});

/** The row of the household list that parses, by its file. */
export const HOUSE_ROW = "[data-part='household-row'][data-file='bbc-world.json']";

export const answer = (body: unknown, status = 200): Response =>
  ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as unknown as Response;

export const refusal = (messages: readonly string[]): Response =>
  answer({ ok: false, file: null, messages: [...messages] }, 400);

/** The guard's refusal of the whole route, in the words `net.ts` writes (rule 18, D-034). */
export const readingListRefused = (address = '192.168.0.27'): Response =>
  answer(
    {
      error: `GET /api/sources from ${address} is refused: the reading list is your file set — every URL, watchword and note — so it is loopback-only (rule 18, D-034); the paper itself is readable from anywhere this server is bound`,
    },
    403,
  );

export type SourcesFetchMock = Mock<(input: string, init?: RequestInit) => Promise<Response>>;

/** The wire, with the answers a test cares about per verb. */
export const stubSourcesWire = (
  write: () => Response = () => answer({ ok: true, file: null, messages: [] }),
  read: () => Response = () => answer(LIST),
): SourcesFetchMock => {
  const mock = vi.fn(async (_input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    return method === 'GET' ? read() : write();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

/** A read that answers one way and nothing else: a refusal, a 5xx, a hanging request. */
export const stubRead = (respond: () => Response | Promise<Response>): SourcesFetchMock => {
  const mock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') return answer({ ok: true, file: null, messages: [] });
    if (!input.includes('/api/sources')) return answer(LIST);
    return respond();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
};

export const theBodyOf = (mock: SourcesFetchMock, method: string): Record<string, unknown> => {
  const body = mock.mock.calls.find((call) => call[1]?.method === method)?.[1]?.body;
  if (typeof body !== 'string') throw new Error(`no ${method} body was posted`);
  return JSON.parse(body) as Record<string, unknown>;
};

export const urlOf = (mock: SourcesFetchMock, method: string): string => {
  const call = mock.mock.calls.find((entry) => entry[1]?.method === method);
  const url = call?.[0];
  if (url === undefined) throw new Error(`no ${method} call was made`);
  return url;
};

export const STATUS = "[data-part='sources-status']";

export const one = <T extends Element>(selector: string, root: ParentNode = globalThis.document): T => {
  const found = root.querySelectorAll<T>(selector);
  const at = found[0];
  if (at === undefined || found.length !== 1)
    throw new Error(`expected one ${selector}, found ${String(found.length)}`);
  return at;
};

export const textOf = (selector: string): string => one(selector).textContent ?? '';

export const ROW = "[data-part='source-row'][data-file='bbc-world.json']";
export const editOf = (): HTMLButtonElement => one<HTMLButtonElement>(`${ROW} [data-part='source-edit']`);
export const editBox = (): HTMLTextAreaElement => one<HTMLTextAreaElement>(`${ROW} [data-part='source-text']`);

/** The reader's own act: open the row, replace the bytes, press Save. */
export const saveOf = (text: string): void => {
  fireEvent.change(editBox(), { target: { value: text } });
  fireEvent.click(one<HTMLButtonElement>(`${ROW} [data-part='source-save']`));
};

export const edited = '{"id":"bbc-world","kind":"rss","weight":5}';

/** The section on its own query client — the tree `App.tsx` puts in the sheet. */
export const sourcesHarness = () => {
  let client: QueryClient | null = null;

  const mount = (): { root: HTMLElement; cache: QueryClient } => {
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });
    client = cache;
    const view = render(
      <QueryClientProvider client={cache}>
        <SourcesSection />
      </QueryClientProvider>,
    );
    return { root: view.container, cache };
  };

  /** Mount, and wait for the list to be on the page. */
  const mounted = async (): Promise<{ root: HTMLElement; cache: QueryClient }> => {
    const at = mount();
    await screen.findByText('BBC World');
    return at;
  };

  const dispose = (): void => {
    cleanup();
    client?.clear();
    client = null;
    vi.unstubAllGlobals();
  };

  return { mount, mounted, dispose };
};
