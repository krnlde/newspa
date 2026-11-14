import { describe, expect, it } from 'vitest';
import type { EditionStats } from '../src/api.ts';
import { buildEdition, emptyStats } from '../src/edition.ts';
import { sectionFor, sectionTitleFor } from '../src/sections.ts';
import { aView } from './views.ts';

const stats = (over: Partial<EditionStats> = {}): EditionStats => ({ ...emptyStats(), ...over });

const build = (
  items: readonly ReturnType<typeof aView>[],
  statsInput: EditionStats = emptyStats(),
  fresh?: Parameters<typeof buildEdition>[6],
) =>
  buildEdition('2026-11-09', '2026-11-09T07:00:00Z', 'Monday, November 9, 2026', items, statsInput, new Map(), fresh);

describe('emptyStats', () => {
  it('is all zeros, not undefined', () => {
    expect(emptyStats()).toEqual({
      items: 0,
      newItems: 0,
      editedItems: 0,
      sourcesFetched: 0,
      sourcesUnhealthy: 0,
      cycles: 0,
    });
  });
});

describe('sectionFor', () => {
  it('routes on the subject words it declares', () => {
    expect(sectionFor('Market report for the week')).toBe('business');
    expect(sectionFor('Election results declared')).toBe('politics');
    expect(sectionFor('New AI model benchmarks')).toBe('technology');
    expect(sectionFor('Science and health roundup')).toBe('science');
    expect(sectionFor('Culture night at the museum')).toBe('culture');
    expect(sectionFor('World affairs briefing')).toBe('world');
    expect(sectionFor('Editorial: the mayor must go')).toBe('opinion');
    expect(sectionFor('Sport: league fixtures')).toBe('sport');
  });

  it('falls back to the id the caller asks for', () => {
    expect(sectionFor('nothing relevant here')).toBe('top');
    expect(sectionFor('nothing relevant here', 'feed')).toBe('feed');
  });
});

describe('sectionTitleFor', () => {
  it('names the sections for print', () => {
    expect(sectionTitleFor('technology')).toBe('Technology');
    expect(sectionTitleFor('science')).toBe('Science & Health');
    expect(sectionTitleFor('top')).toBe('Top Stories');
    expect(sectionTitleFor('invented')).toBe('Top Stories');
  });
});

