import { describe, expect, it } from 'vitest';
import type { EditionStats } from '../src/api.ts';
import { buildEdition, emptyStats } from '../src/normalize.ts';
import { sectionFor, sectionTitleFor } from '../src/sections.ts';
import { aView } from './views.ts';

const stats = (over: Partial<EditionStats> = {}): EditionStats => ({ ...emptyStats(), ...over });

const build = (items: readonly ReturnType<typeof aView>[], statsInput: EditionStats = emptyStats()) =>
  buildEdition('2026-11-09', '2026-11-09T07:00:00Z', 'Monday, November 9, 2026', items, statsInput);

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

  it('orders sections by the summed score of their items', () => {
    const edition = build([
      aView({ key: 'big', title: 'Market report for the week', score: 5 }),
      aView({ key: 'bigger', title: 'Market open higher', score: 6 }),
      aView({ key: 'single', title: 'Election results declared', score: 9 }),
    ]);
    expect(edition.sections.map((section) => `${section.id}:${section.items.length}`)).toEqual([
      'business:2',
      'politics:1',
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
