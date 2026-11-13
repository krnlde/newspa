import { cleanup, render } from '@testing-library/react';
import type { Edition, ItemView, MastheadView, SourceHealthView } from 'newspa-core';
import { type FormatProps, Paper, type PaperLabels } from 'newspa-paper';
import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { afterEach } from 'vitest';
import { spineSectionsOf, useSpine } from '../../src/spine.ts';
import 'newspa-paper/styles/paper.css';

/**
 * The design contract, computed in real Edge (`apps/web/vitest.design.config.ts`
 * — `playwright-core` + `channel: 'msedge'`, the same browser the scraper uses).
 *
 * This is the half of `packages/paper/test/design-contract.test.tsx` that a text
 * scan cannot reach: what a class string **computes to** once the cascade, the
 * media queries and the layout engine have had their say. happy-dom has no
 * layout engine, so the claims of `docs/design.md` — three columns above 900px,
 * a sticky label with an opaque background, a panel padded and boxed by an inset
 * ring, the crossings on the stock, the lead headline above the fold — had never
 * been checked by anything before these files.
 *
 * The suites drive their own widths with `page.viewport()`: the config's
 * `viewport: {width: 1280, height: 900}` is a default, and a contract about
 * breakpoints that only ever sees one width asserts nothing. The test page runs
 * in the browser's own iframe, so a viewport change **is** a media-query change:
 * no `matchMedia` shim, no stubbed width, no pretend breakpoint.
 *
 * This module is the edition every suite prints, and the measuring helpers, so
 * the three suites cannot drift into three different papers.
 */

const DAY = '2026-11-09';
const at = (time: string): string => `${DAY}T${time}:00.000Z`;

const anItem = (key: string, over: Partial<ItemView> = {}): ItemView => ({
  key,
  sourceId: 'world',
  sourceLabel: 'Example World',
  kind: 'rss',
  title: 'Rates held for the third month running as the border crossing reopens',
  link: `https://feeds.example.test/${key}`,
  teaser: 'One paragraph, computed on the server, long enough to be a real deck on the page.',
  image: `https://feeds.example.test/${key}.jpg`,
  publishedAt: at('06:00'),
  author: 'Ann Example',
  firstSeenAt: at('06:05'),
  lastChangedAt: at('09:30'),
  editCount: 1,
  score: 20,
  tier: 'lead',
  read: false,
  lastEventKind: 'new',
  lastEventAt: at('06:05'),
  lastReport: null,
  ...over,
});

const aSource = (id: string, over: Partial<SourceHealthView> = {}): SourceHealthView => ({
  id,
  label: `Example ${id}`,
  kind: 'rss',
  url: `https://feeds.example.test/${id}/rss`,
  state: 'ok',
  lastStatus: 200,
  lastFetchAt: at('11:50'),
  lastChangeAt: at('09:00'),
  itemCount: 12,
  expectedMatchCount: null,
  matchCount: null,
  note: null,
  cadenceMinutes: 20,
  enabled: true,
  ...over,
});

const THE_MASTHEAD: MastheadView = {
  name: 'The Daily Wires',
  tagline: 'Printed from your own machine',
  dayStartHour: 3,
  generatedAt: at('12:00'),
};

const THE_FORMAT: FormatProps = {
  ago: (iso: string) => iso,
  absolute: (iso: string | null) => (iso === null ? '' : iso),
};

const LABELS: PaperLabels = {
  newKicker: 'New',
  editedKicker: 'Edited',
  goneKicker: 'Archived',
  changedLabel: 'Changed',
  seenLabel: 'Seen',
  byline: (author: string) => `By ${author}`,
  opensInNewTab: (sourceLabel: string) => `Open the ${sourceLabel} story in a new tab`,
  editSummary: (added: number, removed: number) => `${String(added)} added, ${String(removed)} removed`,
  editedHeadline: 'Edited today',
  health: {
    headline: 'Sources',
    allWell: (count: number) => `${String(count)} sources, all reporting`,
    state: {
      ok: 'reporting',
      blocked: 'blocked',
      'no-matches': 'matching nothing',
      restructured: 'restructured',
      error: 'errored',
      stale: 'gone quiet',
      unknown: 'unknown',
    },
    cadence: (minutes: number) => `every ${String(minutes)} min`,
    items: (count: number) => `${String(count)} stories`,
    neverFetched: 'never fetched',
    lastPoll: (age: string) => `last poll ${age}`,
    matches: (seen: number, expected: number) => `matched ${String(seen)} of ${String(expected)} elements`,
  },
  stats: () => '12 stories · 6 new · 2 edited',
  onboarding: {
    title: 'No sources yet',
    lead: 'Add a feed.',
    steps: ['Add a source', 'Run the poller', 'Open the paper'],
    command: 'pnpm pick -- https://feeds.example.test/world/rss',
  },
};

