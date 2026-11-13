import { cleanup, render } from '@testing-library/react';
import type { ItemView } from 'newspa-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormatProps, StorySlot } from '../src/index.ts';
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

/** An instant past a month — the point where the app's `ago` stops printing an age. */
const MONTH_OLD = '2026-10-01T06:00:00.000Z';

/**
 * `THE_FORMAT` **with the app's month rule** (D-047): past a month, `ago` prints the
 * absolute form, because the page has one way to write a date. The markers cannot
 * express that shape, and it is the shape the tooltip rule turns on — where the
 * visible words already **are** the instant, a `title` would only repeat them.
 */
const THE_AGED_FORMAT: FormatProps = {
  ago: (iso: string) => (iso === MONTH_OLD ? THE_AGED_FORMAT.absolute(iso) : `ago(${iso})`),
  absolute: THE_FORMAT.absolute,
};

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

  it('uses the gone word for a story the source stopped listing (D-029)', () => {
    // The kicker names the **last event**, so printing "New" for a closed door
    // would be the paper claiming the opposite of what it knows.
    const kicker = one(PART.kicker, showStory({ lastEventKind: 'gone' }));
    expect(kicker.textContent).toContain(THE_LABELS.goneKicker);
    expect(kicker.textContent).not.toContain(THE_LABELS.newKicker);
    expect(kicker.textContent).not.toContain(THE_LABELS.editedKicker);
  });

  it('uses the new word for a first sighting, and for one with no event at all', () => {
    for (const kind of ['new', null] as const) {
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
  it('joins byline, the age of the publication and the age of the last change', () => {
    expect(metaOf({ author: 'Ann Example', publishedAt: at('06:00'), lastChangedAt: at('09:30') })).toBe(
      `By Ann Example · ago(${at('06:00')}) · changed ago(${at('09:30')})`,
    );
  });

  it('omits the byline without leaving a separator behind', () => {
    expect(metaOf({ author: null, publishedAt: at('06:00'), lastChangedAt: at('09:30') })).toBe(
      `ago(${at('06:00')}) · changed ago(${at('09:30')})`,
    );
  });

  it('omits the change when there never was one', () => {
    expect(metaOf({ author: 'Ann Example', publishedAt: at('06:00'), lastChangedAt: null })).toBe(
      `By Ann Example · ago(${at('06:00')})`,
    );
  });

  it('names the sighting when the publisher declared no date, and says so', () => {
    // `firstSeenAt` is on the wire and non-null, so an undated story is placeable
    // by the paper's own knowledge. The word is the point: a bare age would read
    // as the story's publication date, which is the one thing the source never said.
    const asked: string[] = [];
    render(
      <Story
        item={anItem({ author: 'Ann Example', publishedAt: null, lastChangedAt: null })}
        slot="story"
        labels={THE_LABELS}
        format={{
          ago: (iso: string) => {
            asked.push(iso);
            return `ago(${iso})`;
          },
          absolute: THE_FORMAT.absolute,
        }}
        showImage={false}
      />,
    );
    expect(one(PART.meta).textContent).toBe(`By Ann Example · seen ago(${at('06:05')})`);
    // Twice, and both times the **same** instant: the words ask for an age and the
    // tooltip asks for the instant of that same age. The source's last fetch is
    // never asked for — one value per source would manufacture recency.
    expect(asked).toEqual([at('06:05'), at('06:05')]);
  });

  it('prints the meta line for an undated, unbylined story: the sighting is a fact the page has', () => {
    expect(
      showStory({ author: null, publishedAt: null, lastChangedAt: null }).querySelector(PART.meta)?.textContent,
    ).toBe(`seen ago(${at('06:05')})`);
  });
});

describe('the tooltip rides on the age, not the card', () => {
  const metaParts = (container: Element): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>(`${PART.meta} span`),
  ];

  it('hangs each instant on the words built from it, and leaves the card bare', () => {
    // The card is **not** the hover target: its headline paints an overlay over the
    // whole block, so a `title` on the card is a tooltip for the story, the source,
    // the image — everything, which is nothing. The reader's question "when,
    // exactly?" is asked of the date, so the date answers it.
    const container = showStory({
      publishedAt: at('06:00'),
      lastChangedAt: at('09:30'),
      author: 'Ann Example',
    });
    expect(one(PART.story, container).hasAttribute('title')).toBe(false);
    expect(metaParts(container).map((span) => span.textContent)).toEqual([
      'By Ann Example',
      `ago(${at('06:00')})`,
      `changed ago(${at('09:30')})`,
    ]);
    expect(metaParts(container).map((span) => span.getAttribute('title'))).toEqual([
      null,
      `absolute(${at('06:00')})`,
      `absolute(${at('09:30')})`,
    ]);
  });

  it('names a sighting as a sighting in the tooltip too', () => {
    // The tooltip answers "when, exactly?" for the instant the line was built from,
    // so the undated story's tooltip cannot read like a publication date either.
    const container = showStory({ publishedAt: null, lastChangedAt: null, author: null });
    expect(one(PART.meta, container).textContent).toBe(`seen ago(${at('06:05')})`);
    expect(one(`${PART.meta} span`, container).getAttribute('title')).toBe(`absolute(${at('06:05')})`);
  });

  it('carries no tooltip once the line prints the date itself', () => {
    // Past a month `ago` prints the absolute instant, and a tooltip that repeats the
    // words under it is noise: the attribute is absent, not empty.
    const container = render(
      <Story
        item={anItem({ publishedAt: MONTH_OLD, lastChangedAt: null, author: null })}
        slot="story"
        labels={THE_LABELS}
        format={THE_AGED_FORMAT}
        showImage={false}
      />,
    ).container;
    expect(one(`${PART.meta} span`, container).textContent).toBe(`absolute(${MONTH_OLD})`);
    expect(one(`${PART.meta} span`, container).hasAttribute('title')).toBe(false);
  });

  it('lifts the meta row above the headline overlay, the one cost of a reachable date', () => {
    // `after:absolute after:inset-0` on the headline covers the card; only a
    // **positioned** element paints and hit-tests above it. The class is the rule;
    // apps/web/test/design proves the hit test in a real browser.
    expect(one(PART.meta, showStory({})).className.split(' ')).toContain('relative');
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
