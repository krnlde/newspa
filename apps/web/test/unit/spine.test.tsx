import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cluster, groupsOf, type SpineSection, SQUARE_PITCH, spineSectionsOf, useSpine } from '../../src/spine.ts';

/**
 * The spine's script (D-043): the one number, the clustering, and the observer's
 * answer — nothing else.
 *
 * `spine.css` and the browser own the open, the close, the jump, the hover label
 * and the motion, so this file pins what the script decides: **sections whose
 * heads share a position are one cluster** (the reader's ruling, and the defect
 * that made it: the first build pushed colliding marks down the rail by a pitch,
 * which drew a column of three squares where the front page has one row), which
 * section the reader is in, and that no section is ever dropped.
 *
 * The page is a real DOM with faked geometry: a 14 600px document — the live
 * paper's order of magnitude — and a rail 868px tall, the height `pnpm shots` and
 * the Edge test measure at 1440x900. `IntersectionObserver` and `ResizeObserver`
 * are stubs, which is honest: the widget is the subject, and the browser's answer
 * is what a test drives by hand. The real observers are proved in
 * `apps/web/test/design/spine.test.tsx`.
 */

const RAIL_HEIGHT = 868;
const DOC_HEIGHT = 14_600;

interface SectionSpec extends SpineSection {
  readonly top: number;
}

const SECTIONS: readonly SectionSpec[] = [
  // The front page's row: World, Top Stories and Politics begin at one y, and
  // Technology and Science follow far below.
  { id: 'section-world', title: 'World', top: 1600 },
  { id: 'section-top', title: 'Top Stories', top: 1604 },
  { id: 'section-politics', title: 'Politics', top: 1600 },
  { id: 'section-technology', title: 'Technology', top: 6100 },
  { id: 'section-science', title: 'Science & Health', top: 13900 },
];

const sectionsOf = (specs: readonly SectionSpec[]): readonly SpineSection[] =>
  specs.map(({ id, title }) => ({ id, title }));

/** The stubs, one class each, with the handle a test uses to answer. */
class FakeIntersectionObserver {
  static readonly seen: FakeIntersectionObserver[] = [];
  readonly targets: Element[] = [];
  readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    // Assigned, not a parameter property: rule 3 bans the erasable syntax, because
    // Node runs this tree without a transform.
    this.callback = callback;
    FakeIntersectionObserver.seen.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  disconnect(): void {
    this.targets.length = 0;
  }

