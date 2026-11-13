import { cleanup, fireEvent, render } from '@testing-library/react';
import type { SourceHealthView } from 'newspa-core';
import { afterEach, describe, expect, it } from 'vitest';
import { Onboarding } from '../src/index.ts';
import {
  anEdition,
  anItem,
  aSection,
  aSource,
  nthStory,
  one,
  PART,
  partsOf,
  storySlots,
  THE_LABELS,
  THE_MASTHEAD,
  textsOf,
} from './support.ts';
import { brokenSource, editedItem, okSource, showPaper } from './support-page.tsx';

/**
 * `Paper.tsx` owns two things and nothing else: **the order the page prints in**
 * (masthead, lead, ornament, sections, edited strip, health) and **the empty
 * paper as a state** (onboarding, with the command that adds a source). These
 * tests pin both, plus which blocks appear for which edition, because every
 * other decision — the words, the dates, the theme's effect — belongs to the app.
 *
 * `sources: []` is the onboarding case, and the assertion is that no section and
 * no health strip print: a paper with no sources must not look like a paper with
 * no news (rule 5).
 */

afterEach(cleanup);

describe('a paper with no sources', () => {
  it('prints the onboarding block: title, lead, the steps in order, and the command', () => {
    const { container } = showPaper({ sources: [] });
    expect(one(PART.onboardingTitle, container).textContent).toBe(THE_LABELS.onboarding.title);
    expect(one(PART.onboardingLead, container).textContent).toBe(THE_LABELS.onboarding.lead);
    expect(textsOf(`${PART.onboardingSteps} li`, container)).toEqual(THE_LABELS.onboarding.steps);
    expect(one(PART.onboardingCommand, container).textContent).toBe(THE_LABELS.onboarding.command);
  });

  /**
   * The same panel with no recipe: the app's failure state hands in a title, the
   * publisher's reason and the command, and nothing else. An empty `<ol>` would
   * print as a strip of list-marker air above the command, so the branch is the
   * behaviour and this is its test (rule 12).
   */
  it('prints no list when there are no steps', () => {
    const container = render(
      <Onboarding
        copy={{ title: 'The server did not answer', lead: 'connect ECONNREFUSED', steps: [], command: 'pnpm start' }}
      />,
    ).container;
    expect(container.querySelector(PART.onboardingSteps)).toBeNull();
    expect(one(PART.onboardingLead, container).textContent).toBe('connect ECONNREFUSED');
    expect(one(PART.onboardingCommand, container).textContent).toBe('pnpm start');
  });

  it('prints no section, no lead, no edited strip and no health strip', () => {
    const { container } = showPaper({
      sources: [],
      edition: anEdition({ lead: anItem({ key: 'lead:1' }), edited: [editedItem('world:2')] }),
    });
    expect(container.querySelector(PART.onboarding)).not.toBeNull();
    expect(container.querySelectorAll(PART.section)).toHaveLength(0);
    expect(container.querySelector(PART.lead)).toBeNull();
    expect(container.querySelector(PART.edited)).toBeNull();
    expect(container.querySelector(PART.health)).toBeNull();
  });

  it('keeps the masthead, so the empty paper is still a paper', () => {
    const { container } = showPaper({ sources: [] });
    expect(one(PART.title, container).textContent).toBe(THE_MASTHEAD.name);
  });
});

describe('the masthead line', () => {
  it('prints the stats line the label function composed for this edition', () => {
    const { container } = showPaper({
      edition: anEdition({
        stats: { items: 4, newItems: 2, editedItems: 1, sourcesFetched: 2, sourcesUnhealthy: 1, cycles: 7 },
      }),
    });
    expect(one(PART.summary, container).textContent).toBe('4 stories · 2 new · 1 edited');
    expect(one(PART.dateline, container).textContent).toBe(anEdition().dateline);
  });

  it('reflects the theme it is given, and a click asks the app to change it, once', () => {
    const { container, onToggleTheme } = showPaper({ theme: 'dark' });
    const button = one<HTMLButtonElement>(PART.themeSwitch, container);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onToggleTheme).toHaveBeenCalledOnce();
  });
});

