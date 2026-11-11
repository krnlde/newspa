import { fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRAST_KEY } from '../../src/contrast.ts';
import { en } from '../../src/i18n/locales/en.ts';
import { THEME_KEY } from '../../src/theme.ts';
import { html, one, renderPaper } from './support/render.tsx';
import { anEmptyPaper, LINKS, MASTHEAD } from './support/wire.ts';

/**
 * The paper the app prints: the words the state response puts on the page, the
 * onboarding that stands in for an empty edition, and the theme switch. The wire
 * never moves here — `app.test.tsx` is the fetch, the stream and the flash.
 * `support/render.tsx` is the mount, shared by both.
 */

describe('an edition from the server', () => {
  it('prints the masthead the state response names', async () => {
    await renderPaper();
    expect(one<HTMLElement>("[data-part='title']").textContent).toBe(MASTHEAD.name);
    expect(one<HTMLElement>("[data-part='tagline']").textContent).toBe(MASTHEAD.tagline);
    expect(one<HTMLElement>("[data-part='dateline']").textContent).toBe(MASTHEAD.dateline);
    const summary = one<HTMLElement>("[data-part='summary']").textContent ?? '';
    expect(summary).toContain('4 stories');
    expect(summary).toContain('1 unhealthy');
  });

  it('makes the lead headline a link out, in a new tab', async () => {
    await renderPaper();
    const link = one<HTMLAnchorElement>("[data-part='lead'] [data-part='link']");
    expect(link.getAttribute('href')).toBe(LINKS.lead);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('Rates held for the third month running');
  });

  it('prints one section head per section, in the edition order, in the list below the front page', async () => {
    await renderPaper();
    const heads = [...document.querySelectorAll("[data-part='sections'] [data-part='block-head']")].map(
      (head) => head.textContent,
    );
    expect(heads).toEqual(['World', 'Technology']);
    // The lead prints in the front page's centre column, not in the list.
    expect(document.querySelectorAll("[data-part='sections'] article[data-key]")).toHaveLength(3);
  });

  it('shows every unhealthy source in the health strip', async () => {
    await renderPaper();
    const rows = [...document.querySelectorAll<HTMLElement>("[data-part='health'] [data-part='row']")];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-state')).toBe('no-matches');
    expect(rows[0]?.querySelector("[data-part='label']")?.textContent).toBe('Example World');
    expect(rows[0]?.querySelector("[data-part='state']")?.textContent).toBe(en.paper.health.state.noMatches);
  });
});

describe('a paper with no sources', () => {
  it('prints the onboarding block, with the command that adds a source', async () => {
    await renderPaper(anEmptyPaper());
    expect(one<HTMLElement>("[data-part='onboarding-title']").textContent).toBe(en.paper.onboarding.title);
    expect(one<HTMLElement>("[data-part='onboarding-command']").textContent).toBe(en.paper.onboarding.command);
    expect(one<HTMLElement>("[data-part='onboarding-command']").textContent).toContain('pnpm pick');
    expect(document.querySelectorAll("[data-part='onboarding-steps'] li")).toHaveLength(3);
    expect(document.querySelectorAll("[data-part='block-head']")).toHaveLength(0);
    expect(document.querySelector("[data-part='health']")).toBeNull();
  });
});

describe('the theme switch', () => {
  it('names the state it moves to, and writes both stores', async () => {
    await renderPaper();
    const button = one<HTMLButtonElement>("[data-part='theme-switch']");
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
    const button = one<HTMLButtonElement>("[data-part='theme-switch']");
    expect(button.textContent).toBe(en.paper.theme.toLight);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(html().dataset['theme']).toBe('light');
  });
});

describe('the contrast axis (D-038)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete html().dataset['contrast'];
  });

  it('prints a second control in the same row, on its own two stores, and leaves the theme alone', async () => {
    await renderPaper();
    const button = one<HTMLButtonElement>("[data-part='contrast-switch']");
    expect(one("[data-part='theme-switch']").parentElement?.parentElement?.getAttribute('data-part')).toBe(
      'dateline-strip',
    );
    expect(button.textContent).toBe(en.paper.contrast.toMore);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(html().dataset['contrast']).toBe('more');
    expect(globalThis.localStorage.getItem(CONTRAST_KEY)).toBe('more');
    expect(button.textContent).toBe(en.paper.contrast.toNormal);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // Two axes: pressing contrast must not move the stock, and the theme's store is
    // untouched — `useTheme` writes `data-theme` only on its own press, so the
    // honest claim here is that the attribute is still absent. The CSS composes the
    // pair; nothing in JavaScript does.
    expect(html().dataset['theme']).toBeUndefined();
    expect(globalThis.localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it('takes the axis from the url, so a wall device is set by a link with no clicks', async () => {
    vi.stubGlobal('location', { ...globalThis.location, search: '?theme=dark&contrast=more' });
    await renderPaper();
    const button = one<HTMLButtonElement>("[data-part='contrast-switch']");
    expect(button.textContent).toBe(en.paper.contrast.toNormal);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // A url visit writes nothing: the phone that opens a wall link keeps its own choice.
    expect(globalThis.localStorage.getItem(CONTRAST_KEY)).toBeNull();
  });

  it('starts from what the pre-paint script wrote to the document', async () => {
    html().dataset['contrast'] = 'more';
    await renderPaper();
    expect(one("[data-part='contrast-switch']").textContent).toBe(en.paper.contrast.toNormal);
  });
});
