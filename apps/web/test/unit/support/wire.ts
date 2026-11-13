import {
  type EditionSection,
  type HealthState,
  type ItemView,
  type ServerEvent,
  type SourceHealthView,
  type StateResponse,
  serverEventSchema,
  stateResponseSchema,
} from 'newspa-core';
import { type Mock, vi } from 'vitest';

/**
 * The wire the app talks to: a `/api/state` response, and an event stream.
 *
 * Every fixture goes through the **schema**, never a hand-typed literal: an
 * object that drifts from `packages/core/src/api.ts` fails at construction,
 * here, naming the field — not three frames down inside `App.tsx` as a
 * `TypeError`, and not green against a shape the server cannot send.
 *
 * There is no `body` to set, because `ItemView` has none (D-017): the paper
 * cannot render an article's text by accident.
 */

const DAY = '2026-11-09';
const at = (time: string): string => `${DAY}T${time}:00.000Z`;

export const MASTHEAD = {
  name: 'The Daily Wires',
  tagline: 'Printed from your own machine',
  dateline: 'November 9, 2026',
} as const;

/** The story links the page renders, and one it does not: the flash has to tell them apart. */
export const LINKS = {
  lead: 'https://feeds.example.test/lead-story',
  first: 'https://feeds.example.test/first-story',
  second: 'https://feeds.example.test/second-story',
  third: 'https://feeds.example.test/third-story',
  absent: 'https://feeds.example.test/a-story-not-printed-here',
} as const;

const anItem = (
  key: string,
  sourceId: string,
  link: string,
  title: string,
  over: Partial<ItemView> = {},
): ItemView => ({
  key,
  sourceId,
  sourceLabel: sourceId === 'world' ? 'Example World' : 'Example Tech',
  kind: 'rss',
  title,
  link,
  teaser: 'One paragraph, computed on the server: the whole story the paper shows.',
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
  ...over,
});

const aSection = (id: string, title: string, items: readonly ItemView[]): EditionSection => ({
  id,
  title,
  blurb: `What ${title} sent today`,
  // `EditionSection.items` is mutable on the wire (zod infers arrays as mutable),
  // so the fixture copies rather than shares the caller's array.
  items: [...items],
});

const aSource = (id: string, state: HealthState, over: Partial<SourceHealthView> = {}): SourceHealthView => ({
  id,
  label: id === 'world' ? 'Example World' : 'Example Tech',
  kind: 'rss',
  url: `https://feeds.example.test/${id}/rss`,
  state,
  lastStatus: 200,
  lastFetchAt: at('11:50'),
  lastChangeAt: at('09:00'),
  itemCount: 12,
  expectedMatchCount: 14,
  matchCount: 0,
  note: 'the selector matched 0 of 14 elements',
  cadenceMinutes: 20,
  enabled: true,
  ...over,
});

/**
 * The paper with news: a lead, two sections (two stories, then one), and a
 * source that has quietly stopped matching — rule 5 made visible.
 */
export const aPaper = (): StateResponse =>
  stateResponseSchema.parse({
    masthead: { name: MASTHEAD.name, tagline: MASTHEAD.tagline, dayStartHour: 3, generatedAt: at('12:00') },
    edition: {
      id: DAY,
      generatedAt: at('12:00'),
      dateline: MASTHEAD.dateline,
      lead: anItem('lead:1', 'world', LINKS.lead, 'Rates held for the third month running', { tier: 'lead' }),
      sections: [
        aSection('world', 'World', [
          anItem('world:1', 'world', LINKS.first, 'The border crossing reopens'),
          anItem('world:2', 'world', LINKS.second, 'A census counts the empty towns', { tier: 'brief' }),
        ]),
        aSection('technology', 'Technology', [
          anItem('tech:1', 'tech', LINKS.third, 'A standard body agrees on a wire format', { tier: 'front' }),
        ]),
      ],
      edited: [],
      stats: { items: 4, newItems: 2, editedItems: 1, sourcesFetched: 2, sourcesUnhealthy: 1, cycles: 7 },
    },
    sources: [
      aSource('world', 'no-matches'),
      aSource('tech', 'ok', { expectedMatchCount: null, matchCount: null, note: null, itemCount: 40 }),
    ],
  });

