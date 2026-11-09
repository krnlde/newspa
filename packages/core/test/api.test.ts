import { describe, expect, it } from 'vitest';
import {
  addSourceRequestSchema,
  addSourceResponseSchema,
  diffOpSchema,
  editionSchema,
  editionStatsSchema,
  editionsResponseSchema,
  editReportSchema,
  healthStateSchema,
  itemsQuerySchema,
  itemsResponseSchema,
  itemViewSchema,
  mastheadViewSchema,
  sourceHealthViewSchema,
  sourceKindSchema,
  stateResponseSchema,
  storyTierSchema,
} from '../src/api.ts';
import { buildEdition, emptyStats } from '../src/normalize.ts';
import { aView } from './views.ts';

describe('itemViewSchema', () => {
  it('has no body field: the paper is an index, not a mirror', () => {
    const fields = Object.keys(itemViewSchema.shape);
    expect(fields).not.toContain('body');
    expect(fields).toEqual([
      'key',
      'sourceId',
      'sourceLabel',
      'kind',
      'title',
      'link',
      'teaser',
      'image',
      'publishedAt',
      'author',
      'firstSeenAt',
      'lastChangedAt',
      'editCount',
      'score',
      'tier',
      'read',
      'lastEventKind',
      'lastEventAt',
      'lastReport',
    ]);
  });

  it('strips a smuggled body instead of passing it through', () => {
    const parsed = itemsResponseSchema.parse({
      items: [{ ...aView(), body: 'the whole article, 4000 words' }],
      nextCursor: null,
      total: 1,
    });
    const first = parsed.items[0];
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {})).not.toContain('body');
    expect(parsed.items[0]?.teaser).toBe('The bank kept rates unchanged.');
  });

  it('accepts a wire item and requires the fields the paper prints', () => {
    expect(itemViewSchema.safeParse(aView()).success).toBe(true);
    expect(itemViewSchema.safeParse({ ...aView(), teaser: undefined }).success).toBe(false);
    expect(itemViewSchema.safeParse({ ...aView(), kind: 'atom' }).success).toBe(false);
    expect(itemViewSchema.safeParse({ ...aView(), tier: 'headline' }).success).toBe(false);
    expect(itemViewSchema.safeParse({ ...aView(), editCount: -1 }).success).toBe(false);
  });
});

describe('itemsQuerySchema', () => {
  it('defaults limit to 100', () => {
    expect(itemsQuerySchema.parse({})).toEqual({ limit: 100 });
  });

  it('bounds limit to 1..200 and keeps it an integer', () => {
    for (const [limit, ok] of [
      [0, false],
      [1, true],
      [200, true],
      [201, false],
      [1.5, false],
    ] as const) {
      expect(itemsQuerySchema.safeParse({ limit }).success, String(limit)).toBe(ok);
    }
  });

  it('passes the filters through untouched', () => {
    expect(itemsQuerySchema.parse({ sourceId: 'bbc', q: 'rates', since: '2026-11-01', limit: 5, cursor: 'c' })).toEqual(
      {
        sourceId: 'bbc',
        q: 'rates',
        since: '2026-11-01',
        limit: 5,
        cursor: 'c',
      },
    );
  });
});

