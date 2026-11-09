import type { ItemView } from '../src/api.ts';

/** A wire item with the boring fields pre-filled. There is no `body` to set: the schema has none. */
export const aView = (over: Partial<ItemView> = {}): ItemView => ({
  key: 'bbc:1',
  sourceId: 'bbc',
  sourceLabel: 'BBC',
  kind: 'rss',
  title: 'Central bank holds rates',
  link: 'https://bbc.example/a',
  teaser: 'The bank kept rates unchanged.',
  image: null,
  publishedAt: '2026-11-09T06:00:00Z',
  author: null,
  firstSeenAt: '2026-11-09T06:05:00Z',
  lastChangedAt: null,
  editCount: 0,
  score: 12,
  tier: 'lead',
  read: false,
  lastEventKind: 'new',
  lastEventAt: '2026-11-09T06:05:00Z',
  lastReport: null,
  ...over,
});
