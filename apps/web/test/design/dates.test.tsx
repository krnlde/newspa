import { describe, expect, it } from 'vitest';
import { first, showPaper } from './support.tsx';

/**
 * The dates of a story card, **hit-tested** in real Edge (D-047).
 *
 * `packages/paper/test/story.test.tsx` pins which element carries the `title`; it
 * cannot say whether a pointer ever reaches that element, because happy-dom has no
 * layout engine and no paint order. That is the whole question here: the headline's
 * anchor paints an overlay over the card (`after:absolute after:inset-0`), so a
 * tooltip on the date is reachable only if the date **paints above** that overlay.
 * A page that passes the first test and fails this one shows a tooltip nobody can
 * summon.
 *
 * The text asserted is the app's real `Intl` output (see `support.tsx`), offset
 * included, so the string proven under the pointer is the one the reader reads.
 */

const OFFSET = /[+-]\d{2}:\d{2}/u;

const titledSpans = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>("[data-part='meta'] span[title]")];

/** The element Edge says is on top at this element's own centre point. */
const topmostAt = (element: Element): Element => {
  // The page is taller than the viewport, and `elementFromPoint` is viewport-local:
  // a row below the fold has no point to answer with. `scrollIntoView` does nothing
  // on this page, so the scroll is the spine suite's own — the element's document
  // position, minus half a screen — asked **instantly**: the page sets
  // `scroll-behavior: smooth`, and a smooth scroll is still moving when measured.
  globalThis.scrollTo({
    top: element.getBoundingClientRect().top + globalThis.scrollY - Math.round(innerHeight / 2),
    behavior: 'instant',
  });
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
  expect(hit === null, 'the element is off screen').toBe(false);
  return hit as Element;
};

describe('the age and its instant', () => {
  it('answers the pointer with the date, not with the headline overlay', () => {
    showPaper();
    const titled = titledSpans();
    expect(titled.length).toBeGreaterThanOrEqual(2);
    for (const span of titled) {
      const hit = topmostAt(span);
      expect(hit === span || span.contains(hit), `the tooltip on "${span.textContent}" is buried`).toBe(true);
    }
  });

  it('writes the instant in the page’s language, offset inside the string', () => {
    showPaper();
    for (const span of titledSpans()) {
      const title = span.getAttribute('title') ?? '';
      expect(title).toContain('2026');
      expect(title).toMatch(/\d{1,2}:\d{2}/u);
      expect(title).toMatch(OFFSET);
      // The page spells the offset, not `Intl`'s `GMT` prefix (D-047, measured).
      expect(title).not.toContain('GMT');
    }
  });

  it('leaves the card and the byline unlabelled: the tooltip belongs to the age', () => {
    showPaper();
    const story = first("[data-part='story']");
    expect(story.hasAttribute('title')).toBe(false);
    const meta = first("[data-part='story'] [data-part='meta']");
    expect(meta.hasAttribute('title')).toBe(false);
    const byline = meta.querySelector('span') as HTMLElement;
    expect(byline.textContent).toBe('By Ann Example');
    expect(byline.hasAttribute('title')).toBe(false);
  });

  it('keeps the rest of the card clickable — only the date row was lifted out', () => {
    showPaper();
    const deck = first("[data-part='story'] [data-part='deck']");
    const hit = topmostAt(deck);
    expect(hit.closest('a') === null, 'the deck no longer navigates').toBe(false);
  });
});
