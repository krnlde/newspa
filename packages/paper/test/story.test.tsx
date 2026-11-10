import { cleanup, render } from '@testing-library/react';
import type { ItemView } from 'newspa-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { StorySlot } from '../src/index.ts';
import { Story } from '../src/index.ts';
import { anItem, at, one, PART, THE_FORMAT, THE_LABELS } from './support.ts';

/**
 * `Story` is the block the whole paper is made of: kicker, headline-as-link,
 * deck, meta line, optional figure. These tests pin the **props → markup**
 * mapping, which is the component's whole job: which words appear, which
 * elements exist, and what the link promises.
 *
 * The strings asserted are `THE_LABELS`' and `THE_FORMAT`'s markers, never
 * English of the component's own (D-019) — a story that formatted a date itself
 * would fail here because no marker reached it. Layout, sizes and the `●` glyph
 * are the design suite's job in real Edge: happy-dom has no layout engine.
 *
 * The hooks are `data-part` and `data-slot`, not class names (AGENTS.md rule
 * 11): a styling change cannot rename an attribute, so these assertions survive
 * the rewrite with their strength untouched.
 */

afterEach(cleanup);

const showStory = (item: Partial<ItemView>, slot: StorySlot = 'story', showImage = false): HTMLElement =>
  render(<Story item={anItem(item)} slot={slot} labels={THE_LABELS} format={THE_FORMAT} showImage={showImage} />)
    .container;

const metaOf = (item: Partial<ItemView>): string | null => {
  const at2 = showStory(item).querySelector(PART.meta);
  return at2?.textContent ?? null;
};

describe('the kicker', () => {
  it('uses the edited word for a story whose text changed', () => {
    const kicker = one(PART.kicker, showStory({ lastEventKind: 'edited' }));
    expect(kicker.textContent).toContain(THE_LABELS.editedKicker);
    expect(kicker.textContent).not.toContain(THE_LABELS.newKicker);
  });

  it('uses the new word for a first sighting, and for one that has come back', () => {
    for (const kind of ['new', 'gone', null] as const) {
      const kicker = one(PART.kicker, showStory({ lastEventKind: kind }));
      expect(kicker.textContent, String(kind)).toContain(THE_LABELS.newKicker);
      expect(kicker.textContent, String(kind)).not.toContain(THE_LABELS.editedKicker);
    }
  });

  it('prints the source label as its own span, so the design can push it to the margin', () => {
    const kicker = one(PART.kicker, showStory({ sourceLabel: 'Example Tech' }));
    expect(one(PART.source, kicker).textContent).toBe('Example Tech');
  });
});