describe('buildEdition', () => {
  it('puts the highest-scoring story in the lead slot', () => {
    const edition = build([
      aView({ key: 'k1', title: 'New AI model benchmarks', score: 6 }),
      aView({ key: 'k2', title: 'Election results declared', score: 14 }),
    ]);
    expect(edition.lead?.key).toBe('k2');
    expect(edition.id).toBe('2026-11-09');
    expect(edition.dateline).toBe('Monday, November 9, 2026');
    expect(edition.generatedAt).toBe('2026-11-09T07:00:00Z');
  });

  it('breaks a score tie by the newest publication', () => {
    const edition = build([
      aView({ key: 'older', title: 'Election results declared', score: 10, publishedAt: '2026-11-09T05:00:00Z' }),
      aView({ key: 'newer', title: 'Election results certified', score: 10, publishedAt: '2026-11-09T07:00:00Z' }),
    ]);
    expect(edition.lead?.key).toBe('newer');
    expect(edition.sections[0]?.items.map((item) => item.key)).toEqual(['newer', 'older']);
  });

  it('routes a section from the title, the teaser and the source label together', () => {
    const edition = build([
      aView({ key: 'from-title', title: 'Election results declared', teaser: '', score: 9 }),
      aView({
        key: 'from-teaser',
        title: 'Notebook notes',
        teaser: 'A market report lands.',
        score: 2,
        sourceLabel: 'S',
      }),
      aView({ key: 'from-label', title: 'Notebook notes', teaser: '', score: 1, sourceLabel: 'Business Desk' }),
    ]);
    expect(edition.sections.map((section) => section.id)).toEqual(['politics', 'business']);
    expect(edition.sections[1]?.items.map((item) => item.key)).toEqual(['from-teaser', 'from-label']);
  });

  it('orders sections by the rank of their strongest story, not by a summed score', () => {
    // Summing let a pile of mid stories outrank one strong one (the archive effect
    // D-048 removes); the section that leads the page is the one with the best news.
    const edition = build([
      aView({ key: 'big', title: 'Market report for the week', score: 5 }),
      aView({ key: 'bigger', title: 'Market open higher', score: 6 }),
      aView({ key: 'single', title: 'Election results declared', score: 9 }),
    ]);
    expect(edition.sections.map((section) => `${section.id}:${section.items.length}`)).toEqual([
      'politics:1',
      'business:2',
    ]);
  });

  it('takes the section blurb from the section lead teaser', () => {
    const edition = build([
      aView({ key: 'k1', title: 'Election results declared', teaser: 'The count finished late.', score: 9 }),
      aView({ key: 'k2', title: 'Election results certified', teaser: 'Certified on Friday.', score: 4 }),
    ]);
    expect(edition.sections[0]?.title).toBe('Politics');
    expect(edition.sections[0]?.blurb).toBe('The count finished late.');
  });

  it('is an empty blurb when the section lead has no deck, which is not a null', () => {
    const edition = build([aView({ key: 'k9', title: 'Election results declared', teaser: '', score: 1 })]);
    expect(edition.sections[0]?.blurb).toBe('');
  });

  it('lists as edited only the items that were edited', () => {
    const edition = build([
      aView({ key: 'quiet', title: 'Election results declared', score: 10, editCount: 0 }),
      aView({ key: 'edited-low', title: 'Market report for the week', score: 3, editCount: 1 }),
      aView({ key: 'edited-high', title: 'Market open higher', score: 8, editCount: 4 }),
    ]);
    expect(edition.edited.map((item) => item.key)).toEqual(['edited-high', 'edited-low']);
  });

  it('passes the stats through untouched', () => {
    const edition = build(
      [aView()],
      stats({ items: 12, newItems: 3, editedItems: 1, sourcesFetched: 8, sourcesUnhealthy: 2, cycles: 40 }),
    );
    expect(edition.stats).toEqual({
      items: 12,
      newItems: 3,
      editedItems: 1,
      sourcesFetched: 8,
      sourcesUnhealthy: 2,
      cycles: 40,
    });
  });

  it('prints an empty paper without inventing a lead', () => {
    const edition = build([]);
    expect(edition.lead).toBeNull();
    expect(edition.sections).toEqual([]);
    expect(edition.edited).toEqual([]);
    expect(edition.stats).toEqual(emptyStats());
  });
});

/**
 * D-048, measured on the live paper (2026-11-14): the title page printed
 * 5-day-old stories and a month-old page-sighting, because the score's age term
 * (max 4, additive) lost to source weights worth 6 and 10, and a section printed
 * its whole archive (102 items). The law: age **multiplies** the score, the lead
 * and the rails print only fresh items, and a section prints a cap's worth.
 */
