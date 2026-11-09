/**
 * The assembler: rows in, wire out. These tests hand `editionOf` rows it read
 * from a real in-memory database and assert the `StateResponse` contract on
 * **every** case, because the shape is the whole point of the module.
 *
 * `now` and `dateline` are inputs, so the assertions are instants and literals,
 * never "the moment the test ran" (D-019). Sections, stats and health are in
 * `edition-health.test.ts`; events are in `edition-events.test.ts`.
 */

import { editionIdFor, emptyStats, itemViewSchema, type StoryTier, stateResponseSchema } from 'newspa-core';
import { describe, expect, it } from 'vitest';
import type { EditionInput } from '../src/edition.ts';
import { editionOf } from '../src/edition.ts';
import {
  addSnapshot,
  addSource,
  aMasthead,
  anHtmlSpec,
  anItemRecord,
  anRssSpec,
  aSnapshot,
  BODY_NEEDLE,
  build,
  DATELINE,
  DECK,
  emptyRows,
  FIXED,
  openDb,
  rowsOf,
  seeded,
  wireItem,
  wireItems,
} from './support.ts';

describe('the contract', () => {
  it('parses every shape: empty, seeded, and one with events and snapshots', () => {
    expect(stateResponseSchema.safeParse(editionOf(emptyRows())).success).toBe(true);

    const db = openDb();
    addSource(db, anRssSpec(), { health: 'blocked', note: '403', lastStatus: 403, lastPolledAt: FIXED.toISOString() });
    addSnapshot(db, aSnapshot());
    expect(stateResponseSchema.safeParse(editionOf(rowsOf(db))).success).toBe(true);
    expect(stateResponseSchema.safeParse(editionOf(rowsOf(db, { cycles: 42 }))).success).toBe(true);
    db.close();
  });

  it('prints an empty paper from an empty database', () => {
    const state = build(emptyRows());
    expect(state.sources).toEqual([]);
    expect(state.edition.sections).toEqual([]);
    expect(state.edition.lead).toBeNull();
    expect(state.edition.edited).toEqual([]);
    expect(state.edition.stats).toEqual(emptyStats());
    expect(state.edition.stats.items).toBe(0);
  });

  it('carries the masthead it was given, and an edition id built from its day start', () => {
    const state = build(emptyRows());
    expect(state.masthead).toEqual({
      name: 'The Weekly Ledger',
      tagline: 'As it happens, on your own machine',
      dayStartHour: 7,
      generatedAt: FIXED.toISOString(),
    });
    expect(state.edition.id).toBe(editionIdFor(FIXED, 7));
    expect(state.edition.generatedAt).toBe(FIXED.toISOString());
    // The dateline is the injected string, not a computed one: this file owns no language.
    expect(state.edition.dateline).toBe(DATELINE);

    const late = build(rowsOf(seeded([anRssSpec()]), { masthead: aMasthead({ dayStartHour: 23 }) }));
    expect(late.edition.id).toBe(editionIdFor(FIXED, 23));
    expect(late.masthead.dayStartHour).toBe(23);
  });
});

describe('the wire shape of an item', () => {
  it('carries the record’s own fields, and the source’s label', () => {
    const db = seeded(
      [anRssSpec()],
      [anItemRecord({ key: 'bbc:one', author: 'A. Reporter', image: 'https://i.example/a.png' })],
    );
    const view = wireItem(build(rowsOf(db)), 'bbc', 'bbc:one');
    expect(view).toMatchObject({
      key: 'bbc:one',
      sourceId: 'bbc',
      sourceLabel: 'BBC World',
      kind: 'rss',
      title: 'Central bank holds rates as inflation cools',
      link: 'https://bbc.example/a',
      publishedAt: '2026-11-09T06:00:00Z',
      author: 'A. Reporter',
      image: 'https://i.example/a.png',
      firstSeenAt: '2026-11-09T06:05:00Z',
      lastChangedAt: null,
      editCount: 0,
    });
    db.close();
  });

  it('labels each item with its own source, and keeps the item’s own kind', () => {
    const db = seeded(
      [anRssSpec(), anHtmlSpec()],
      [
        anItemRecord(),
        anItemRecord({ key: 'cards:1', sourceId: 'cards', kind: 'html', link: 'https://cards.example/1' }),
      ],
    );
    const state = build(rowsOf(db));
    expect(wireItem(state, 'bbc', 'bbc:h1').sourceLabel).toBe('BBC World');
    expect(wireItem(state, 'cards', 'cards:1').sourceLabel).toBe('Example Daily');
    expect(wireItem(state, 'cards', 'cards:1').kind).toBe('html');
    db.close();
  });

  it('falls back to the source id when the source row is gone, never a blank label', () => {
    const db = seeded([anRssSpec()], [anItemRecord()]);
    const state = build(rowsOf(db, { sources: [] }));
    expect(wireItem(state, 'bbc', 'bbc:h1').sourceLabel).toBe('bbc');
    db.close();
  });

  it('teases from the publisher’s deck, and drops a paywall prompt', () => {
    const db = seeded(
      [anRssSpec()],
      [
        anItemRecord({ key: 'bbc:deck', summary: DECK }),
        anItemRecord({ key: 'bbc:wall', summary: 'Click here to read the full story' }),
      ],
    );
    const state = build(rowsOf(db));
    expect(wireItem(state, 'bbc', 'bbc:deck').teaser).toBe(DECK);
    expect(wireItem(state, 'bbc', 'bbc:wall').teaser).toBe('');
    db.close();
  });
});

