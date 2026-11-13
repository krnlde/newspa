import { cleanup } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { boxOf, cssOf, first, px, showPaper, showSpinedPaper } from './support.tsx';

/**
 * The spine, computed in real Edge (D-043): the row of squares, the animated
 * submenu, the jump, and the reader's two laws — **an overlay relayouts nothing**,
 * and **a place on the rail is one y**. See `support.tsx` for the edition, the
 * viewport story, and why happy-dom cannot check any of this: the row and the
 * column are the same elements in two states, and the states are `:hover`,
 * `:focus-within`, `transform` and a transition — none of which a DOM shim
 * evaluates.
 *
 * The gutter is not measured here: `@vitest/browser` injects an unlayered
 * `body { padding: 0 }` into this frame (`boxes.test.tsx` records the same), so the
 * sheet is full-bleed and there is no gutter to sit in. That the rail fits inside
 * the gutter on a real page is what `pnpm shots` prints.
 */

const SPINE = "[data-part='spine']";
const RAIL = "[data-part='spine-rail']";
const CLUSTER = "[data-part='spine-cluster']";
const MARK = "[data-part='spine-mark']";
const SQUARE = "[data-part='spine-square']";
const LABEL = "[data-part='spine-label']";

const marks = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(MARK)];
const tap = (): number => px(cssOf(SPINE).getPropertyValue('--spine-tap'));
const pitch = (): number => px(cssOf(SPINE).getPropertyValue('--spine-pitch'));

