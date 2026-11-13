import type { SpineGroup } from 'newspa-paper';
import { useEffect, useRef, useState } from 'react';

/**
 * The spine's one number (D-043) — and the only script the spine needs.
 *
 * `spine.css` draws the squares, and the titles that expand out of them on
 * `:hover` and `:focus-within`; the jump is a native anchor, so the page's own
 * `scroll-behavior: smooth` (`base.css`) is the whole of its motion. Two facts are
 * outside CSS's reach, and this file reads them from the layout and nothing else:
 *
 *  - **where each section sits in the document**, as a fraction of the rail
 *    (`--at`). Sections whose heads share a position — the front page prints
 *    WORLD, TOP STORIES and POLITICS in one row — share one **cluster** of squares,
 *    side by side. The reader's ruling, and the reason nothing is dropped: the first
 *    build pushed colliding marks down the rail by a pitch, which drew a column of
 *    three squares where the page says they are at one place. Measured on the live
 *    page, 2026-11-13, and ruled a defect.
 *  - **which section the reader is in**, from one **`IntersectionObserver`**
 *    watching a band across the top fifth of the viewport. There is no scroll
 *    listener in this file, and none is needed.
 *
 * Heights change under the page — a poll arrives, an image loads, the editor writes
 * a source — so a `ResizeObserver` on the sections and on the document re-measures.
 * Positions are fractions, so a window resize needs no work beyond the rail's own
 * height, which the observer reports.
 */

/** A section, as the app knows it: the anchor's id, and the words. */
export interface SpineSection {
  readonly id: string;
  readonly title: string;
}

/** The rail, as the component needs it: clusters of squares, in the sheet's order. */
export interface SpineView {
  readonly groups: readonly SpineGroup[];
}

/**
 * The rail's square pitch, in px: `--spine-bullet` plus its gap, and the distance
 * under which two section heads are **the same place on the rail**. The number is
 * the CSS's, and `apps/web/test/design/spine.test.tsx` reads the token from the
 * page, so the two cannot drift apart.
 */
export const SQUARE_PITCH = 7;

/** The band that answers "which section is the reader in": the top fifth. */
const BAND = '0px 0px -80% 0px';

/**
 * Group positions into clusters: walk the rail in document order, and a section
 * whose place is within `pitch` of the current cluster joins it. Deterministic and
 * total — every section lands in exactly one cluster, no mark is dropped, and the
 * cluster's place is its first section's, which is the place the page shows.
 */
export const cluster = (positions: readonly number[], pitch: number = SQUARE_PITCH): number[][] => {
  const groups: number[][] = [];
  for (const position of positions) {
    const last = groups[groups.length - 1];
    if (last !== undefined && position - (last[last.length - 1] as number) <= pitch) last.push(position);
    else groups.push([position]);
  }
  return groups;
};

/** The rail's height, in px, as its own box says — the CSS inset has one owner. */
const railHeightOf = (): number => {
  const rail = document.querySelector("[data-part='spine-rail']");
  return rail === null ? 0 : rail.getBoundingClientRect().height;
};

/** Each section that is on the page, with its top in document px. */
const topsOf = (sections: readonly SpineSection[]): { section: SpineSection; top: number }[] =>
  sections
    .map((section) => ({ section, element: document.getElementById(section.id) }))
    // A section with no element is not on the page, so it gets no square: the rail
    // maps the page, and a mark that points at nothing is an ornament.
    .filter((placed): placed is { section: SpineSection; element: HTMLElement } => placed.element !== null)
    .map((placed) => ({
      section: placed.section,
      top: placed.element.getBoundingClientRect().top + globalThis.scrollY,
    }));

/** The rail's clusters for the measured page, inked at `active`. */
export const groupsOf = (sections: readonly SpineSection[], active: string | null): SpineGroup[] => {
  const on = topsOf(sections);
  const railHeight = railHeightOf();
  const documentHeight = document.documentElement.scrollHeight;
  const scale = documentHeight <= 0 || railHeight <= 0 ? 0 : railHeight / documentHeight;
  const px = on.map((entry) => entry.top * scale);
  const placeOf = new Map(on.map((entry, index) => [entry.section.id, px[index] as number]));
  return cluster(px).map((positions) => ({
    at: railHeight <= 0 ? 0 : (positions[0] as number) / railHeight,
    marks: on
      .filter((entry) => positions.includes(placeOf.get(entry.section.id) as number))
      .map((entry) => ({ id: entry.section.id, title: entry.section.title, active: entry.section.id === active })),
  }));
};

/**
 * The app's sections, as rail entries. `section-<id>` is the id `Section.tsx`
 * stamps on every section, so the rail points at what is on the page and adds no
 * ids of its own — and the front page's rails, which repeat two of these titles
 * **without** an id, are not on the rail: the paper indexes a section once.
 */
export const spineSectionsOf = (sections: readonly SpineSection[]): SpineSection[] =>
  sections.map((section) => ({ id: `section-${section.id}`, title: section.title }));

/**
 * The rail, measured. `sections` is the app's list in the order the sheet prints
 * them; the view is rebuilt when the observer answers, when a section's box resizes,
 * and when the list itself changes (a poll, a new section).
 *
 * Nothing here answers a click, a key or a scroll. The marks are anchors, so the
 * browser navigates and the URL keeps the section; the submenu is `:hover` and
 * `:focus-within`, so CSS opens it; and there is nothing to escape from, because
 * there is no overlay.
 */
export const useSpine = (sections: readonly SpineSection[]): SpineView => {
  const [groups, setGroups] = useState<readonly SpineGroup[]>([]);
  const active = useRef<string | null>(null);

  // The app's list is memoised (`App.tsx`), so it is a dependency that means what
  // it says: a new list is a page with different sections, and that is the only
  // time the observed set changes. Heights, not the list, change under the page —
  // a poll arrives, an image loads, the editor writes a source — and the
  // `ResizeObserver` answers those.
  useEffect(() => {
    const rebuild = (): void => setGroups(groupsOf(sections, active.current));
    rebuild();
    const observer = new ResizeObserver(rebuild);
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element !== null) observer.observe(element);
    }
    const rail = document.querySelector("[data-part='spine-rail']");
    if (rail !== null) observer.observe(rail);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (seen) => {
        for (const entry of seen) {
          if (entry.isIntersecting) inBand.add(entry.target.id);
          else inBand.delete(entry.target.id);
        }
        // The first section, in the sheet's order, whose head is in the band: the
        // one the reader is entering. At the top of the page the lead owns the band,
        // so nothing is active — the front page is not a section.
        const next = sections.find((section) => inBand.has(section.id))?.id ?? null;
        if (next === active.current) return;
        active.current = next;
        setGroups(groupsOf(sections, next));
      },
      { rootMargin: BAND, threshold: 0 },
    );
    for (const section of sections) {
      const element = document.getElementById(section.id);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [sections]);

  return { groups };
};