describe('the lead', () => {
  it('prints the lead story as the lead, and the ornament after it', () => {
    const { container } = showPaper({ edition: anEdition({ lead: anItem({ key: 'lead:1' }) }) });
    expect(storySlots(one(PART.lead, container))).toEqual(['lead']);
    expect(one(PART.ornament, container).textContent).toBe('\u2766');
    expect(one(PART.ornament, container).getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the lead its image, because the lead is always shown one', () => {
    const { container } = showPaper({
      edition: anEdition({ lead: anItem({ key: 'lead:1', image: 'https://feeds.example.test/a.jpg' }) }),
    });
    expect(one(`${PART.lead} ${PART.figure}`, container)).not.toBeNull();
  });

  it('prints no lead and no ornament for an edition with no lead', () => {
    const { container } = showPaper({ edition: anEdition({ lead: null }) });
    expect(container.querySelector(PART.lead)).toBeNull();
    expect(container.querySelector(PART.ornament)).toBeNull();
  });
});

describe('the sections', () => {
  it('prints every section of the edition, with its title, in the edition order', () => {
    const { container } = showPaper({
      edition: anEdition({
        sections: [
          aSection({ id: 'world', title: 'World', items: [anItem({ key: 'world:1' })] }),
          aSection({ id: 'technology', title: 'Technology', items: [anItem({ key: 'tech:1' })] }),
        ],
      }),
    });
    expect(textsOf(`${PART.sections} ${PART.section} ${PART.blockHead}`, container)).toEqual(['World', 'Technology']);
    expect([...container.querySelectorAll(`section${PART.section}`)].map((node) => node.id)).toEqual([
      'section-world',
      'section-technology',
    ]);
  });

  it('prints the section’s first story as the leader, and the rest as stories', () => {
    const { container } = showPaper({
      edition: anEdition({
        sections: [
          aSection({
            id: 'world',
            items: [anItem({ key: 'world:1' }), anItem({ key: 'world:2' }), anItem({ key: 'world:3' })],
          }),
        ],
      }),
    });
    expect(storySlots(container)).toEqual(['leader', 'story', 'story']);
    expect(container.querySelector(`${PART.section} ${PART.figure}`)).toBeNull();
  });

  it('prints a section with no items as an empty section, not as nothing', () => {
    const { container } = showPaper({
      edition: anEdition({ sections: [aSection({ id: 'world', title: 'World', items: [] })] }),
    });
    expect(container.querySelectorAll(PART.section)).toHaveLength(1);
    expect(container.querySelectorAll('article')).toHaveLength(0);
  });
});
describe('the health strip', () => {
  it('prints the unhealthy sources of the state response, and nothing for the healthy ones', () => {
    const sources: readonly SourceHealthView[] = [okSource, brokenSource];
    const { container } = showPaper({ sources });
    expect(container.querySelectorAll(`${PART.health} ${PART.healthRow}`)).toHaveLength(1);
    expect(one(PART.label, container).textContent).toBe('Example World');
  });

  it('prints the all-well line when every source is reporting', () => {
    const { container } = showPaper({ sources: [okSource, aSource({ id: 'gov', label: 'Example Gov' })] });
    expect(one<HTMLElement>(PART.health, container).dataset['well']).toBe('true');
    expect(one(PART.line, container).textContent).toBe('2 sources, all reporting');
  });
});

describe('the order of the page', () => {
  it('prints masthead, front page, ornament, sections, edited strip, health, in that order', () => {
    const { container } = showPaper({
      edition: anEdition({
        // The lead is also the first item of the strongest section, which is how
        // core builds an edition: `edition.lead` is the top-scoring item, and
        // sections are ordered by the score they carry.
        lead: anItem({ key: 'world:1' }),
        sections: [
          aSection({ id: 'world', title: 'World', items: [anItem({ key: 'world:1' }), anItem({ key: 'world:2' })] }),
          aSection({ id: 'tech', title: 'Technology', items: [anItem({ key: 'tech:1' })] }),
          aSection({ id: 'biz', title: 'Business', items: [anItem({ key: 'biz:1' })] }),
        ],
        edited: [editedItem('world:2')],
      }),
      sources: [brokenSource],
    });
    expect(partsOf(one(PART.sheet, container))).toEqual([
      'masthead',
      'front',
      'ornament',
      'sections',
      'edited',
      'health',
    ]);
    // The centre of the front page is the lead story, and the two strongest
    // sections flank it — the DOM prints the lead first, so reading order and
    // print order start with the story that matters, and the grid places it in
    // the middle column (`col-start-2`, see `FrontPage` in `Paper.tsx`).
    expect(partsOf(one(PART.front, container))).toEqual(['lead', 'rail:left', 'rail:right']);
    expect(container.querySelector<HTMLElement>(`${PART.lead} ${PART.story}`)?.dataset['key']).toBe('world:1');
    // A rail never repeats the centre story: the same headline twice on one
    // screen is not an index.
    const railKeys = [...container.querySelectorAll<HTMLElement>(`${PART.rail} article`)].map(
      (node) => node.dataset['key'],
    );
    expect(railKeys).toEqual(['world:2', 'tech:1']);
    expect(nthStory(container, 0).dataset['slot']).toBe('lead');
  });
});
