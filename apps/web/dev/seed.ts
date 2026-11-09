import { readFileSync, writeFileSync } from 'node:fs';
import { defaultAppConfig, htmlSourceSchema, jsonSourceSchema, rssSourceSchema, type SourceSpec } from 'newspa-config';
import {
  buildEdition,
  defaultScoreRules,
  type EditionStats,
  editionIdFor,
  editReport,
  type HealthState,
  type ItemView,
  isBoilerplateTeaser,
  nowIso,
  type PickedItem,
  type SourceHealthView,
  type StateResponse,
  scoreItem,
  teaserFor,
} from 'newspa-core';
import { type ParseFailureReason, type ParseResult, parsePayload } from 'newspa-fetch';

/**
 * The dev fixture: `node dev/seed.ts` builds `dev/state.json`, and
 * `dev/apiPlugin.ts` serves it at `/api/state` so `pnpm dev` prints a real paper
 * before `packages/server` exists. It is **dev-only** — the app's production
 * data comes from the server at 8787, and nothing here ships in the bundle.
 *
 * The story text is not invented: every item is parsed by the real parser from a
 * capture in `packages/fetch/test/fixtures/` (provenance in that directory's
 * README). Two things are synthetic, and named where they are made:
 * the **edit diff** rows, because a capture is one snapshot of one publisher's
 * text and a diff needs two; and the **dateline**, which the server owns.
 */

const fixtures = new URL('../../../packages/fetch/test/fixtures/', import.meta.url);
const read = (name: string): string => readFileSync(new URL(name, fixtures), 'utf8');

interface Entry {
  readonly spec: SourceSpec;
  readonly fixture: string;
}

const rss = (id: string, label: string, url: string, weight: number, section?: string) =>
  rssSourceSchema.parse({ id, label, url, kind: 'rss', weight, section });

const entries: Entry[] = [
  {
    spec: rss('bbc', 'BBC World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 3),
    fixture: 'feed-bbc-world.xml',
  },
  {
    spec: rss('guardian', 'The Guardian', 'https://www.theguardian.com/world/rss', 2),
    fixture: 'feed-guardian-world.xml',
  },
  { spec: rss('ubuntu', 'Ubuntu Blog', 'https://ubuntu.com/blog/feed', 1), fixture: 'feed-ubuntu-blog.xml' },
  {
    // `weight: 5` is the importance slider at its top: 10 points from the source
    // alone, so a fresh release scores over 12 and takes the lead.
    spec: rss('node-releases', 'Node.js releases', 'https://github.com/nodejs/node/releases.atom', 5, 'Software'),
    fixture: 'feed-github-releases.atom.xml',
  },
  {
    spec: jsonSourceSchema.parse({
      id: 'hn',
      label: 'Hacker News',
      url: 'https://hn.algolia.com/api/v1/search?tags=front_page',
      kind: 'json',
      weight: 2,
      section: 'Technology',
      itemsPath: 'hits',
      fields: { title: 'title', link: 'url', date: 'created_at', image: 'thumbnail' },
    }),
    fixture: 'json-hn-front-page.json',
  },
  {
    // A page with no list: the document is one item, keyed by its text (D-005).
    spec: htmlSourceSchema.parse({
      id: 'node-downloads',
      label: 'Node.js downloads',
      url: 'https://nodejs.org/en/download',
      kind: 'html',
      weight: 5,
      section: 'Software',
      strip: ['.updated'],
    }),
    fixture: 'html-page-version.html',
  },
  {
    spec: htmlSourceSchema.parse({
      id: 'cards',
      label: 'Example Daily',
      url: 'https://example.invalid/',
      kind: 'html',
      weight: 1,
      list: '.story-grid .card',
      fields: { title: '.title', summary: '.deck', link: 'a' },
    }),
    fixture: 'html-card-list.html',
  },
  {
    // The unhealthy source is a real failure, not a made-up one: an items path
    // that resolves to nothing. Rule 5 says the paper has to say so.
    spec: jsonSourceSchema.parse({
      id: 'broken-api',
      label: 'Example API',
      url: 'https://example.invalid/data',
      kind: 'json',
      itemsPath: 'data.stories',
      fields: { title: 'title', link: 'url' },
    }),
    fixture: 'json-no-items.json',
  },
];

const rules = defaultScoreRules({ watchwords: ['security', 'release', 'v2', 'kernel'], sourceWeight: 1 });

const viewOf = (spec: SourceSpec, picked: PickedItem, at: Date): ItemView => {
  const teaser = teaserFor({ title: picked.title, summary: picked.summary, body: picked.body });
  const { total, tier } = scoreItem(
    { title: picked.title, summary: picked.summary, publishedAt: picked.publishedAt, sourceLabel: spec.label },
    rules,
    at,
  );
  return {
    key: picked.key,
    sourceId: spec.id,
    sourceLabel: spec.label,
    kind: spec.kind,
    title: picked.title,
    link: picked.link,
    teaser: isBoilerplateTeaser(teaser) ? '' : teaser,
    image: picked.image,
    publishedAt: picked.publishedAt,
    author: picked.author,
    firstSeenAt: nowIso(),
    lastChangedAt: null,
    editCount: 0,
    score: total,
    tier,
    read: false,
    lastEventKind: 'new',
    lastEventAt: nowIso(),
    lastReport: null,
  };
};

/** A publisher rewrote the line. The text is real; the second version is not. */
const markEdited = (item: ItemView): ItemView => {
  const after = `${item.teaser.replace(/^\w+/, 'Formerly')} — and the numbers were corrected`;
  const report = editReport(item.teaser, after);
  return {
    ...item,
    teaser: after,
    editCount: 1,
    lastChangedAt: nowIso(),
    lastEventKind: 'edited',
    lastEventAt: nowIso(),
    lastReport: {
      ops: report.ops,
      added: report.added,
      removed: report.removed,
      similarity: report.similarity,
      meaningful: report.meaningful,
    },
  };
};

const REASONS: Partial<Record<ParseFailureReason, HealthState>> = {
  challenge: 'blocked',
  'no-matches': 'no-matches',
  'no-items': 'error',
  'no-items-path': 'error',
  'no-usable-items': 'error',
  'no-island': 'error',
  'island-not-json': 'error',
  truncated: 'error',
  malformed: 'error',
  'kind-mismatch': 'error',
  empty: 'error',
};

const healthOf = (spec: SourceSpec, result: ParseResult, at: Date): SourceHealthView => {
  const fetchedAt = at.toISOString();
  if (result.ok === false) {
    return {
      id: spec.id,
      label: spec.label,
      kind: spec.kind,
      url: spec.url,
      state: REASONS[result.reason] ?? 'error',
      lastStatus: 200,
      lastFetchAt: fetchedAt,
      lastChangeAt: null,
      itemCount: 0,
      expectedMatchCount: spec.matchCount ?? null,
      matchCount: result.matchCount,
      note: result.detail,
      cadenceMinutes: spec.cadenceMinutes,
      enabled: true,
    };
  }
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    url: spec.url,
    state: 'ok',
    lastStatus: 200,
    lastFetchAt: fetchedAt,
    lastChangeAt: fetchedAt,
    itemCount: result.items.length,
    expectedMatchCount: spec.matchCount ?? null,
    matchCount: result.matchCount,
    note: result.notes[result.notes.length - 1] ?? null,
    cadenceMinutes: spec.cadenceMinutes,
    enabled: true,
  };
};

