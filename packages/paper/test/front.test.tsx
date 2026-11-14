import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaperProps } from '../src/index.ts';
import { Paper } from '../src/index.ts';
import {
  anEdition,
  anItem,
  aSection,
  aSource,
  nthStory,
  one,
  PART,
  partsOf,
  railOf,
  THE_FORMAT,
  THE_LABELS,
  THE_MASTHEAD,
} from './support.ts';

/**
 * The front page: the lead in the centre, the **two strongest sections** as
 * narrow rails beside it, and the sections list below the fold.
 *
 * Which sections are strongest is core's decision (sections arrive ordered by
 * the score they carry), so the paper's rules are only these: the centre is the
 * lead, a rail never repeats the centre, a rail is short, an empty rail renders
 * nothing, and a rail's stories are the quietest volume the paper has.
 */

afterEach(cleanup);

const show = (over: Partial<PaperProps> = {}) =>
  render(
    <Paper
      masthead={THE_MASTHEAD}
      edition={anEdition()}
      sources={[aSource({ id: 'tech', state: 'ok' })]}
      labels={THE_LABELS}
      format={THE_FORMAT}
      theme="light"
      onToggleTheme={vi.fn()}
      themeLabel="Switch to dark"
      {...over}
    />,
  );

/** A story in a rail, by key. A missing key is a loud string, never a silent `undefined`. */
const railKeys = (container: HTMLElement): string[] =>
  [...container.querySelectorAll<HTMLElement>(`${PART.rail} article`)].map((node) => node.dataset['key'] ?? '(no key)');

describe('the front page', () => {
  it('puts the lead in the centre and the two strongest sections at its sides', () => {
    const { container } = show({
      edition: anEdition({
        lead: anItem({ key: 'a:1' }),
        sections: [
          aSection({ id: 'a', title: 'World', items: [anItem({ key: 'a:2' })] }),
          aSection({ id: 'b', title: 'Technology', items: [anItem({ key: 'b:1' })] }),
          aSection({ id: 'c', title: 'Business', items: [anItem({ key: 'c:1' })] }),
        ],
      }),
    });
    expect(partsOf(one(PART.front, container))).toEqual(['lead', 'rail:left', 'rail:right']);
    expect(railKeys(container)).toEqual(['a:2', 'b:1']);
    expect([...container.querySelectorAll(`${PART.rail} ${PART.blockHead}`)].map((node) => node.textContent)).toEqual([
      'World',
      'Technology',
    ]);
    // The third section is not on the front: it prints in the list below.
    expect(railKeys(container)).not.toContain('c:1');
  });

  it('prints one rail when there is one section, and never an empty column', () => {
    const { container } = show({
      edition: anEdition({
        lead: anItem({ key: 'a:1' }),
        sections: [aSection({ id: 'a', title: 'World', items: [anItem({ key: 'a:1' })] })],
      }),
    });
    // That section's only item is the lead, so its rail has nothing to show and
    // renders nothing; the single real rail is the centre's neighbour.
    expect(partsOf(one(PART.front, container))).toEqual(['lead']);
    expect(container.querySelectorAll(PART.rail)).toHaveLength(0);
  });

  it('caps a rail at four items, because a rail points into the section below', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => anItem({ key: `a:${n}` }));
    const { container } = show({
      edition: anEdition({
        lead: anItem({ key: 'lead:1' }),
        sections: [
          aSection({ id: 'a', title: 'World', items }),
          aSection({ id: 'b', items: [anItem({ key: 'b:1' })] }),
        ],
      }),
    });
    expect(railKeys(container).filter((key) => key.startsWith('a:'))).toHaveLength(4);
  });

  it('prints only the section rail it is given, so an old story stays below the fold', () => {
    // D-048 is core's law, and the page has no clock: the gate arrives as data.
    // The section's list holds the old story too; its rail holds only its news.
    const fresh = anItem({ key: 'a:2' });
    const { container } = show({
      edition: anEdition({
        lead: anItem({ key: 'lead:1' }),
        sections: [
          aSection({
            id: 'a',
            title: 'World',
            items: [anItem({ key: 'a:1' }), fresh, anItem({ key: 'a:3' })],
            rail: [fresh],
          }),
          aSection({ id: 'b', items: [anItem({ key: 'b:1' })] }),
        ],
      }),
    });
    expect(railKeys(container).filter((key) => key.startsWith('a:'))).toEqual(['a:2']);
  });

  it('sets rail stories to the quietest slot, with no figure', () => {
    const { container } = show({
      edition: anEdition({
        // Both the lead and the rail's story have a photograph available. Only
        // the lead prints one: a rail is words that point into the list below,
        // and a rail of thumbnails is a photo blog, not a front page.
        lead: anItem({ key: 'lead:1', image: 'https://x.test/p.jpg' }),
        sections: [
          aSection({ id: 'a', title: 'World', items: [anItem({ key: 'a:1', image: 'https://x.test/rail.jpg' })] }),
          aSection({ id: 'b', items: [anItem({ key: 'b:1' })] }),
        ],
      }),
    });
    const rail = one(railOf('left'), container);
    expect([...rail.querySelectorAll<HTMLElement>('article')].map((node) => node.dataset['slot'])).toEqual(['brief']);
    expect(rail.querySelector('figure')).toBeNull();
    // The lead keeps its photograph; the rails are words.
    expect(one(`${PART.lead} ${PART.figure} ${PART.image}`, container).getAttribute('src')).toBe(
      'https://x.test/p.jpg',
    );
  });

  it('separates rail items with a rule on the list item, not on the story', () => {
    const items = ['a:2', 'a:3', 'a:4'].map((key) => anItem({ key }));
    const { container } = show({
      edition: anEdition({
        lead: anItem({ key: 'lead:1' }),
        sections: [
          aSection({ id: 'a', title: 'World', items }),
          aSection({ id: 'b', items: [anItem({ key: 'b:1' })] }),
        ],
      }),
    });
    const list = one(`${railOf('left')} ${PART.railList}`, container);
    expect([...list.children].map((node) => node.tagName)).toEqual(['LI', 'LI', 'LI']);
    expect([...list.querySelectorAll<HTMLElement>(PART.story)].map((node) => node.dataset['slot'])).toEqual([
      'brief',
      'brief',
      'brief',
    ]);
  });

  it('prints no front page at all for an edition with no lead', () => {
    const { container } = show({
      edition: anEdition({ lead: null, sections: [aSection({ id: 'a', items: [anItem({ key: 'a:1' })] })] }),
    });
    expect(container.querySelector(PART.front)).toBeNull();
    expect(container.querySelector(PART.ornament)).toBeNull();
    // The sections list is still the paper: an edition with no lead is thin, not blank.
    expect(nthStory(container, 0).dataset['slot']).toBe('leader');
    expect([...one(PART.sections, container).children].map((node) => node.getAttribute('data-part'))).toEqual([
      'section',
    ]);
  });
});