describe('the unread mark', () => {
  it('marks a story the reader has not opened, hidden from the screen reader', () => {
    const mark = one(PART.mark, showStory({ read: false }));
    expect(mark.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves no mark element on a story that is read', () => {
    expect(showStory({ read: true }).querySelector(PART.mark)).toBeNull();
  });
});

describe('the headline', () => {
  it('is a real anchor out to the publisher, in a new tab, with no opener', () => {
    const container = showStory({
      link: 'https://feeds.example.test/second-story',
      title: 'A census counts the empty towns',
    });
    const link = one<HTMLAnchorElement>(`${PART.headline} ${PART.link}`, container);
    expect(link.getAttribute('href')).toBe('https://feeds.example.test/second-story');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('A census counts the empty towns');
  });

  it('names the source in the link’s accessible name, from the label prop', () => {
    const link = one<HTMLAnchorElement>(PART.link, showStory({ sourceLabel: 'Example World' }));
    expect(link.getAttribute('aria-label')).toBe(THE_LABELS.opensInNewTab('Example World'));
  });
});

describe('the story block', () => {
  it('carries the item key, and the read state as an attribute a stylesheet can match', () => {
    const article = one('article', showStory({ key: 'tech:9', read: false }));
    expect(article.getAttribute('data-key')).toBe('tech:9');
    expect(article.getAttribute('data-read')).toBe('false');
    expect(one('article', showStory({ key: 'tech:9', read: true })).getAttribute('data-read')).toBe('true');
  });

  it('takes its slot from the display slot, never from the item’s tier', () => {
    const slots: readonly StorySlot[] = ['lead', 'leader', 'story', 'brief'];
    for (const slot of slots) {
      const article = one<HTMLElement>('article', showStory({ tier: 'brief' }, slot));
      expect(article.dataset['slot'], slot).toBe(slot);
      expect(article.getAttribute('data-part'), slot).toBe('story');
    }
  });

  it('prints the lead’s figure after its deck, so the headline leads the photo', () => {
    const container = showStory({ image: 'https://feeds.example.test/a.jpg' }, 'lead', true);
    const parts = [...one('article', container).children].map((node) => node.getAttribute('data-part'));
    expect(parts).toEqual(['kicker', 'headline', 'deck', 'figure', 'meta']);
  });

  it('prints a section leader’s figure first, because a leader is a card in a column', () => {
    const container = showStory({ image: 'https://feeds.example.test/a.jpg' }, 'leader', true);
    const parts = [...one('article', container).children].map((node) => node.getAttribute('data-part'));
    expect(parts[0]).toBe('figure');
    expect(parts.indexOf('figure')).toBeLessThan(parts.indexOf('headline'));
  });
});

describe('the deck', () => {
  it('prints the teaser the server computed', () => {
    expect(one(PART.deck, showStory({ teaser: 'Two columns of measured type.' })).textContent).toBe(
      'Two columns of measured type.',
    );
  });

  it('prints no deck element when the teaser is empty', () => {
    expect(showStory({ teaser: '' }).querySelector(PART.deck)).toBeNull();
  });
});

describe('the meta line', () => {
  it('joins byline, published stamp and the age of the last change with a separator', () => {
    expect(metaOf({ author: 'Ann Example', publishedAt: at('06:00'), lastChangedAt: at('09:30') })).toBe(
      `By Ann Example · pub(${at('06:00')}) · changed ago(${at('09:30')})`,
    );
  });

  it('omits the byline without leaving a separator behind', () => {
    expect(metaOf({ author: null, publishedAt: at('06:00'), lastChangedAt: at('09:30') })).toBe(
      `pub(${at('06:00')}) · changed ago(${at('09:30')})`,
    );
  });

  it('omits the change when there never was one', () => {
    expect(metaOf({ author: 'Ann Example', publishedAt: at('06:00'), lastChangedAt: null })).toBe(
      `By Ann Example · pub(${at('06:00')})`,
    );
  });

  it('omits an absent publication stamp, and the formatter is not asked for a null one', () => {
    const asked: (string | null)[] = [];
    render(
      <Story
        item={anItem({ author: 'Ann Example', publishedAt: null, lastChangedAt: null })}
        slot="story"
        labels={THE_LABELS}
        format={{
          published: (iso: string | null) => {
            asked.push(iso);
            return iso === null ? '' : `pub(${iso})`;
          },
          ago: THE_FORMAT.ago,
        }}
        showImage={false}
      />,
    );
    expect(one(PART.meta).textContent).toBe('By Ann Example');
    expect(asked).toEqual([null]);
  });

  it('prints no meta element at all when every part is empty', () => {
    expect(showStory({ author: null, publishedAt: null, lastChangedAt: null }).querySelector(PART.meta)).toBeNull();
  });
});

describe('the figure', () => {
  it('attaches the image, the empty alt and the source caption to a story that is shown one', () => {
    const figure = one(PART.figure, showStory({ image: 'https://feeds.example.test/a.jpg' }, 'lead', true));
    const image = one<HTMLImageElement>(PART.image, figure);
    expect(image.getAttribute('src')).toBe('https://feeds.example.test/a.jpg');
    expect(image.getAttribute('alt')).toBe('');
    expect(image.getAttribute('loading')).toBe('lazy');
    expect(one(PART.caption, figure).textContent).toBe('Example World');
  });

  it('prints no figure element when the source has no image: an empty div is not a photograph', () => {
    expect(showStory({ image: null }, 'lead', true).querySelector(PART.figure)).toBeNull();
  });

  it('prints no figure for a story that is not shown one, even with an image', () => {
    expect(
      showStory({ image: 'https://feeds.example.test/a.jpg' }, 'story', false).querySelector(PART.figure),
    ).toBeNull();
  });
});