/** An edition with a lead, two sections (rails and the list), an edited strip, a broken source. */
const THE_EDITION: Edition = {
  id: DAY,
  generatedAt: at('12:00'),
  dateline: 'November 9, 2026',
  lead: anItem('lead:1'),
  sections: [
    {
      id: 'world',
      title: 'World',
      blurb: 'Border, elections, weather',
      items: [anItem('world:1'), anItem('world:2'), anItem('world:3')],
    },
    {
      id: 'tech',
      title: 'Technology',
      blurb: 'What the wires filed',
      items: [anItem('tech:1', { sourceLabel: 'Example Tech' }), anItem('tech:2', { sourceLabel: 'Example Tech' })],
    },
  ],
  edited: [
    anItem('world:2', {
      lastEventKind: 'edited',
      lastReport: { ops: [{ type: 'insert', text: 'held' }], added: 3, removed: 1, similarity: 0.8, meaningful: true },
    }),
  ],
  stats: { items: 12, newItems: 6, editedItems: 2, sourcesFetched: 3, sourcesUnhealthy: 1, cycles: 4 },
};

const SOURCES: readonly SourceHealthView[] = [
  aSource('world'),
  aSource('tech', { state: 'no-matches', note: 'the selector matched 0 of 14 elements' }),
];

/** The paper, as the app renders it: one tree, the real stylesheet, a real browser. */
const PAPER_BASE = {
  masthead: THE_MASTHEAD,
  edition: THE_EDITION,
  sources: SOURCES,
  labels: LABELS,
  format: THE_FORMAT,
} as const;

export const showPaper = (): void => {
  render(<Paper {...PAPER_BASE} theme="light" onToggleTheme={() => undefined} themeLabel="Switch to dark" />);
};

/**
 * The paper **with the spine** (D-043), and its numbers from the real hook.
 *
 * The rail's geometry is the suite's subject: each tick's place is a fraction of
 * the rail, and the hatch band's height is the share of the page on screen. A stub
 * of `useSpine` would measure the stub, so this renders the same edition through
 * `useSpine(spineSectionsOf(...))`, with real `IntersectionObserver` and
 * `ResizeObserver`, which a real browser has. The four words the app owns are the
 * app's English ones; that the paper prints no words of its own is proved in
 * `packages/paper/test/spine.test.tsx`.
 */
export const showSpinedPaper = (): void => {
  const Spined = (): ReactElement => {
    // Memoised, as the app memoises: a new array each render would re-make the
    // observers on every render, and the rail's own state change is a render.
    const sections = useMemo(() => spineSectionsOf(THE_EDITION.sections), []);
    const spine = useSpine(sections);
    return (
      <Paper
        {...PAPER_BASE}
        theme="light"
        onToggleTheme={() => undefined}
        themeLabel="Switch to dark"
        spine={{ groups: spine.groups, railLabel: 'Section rail' }}
      />
    );
  };
  render(<Spined />);
};

/**
 * The paper on an explicit pair of display axes (D-038).
 *
 * The app applies both before first paint (the script in `index.html`), so a suite
 * that wants the cascade to have decided has to write the attributes on
 * `documentElement` and mount with the matching props: the CSS reads the markup, the
 * controls read the props, and a test that set only one of the two would measure a
 * state no real page can be in.
 */
export const showPaperIn = (theme: 'light' | 'dark', contrast: 'normal' | 'more'): void => {
  const at = document.documentElement;
  at.dataset['theme'] = theme;
  at.dataset['contrast'] = contrast;
  render(
    <Paper
      masthead={THE_MASTHEAD}
      edition={THE_EDITION}
      sources={SOURCES}
      labels={LABELS}
      format={THE_FORMAT}
      theme={theme}
      onToggleTheme={() => undefined}
      themeLabel={theme === 'dark' ? 'Light' : 'Dark'}
      contrast={contrast}
      onToggleContrast={() => undefined}
      contrastLabel={contrast === 'more' ? 'Plain' : 'High contrast'}
    />,
  );
};

/** Everything the paper owns: a scan over this cannot be vacuous. */
export const paperElements = (): HTMLElement[] => {
  const sheet = document.querySelector<HTMLElement>("[data-part='sheet']");
  if (sheet === null) throw new Error('the paper printed no sheet');
  return [...sheet.querySelectorAll<HTMLElement>('*')];
};

export const first = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector} on the page`);
  return found;
};

export const cssOf = (selector: string, pseudo?: string): CSSStyleDeclaration =>
  globalThis.getComputedStyle(first(selector), pseudo);
export const widthOf = (selector: string): number => Math.round(first(selector).getBoundingClientRect().width);
export const boxOf = (selector: string): DOMRectReadOnly => first(selector).getBoundingClientRect();
export const px = (value: string): number => Number.parseFloat(value);
export const tracks = (selector: string): string[] =>
  cssOf(selector)
    .gridTemplateColumns.split(' ')
    .filter((part) => part.length > 0);

/** An opaque background is one a scrolling column cannot show through. */
export const isOpaque = (color: string): boolean => {
  if (color === 'transparent') return false;
  const inside = /\(([^)]*)\)/u.exec(color)?.[1] ?? '';
  const parts = inside.split(/[\s,/]+/u).filter((part) => part.length > 0);
  const alpha = parts[3];
  if (alpha === undefined) return color.startsWith('rgb');
  return Number.parseFloat(alpha) > 0.999;
};

afterEach(cleanup);
