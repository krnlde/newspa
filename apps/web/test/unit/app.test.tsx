import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { StateResponse } from 'newspa-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.tsx';
import { initI18n } from '../../src/i18n/index.ts';
import { en } from '../../src/i18n/locales/en.ts';
import { THEME_KEY } from '../../src/theme.ts';
import {
  anEmptyPaper,
  aPaper,
  aPendingFetch,
  aRejectedFetch,
  aStatusFetch,
  cycleDone,
  type FetchMock,
  itemEdited,
  itemNew,
  LINKS,
  MASTHEAD,
  publish,
  publishRaw,
  quietEvents,
  responseOf,
  stubFetch,
  stubWire,
  theSource,
} from './support/wire.ts';

/**
 * `App.tsx` is the seam between the server and the page: it owns the fetch, the
 * stream, the strings, the dates and the theme, and hands finished words to
 * `newspa-paper`. These tests pin which of the app's states reaches the page, and
 * what the page does when the wire moves — not the paper's layout, which
 * `packages/paper` tests own. Strings are asserted against `en`: the mapping under
 * test is key → element, not the copy. `StrictMode` is absent because React 19
 * invokes every effect twice on a dev mount, so `openEvents` would open two
 * streams and close one at once, and the unmount test would be about a stream the
 * production tree never had.
 */

/** The flash is a DOM attribute, not React state: a flash that outlived the re-render would never leave. */
const FLASH = 'data-flash';
const html = (): HTMLElement => globalThis.document.documentElement;

const articleOf = (key: string): HTMLElement => {
  const at = document.querySelector<HTMLElement>(`article[data-key="${key}"]`);
  if (at === null) throw new Error(`no article[data-key="${key}"] is on the page`);
  return at;
};

/** The keys of the stories that are flashing, in the order the page prints them. */
const flashing = (): string[] =>
  [...document.querySelectorAll<HTMLElement>('article[data-key]')]
    .filter((article) => article.hasAttribute(FLASH))
    .map((article) => article.dataset['key'] ?? '');

const one = <T extends Element>(selector: string): T => {
  const found = document.querySelectorAll<T>(selector);
  const at = found[0];
  if (at === undefined || found.length !== 1)
    throw new Error(`expected one ${selector}, found ${String(found.length)}`);
  return at;
};

let client: QueryClient | null = null;

/** The tree `main.tsx` renders, minus `StrictMode`, and with no retry. */
const renderApp = (): { view: ReturnType<typeof render>; client: QueryClient } => {
  const fresh = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client = fresh;
  const view = render(
    <QueryClientProvider client={fresh}>
      <App />
    </QueryClientProvider>,
  );
  return { view, client: fresh };
};