describe('view schemas', () => {
  const masthead = { name: 'The Daily', tagline: 'Own news', dayStartHour: 7, generatedAt: '2026-11-09T07:00:00Z' };

  it('keeps dayStartHour inside a day', () => {
    expect(mastheadViewSchema.safeParse(masthead).success).toBe(true);
    expect(mastheadViewSchema.safeParse({ ...masthead, dayStartHour: 24 }).success).toBe(false);
    expect(mastheadViewSchema.safeParse({ ...masthead, dayStartHour: -1 }).success).toBe(false);
  });

  it('requires a positive cadence and non-negative counts on a health view', () => {
    const view = {
      id: 'bbc',
      label: 'BBC',
      kind: 'rss',
      url: 'https://bbc.example/rss',
      state: 'ok',
      lastStatus: 200,
      lastFetchAt: null,
      lastChangeAt: null,
      itemCount: 12,
      expectedMatchCount: null,
      matchCount: null,
      note: null,
      cadenceMinutes: 20,
      enabled: true,
    };
    expect(sourceHealthViewSchema.safeParse(view).success).toBe(true);
    expect(sourceHealthViewSchema.safeParse({ ...view, cadenceMinutes: 0 }).success).toBe(false);
    expect(sourceHealthViewSchema.safeParse({ ...view, itemCount: -1 }).success).toBe(false);
    expect(sourceHealthViewSchema.safeParse({ ...view, state: 'shrugging' }).success).toBe(false);
  });

  it('accepts a built edition as wire-valid', () => {
    const edition = buildEdition(
      '2026-11-09',
      '2026-11-09T07:00:00Z',
      'Monday, November 9, 2026',
      [aView()],
      emptyStats(),
    );
    expect(editionSchema.safeParse(edition).success).toBe(true);
    expect(editionSchema.safeParse({ ...edition, lead: null }).success).toBe(true);
    expect(editionSchema.safeParse({ ...edition, stats: { ...edition.stats, cycles: -1 } }).success).toBe(false);
  });

  it('composes the full state response', () => {
    const edition = buildEdition(
      '2026-11-09',
      '2026-11-09T07:00:00Z',
      'Monday, November 9, 2026',
      [aView()],
      emptyStats(),
    );
    const sources = [
      {
        id: 'bbc',
        label: 'BBC',
        kind: 'rss',
        url: 'https://bbc.example/rss',
        state: 'ok',
        lastStatus: 200,
        lastFetchAt: null,
        lastChangeAt: null,
        itemCount: 12,
        expectedMatchCount: null,
        matchCount: null,
        note: null,
        cadenceMinutes: 20,
        enabled: true,
      },
    ];
    expect(stateResponseSchema.safeParse({ masthead, edition, sources }).success).toBe(true);
    expect(stateResponseSchema.safeParse({ masthead, edition, sources: [] }).success).toBe(true);
  });

  it('declares the enums the paper switches on', () => {
    expect(healthStateSchema.options).toEqual([
      'unknown',
      'ok',
      'blocked',
      'no-matches',
      'restructured',
      'error',
      'stale',
    ]);
    expect(storyTierSchema.options).toEqual(['lead', 'front', 'section', 'brief']);
    expect(sourceKindSchema.options).toEqual(['rss', 'html', 'json']);
    expect(diffOpSchema.shape.type.options).toEqual(['equal', 'insert', 'delete']);
  });

  it('validates an edit report against the diff, not the article', () => {
    expect(
      editReportSchema.safeParse({
        ops: [{ type: 'equal', text: 'a ' }],
        added: 0,
        removed: 0,
        similarity: 1,
        meaningful: false,
      }).success,
    ).toBe(true);
    expect(
      editReportSchema.safeParse({ ops: [], added: -1, removed: 0, similarity: 2, meaningful: 'yes' }).success,
    ).toBe(false);
  });

  it('keeps stats non-negative', () => {
    expect(editionStatsSchema.safeParse(emptyStats()).success).toBe(true);
    expect(editionStatsSchema.safeParse({ ...emptyStats(), newItems: -1 }).success).toBe(false);
  });

  it('lists editions', () => {
    expect(
      editionsResponseSchema.safeParse({ editions: [{ id: '2026-11-09', dateline: 'D', items: 3 }] }).success,
    ).toBe(true);
    expect(
      editionsResponseSchema.safeParse({ editions: [{ id: '2026-11-09', dateline: 'D', items: -1 }] }).success,
    ).toBe(false);
  });

  it('requires file text, and an optional filename that fits a path', () => {
    expect(addSourceRequestSchema.safeParse({ text: 'ab' }).success).toBe(true);
    expect(addSourceRequestSchema.safeParse({ text: 'a' }).success).toBe(false);
    expect(addSourceRequestSchema.safeParse({ text: 'ab', filename: 'x'.repeat(81) }).success).toBe(false);
    expect(addSourceResponseSchema.safeParse({ ok: true, file: 'bbc.json', messages: [] }).success).toBe(true);
    expect(addSourceResponseSchema.safeParse({ ok: true, file: null, messages: ['nope'] }).success).toBe(true);
    expect(addSourceResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });
});