describe('buildEdition — the freshness law (D-048)', () => {
  const old = (over: Parameters<typeof aView>[0]): ReturnType<typeof aView> =>
    aView({ publishedAt: '2026-11-04T07:00:00Z', ...over }); // 120 h before generatedAt

  it('gives the lead to the fresher story when age multiplies the score', () => {
    // The measured case: a 12-point story from five days ago against a 6-point
    // story from an hour ago. Old law: the old one leads. New law: the news leads.
    const edition = build([
      old({ key: 'stale', title: 'A tariff story, five days on', score: 12 }),
      aView({ key: 'fresh', title: 'The market closes higher', score: 6 }),
    ]);
    expect(edition.lead?.key).toBe('fresh');
  });

  it('a page-mode sighting from last month cannot lead, and leaves the rail', () => {
    // The Ubuntu Blog case from the screenshot: one item per page, its "date" is
    // the sighting, and the card read `BY CANONICAL · LAST MONTH` **above the fold**.
    const edition = build([
      aView({
        key: 'ubuntu:page',
        title: 'Canonical releases Ubuntu 26.10',
        score: 14,
        publishedAt: null,
        firstSeenAt: '2026-10-09T07:00:00Z',
      }),
      aView({ key: 'today', title: 'Election results declared', score: 5 }),
    ]);
    expect(edition.lead?.key).toBe('today');
    const world = edition.sections.find((section) => section.items.some((item) => item.key === 'ubuntu:page'));
    expect(world?.rail.map((item) => item.key)).not.toContain('ubuntu:page');
    expect(world?.items.map((item) => item.key)).toContain('ubuntu:page');
    expect(world?.items.at(-1)?.key).toBe('ubuntu:page');
  });

  it('prints the freshest of the stale when nothing is fresh — never an empty front page', () => {
    // Rule 5: a page of nothing is a silent zero. The age on the card says the truth.
    const edition = build([
      old({ key: 'stale-much', title: 'Election results declared', score: 14, publishedAt: '2026-11-01T07:00:00Z' }),
      old({ key: 'stale-less', title: 'Market report for the week', score: 4 }),
    ]);
    expect(edition.lead?.key).toBe('stale-less');
    const rails = edition.sections.flatMap((section) => section.rail);
    expect(rails).toEqual([]);
  });

  it('gates the rail at the knob, and keeps the older items in the section', () => {
    const edition = build(
      [
        aView({ key: 'fresh', title: 'Election results declared', score: 9 }),
        aView({ key: 'mid', title: 'Election results audited', score: 8, publishedAt: '2026-11-08T07:00:00Z' }),
        old({ key: 'stale', title: 'Election results archived', score: 7 }),
      ],
      emptyStats(),
      { maxAgeHours: 36, halfLifeHours: 24, sectionMaxItems: 12 },
    );
    const politics = edition.sections[0];
    expect(politics?.rail.map((item) => item.key)).toEqual(['fresh', 'mid']);
    expect(politics?.items.map((item) => item.key)).toEqual(['fresh', 'mid', 'stale']);
  });

  it('caps a section at the knob, newest-ranked first', () => {
    const many = Array.from({ length: 20 }, (_unused, index) =>
      aView({
        key: `m${String(index)}`,
        title: 'Market report for the week',
        score: 12,
        publishedAt: `2026-11-09T0${String(6 - Math.floor(index / 4))}:0${String(index % 10)}:00Z`,
      }),
    );
    const edition = build(many, emptyStats(), { maxAgeHours: 36, halfLifeHours: 24, sectionMaxItems: 12 });
    const business = edition.sections[0];
    expect(business?.items).toHaveLength(12);
    const ages = business?.items.map((item) => Date.parse(item.publishedAt ?? '')) ?? [];
    expect([...ages].sort((a, b) => b - a)).toEqual(ages);
    // The rail is gated **and** short: the wire carries what the page can print
    // (four slots plus the room the lead takes), not the section's whole fresh set.
    expect(business?.rail).toHaveLength(5);
    expect(business?.rail.map((item) => item.key)).toEqual(business?.items.slice(0, 5).map((item) => item.key));
  });

  it('leaves the tier of the stored score alone: only placement decays', () => {
    const edition = build([old({ key: 'stale', title: 'A tariff story, five days on', score: 12 })]);
    expect(edition.lead?.tier).toBe('lead'); // its standing on the row
    expect(edition.lead?.score).toBe(12); // the stored score, undecayed
    // Its placement is the decayed story: it is the lead only because nothing is fresh.
  });

  it('defaults the knobs: 36 h gate, 24 h half-life, 12 items', () => {
    const edition = build([
      aView({ key: 'gate', title: 'Election results declared', score: 20, publishedAt: '2026-11-09T06:00:00Z' }),
      // 37 h: one hour past the default gate, and out of the title page.
      aView({ key: 'past', title: 'Election results audited', score: 20, publishedAt: '2026-11-07T18:00:00Z' }),
    ]);
    expect(edition.lead?.key).toBe('gate');
    expect(edition.sections[0]?.rail.map((item) => item.key)).toEqual(['gate']);
  });
});
