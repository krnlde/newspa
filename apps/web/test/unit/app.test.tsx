import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../../src/i18n/locales/en.ts';
import { articleOf, FLASH, flashing, one, renderApp, renderPaper } from './support/render.tsx';
import { answer, LIST } from './support/sourcesWire.tsx';
import {
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
 *
 * The mount helpers live in `support/render.tsx`, shared with `app-paper.test.tsx`,
 * which is the same app printed by a wire that never moves.
 */

/**
 * The calls to the **state endpoint**, not every fetch: the page reads a second
 * route now (`/api/sources`, WP14), so a count of the whole wire is a count of
 * how many endpoints the app has, and says nothing about the paper refetching.
 */
const stateCalls = (mock: FetchMock): number => mock.mock.calls.filter((call) => call[0] === '/api/state').length;

describe('while /api/state is in flight', () => {
  it('prints the loading line, not a blank page', () => {
    stubFetch(aPendingFetch);
    renderApp();
    // The loading screen is the paper's shell (`sheetClass`, exported) with the
    // app's string in it, on the paper's own hooks: the loading line prints in
    // `[data-part='summary']`, the dateline strip's line. The next three
    // assertions are the parts a loading screen must not print.
    expect(one<HTMLParagraphElement>("[data-part='sheet'] [data-part='summary']").textContent).toBe(en.paper.loading);
    expect(document.querySelector("[data-part='title']")).toBeNull();
    expect(document.querySelector("[data-part='block-head']")).toBeNull();
    expect(document.querySelector("[data-part='onboarding']")).toBeNull();
  });

  it('swaps the loading line for the paper when the response lands', async () => {
    stubFetch(async () => responseOf(aPaper()));
    renderApp();
    expect(document.querySelector("[data-part='title']")).toBeNull();
    await screen.findByText(MASTHEAD.name);
    expect(one<HTMLElement>("[data-part='title']").textContent).toBe(MASTHEAD.name);
    expect(one<HTMLElement>("[data-part='summary']").textContent).toContain('4 stories');
    expect(document.querySelector("[data-part='onboarding']")).toBeNull();
  });
});

describe('when the fetch fails', () => {
  it('names the failure, the reason, and the command that fixes it', async () => {
    stubFetch(aRejectedFetch('connect ECONNREFUSED 127.0.0.1:8787'));
    renderApp();
    // The failure panel is the paper's onboarding, with the app's strings: so
    // the hooks are the paper's, and the assertions are about what the app put
    // into them.
    const title = await screen.findByText(en.paper.failed);
    expect(one<HTMLElement>("[data-part='onboarding'] [data-part='onboarding-title']")).toBe(title);
    expect(one<HTMLElement>("[data-part='onboarding-lead']").textContent).toBe('connect ECONNREFUSED 127.0.0.1:8787');
    expect(one<HTMLElement>("[data-part='onboarding-command']").textContent).toBe(en.paper.failedHint);
    // A failure has no recipe, so the numbered list is absent, not empty: an
    // empty `<ol>` is a strip of list-marker air above the command.
    expect(document.querySelector("[data-part='onboarding-steps']")).toBeNull();
    expect(document.querySelector("[data-part='title']")).toBeNull();
    expect(document.querySelector("[data-part='block-head']")).toBeNull();
  });

  it('prints the status the server answered, inside the reason', async () => {
    stubFetch(aStatusFetch(503));
    renderApp();
    await screen.findByText(en.paper.failed);
    expect(one<HTMLElement>("[data-part='onboarding-lead']").textContent).toContain('503');
    expect(one<HTMLElement>("[data-part='onboarding-command']").textContent).toContain('pnpm start');
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
    expect(stateCalls(fetch)).toBe(4);
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

/**
 * The sources editor (WP14), as the app mounts it.
 *
 *  - the paper prints **no form**: the sheet's dateline strip carries one control,
 *    and the dialog is not in the page until it is pressed. The sheet is the
 *    page's one panel of newsprint, and three lines per source, a textarea and the
 *    absolute path of the watchlist directory do not belong on it;
 *  - the reading list is fetched **only when the control is pressed** — its answer
 *    is the reader's files, and rule 18 keeps them to a loopback peer, so a page
 *    load asks for them only when a reader asked to see them;
 *  - closing takes the form off the page, so the next open asks the server again
 *    rather than showing bytes from a list the files may have outgrown.
 */
const OPEN = "[data-part='sources-open']";
const CLOSE = "[data-part='sources-close']";
const ROW = "[data-part='source-row']";

/** The two routes the app reads, answered apart, so a test can count them apart. */
const stubBothRoutes = (): FetchMock => {
  const mock = vi.fn(
    async (input: string): Promise<Response> =>
      input.startsWith('/api/sources') ? answer(LIST) : responseOf(aPaper()),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
};

const sourcesCalls = (mock: FetchMock): number => mock.mock.calls.filter((call) => call[0] === '/api/sources').length;

describe('the sources editor', () => {
  it('prints no form on the page: one control in the dateline strip, and no dialog at all', async () => {
    stubBothRoutes();
    renderApp();
    await screen.findByText(MASTHEAD.name);
    expect(one<HTMLButtonElement>(OPEN).textContent).toBe(en.sources.open);
    // Not "a closed dialog": the editor is not in the page until it is asked for,
    // so there is no hidden form to tab through, and `partsOf(sheet)` stays the
    // paper's list.
    expect(document.querySelectorAll("[data-part='sources-modal']")).toHaveLength(0);
    expect(document.querySelectorAll(ROW)).toHaveLength(0);
  });

  it('asks for the reading list only when the control is pressed, and prints it in the modal', async () => {
    const fetch = stubBothRoutes();
    renderApp();
    await screen.findByText(MASTHEAD.name);
    expect(sourcesCalls(fetch)).toBe(0);
    fireEvent.click(one<HTMLButtonElement>(OPEN));
    await screen.findByText('BBC World');
    expect(sourcesCalls(fetch)).toBe(1);
    expect(one<HTMLElement>("[data-part='sources-modal'] [data-part='sources-dir']").textContent).toBe(
      `Files in ${LIST.dir}`,
    );
    expect(document.querySelectorAll(ROW)).toHaveLength(2);
  });

  it('takes the form off the page when it closes, returns focus, and the next open asks again', async () => {
    const fetch = stubBothRoutes();
    renderApp();
    await screen.findByText(MASTHEAD.name);
    fireEvent.click(one<HTMLButtonElement>(OPEN));
    await screen.findByText('BBC World');
    fireEvent.click(one<HTMLButtonElement>(CLOSE));
    await screen.findByText(MASTHEAD.name);
    // The modal unmounts, so the browser has nothing to restore focus to: the app
    // focuses the control that opened it, and the reader is back where they started.
    expect(document.querySelectorAll(ROW)).toHaveLength(0);
    expect(document.querySelectorAll("[data-part='sources-modal']")).toHaveLength(0);
    expect(globalThis.document.activeElement).toBe(one<HTMLButtonElement>(OPEN));
    fireEvent.click(one<HTMLButtonElement>(OPEN));
    await screen.findByText('BBC World');
    expect(sourcesCalls(fetch)).toBe(2);
  });
});