describe('no body on the wire (D-017)', () => {
  const withNeedle = (): ReturnType<typeof openDb> =>
    seeded(
      [anRssSpec()],
      [
        anItemRecord({
          key: 'bbc:leak',
          summary: DECK,
          body: `The bank kept rates unchanged. ${BODY_NEEDLE} It is stored evidence, not content.`,
        }),
      ],
    );

  it('never sends the stored body: the canary sentence is absent from the whole payload', () => {
    const db = withNeedle();
    const wire = JSON.stringify(build(rowsOf(db)));
    expect(wire.includes(BODY_NEEDLE), 'the stored body reached the wire').toBe(false);
    expect(wire.includes('Analysts had expected'), 'a body paragraph reached the wire').toBe(false);
    db.close();
  });

  it('emits no `body` key on any item, because the schema has none', () => {
    const db = withNeedle();
    const state = build(rowsOf(db));
    for (const item of wireItems(state)) expect(Object.keys(item), item.key).not.toContain('body');
    expect(Object.keys(itemViewSchema.shape)).not.toContain('body');
    db.close();
  });
});

describe('tiers from the stored score', () => {
  const TIERS: readonly { readonly score: number; readonly tier: StoryTier }[] = [
    { score: 12, tier: 'lead' },
    { score: 8, tier: 'front' },
    { score: 4.5, tier: 'section' },
    { score: 3, tier: 'brief' },
  ];

  const tierRows = (scores: readonly number[]): EditionInput => {
    const db = seeded(
      [anRssSpec()],
      scores.map((score, index) =>
        anItemRecord({
          key: `bbc:tier-${String(index)}`,
          summary: DECK,
          scoreRealtime: score,
          // Every row carries a digest score high enough to be a `lead`: if the
          // tier came from `scoreDigest`, the low rows would disagree.
          scoreDigest: 20,
        }),
      ),
    );
    const input = rowsOf(db);
    db.close();
    return input;
  };

  it('tiers on 12 / 8 / 4.5 and pins `score` to `scoreRealtime`', () => {
    const state = build(tierRows(TIERS.map((row) => row.score)));
    for (const [index, { score, tier }] of TIERS.entries()) {
      const view = wireItem(state, 'bbc', `bbc:tier-${String(index)}`);
      expect([view.score, view.tier], `scoreRealtime ${String(score)}`).toEqual([score, tier]);
    }
  });

  it('tiers just below each boundary one step lower', () => {
    const state = build(tierRows([11.99, 7.99, 4.49, 0]));
    expect(wireItems(state).map((item) => item.tier)).toEqual(['front', 'section', 'brief', 'brief']);
  });
});

describe('read markers', () => {
  it('reads `readAt` as read, and a null marker as unread', () => {
    const db = seeded(
      [anRssSpec()],
      [anItemRecord({ key: 'bbc:read', readAt: '2026-11-09T09:00:00Z' }), anItemRecord({ key: 'bbc:unread' })],
    );
    const state = build(rowsOf(db));
    expect(wireItem(state, 'bbc', 'bbc:read').read).toBe(true);
    expect(wireItem(state, 'bbc', 'bbc:unread').read).toBe(false);
    db.close();
  });
});