const at = new Date();
const views: ItemView[] = [];
const sources: SourceHealthView[] = [];

for (const entry of entries) {
  const result = parsePayload(read(entry.fixture), entry.spec);
  sources.push(healthOf(entry.spec, result, at));
  if (result.ok === false) continue;
  for (const picked of result.items) views.push(viewOf(entry.spec, picked, at));
}

const withEdits = views.map((item, index) => (index % 17 === 3 && item.teaser.length > 60 ? markEdited(item) : item));
const withRead = withEdits.map((item, index) => (index % 4 === 0 ? { ...item, read: true } : item));

const stats: EditionStats = {
  items: withRead.length,
  newItems: withRead.filter((item) => item.editCount === 0).length,
  editedItems: withRead.filter((item) => item.editCount > 0).length,
  sourcesFetched: sources.length,
  sourcesUnhealthy: sources.filter((source) => source.state !== 'ok').length,
  cycles: 1,
};

/**
 * sourceId → the section the source declared. The server builds this same map
 * out of `sources/*.json`; core gives a declared section precedence over the
 * keyword ladder (`buildEdition`), which is the "topic select" the picker will
 * write into the source file.
 */
const declared = new Map<string, string>();
for (const entry of entries) {
  const label = entry.spec.section;
  if (label !== undefined) declared.set(entry.spec.id, label);
}

const config = defaultAppConfig();
const edition = buildEdition(
  editionIdFor(at, config.masthead.dayStartHour),
  at.toISOString(),
  new Intl.DateTimeFormat('en-US', { dateStyle: 'full' }).format(at),
  withRead,
  stats,
  declared,
);

const state: StateResponse = {
  masthead: {
    name: config.masthead.name,
    tagline: config.masthead.tagline,
    dayStartHour: config.masthead.dayStartHour,
    generatedAt: at.toISOString(),
  },
  edition,
  sources,
};

writeFileSync(new URL('state.json', import.meta.url), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
console.log(
  `dev fixture: ${String(withRead.length)} stories, ${String(stats.editedItems)} edited, ${String(sources.length)} sources from ${entries.length} captures`,
);
