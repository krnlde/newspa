import type { Edition, EditionSection, EditReportView, ItemView, MastheadView, SourceHealthView } from 'newspa-core';
import type { FormatProps, HealthLabels, MastheadProps, PaperLabels } from '../src/index.ts';

/**
 * The fixtures every paper test builds its props from.
 *
 * Each builder is a typed literal (`ItemView`, `SourceHealthView`, …) spread
 * with the caller's overrides, so a field added to the wire contract is a
 * compile error here, naming the field, not a `undefined is not iterable`
 * inside a component. There is no `body` to set: `ItemView` has none (D-017).
 *
 * **The labels are literal English and the formatters are literal strings.**
 * That is deliberate (D-019): the paper must render exactly what it is handed,
 * so a marker like `pub(2026-11-09T06:00:00Z)` proves both that the string
 * arrived through props and which instant travelled. A clock, `Intl` or a
 * translation function in this file would hide a component that formats.
 */

const DAY = '2026-11-09';
/** An instant on the fixture day, so a test can name the string it expects back. */
export const at = (time: string): string => `${DAY}T${time}:00.000Z`;

const ITEM: ItemView = {
  key: 'world:1',
  sourceId: 'world',
  sourceLabel: 'Example World',
  kind: 'rss',
  title: 'The border crossing reopens',
  link: 'https://feeds.example.test/first-story',
  teaser: 'One paragraph, computed on the server.',
  image: null,
  publishedAt: at('06:00'),
  author: null,
  firstSeenAt: at('06:05'),
  lastChangedAt: null,
  editCount: 0,
  score: 12,
  tier: 'section',
  read: false,
  lastEventKind: 'new',
  lastEventAt: at('06:05'),
  lastReport: null,
};

/** A wire item with the boring fields pre-filled. */
export const anItem = (over: Partial<ItemView> = {}): ItemView => ({ ...ITEM, ...over });

/** A word diff of the teaser: one of each op, in the order the paper prints them. */
export const aReport = (over: Partial<EditReportView> = {}): EditReportView => ({
  ops: [
    { type: 'equal', text: 'The bank kept rates ' },
    { type: 'insert', text: 'unchanged' },
    { type: 'delete', text: 'steady' },
  ],
  added: 9,
  removed: 5,
  similarity: 0.82,
  meaningful: true,
  ...over,
});

export const aSource = (over: Partial<SourceHealthView> = {}): SourceHealthView => ({
  id: 'world',
  label: 'Example World',
  kind: 'rss',
  url: 'https://feeds.example.test/world/rss',
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

export const aSection = (over: Partial<EditionSection> = {}): EditionSection => ({
  id: 'world',
  title: 'World',
  blurb: 'What World sent today',
  items: [],
  ...over,
});

export const anEdition = (over: Partial<Edition> = {}): Edition => ({
  id: DAY,
  generatedAt: at('12:00'),
  dateline: 'November 9, 2026',
  lead: null,
  sections: [],
  edited: [],
  stats: { items: 0, newItems: 0, editedItems: 0, sourcesFetched: 0, sourcesUnhealthy: 0, cycles: 0 },
  ...over,
});

export const THE_MASTHEAD: MastheadView = {
  name: 'The Daily Wires',
  tagline: 'Printed from your own machine',
  dayStartHour: 3,
  generatedAt: at('12:00'),
};

export const THE_HEALTH_LABELS: HealthLabels = {
  headline: 'SOURCES',
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
};

/** Finished words, in the shape `apps/web/src/labels.ts` hands the paper. */
export const THE_LABELS: PaperLabels = {
  newKicker: 'NEW',
  editedKicker: 'EDITED',
  changedLabel: 'Changed',
  byline: (author: string) => `By ${author}`,
  opensInNewTab: (sourceLabel: string) => `Open the ${sourceLabel} story in a new tab`,
  editSummary: (added: number, removed: number) => `${String(added)} added, ${String(removed)} removed`,
  editedHeadline: 'EDITED TODAY',
  health: THE_HEALTH_LABELS,
  stats: (stats) =>
    `${String(stats.items)} stories · ${String(stats.newItems)} new · ${String(stats.editedItems)} edited`,
  onboarding: {
    title: 'No sources yet',
    lead: 'Add a feed, run the poller, and the paper prints itself.',
    steps: ['Add a source file', 'Start the poller', 'Open the paper'],
    command: 'pnpm pick -- https://feeds.example.test/world/rss',
  },
};

/**
 * The formatters as markers. The paper is handed functions, per render, because
 * a formatter built at module load is a frozen language (D-019) — so a test can
 * read the instant straight out of the rendered text.
 */
export const THE_FORMAT: FormatProps = {
  published: (iso: string | null) => (iso === null ? '' : `pub(${iso})`),
  ago: (iso: string) => `ago(${iso})`,
};

export const THE_MASTHEAD_PROPS: MastheadProps = {
  name: THE_MASTHEAD.name,
  tagline: THE_MASTHEAD.tagline,
  dateline: anEdition().dateline,
  summary: '4 stories · 2 new · 1 edited',
  theme: 'light',
  onToggleTheme: () => undefined,
  themeLabel: 'Switch to dark',
};

/** The first element matching `selector`, and a failure that says how many there were. */
export const one = <T extends Element>(selector: string, root: ParentNode = globalThis.document): T => {
  const found = root.querySelectorAll<T>(selector);
  const at = found[0];
  if (at === undefined || found.length !== 1)
    throw new Error(`expected one ${selector}, found ${String(found.length)}`);
  return at;
};

/** The story at `index` in print order, and a failure that says how many there were. */
export const nthStory = (root: ParentNode, index: number): HTMLElement => {
  const found = root.querySelectorAll<HTMLElement>('article.story');
  const story = found[index];
  if (story === undefined)
    throw new Error(`no story at index ${String(index)}: the page prints ${String(found.length)}`);
  return story;
};

/** Every match, in document order, as text. */
export const textsOf = (selector: string, root: ParentNode = globalThis.document): string[] =>
  [...root.querySelectorAll(selector)].map((node) => node.textContent ?? '');

/** The class names of the stories on the page, in print order. */
export const storyClasses = (root: ParentNode = globalThis.document): string[] =>
  [...root.querySelectorAll<HTMLElement>('article.story')].map((node) => node.className);
