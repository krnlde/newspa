/**
 * The composed read side: a **real** in-memory database (migrations, columns,
 * JSON columns, foreign keys), written through the repositories, then read back
 * by `stateOf`. Nothing here mocks a repository: the point of the file is that
 * the wire shape is built out of rows SQLite actually returned.
 *
 * Events, sections, stats, health and the read budget are in
 * `state-reads.test.ts`, which reads the same composed path.
 */

import { editionIdFor, emptyStats, type StateResponse, stateResponseSchema } from 'newspa-core';
import { CURRENT_VERSION, type Database, DEFAULT_ITEM_LIMIT, MAX_EVENT_LIMIT } from 'newspa-db';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE_EVENT_LIMIT, DEFAULT_STATE_ITEM_LIMIT, datelineFor, stateOf } from '../src/state.ts';
import {
  aConfig,
  addEvent,
  addItem,
  addSource,
  aMasthead,
  anEvent,
  anHtmlSpec,
  anItemRecord,
  anRssSpec,
  BODY_NEEDLE,
  bareDeps,
  DATELINE,
  DECK,
  FIXED,
  openDb,
  stateOfDb,
  wireItem,
  wireItems,
} from './support.ts';
import { countedDeps } from './supportReads.ts';

describe('the database behind the read side', () => {
  it('opens a migrated schema, so every row these tests write is a real row', () => {
    const db = openDb();
    expect(db.version).toBe(CURRENT_VERSION);
    expect(db.journalMode).toBe('memory');
    expect(stateOfDb(db).edition.stats.items).toBe(0);
    db.close();
  });
});

describe('an empty database', () => {
  it('is a valid `StateResponse` with an empty paper and the config’s masthead', () => {
    const db = openDb();
    const state = stateOfDb(db);
    expect(state.sources).toEqual([]);
    expect(state.edition.sections).toEqual([]);
    expect(state.edition.lead).toBeNull();
    expect(state.edition.edited).toEqual([]);
    expect(state.edition.stats).toEqual(emptyStats());
    expect(state.masthead).toEqual({
      name: 'The Weekly Ledger',
      tagline: 'As it happens, on your own machine',
      dayStartHour: 7,
      generatedAt: FIXED.toISOString(),
    });
    expect(state.edition.id).toBe(editionIdFor(FIXED, aConfig().masthead.dayStartHour));
    expect(state.edition.generatedAt).toBe(FIXED.toISOString());
    // The injected dateline travels to the wire: this path computes no string.
    expect(state.edition.dateline).toBe(DATELINE);
    db.close();
  });

  it('reads its own clock and builds its own dateline when nobody injects them', () => {
    const db = openDb();
    const state = stateResponseSchema.parse(stateOf(bareDeps(db)));
    expect(Number.isNaN(Date.parse(state.edition.generatedAt))).toBe(false);
    expect(state.edition.dateline).toMatch(/\d{4}/);
    expect(state.edition.dateline).not.toBe(DATELINE);
    expect(state.edition.id).toBe(editionIdFor(new Date(state.edition.generatedAt), aMasthead().dayStartHour));
    db.close();
  });
});

describe('no body on the wire (D-017)', () => {
  const leaking = (db: Database): void => {
    addSource(db, anRssSpec(), { health: 'ok', lastPolledAt: FIXED.toISOString() });
    addItem(
      db,
      anItemRecord({
        key: 'bbc:leak',
        summary: DECK,
        body: `The bank kept rates unchanged. ${BODY_NEEDLE} Analysts had expected a cut.`,
      }),
    );
    addEvent(db, anEvent({ itemKey: 'bbc:leak' }));
  };

  it('is the loud one: the canary is absent from the payload, and `bodyOf` never runs', () => {
    const db = openDb();
    leaking(db);
    const { deps, reads } = countedDeps(db);
    const wire = JSON.stringify(stateResponseSchema.parse(stateOf(deps)));
    expect(wire.includes(BODY_NEEDLE), 'the stored body reached the wire').toBe(false);
    expect(wire.includes('Analysts had expected'), 'a stored body paragraph reached the wire').toBe(false);
    expect(reads().bodyOf, 'state.ts read the stored body').toBe(0);
    expect(wireItem(JSON.parse(wire) as StateResponse, 'bbc', 'bbc:leak').teaser).toBe(DECK);
    db.close();
  });

  it('keeps the body in the database, where it is evidence and not content', () => {
    const db = openDb();
    leaking(db);
    expect(db.items.bodyOf('bbc', 'bbc:leak')).toContain(BODY_NEEDLE);
    expect(stateOfDb(db).edition.stats.items).toBe(1);
    db.close();
  });
});

