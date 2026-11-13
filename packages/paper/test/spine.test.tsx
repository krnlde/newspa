import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Spine, type SpineGroup, type SpineProps } from '../src/index.ts';
import { firstOf, one, PART, partsOf } from './support.ts';

/**
 * The spine as a component (D-043): what it prints, and what it points at.
 *
 * The row-to-list animation, the reveal, the jump and the no-relayout law all
 * belong to the browser and to `spine.css`, so they are pinned in real Edge
 * (`apps/web/test/design/spine.test.tsx`). This file owns the claims that live in
 * markup: one cluster per place on the rail, one anchor per section, the index the
 * animation reads, the section's own word as the mark's text, nothing printed that
 * a reader cannot reach, and — the reader's ruling — **no menu**: the rail is the
 * whole of the navigation.
 */

const GROUPS: readonly SpineGroup[] = [
  {
    // The front page's row: three section heads at one document position, so the
    // rail holds three squares in **one** cluster, side by side.
    at: 0.108,
    marks: [
      { id: 'section-world', title: 'World', active: false },
      { id: 'section-top', title: 'Top Stories', active: true },
      { id: 'section-politics', title: 'Politics', active: false },
    ],
  },
  { at: 0.708, marks: [{ id: 'section-technology', title: 'Technology', active: false }] },
];

const THE_SPINE: SpineProps = { groups: GROUPS, railLabel: 'Section rail' };

const showSpine = (over: Partial<SpineProps> = {}) => render(<Spine {...THE_SPINE} {...over} />).container;

afterEach(cleanup);

describe('the rail', () => {
  it('is a landmark named by the app, and the rail is the spine’s only box', () => {
    const container = showSpine();
    const rail = one(PART.spineRail, container);
    expect(rail.tagName).toBe('NAV');
    expect(rail.getAttribute('aria-label')).toBe(THE_SPINE.railLabel);
    expect(partsOf(one(PART.spine, container))).toEqual(['spine-rail']);
  });

  it('prints one cluster per place on the rail, at that place', () => {
    const clusters = [...showSpine().querySelectorAll<HTMLElement>(PART.spineCluster)];
    expect(clusters).toHaveLength(GROUPS.length);
    expect(clusters.map((cluster) => cluster.style.getPropertyValue('--at'))).toEqual(['0.108', '0.708']);
  });

  it('prints one anchor per section, inside its cluster, at the section’s own target', () => {
    const clusters = [...showSpine().querySelectorAll<HTMLElement>(PART.spineCluster)];
    expect(clusters.map((cluster) => [...cluster.querySelectorAll(PART.spineMark)].length)).toEqual([3, 1]);
    const marks = [...showSpine().querySelectorAll<HTMLAnchorElement>(PART.spineMark)];
    expect(marks.map((mark) => mark.getAttribute('href'))).toEqual([
      '#section-world',
      '#section-top',
      '#section-politics',
      '#section-technology',
    ]);
    for (const mark of marks) expect(mark.tagName).toBe('A');
  });

  it('numbers every mark within its cluster, which is the index the animation moves by', () => {
    // `spine.css` puts index `i` along the row and down the column. Without the
    // number the animation has no order to animate, and a cluster is three squares
    // on one pixel.
    const marks = [...showSpine().querySelectorAll<HTMLElement>(PART.spineMark)];
    expect(marks.map((mark) => mark.style.getPropertyValue('--i'))).toEqual(['0', '1', '2', '0']);
  });

  it('names a mark with the section’s word, and prints no word of its own', () => {
    const marks = [...showSpine().querySelectorAll<HTMLElement>(PART.spineMark)];
    expect(marks.map((mark) => one(PART.spineLabel, mark).textContent)).toEqual([
      'World',
      'Top Stories',
      'Politics',
      'Technology',
    ]);
    // D-019: the paper is given the rail's name, and story text is the publisher's.
    expect(showSpine().textContent).not.toContain('Contents');
    expect(showSpine().textContent).not.toContain('Close');
  });

  it('keeps the square out of the reader’s way: it is the mark’s shape, not its name', () => {
    const mark = firstOf(PART.spineMark, showSpine());
    expect(one(PART.spineSquare, mark).getAttribute('aria-hidden')).toBe('true');
    // The word first, then the square: the word slides out of the rail, and the
    // square stays at the rail's edge in both shapes.
    expect(partsOf(mark)).toEqual(['spine-label', 'spine-square']);
  });

  it('inks the section the reader is in, and only that one', () => {
    const marks = [...showSpine().querySelectorAll<HTMLElement>(PART.spineMark)];
    expect(marks.map((mark) => mark.getAttribute('data-active'))).toEqual(['false', 'true', 'false', 'false']);
  });

  it('has no menu: no panel, no dialog, no heading, no way out', () => {
    // The reader's ruling. The first build opened a `CONTENTS` panel; the rail is
    // the submenu, so a second navigation surface is a thing to learn, and a thing
    // to escape from, that the page does not need.
    const container = showSpine();
    expect(container.querySelectorAll('dialog, [data-part="spine-panel"], [data-part="spine-close"]')).toHaveLength(0);
  });

  it('prints nothing when it has nothing to point at, and does not gate itself', () => {
    // The app decides whether a rail is worth printing (one section is not a
    // contents list). The rail's box must exist for the measurement to read, so an
    // empty list prints the box and no marks — it never refuses to mount.
    const container = showSpine({ groups: [] });
    expect(one(PART.spineRail, container)).toBeTruthy();
    expect(container.querySelectorAll(PART.spineCluster)).toHaveLength(0);
    expect(container.querySelectorAll(PART.spineMark)).toHaveLength(0);
  });
});