  unobserve(): void {
    // Not used by the spine; present because the platform has it.
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Deliver the browser's answer: these ids are crossing the band. */
  emit(ids: readonly string[]): void {
    const entries = this.targets.map((target) => ({
      target,
      isIntersecting: ids.includes(target.id),
    })) as unknown as IntersectionObserverEntry[];
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

class FakeResizeObserver {
  static readonly seen: FakeResizeObserver[] = [];
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.seen.push(this);
  }

  observe(): void {
    // The spine observes elements; the test triggers by hand.
  }

  unobserve(): void {
    // Not used by the spine.
  }

  disconnect(): void {
    // Nothing to release in a stub.
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

/** A page with the given sections, and the rail's box, at the given heights. */
const mountPage = (specs: readonly SectionSpec[], railHeight = RAIL_HEIGHT): void => {
  document.body.innerHTML = `<div data-part="spine"><nav id="spine-rail" data-part="spine-rail"></nav>${specs
    .map((spec) => `<section id="${spec.id}"></section>`)
    .join('')}</div>`;
  // Geometry is faked **on the elements the spine reads**, not on
  // `Element.prototype`: a prototype patch is global to the process, and under v8
  // coverage it is how a test file ends up allocating until the worker dies (4GB,
  // measured). A per-element patch says the same thing and is scoped to the DOM it
  // builds.
  const at = (id: string, x: number, y: number, width: number, height: number): void => {
    const element = document.getElementById(id);
    if (element !== null) element.getBoundingClientRect = () => new DOMRect(x, y, width, height);
  };
  at('spine-rail', 1418, 16, 1, railHeight);
  for (const spec of specs) at(spec.id, 80, spec.top, 600, 1200);
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: DOC_HEIGHT, configurable: true });
  Object.defineProperty(globalThis, 'scrollY', { value: 0, configurable: true });
};

beforeEach(() => {
  FakeIntersectionObserver.seen.length = 0;
  FakeResizeObserver.seen.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('the clusters', () => {
  it('keeps one place at one y: positions within a square pitch are one cluster', () => {
    expect(cluster([100, 104, 620, 830])).toEqual([[100, 104], [620], [830]]);
  });

  it('groups a place up to a square pitch wide, and splits the next one', () => {
    // The boundary is inclusive and it is the CSS's: a cluster of squares is a row
    // one pitch per square, so two heads within a pitch of each other are the same
    // place on the rail, and a head a pixel beyond it is a place of its own.
    expect(cluster([100, 100 + SQUARE_PITCH])).toEqual([[100, 100 + SQUARE_PITCH]]);
    expect(cluster([100, 100 + SQUARE_PITCH + 1])).toEqual([[100], [100 + SQUARE_PITCH + 1]]);
  });

  it('keeps every position, in document order, and never moves one', () => {
    // The defect this replaces pushed a colliding mark down the rail, which drew a
    // column of squares the page does not have.
    const positions = [500, 500, 500, 500, 900];
    const grouped = cluster(positions);
    expect(grouped.flat().sort((a, b) => a - b)).toEqual([...positions].sort((a, b) => a - b));
    expect(grouped[0]).toEqual([500, 500, 500, 500]);
  });

  it('prints nothing for no sections', () => {
    expect(cluster([])).toEqual([]);
  });
});

describe('the rail’s clusters', () => {
  it('holds the front page’s row in one cluster, at the row’s own place', () => {
    mountPage(SECTIONS);
    const groups = groupsOf(sectionsOf(SECTIONS), null);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.marks.map((mark) => mark.id)).toEqual(['section-world', 'section-top', 'section-politics']);
    for (const group of groups) {
      const first = group.marks[0];
      const spec = SECTIONS.find((found) => found.id === first?.id) as SectionSpec;
      expect(group.at).toBeCloseTo(spec.top / DOC_HEIGHT, 4);
    }
  });

  it('inks the section the reader is in, and only that one', () => {
    mountPage(SECTIONS);
    const groups = groupsOf(sectionsOf(SECTIONS), 'section-top');
    expect(groups.flatMap((group) => group.marks.map((mark) => mark.active))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('prints no square for a section that is not on the page', () => {
    // The rail maps the page. A mark that points at nothing is an ornament, and a
    // dead anchor in the tab order.
    mountPage(SECTIONS);
    const groups = groupsOf([{ id: 'section-missing', title: 'Missing' }, ...sectionsOf(SECTIONS)], null);
    expect(groups.flatMap((group) => group.marks).map((mark) => mark.id)).toEqual(SECTIONS.map((spec) => spec.id));
  });

  it('puts every section in exactly one cluster, whatever the page', () => {
    mountPage(SECTIONS);
    const groups = groupsOf(sectionsOf(SECTIONS), null);
    const ids = groups.flatMap((group) => group.marks.map((mark) => mark.id));
    expect(ids).toHaveLength(SECTIONS.length);
    expect(new Set(ids).size).toBe(SECTIONS.length);
  });

  it('names the app’s sections with the ids the sheet prints', () => {
    expect(spineSectionsOf([{ id: 'world', title: 'World' }])).toEqual([{ id: 'section-world', title: 'World' }]);
  });
});

describe('the rail, mounted', () => {
  const sections = sectionsOf(SECTIONS);

  it('measures on mount, before any observer answers', () => {
    mountPage(SECTIONS);
    const { result } = renderHook(() => useSpine(sections));
    expect(result.current.groups.flatMap((group) => group.marks).map((mark) => mark.id)).toEqual(
      SECTIONS.map((spec) => spec.id),
    );
  });

  it('inks the section the observer puts in the band, and uninks it when it leaves', () => {
    mountPage(SECTIONS);
    const { result } = renderHook(() => useSpine(sections));
    const observer = FakeIntersectionObserver.seen.at(-1) as FakeIntersectionObserver;
    act(() => observer.emit(['section-technology']));
    expect(result.current.groups.flatMap((group) => group.marks.map((mark) => mark.active))).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    // A scroll that crosses no head does no work: the same answer is the same view,
    // not a rebuilt one. The marks are `--at` percentages, so a re-measure on every
    // callback would be a re-render on every frame the band reports.
    const inked = result.current.groups;
    act(() => observer.emit(['section-technology']));
    expect(result.current.groups).toBe(inked);
    act(() => observer.emit([]));
    expect(result.current.groups.every((group) => group.marks.every((mark) => !mark.active))).toBe(true);
  });

  it('takes the first section in the band, in the sheet’s order', () => {
    // Two heads in the band at once: the reader is entering the upper one, and the
    // rail says so — the same order the clusters are printed in, so the two never
    // disagree.
    mountPage(SECTIONS);
    const { result } = renderHook(() => useSpine(sections));
    const observer = FakeIntersectionObserver.seen.at(-1) as FakeIntersectionObserver;
    act(() => observer.emit(['section-science', 'section-politics']));
    expect(result.current.groups.flatMap((group) => group.marks.map((mark) => mark.active))).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it('prints no square, and observes nothing, for a section that is not on the page', () => {
    // The rail maps the page, so an id with no element gets no mark — and no
    // observer, because an observer on a node that does not exist answers nothing
    // and the band would report a section the reader can never reach.
    //
    // The list is built **outside** the render callback: `useSpine` takes the app's
    // memoised list, and a new array each render is a new observed set each render,
    // which is an effect that re-runs on its own `setGroups` — an infinite loop that
    // ends in a 4GB heap and a dead worker (measured). `App.tsx` memoises for the
    // same reason.
    const withMissing: readonly SpineSection[] = [{ id: 'section-missing', title: 'Missing' }, ...sections];
    mountPage(SECTIONS);
    const { result } = renderHook(() => useSpine(withMissing));
    expect(result.current.groups.flatMap((group) => group.marks).map((mark) => mark.id)).toEqual(
      SECTIONS.map((spec) => spec.id),
    );
    expect(FakeIntersectionObserver.seen.at(-1)?.targets.map((target) => target.id)).toEqual(
      SECTIONS.map((spec) => spec.id),
    );
  });

  it('re-measures when a section’s box changes — a poll arrives, heights move', () => {
    mountPage(SECTIONS);
    const { result } = renderHook(() => useSpine(sections));
    const before = result.current.groups.map((group) => group.at);
    mountPage(SECTIONS.map((spec, index) => (index === 0 ? { ...spec, top: 4000 } : spec)));
    act(() => FakeResizeObserver.seen.at(-1)?.trigger());
    const after = result.current.groups.map((group) => group.at);
    expect(after[0]).toBeCloseTo(4000 / DOC_HEIGHT, 4);
    expect(after).not.toEqual(before);
  });
});