/** A part inside a node, for a claim about one mark of many. */
const onlyIn = (root: HTMLElement, selector: string): HTMLElement => {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector} in ${root.dataset['part'] ?? root.tagName}`);
  return found;
};

/** The keyboard's way in: `:focus-within` is the same CSS rule as the pointer's. */
const open = async (): Promise<void> => {
  first(MARK).focus();
  // The animation is 260ms; a settled cluster is the measured state, and a test
  // that read the frames would be asserting a duration the reader has not ruled on.
  await vi.waitFor(
    () => {
      const boxes = marks().map((mark) => mark.getBoundingClientRect());
      expect(boxes[1] === undefined || boxes[1].top - (boxes[0] as DOMRect).top).toBeGreaterThanOrEqual(tap() - 1);
    },
    { timeout: 2_000 },
  );
};

describe('the row: a place on the rail is one y', () => {
  it('holds the front page’s row in one cluster, side by side, at the same height', () => {
    showSpinedPaper();
    const clusters = [...document.querySelectorAll<HTMLElement>(CLUSTER)];
    // The edition prints WORLD and TOP STORIES in one row, so their heads are at one
    // document position and the rail must say so: one cluster, and its marks at one
    // y. The first build pushed them a pitch apart and drew a column the page does
    // not have — the defect the reader pointed at, and the reason no section is ever
    // dropped.
    expect(clusters).toHaveLength(1);
    const boxes = marks().map((mark) => mark.getBoundingClientRect());
    expect(boxes).toHaveLength(2);
    const [left, right] = boxes as [DOMRect, DOMRect];
    expect(Math.abs(left.top - right.top)).toBeLessThan(1);
    expect(Math.abs(right.x - left.x)).toBeCloseTo(pitch(), 0);
  });

  it('prints the word clipped away at rest, and the square is all the rail shows', () => {
    showSpinedPaper();
    for (const mark of marks()) {
      expect(mark.getBoundingClientRect().width).toBeLessThanOrEqual(
        px(cssOf(SPINE).getPropertyValue('--spine-bullet')) + 1,
      );
      // The word is in the DOM (so a screen reader and a find-in-page reach it) and
      // clipped out of sight: nine titles in a 40px gutter is a form, not a page.
      expect(mark.getBoundingClientRect().height).toBeGreaterThanOrEqual(tap());
    }
    expect(first(LABEL).textContent).toBe('World');
  });

  it('draws nothing but its squares: no guideline, no registration tick, no band, no panel', () => {
    showSpinedPaper();
    const rail = cssOf(RAIL);
    // The reader read the lines as debug marks and ruled them out; a rail that grows
    // a border again is a rail that argues with the reader.
    expect(rail.borderInlineEndWidth).toBe('0px');
    expect(rail.borderInlineStartWidth).toBe('0px');
    for (const side of ['::before', '::after']) {
      expect(cssOf(RAIL, side).content, `the rail draws a mark on ${side}`).toBe('none');
    }
    expect(
      document.querySelectorAll(
        "[data-part='spine-progress'], [data-part='spine-panel'], [data-part='spine-close'], dialog",
      ),
    ).toHaveLength(0);
  });

  it('adds no scrollable width: the page is as wide with the rail as without it', () => {
    // The absolute verdict ("no sideways scroll on the real page") is printed by
    // `pnpm shots`, because this frame is 6px wide with its own crop marks and
    // `boxes.test.tsx` records why it cannot answer that. What **can** be measured
    // here is the spine's own contribution, which is what the law claims: nothing.
    showPaper();
    const plain = document.documentElement.scrollWidth;
    cleanup();
    showSpinedPaper();
    expect(document.documentElement.scrollWidth).toBe(plain);
  });

  it('is not printed at all on a phone, where the paper is one column', async () => {
    await page.viewport(390, 844);
    showSpinedPaper();
    expect(cssOf(SPINE).display).toBe('none');
    await page.viewport(1440, 900);
    expect(cssOf(SPINE).display).toBe('block');
  });
});

describe('the submenu: the row becomes a list, and the titles arrive', () => {
  it('animates place and width, which is the whole of the animation', () => {
    showSpinedPaper();
    const style = cssOf(MARK);
    expect(style.overflow).toBe('hidden');
    expect(style.transitionProperty).toContain('transform');
    expect(style.transitionProperty).toContain('inline-size');
    expect(px(style.transitionDuration)).toBeLessThanOrEqual(0.4);
  });

  it('stacks the squares down the rail, one tap apart, and grows a title beside each', async () => {
    showSpinedPaper();
    await open();
    const [upper, lower] = marks();
    if (upper === undefined || lower === undefined)
      throw new Error('the front page’s row printed fewer than two marks');
    const boxes = [upper, lower].map((mark) => mark.getBoundingClientRect());
    expect((boxes[1] as DOMRect).top - (boxes[0] as DOMRect).top).toBeGreaterThanOrEqual(tap() - 1);
    expect(lower.getBoundingClientRect().width).toBeGreaterThan(40);
    expect(onlyIn(upper, LABEL).getBoundingClientRect().width).toBeGreaterThan(20);
  });

  it('keeps the bullets on the right, and the titles right-aligned against them', async () => {
    showSpinedPaper();
    const railRight = boxOf(CLUSTER).right;
    await open();
    for (const mark of marks()) {
      const box = mark.getBoundingClientRect();
      const square = onlyIn(mark, SQUARE);
      const label = onlyIn(mark, LABEL);
      // The square is the mark's last word: its right edge is the rail's edge, in
      // both shapes. That is the reader's ruling, given with the animation.
      expect(Math.abs(box.right - railRight)).toBeLessThan(2);
      expect(Math.abs(square.getBoundingClientRect().right - railRight)).toBeLessThan(2);
      expect(globalThis.getComputedStyle(label).textAlign).toBe('end');
    }
  });

  it('is a target only as wide as its text, so the page under the rail keeps its clicks', async () => {
    showSpinedPaper();
    await open();
    const mark = marks()[0] as HTMLElement;
    const box = mark.getBoundingClientRect();
    const label = mark.getBoundingClientRect().left;
    // A box that grows to a fixed 22rem would cover the column's words and answer a
    // click meant for them. Measured 24px left of the mark's own edge, the page is
    // the page, and on the word it is the mark.
    const outside = document.elementFromPoint(Math.round(label - 24), Math.round(box.y + box.height / 2));
    expect(outside === null || mark.contains(outside)).toBe(false);
    const on = document.elementFromPoint(Math.round(box.x + 6), Math.round(box.y + box.height / 2));
    expect(on !== null && mark.contains(on)).toBe(true);
  });

  it('inks the square of the section the reader has entered', async () => {
    showSpinedPaper();
    expect(marks().filter((mark) => mark.dataset['active'] === 'true')).toHaveLength(0);
    globalThis.scrollTo(0, first("[data-part='section']").getBoundingClientRect().top + globalThis.scrollY);
    await vi.waitFor(() => expect(marks().some((mark) => mark.dataset['active'] === 'true')).toBe(true), {
      timeout: 4_000,
    });
    expect(marks().filter((mark) => mark.dataset['active'] === 'true')).toHaveLength(1);
  });
});

describe('the jump', () => {
  it('pressing a mark leaves the columns where they are, and puts the section at the top', async () => {
    showSpinedPaper();
    const plain = boxOf("[data-part='columns']");
    expect(first(MARK).getAttribute('href')).toBe('#section-world');
    first(MARK).click();
    await vi.waitFor(() => expect(first("[data-part='section']").getBoundingClientRect().top).toBeLessThan(300), {
      timeout: 4_000,
    });
    // The URL carries the section, because the jump is the browser's own: a reader
    // who copies the address hands over the section, and the back button travels.
    expect(globalThis.location.hash).toBe('#section-world');
    // The overlay's law, measured after the state that covers the most: the columns
    // have not moved by a pixel while the rail grew a list of words over them, and
    // the section arrived where the reader asked for it.
    const spined = boxOf("[data-part='columns']");
    expect({ x: spined.x, width: spined.width }).toStrictEqual({ x: plain.x, width: plain.width });
  });
});