/** Mount against a state response, and wait until the masthead is on the page. */
const renderPaper = async (
  state: StateResponse = aPaper(),
): Promise<ReturnType<typeof renderApp> & { fetch: FetchMock }> => {
  const fetch = stubFetch(async () => responseOf(state));
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

describe('while /api/state is in flight', () => {
  it('prints the loading line, not a blank page', () => {
    stubFetch(aPendingFetch);
    renderApp();
    expect(one<HTMLParagraphElement>('.paper .masthead__summary').textContent).toBe(en.paper.loading);
    expect(document.querySelector('.masthead__name')).toBeNull();
    expect(document.querySelector('.section__head')).toBeNull();
    expect(document.querySelector('.onboarding')).toBeNull();
  });

  it('swaps the loading line for the paper when the response lands', async () => {
    stubFetch(async () => responseOf(aPaper()));
    renderApp();
    expect(document.querySelector('.masthead__name')).toBeNull();
    await screen.findByText(MASTHEAD.name);
    expect(one<HTMLElement>('.masthead__name').textContent).toBe(MASTHEAD.name);
    expect(one<HTMLElement>('.masthead__summary').textContent).toContain('4 stories');
    expect(document.querySelector('.onboarding')).toBeNull();
  });
});

describe('when the fetch fails', () => {
  it('names the failure, the reason, and the command that fixes it', async () => {
    stubFetch(aRejectedFetch('connect ECONNREFUSED 127.0.0.1:8787'));
    renderApp();
    const title = await screen.findByText(en.paper.failed);
    expect(title.className).toBe('onboarding__title');
    expect(one<HTMLElement>('.onboarding__lead').textContent).toBe('connect ECONNREFUSED 127.0.0.1:8787');
    expect(one<HTMLElement>('.onboarding__command').textContent).toBe(en.paper.failedHint);
    expect(document.querySelector('.masthead__name')).toBeNull();
    expect(document.querySelector('.section__head')).toBeNull();
  });

  it('prints the status the server answered, inside the reason', async () => {
    stubFetch(aStatusFetch(503));
    renderApp();
    await screen.findByText(en.paper.failed);
    expect(one<HTMLElement>('.onboarding__lead').textContent).toContain('503');
    expect(one<HTMLElement>('.onboarding__command').textContent).toContain('pnpm start');
  });
});

describe('an edition from the server', () => {
  it('prints the masthead the state response names', async () => {
    await renderPaper();
    expect(one<HTMLElement>('.masthead__name').textContent).toBe(MASTHEAD.name);
    expect(one<HTMLElement>('.masthead__tagline').textContent).toBe(MASTHEAD.tagline);
    expect(one<HTMLElement>('.masthead__dateline').textContent).toBe(MASTHEAD.dateline);
    const summary = one<HTMLElement>('.masthead__summary').textContent ?? '';
    expect(summary).toContain('4 stories');
    expect(summary).toContain('1 unhealthy');
  });

  it('makes the lead headline a link out, in a new tab', async () => {
    await renderPaper();
    const link = one<HTMLAnchorElement>('.paper__lead .story__link');
    expect(link.getAttribute('href')).toBe(LINKS.lead);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Rates held for the third month running');
  });

  it('prints one section head per section, in the edition order, in the list below the front page', async () => {
    await renderPaper();
    const heads = [...document.querySelectorAll('.paper__sections .section__head')].map((head) => head.textContent);
    expect(heads).toEqual(['World', 'Technology']);
    // The lead prints in the front page's centre column, not in the list.
    expect(document.querySelectorAll('.paper__sections article[data-key]')).toHaveLength(3);
  });

  it('shows every unhealthy source in the health strip', async () => {
    await renderPaper();
    const rows = [...document.querySelectorAll<HTMLElement>('.health__row')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-state')).toBe('no-matches');
    expect(rows[0]?.querySelector('.health__label')?.textContent).toBe('Example World');
    expect(rows[0]?.querySelector('.health__state')?.textContent).toBe(en.paper.health.state.noMatches);
  });
});

describe('a paper with no sources', () => {
  it('prints the onboarding block, with the command that adds a source', async () => {
    await renderPaper(anEmptyPaper());
    expect(one<HTMLElement>('.onboarding__title').textContent).toBe(en.paper.onboarding.title);
    expect(one<HTMLElement>('.onboarding__command').textContent).toBe(en.paper.onboarding.command);
    expect(one<HTMLElement>('.onboarding__command').textContent).toContain('pnpm pick');
    expect(document.querySelectorAll('.onboarding__steps li')).toHaveLength(3);
    expect(document.querySelectorAll('.section__head')).toHaveLength(0);
    expect(document.querySelector('.health')).toBeNull();
  });
});

describe('the live stream', () => {
  it('flashes the stories a push names, for 400ms, and no longer', async () => {
    await renderPaper();
    expect(articleOf('world:2').hasAttribute(FLASH)).toBe(false);
    vi.useFakeTimers();
    await act(async () => {
      publish(itemEdited(LINKS.lead));
      publish(itemNew(LINKS.second));
    });
    // The flash follows the link, not the source, so the page's print order is the order asserted here.
    expect(flashing()).toEqual(['lead:1', 'world:2']);
    vi.advanceTimersByTime(399);
    expect(flashing()).toEqual(['lead:1', 'world:2']);
    vi.advanceTimersByTime(1);
    expect(flashing()).toEqual([]);
    vi.useRealTimers();
  });

  it('flashes nothing for a story the page is not printing', async () => {
    await renderPaper();
    await act(async () => {
      publish(itemNew(LINKS.absent));
    });
    expect(flashing()).toEqual([]);
  });

  it('refetches once per push that is not about a story, and flashes nothing', async () => {
    const { fetch } = await renderPaper();
    for (const event of quietEvents()) {
      await act(async () => {
        publish(event);
      });
    }
    expect(fetch.mock.calls).toHaveLength(4);
    expect(flashing()).toEqual([]);
  });

  it('invalidates the state query for a push, and flashes no story', async () => {
    const { fetch, client: cache } = await renderPaper();
    const invalidated = vi.spyOn(cache, 'invalidateQueries');
    const before = fetch.mock.calls.length;
    await act(async () => {
      publish(cycleDone());
    });
    expect(invalidated).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.length).toBeGreaterThan(before);
    expect(flashing()).toEqual([]);
  });

  it('reports a message that does not parse, keeps the stream open, and does not refetch', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch } = await renderPaper();
    const before = fetch.mock.calls.length;
    expect(() => publishRaw('this is not json')).not.toThrow();
    expect(warned).toHaveBeenCalledOnce();
    const note = String(warned.mock.calls[0]?.[0] ?? '');
    expect(note.startsWith('an SSE message did not parse: ')).toBe(true);
    expect(note.length).toBeGreaterThan('an SSE message did not parse: '.length);
    expect(fetch.mock.calls).toHaveLength(before);
    expect(flashing()).toEqual([]);
    await act(async () => {
      publish(itemNew(LINKS.first));
    });
    expect(articleOf('world:1').dataset['flash']).toBe('true');
  });

  it('opens the stream the server publishes, and closes it on unmount', () => {
    stubFetch(aPendingFetch);
    const { view } = renderApp();
    expect(theSource().url).toBe('/api/events');
    expect(theSource().close).not.toHaveBeenCalled();
    view.unmount();
    expect(theSource().close).toHaveBeenCalledOnce();
  });
});

describe('the theme switch', () => {
  it('names the state it moves to, and writes both stores', async () => {
    await renderPaper();
    const button = one<HTMLButtonElement>('.masthead__switch');
    expect(button.textContent).toBe(en.paper.theme.toDark);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(html().dataset['theme']).toBe('dark');
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(button.textContent).toBe(en.paper.theme.toLight);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(html().dataset['theme']).toBe('light');
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBe('light');
  });

  it('starts from the theme the pre-paint script chose, so its label says Light', async () => {
    html().dataset['theme'] = 'dark';
    await renderPaper();
    const button = one<HTMLButtonElement>('.masthead__switch');
    expect(button.textContent).toBe(en.paper.theme.toLight);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(html().dataset['theme']).toBe('light');
  });
});
