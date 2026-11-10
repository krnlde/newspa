import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