/** The paper with nothing on the wire: the onboarding state, which is a state, not a blank page. */
export const anEmptyPaper = (): StateResponse =>
  stateResponseSchema.parse({
    masthead: { name: MASTHEAD.name, tagline: MASTHEAD.tagline, dayStartHour: 3, generatedAt: at('12:00') },
    edition: {
      id: DAY,
      generatedAt: at('12:00'),
      dateline: MASTHEAD.dateline,
      lead: null,
      sections: [],
      edited: [],
      stats: { items: 0, newItems: 0, editedItems: 0, sourcesFetched: 0, sourcesUnhealthy: 0, cycles: 0 },
    },
    sources: [],
  });

/**
 * `/api/state` shaped like a `Response`: `api.ts` reads `ok`, `status`, `json`
 * and the worker's stamp header, nothing else.
 *
 * `headers` is the seam the offline label uses (WP16, D-039): `sw.js` stamps a
 * cached edition with `newspa-cached-at`, and the page prints "cached 06:12"
 * because of that one header — so a test that cannot set it cannot test the rule.
 */
export const responseOf = (body: unknown, headers: Record<string, string> = {}): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    json: async () => body,
  }) as unknown as Response;

/** The same answer, served out of the worker's cache and stamped at `at`. */
export const aCachedAnswer = (body: unknown, at: string): Response => responseOf(body, { 'newspa-cached-at': at });

export type FetchMock = Mock<(input: string, init?: RequestInit) => Promise<Response>>;

export const stubFetch = (respond: () => Promise<Response>): FetchMock => {
  const mock = vi.fn(async (_input: string, _init?: RequestInit): Promise<Response> => respond());
  vi.stubGlobal('fetch', mock);
  return mock;
};

/** A request that never settles: the state the app must render as loading, not blank. */
export const aPendingFetch = (): Promise<Response> => new Promise<Response>(() => undefined);

export const aRejectedFetch = (message: string): (() => Promise<Response>) => {
  const failure = new Error(message);
  return async (): Promise<Response> => {
    throw failure;
  };
};

/** A live server that answers a status the paper cannot print (`api.ts` names it). */
export const aStatusFetch =
  (status: number): (() => Promise<Response>) =>
  async (): Promise<Response> =>
    ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

/**
 * happy-dom has no `EventSource`, so the stream is the one place a fake is
 * honest: it records the URL, counts `close`, and hands messages to `onmessage`.
 */
export class FakeSource {
  readonly url: string;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  readonly close = vi.fn();

  constructor(url: string) {
    this.url = url;
    opened.push(this);
  }
}

export const opened: FakeSource[] = [];

/** Fresh stream, fresh `fetch`: called from every test's `beforeEach`. */
export const stubWire = (): void => {
  opened.length = 0;
  vi.stubGlobal('EventSource', FakeSource);
};

export const theSource = (): FakeSource => {
  const at = opened.at(-1);
  if (at === undefined) throw new Error('the app opened no EventSource');
  return at;
};

/** One push down the stream, exactly as the browser would hand it over. */
export const publishRaw = (data: string): void => {
  const handler = theSource().onmessage;
  if (handler === null) throw new Error('the app installed no onmessage handler');
  handler(new MessageEvent<string>('message', { data }));
};

export const publish = (event: ServerEvent): void => publishRaw(JSON.stringify(event));

export const itemNew = (link: string): ServerEvent =>
  serverEventSchema.parse({
    type: 'item:new',
    at: at('12:01'),
    sourceId: 'world',
    title: 'A story the server has not printed yet',
    link,
    score: 20,
  });

export const itemEdited = (link: string): ServerEvent =>
  serverEventSchema.parse({
    type: 'item:edited',
    at: at('12:01'),
    sourceId: 'world',
    title: 'A story the publisher rewrote',
    link,
    added: 6,
    removed: 2,
  });

export const cycleDone = (): ServerEvent =>
  serverEventSchema.parse({ type: 'cycle:done', at: at('12:02'), fetched: 2, newItems: 1, editedItems: 0 });

/** Every push the paper must react to **without** flashing a story. */
export const quietEvents = (): ServerEvent[] => [
  serverEventSchema.parse({ type: 'cycle:start', at: at('12:03') }),
  serverEventSchema.parse({
    type: 'source:health',
    at: at('12:03'),
    source: 'world',
    state: 'restructured',
    note: 'selector matched 0 of 9',
  }),
  serverEventSchema.parse({ type: 'edition:updated', at: at('12:03'), edition: DAY }),
];
