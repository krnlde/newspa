import { z } from 'zod';
import type { StoryTier } from './types.ts';

/**
 * The wire contract between the server and the paper, defined once, in zod.
 * Inferring the TypeScript types from schemas is what keeps `EventSource`
 * honest: `JSON.parse` returns `unknown` here and every event is parsed before
 * the app sees it, so a malformed push is a typed failure, not a runtime crash.
 */

export const storyTierSchema = z.enum(['lead', 'front', 'section', 'brief']);

export const diffOpSchema = z.object({
  type: z.enum(['equal', 'insert', 'delete']),
  text: z.string(),
});

export const editReportSchema = z.object({
  ops: z.array(diffOpSchema),
  added: z.int().min(0),
  removed: z.int().min(0),
  similarity: z.number().min(0).max(1),
  meaningful: z.boolean(),
});

export const healthStateSchema = z.enum(['unknown', 'ok', 'blocked', 'no-matches', 'restructured', 'error', 'stale']);

export const sourceKindSchema = z.enum(['rss', 'html', 'json']);

export const itemViewSchema = z.object({
  key: z.string(),
  sourceId: z.string(),
  sourceLabel: z.string(),
  kind: sourceKindSchema,
  title: z.string(),
  /** The story's own URL. The paper links out to this in a new tab; it never renders `body`. */
  link: z.string(),
  /** Headline + one paragraph, computed on the server. This is the whole content the paper shows. */
  teaser: z.string(),
  /** Hero image picked from the source (og:image / enclosure / media:content). Null when the source has none. */
  image: z.string().nullable(),
  publishedAt: z.string().nullable(),
  author: z.string().nullable(),
  firstSeenAt: z.string(),
  lastChangedAt: z.string().nullable(),
  editCount: z.int().min(0),
  score: z.number(),
  tier: storyTierSchema,
  read: z.boolean(),
  lastEventKind: z.enum(['new', 'edited', 'gone']).nullable(),
  lastEventAt: z.string().nullable(),
  /**
   * Word diff of the **teaser** fields (title + deck), not of the article body:
   * the paper shows what changed in the words it displays, and full text stays
   * in the database.
   */
  lastReport: editReportSchema.nullable(),
});

export const sourceHealthViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: sourceKindSchema,
  url: z.string(),
  state: healthStateSchema,
  lastStatus: z.int().nullable(),
  lastFetchAt: z.string().nullable(),
  lastChangeAt: z.string().nullable(),
  itemCount: z.int().min(0),
  expectedMatchCount: z.int().min(0).nullable(),
  matchCount: z.int().min(0).nullable(),
  note: z.string().nullable(),
  cadenceMinutes: z.int().min(1),
  enabled: z.boolean(),
});

export const editionSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  blurb: z.string().nullable(),
  items: z.array(itemViewSchema),
});

export const editionStatsSchema = z.object({
  items: z.int().min(0),
  newItems: z.int().min(0),
  editedItems: z.int().min(0),
  sourcesFetched: z.int().min(0),
  sourcesUnhealthy: z.int().min(0),
  cycles: z.int().min(0),
});

export const editionSchema = z.object({
  id: z.string(),
  generatedAt: z.string(),
  dateline: z.string(),
  lead: itemViewSchema.nullable(),
  sections: z.array(editionSectionSchema),
  edited: z.array(itemViewSchema),
  stats: editionStatsSchema,
});

export const mastheadViewSchema = z.object({
  name: z.string(),
  tagline: z.string(),
  dayStartHour: z.int().min(0).max(23),
  generatedAt: z.string(),
});

export const stateResponseSchema = z.object({
  masthead: mastheadViewSchema,
  edition: editionSchema,
  sources: z.array(sourceHealthViewSchema),
});

export const itemsQuerySchema = z.object({
  sourceId: z.string().optional(),
  q: z.string().optional(),
  since: z.string().optional(),
  limit: z.int().min(1).max(200).default(100),
  cursor: z.string().optional(),
});

export const itemsResponseSchema = z.object({
  items: z.array(itemViewSchema),
  nextCursor: z.string().nullable(),
  total: z.int().min(0).nullable(),
});

export const editionsResponseSchema = z.object({
  editions: z.array(z.object({ id: z.string(), dateline: z.string(), items: z.int().min(0) })),
});

export const addSourceRequestSchema = z.object({
  /** Raw file text. The server validates with the config schema so the web app
   *  never needs a second copy of the source schema. */
  text: z.string().min(2),
  filename: z.string().min(1).max(80).optional(),
});

export const addSourceResponseSchema = z.object({
  ok: z.boolean(),
  file: z.string().nullable(),
  messages: z.array(z.string()),
});

/** Server → paper. Discriminated so a new event type cannot be silently mishandled. */
export const serverEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cycle:start'), at: z.string() }),
  z.object({
    type: z.literal('cycle:done'),
    at: z.string(),
    fetched: z.int().min(0),
    newItems: z.int().min(0),
    editedItems: z.int().min(0),
  }),
  z.object({
    type: z.literal('item:new'),
    at: z.string(),
    sourceId: z.string(),
    title: z.string(),
    link: z.string(),
    score: z.number(),
  }),
  z.object({
    type: z.literal('item:edited'),
    at: z.string(),
    sourceId: z.string(),
    title: z.string(),
    link: z.string(),
    added: z.int().min(0),
    removed: z.int().min(0),
  }),
  z.object({
    type: z.literal('source:health'),
    at: z.string(),
    source: z.string(),
    state: healthStateSchema,
    note: z.string().nullable(),
  }),
  z.object({ type: z.literal('edition:updated'), at: z.string(), edition: z.string() }),
]);

export type ItemView = z.infer<typeof itemViewSchema>;
export type SourceHealthView = z.infer<typeof sourceHealthViewSchema>;
export type EditionSection = z.infer<typeof editionSectionSchema>;
export type EditionStats = z.infer<typeof editionStatsSchema>;
export type Edition = z.infer<typeof editionSchema>;
export type MastheadView = z.infer<typeof mastheadViewSchema>;
export type StateResponse = z.infer<typeof stateResponseSchema>;
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;
export type ItemsResponse = z.infer<typeof itemsResponseSchema>;
export type EditionsResponse = z.infer<typeof editionsResponseSchema>;
export type AddSourceRequest = z.infer<typeof addSourceRequestSchema>;
export type AddSourceResponse = z.infer<typeof addSourceResponseSchema>;
export type DiffOpView = z.infer<typeof diffOpSchema>;
export type EditReportView = z.infer<typeof editReportSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;

/** Narrowing happens on the wire: `unknown` in, typed event out, or a reason. */
export const parseServerEvent = (data: string): { ok: true; event: ServerEvent } | { ok: false; message: string } => {
  let json: unknown;
  try {
    json = JSON.parse(data) as unknown;
  } catch (cause) {
    return { ok: false, message: cause instanceof Error ? cause.message : 'not json' };
  }
  const parsed = serverEventSchema.safeParse(json);
  return parsed.success
    ? { ok: true, event: parsed.data }
    : { ok: false, message: parsed.error.issues[0]?.message ?? 'schema mismatch' };
};

export type { StoryTier };
