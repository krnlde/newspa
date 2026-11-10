import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { en } from '../../src/i18n/locales/en.ts';
import { articleOf, FLASH, flashing, one, renderApp, renderPaper } from './support/render.tsx';
import {
  aPaper,
  aPendingFetch,
  aRejectedFetch,
  aStatusFetch,
  cycleDone,
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
