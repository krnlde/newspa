import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { StateResponse } from 'newspa-core';
import { afterEach, beforeEach, vi } from 'vitest';
import { App } from '../../../src/App.tsx';
import { initI18n } from '../../../src/i18n/index.ts';
import { aPaper, type FetchMock, MASTHEAD, responseOf, stubFetch, stubWire } from './wire.ts';

/**
 * The mount half of the app tests, shared by `app.test.tsx` (what the wire does
 * to the page) and `app-paper.test.tsx` (what the page prints), so the two
 * cannot drift into two different trees. The docstring of `app.test.tsx` is the
 * reason these tests exist and why `StrictMode` is absent from this tree.
 */

/** The flash is a DOM attribute, not React state: a flash that outlived the re-render would never leave. */
export const FLASH = 'data-flash';
export const html = (): HTMLElement => globalThis.document.documentElement;

export const articleOf = (key: string): HTMLElement => {
  const at = document.querySelector<HTMLElement>(`article[data-key="${key}"]`);
  if (at === null) throw new Error(`no article[data-key="${key}"] is on the page`);
  return at;
};

/** The keys of the stories that are flashing, in the order the page prints them. */
export const flashing = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('article[data-key]')]
    .filter((article) => article.hasAttribute(FLASH))
    .map((article) => article.dataset['key'] ?? '');

export const one = <T extends Element>(selector: string): T => {
  const found = document.querySelectorAll<T>(selector);
  const at = found[0];
  if (at === undefined || found.length !== 1)
    throw new Error(`expected one ${selector}, found ${String(found.length)}`);
  return at;
};

let client: QueryClient | null = null;

/** The tree `main.tsx` renders, minus `StrictMode`, and with no retry. */
export const renderApp = (): { view: ReturnType<typeof render>; client: QueryClient } => {
  const fresh = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client = fresh;
  const view = render(
    <QueryClientProvider client={fresh}>
      <App />
    </QueryClientProvider>,
  );
  return { view, client: fresh };
};

/**
 * Mount against a state response, and wait until the masthead is on the page.
 *
 * `headers` is the worker's seam (WP16, D-039): `newspa-cached-at` is the only
 * thing that distinguishes an answer off the wire from a cached edition, and the
 * page's freshness label depends on it, so a mount that cannot set it cannot test
 * the rule.
 */
export const renderPaper = async (
  state: StateResponse = aPaper(),
  headers: Record<string, string> = {},
): Promise<ReturnType<typeof renderApp> & { fetch: FetchMock }> => {
  const fetch = stubFetch(async () => responseOf(state, headers));
  const mounted = renderApp();
  await screen.findByText(MASTHEAD.name);
  return { ...mounted, fetch };
};

beforeEach(async () => {
  await initI18n({ language: 'en' });
  // `test/setup.ts` clears storage and `lang`/`dir`, not `data-theme`, which is where the app's theme starts.
  delete html().dataset['theme'];
  stubWire();
});

afterEach(() => {
  client?.clear();
  client = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
