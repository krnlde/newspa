import { describe, expect, it } from 'vitest';
import type { ItemView } from '../src/api.ts';
import { buildEdition, emptyStats } from '../src/normalize.ts';
import { SECTION_IDS, sectionFor, sectionIdFor, sectionOf, sectionTitleFor } from '../src/sections.ts';
import { aView } from './views.ts';

/**
 * Where a story prints. A **declared** section (the reader's own words in
 * `sources/*.json`) wins; the keyword ladder routes everything else. The ladder
 * itself is pinned in `normalize.test.ts`, line by line, including the false
 * friends ("Ukraine talks" is not technology) — this file is about the two rules
 * that decide a heading: precedence and naming.
 */
const build = (items: readonly ItemView[], declared: ReadonlyMap<string, string> = new Map()) =>
  buildEdition('2026-11-09', '2026-11-09T07:00:00Z', 'Monday, November 9, 2026', items, emptyStats(), declared);

describe('sectionIdFor — the id of a label a reader typed', () => {
  it('slugs words, keeps digits, folds case', () => {
    expect(sectionIdFor('Iran')).toBe('iran');
    expect(sectionIdFor('Rail strikes')).toBe('rail-strikes');
    expect(sectionIdFor('AI releases 2026')).toBe('ai-releases-2026');
    expect(sectionIdFor('  Spaces  ')).toBe('spaces');
  });

  it('folds accents in the id and only in the id', () => {
    // The id is an address (`#section-quebec`); the title keeps the accents,
    // because the title is typography and the reader typed it.
    expect(sectionIdFor('Québec')).toBe('quebec');
    expect(sectionOf('Québec').title).toBe('Québec');
  });

  it('is the same section for one label spelled two ways', () => {
    expect(sectionIdFor('iran')).toBe(sectionIdFor('Iran'));
    expect(sectionIdFor('Tehran  daily')).toBe('tehran-daily');
  });

  it('falls back to `top` when the label has no ASCII letters', () => {
    expect(sectionIdFor('…')).toBe('top');
    expect(sectionIdFor('!!!')).toBe('top');
    expect(sectionIdFor('')).toBe('top');
  });

  it('is safe inside an id attribute', () => {
    for (const label of ['C++', 'Rust/wasm', 'Node.js LTS', 'Bölmeler', '  ---  ']) {
      expect(sectionIdFor(label)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe('sectionOf — the heading of a declared section', () => {
  it('prints the reader’s words, trimmed, and never a slug', () => {
    expect(sectionOf('Rail strikes')).toEqual({ id: 'rail-strikes', title: 'Rail strikes' });
    expect(sectionOf('  Iran  ')).toEqual({ id: 'iran', title: 'Iran' });
  });

  it('names an empty label after the catch-all, and points it at `top`', () => {
    expect(sectionOf('   ')).toEqual({ id: 'top', title: 'Top Stories' });
  });

  it('lists the built-ins in ladder order, each with a real title', () => {
    expect(SECTION_IDS).toEqual([
      'world',
      'politics',
      'business',
      'technology',
      'science',
      'sport',
      'culture',
      'opinion',
    ]);
    for (const id of SECTION_IDS) {
      const title = sectionTitleFor(id);
      expect(title.length > 0, id).toBe(true);
      expect(title, id).not.toBe(id);
    }
  });

  it('never puts a raw id on the page', () => {
    expect(sectionTitleFor('invented')).toBe('Top Stories');
    expect(sectionTitleFor('top')).toBe('Top Stories');
  });
});

describe('buildEdition — a declared section wins over the text', () => {
  const node = aView({
    sourceId: 'node',
    sourceLabel: 'Node.js releases',
    title: 'v25.4.0 (current) released',
    teaser: 'A new current release with security fixes.',
    score: 14,
  });
  const war = aView({
    sourceId: 'bbc',
    sourceLabel: 'BBC World',
    title: 'World affairs briefing',
    teaser: 'The foreign ministry spoke today.',
    score: 9,
  });

  it('routes a declared source by its declaration, not its words', () => {
    const edition = build([node], new Map([['node', 'Software']]));
    expect(edition.sections.map((s) => [s.id, s.title])).toEqual([['software', 'Software']]);
    // The ladder would have said `top`: the text has no keyword it matches.
    expect(sectionFor(`${node.title} ${node.teaser} ${node.sourceLabel}`)).toBe('top');
  });

  it('keeps an undeclared source on the ladder', () => {
    const edition = build([war]);
    expect(edition.sections.map((s) => [s.id, s.title])).toEqual([['world', 'World']]);
  });

  it('merges two sources that declared the same section, under the first spelling', () => {
    const ubuntu = aView({ sourceId: 'ubuntu', sourceLabel: 'Ubuntu Blog', title: 'Kernel notes', score: 8 });
    const edition = build(
      [node, ubuntu],
      new Map([
        ['node', 'Software'],
        ['ubuntu', 'software'],
      ]),
    );
    expect(edition.sections).toHaveLength(1);
    expect(edition.sections[0]?.items).toHaveLength(2);
    expect(edition.sections[0]?.title).toBe('Software');
  });

  it('lets a declared label take over a built-in bucket', () => {
    // Declaring `World` on a source with the same id as the ladder's `world`
    // prints one section, titled with the reader's words.
    const edition = build([war], new Map([['bbc', 'World news']]));
    expect(edition.sections.map((s) => [s.id, s.title])).toEqual([['world-news', 'World news']]);
  });

  it('orders sections by the score they carry, so an important source leads', () => {
    const edition = build(
      [node, war],
      new Map([
        ['node', 'Software'],
        ['bbc', 'World news'],
      ]),
    );
    expect(edition.sections.map((s) => s.id)).toEqual(['software', 'world-news']);
    // The lead is the highest score of the edition, whatever section it is in.
    expect(edition.lead?.sourceId).toBe('node');
  });

  it('defaults to no declarations, so an unlabelled archive still prints', () => {
    const edition = build([node, war]);
    expect(edition.sections.map((s) => s.id).sort()).toEqual(['top', 'world']);
  });
});
