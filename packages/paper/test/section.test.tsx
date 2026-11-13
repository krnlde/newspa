import { cleanup, render } from '@testing-library/react';
import type { ItemView } from 'newspa-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionProps } from '../src/index.ts';
import { Section } from '../src/index.ts';
import { anItem, at, nthStory, one, PART, storySlots, THE_FORMAT, THE_LABELS, textsOf } from './support.ts';

/**
 * A section is the paper's unit of ordering: an uppercase head with a rule, an
 * optional blurb, and the stories in the order the server scored them. The
 * component's promise is **the first story is the leader** — it is the one that
 * gets the big headline and, when the source has one, the photograph — and that
 * nothing about the section invents a word.
 */

afterEach(cleanup);

const stories = (keys: readonly string[]): ItemView[] =>
  keys.map((key) => anItem({ key, title: `Story ${key}`, link: `https://feeds.example.test/${key}` }));

const showSection = (over: Partial<SectionProps> = {}): HTMLElement => {
  const props: SectionProps = {
    id: 'world',
    title: 'World',
    blurb: 'What World sent today',
    items: stories(['world:1', 'world:2']),
    labels: THE_LABELS,
    format: THE_FORMAT,
    ...over,
  };
  return render(<Section {...props} />).container;
};

const keysOf = (root: ParentNode): (string | undefined)[] =>
  [...root.querySelectorAll<HTMLElement>('article[data-key]')].map((node) => node.dataset['key']);

describe('the head', () => {
  it('prints the section title as the only text in the head, and the rule as a hidden span', () => {
    const head = one(PART.blockHead, showSection({ title: 'Technology' }));
    expect(head.textContent).toBe('Technology');
    expect(one(PART.rule, head).getAttribute('aria-hidden')).toBe('true');
  });

  it('gives the section an addressable id, prefixed so it cannot collide with a story', () => {
    const section = one(`section${PART.section}`, showSection({ id: 'technology' }));
    expect(section.getAttribute('id')).toBe('section-technology');
  });
});

describe('the blurb', () => {
  it('prints the blurb the reader wrote for a section that has stories', () => {
    expect(one(PART.blurb, showSection({ blurb: 'Border, elections, weather' })).textContent).toBe(
      'Border, elections, weather',
    );
  });

  it('prints no blurb element when there is none', () => {
    expect(showSection({ blurb: null }).querySelector(PART.blurb)).toBeNull();
  });

  it('prints no blurb for a section with no stories: a promise about content that is not there is a lie', () => {
    expect(showSection({ blurb: 'What World sent today', items: [] }).querySelector(PART.blurb)).toBeNull();
  });
});

describe('the stories', () => {
  it('makes the first story the leader and every later one a plain story', () => {
    expect(storySlots(showSection({ items: stories(['a', 'b', 'c']) }))).toEqual(['leader', 'story', 'story']);
  });

  it('keeps the stories in the order the edition put them, keyed by item key', () => {
    expect(keysOf(showSection({ items: stories(['world:3', 'world:1', 'world:2']) }))).toEqual([
      'world:3',
      'world:1',
      'world:2',
    ]);
  });

  it('gives no key warning when the stories are distinct, as the edition guarantees', () => {
    const warned = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    showSection({ blurb: null, items: stories(['a', 'b']) });
    expect(warned).not.toHaveBeenCalled();
  });

  it('shows the image only on the leader, because only the leader is shown one', () => {
    const items = ['world:1', 'world:2'].map((key) => anItem({ key, image: `https://feeds.example.test/${key}.jpg` }));
    const container = showSection({ items });
    expect(textsOf(PART.caption, container)).toEqual(['Example World']);
    expect(container.querySelectorAll(PART.figure)).toHaveLength(1);
    expect(nthStory(container, 0).querySelector(PART.figure)).not.toBeNull();
    expect(nthStory(container, 1).querySelector(PART.figure)).toBeNull();
  });

  it('hands every story the labels and formatters it was given, so no story formats anything itself', () => {
    const container = showSection({
      items: [
        anItem({ key: 'world:1' }),
        anItem({ key: 'world:2', author: 'Ann Example', publishedAt: null, lastEventKind: 'edited' }),
      ],
    });
    const second = nthStory(container, 1);
    expect(one(PART.kicker, second).textContent).toContain(THE_LABELS.editedKicker);
    expect(one(PART.meta, second).textContent).toBe('By Ann Example');
    expect(nthStory(container, 0).querySelector(PART.meta)?.textContent).toBe(`ago(${at('06:00')})`);
  });

  it('prints an empty columns block, and no story, for a section with no items', () => {
    const container = showSection({ items: [] });
    expect(container.querySelectorAll('article')).toHaveLength(0);
    expect(one(PART.columns, container).textContent).toBe('');
  });
});