describe('items on the wire', () => {
  it('labels each item with its own source’s label, and keeps its own kind', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addSource(db, anHtmlSpec());
    addItem(db, anItemRecord({ summary: DECK }));
    addItem(
      db,
      anItemRecord({ key: 'cards:1', sourceId: 'cards', kind: 'html', link: 'https://cards.example/1', summary: DECK }),
    );
    const state = stateOfDb(db);
    expect(wireItem(state, 'bbc', 'bbc:h1').sourceLabel).toBe('BBC World');
    expect(wireItem(state, 'cards', 'cards:1').sourceLabel).toBe('Example Daily');
    expect(wireItem(state, 'cards', 'cards:1').kind).toBe('html');
    db.close();
  });

  it('marks the read item read, and leaves the other unread', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    addItem(db, anItemRecord({ key: 'bbc:one', summary: DECK }));
    addItem(db, anItemRecord({ key: 'bbc:two', summary: DECK, link: 'https://bbc.example/b' }));
    db.items.setRead('bbc', 'bbc:one', '2026-11-09T09:00:00Z');
    const state = stateOfDb(db);
    expect(wireItem(state, 'bbc', 'bbc:one').read).toBe(true);
    expect(wireItem(state, 'bbc', 'bbc:two').read).toBe(false);
    db.close();
  });

  it('respects the item limit: three rows in the table, the page it was asked for on the wire', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    for (const key of ['bbc:a', 'bbc:b', 'bbc:c'])
      addItem(db, anItemRecord({ key, summary: DECK, link: `https://bbc.example/${key.slice(4)}` }));
    expect(db.items.count()).toBe(3);
    expect(stateOfDb(db, { itemLimit: 2 }).edition.stats.items).toBe(2);
    expect(wireItems(stateOfDb(db, { itemLimit: 2 }))).toHaveLength(2);
    expect(stateOfDb(db).edition.stats.items).toBe(3);
    db.close();
  });

  it('tiers from `scoreRealtime`, and never from `scoreDigest`', () => {
    const db = openDb();
    addSource(db, anRssSpec());
    const rows = [
      { key: 'bbc:lead', score: 12, digest: 0, tier: 'lead' },
      { key: 'bbc:front', score: 8, digest: 20, tier: 'front' },
      { key: 'bbc:section', score: 4.5, digest: 20, tier: 'section' },
      { key: 'bbc:brief', score: 3, digest: 20, tier: 'brief' },
    ] as const;
    for (const row of rows)
      addItem(
        db,
        anItemRecord({
          key: row.key,
          summary: DECK,
          link: `https://bbc.example/${row.key}`,
          scoreRealtime: row.score,
          scoreDigest: row.digest,
        }),
      );
    const state = stateOfDb(db);
    for (const row of rows) {
      const view = wireItem(state, 'bbc', row.key);
      expect([view.score, view.tier], row.key).toEqual([row.score, row.tier]);
    }
    db.close();
  });
});

describe('the clock, the dateline and the page', () => {
  it('defaults the page to the architecture’s budget, not SQLite’s ceiling', () => {
    expect(DEFAULT_STATE_ITEM_LIMIT).toBe(DEFAULT_ITEM_LIMIT);
    expect(DEFAULT_STATE_EVENT_LIMIT).toBe(MAX_EVENT_LIMIT);
  });

  it('formats the local zone by default, and a named zone when the masthead asks', () => {
    expect(datelineFor(FIXED, 'local')).toMatch(/\d{4}/);
    // Two named zones, one instant that is a different weekday in each.
    const nearMidnight = new Date('2026-11-09T23:30:00Z');
    expect(datelineFor(nearMidnight, 'Pacific/Kiritimati')).not.toBe(datelineFor(nearMidnight, 'Pacific/Pago_Pago'));
  });
});
