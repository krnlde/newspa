import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { EditionStats, HealthState } from 'newspa-core';
import type { PaperLabels } from 'newspa-paper';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { initI18n } from '../../src/i18n/index.ts';
import { paperLabelsOf } from '../../src/labels.ts';
import { useLocale } from '../../src/lib/useLocale.ts';
import { localeFor } from './support/locale.ts';

/**
 * The one place the app assembles strings (D-019), so two things are worth
 * pinning:
 *
 * - `count` is the **raw number** and `value` is the **`Intl` string**. i18next
 *   needs the number to pick the plural form; the reader needs `Intl`'s
 *   grouping. A file that passed the formatted string as `count` would never
 *   select `_one`, and would print English grouping in German.
 * - nothing reaches the paper empty: every `HealthState` has a word (rule 5),
 *   and the stats line is a join of the parts that exist, not a template with
 *   a hole in it.
 */

/** Every state core can report — the paper must have a distinct word for each. */
const HEALTH_STATES = [
  'ok',
  'blocked',
  'no-matches',
  'restructured',
  'error',
  'stale',
  'unknown',
] as const satisfies readonly HealthState[];

type SpyT = Mock<(key: string, options?: Record<string, unknown>) => string>;

const spyT = (): SpyT => vi.fn((key: string, _options?: Record<string, unknown>): string => key);

/** The spy at the `TFunction` boundary: i18next's real signature is a wall of
 * generics, and the only part of it `labels.ts` uses is key + options. */
const tOf = (spy: SpyT): TFunction => spy as unknown as TFunction;

const lastKey = (spy: SpyT): string => {
  const key = spy.mock.calls.at(-1)?.[0];
  if (key === undefined) throw new Error('`t` was never called');
  return key;
};

/** The options object of the last call — what carries `count` and `value`. */
const lastOptions = (spy: SpyT): Record<string, unknown> => {
  const options = spy.mock.calls.at(-1)?.[1];
  if (options === undefined) throw new Error(`\`${lastKey(spy)}\` was called with no options`);
  return options as Record<string, unknown>;
};

const statsOf = (over: Partial<EditionStats> = {}): EditionStats => ({
  items: 1234,
  newItems: 3,
  editedItems: 1,
  sourcesFetched: 5,
  sourcesUnhealthy: 0,
  cycles: 12,
  ...over,
});

/** The pair the app builds at its only call site: i18next's `t` and the locale
 * seam, both from hooks, so the strings are the real catalogue and real `Intl`. */
const LabelsProbe = (): PaperLabels => paperLabelsOf(useTranslation().t, useLocale());

const labelsIn = async (language: string): Promise<PaperLabels> => {
  await initI18n({ language });
  return renderHook(LabelsProbe).result.current;
};

describe('the counted strings', () => {
  it('hands i18next the raw number as `count` and `Intl` as `value`', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('de'));
    labels.health.allWell(1234);
    expect(lastKey(spy)).toBe('paper.health.allWell');
    expect(lastOptions(spy)).toStrictEqual({ count: 1234, value: '1.234' });
    labels.health.cadence(20);
    expect(lastOptions(spy)).toStrictEqual({ count: 20, value: '20' });
    labels.health.items(1234);
    expect(lastOptions(spy)).toStrictEqual({ count: 1234, value: '1.234' });
  });

  it('keeps `count` a number, because a string never selects a plural form', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('de'));
    labels.health.allWell(1_234_567);
    const options = lastOptions(spy);
    // Bracket access: `Record<string, unknown>` is an index signature.
    expect(options['count']).toBe(1_234_567);
    expect(typeof options['count']).toBe('number');
    expect(typeof options['value']).toBe('string');
    expect(options['value']).toBe('1.234.567');
  });

  it('counts the stats line the same way, for every number in it', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('en'));
    labels.stats(statsOf({ sourcesUnhealthy: 2 }));
    // `paperLabelsOf` asks for the plain keys as it is built, so the stats line
    // is the calls it made *with* numbers, in order.
    expect(
      spy.mock.calls.filter((call) => String(call[0]).startsWith('paper.stats.')).map((call) => [call[0], call[1]]),
    ).toEqual([
      ['paper.stats.items', { count: 1234, value: '1,234' }],
      ['paper.stats.new', { count: 3, value: '3' }],
      ['paper.stats.edited', { count: 1, value: '1' }],
      ['paper.stats.sources', { count: 5, value: '5' }],
      ['paper.stats.unhealthy', { count: 2, value: '2' }],
    ]);
  });

  it('formats both numbers of the edit summary, with `count` for the plural', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('de'));
    labels.editSummary(1234, 5);
    expect(lastKey(spy)).toBe('paper.editSummary');
    expect(lastOptions(spy)).toStrictEqual({ count: 1234, added: '1.234', removed: '5' });
  });

  it('formats the rot line through `Intl` on both sides', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('en'));
    labels.health.matches(0, 1234);
    expect(lastKey(spy)).toBe('paper.health.matches');
    expect(lastOptions(spy)).toStrictEqual({ seen: '0', expected: '1,234' });
  });

  it('interpolates the age, the source and the author as words, not numbers', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('de'));
    labels.health.lastPoll('vor 3 Stunden');
    expect(lastOptions(spy)).toStrictEqual({ ago: 'vor 3 Stunden' });
    labels.opensInNewTab('BBC');
    expect(lastKey(spy)).toBe('paper.opensInNewTab');
    expect(lastOptions(spy)).toStrictEqual({ source: 'BBC' });
    labels.byline('Ann Example');
    expect(lastKey(spy)).toBe('paper.byline');
    expect(lastOptions(spy)).toStrictEqual({ author: 'Ann Example' });
  });

  it('asks for the plain keys with no options', () => {
    const spy = spyT();
    const labels = paperLabelsOf(tOf(spy), localeFor('en'));
    expect(labels.newKicker).toBe('paper.kicker.new');
    expect(labels.editedKicker).toBe('paper.kicker.edited');
    expect(labels.goneKicker).toBe('paper.kicker.gone');
    expect(labels.editedHeadline).toBe('paper.edited.headline');
    expect(labels.health.headline).toBe('paper.health.headline');
    expect(labels.health.neverFetched).toBe('paper.health.neverFetched');
    expect(spy.mock.calls.every((call) => call[1] === undefined)).toBe(true);
  });
});

describe('the strings the reader sees', () => {
  it('selects the plural with `count` and prints the number with `Intl`', async () => {
    const de = await labelsIn('de');
    expect(de.health.allWell(1)).toBe('1 Quelle, alle berichten');
    expect(de.health.allWell(1234)).toBe('1.234 Quellen, alle berichten');
    expect(de.health.cadence(20)).toBe('alle 20 Min.');
    const en = await labelsIn('en');
    expect(en.health.allWell(1234)).toBe('1,234 sources, all reporting');
  });

  it('joins the stats line with the middot', async () => {
    const de = await labelsIn('de');
    expect(de.stats(statsOf())).toBe('1.234 Meldungen · 3 neu · 1 geändert · 5 Quellen');
    const en = await labelsIn('en');
    expect(en.stats(statsOf())).toBe('1,234 stories · 3 new · 1 edited · 5 sources');
  });

  it('adds the unhealthy part, and only when something is unhealthy', async () => {
    const en = await labelsIn('en');
    expect(en.stats(statsOf({ sourcesUnhealthy: 0 }))).not.toContain('unhealthy');
    expect(en.stats(statsOf({ sourcesUnhealthy: 0 }))).not.toMatch(/(·\s*$|\s·\s·)/);
    expect(en.stats(statsOf({ sourcesUnhealthy: 2 }))).toBe(
      '1,234 stories · 3 new · 1 edited · 5 sources · 2 unhealthy',
    );
    const de = await labelsIn('de');
    expect(de.stats(statsOf({ sourcesUnhealthy: 1 }))).toContain(' · 1 gestört');
  });

  it('keeps a zero story count in the line, and drops only the unhealthy part', async () => {
    const en = await labelsIn('en');
    const quiet = en.stats({
      items: 0,
      newItems: 0,
      editedItems: 0,
      sourcesFetched: 0,
      sourcesUnhealthy: 0,
      cycles: 0,
    });
    expect(quiet).toBe('0 stories · 0 new · 0 edited · 0 sources');
  });

  it('has a distinct word for every state core can report', async () => {
    const en = await labelsIn('en');
    const words = HEALTH_STATES.map((state) => en.health.state[state]);
    for (const word of words) expect(word.trim().length).toBeGreaterThan(0);
    expect(new Set(words).size).toBe(HEALTH_STATES.length);
    expect(Object.keys(en.health.state).sort()).toEqual([...HEALTH_STATES].sort());
    const de = await labelsIn('de');
    expect(de.health.state['no-matches']).toBe('findet nichts');
    expect(de.health.state.stale).toBe('veraltet');
    expect(de.health.state.restructured).toBe('umgebaut');
  });

  it('prints the health chrome, the kickers and the byline in the reader’s language', async () => {
    const de = await labelsIn('de');
    expect(de.health.headline).toBe('Quellen');
    expect(de.health.neverFetched).toBe('nie abgerufen');
    expect(de.health.lastPoll('vor 3 Stunden')).toBe('letzte Abfrage vor 3 Stunden');
    expect(de.health.matches(0, 14)).toBe('0 von 14 Elementen getroffen');
    expect(de.health.items(1234)).toBe('1.234 Meldungen');
    expect(de.editSummary(3, 1)).toBe('3 Zeichen ergänzt, 1 entfernt');
    expect(de.newKicker).toBe('Neu');
    expect(de.editedKicker).toBe('Geändert');
    expect(de.goneKicker).toBe('Archiviert');
    expect(de.editedHeadline).toBe('Geändert');
    expect(de.byline('Ann Example')).toBe('Von Ann Example');
    expect(de.opensInNewTab('BBC')).toBe('Die BBC-Meldung in einem neuen Tab öffnen');
    expect(de.onboarding.command).toContain('pnpm pick');
    const en = await labelsIn('en');
    expect(en.health.headline).toBe('Sources');
    expect(en.newKicker).toBe('New');
    expect(en.editedKicker).toBe('Edited');
    expect(en.goneKicker).toBe('Archived');
    expect(en.byline('Ann Example')).toBe('By Ann Example');
  });

  it('has three onboarding steps, with a title, a lead and the command', async () => {
    const en = await labelsIn('en');
    expect(en.onboarding.steps).toHaveLength(3);
    for (const step of en.onboarding.steps) expect(step.trim().length).toBeGreaterThan(0);
    expect(en.onboarding.title.length).toBeGreaterThan(0);
    expect(en.onboarding.lead.length).toBeGreaterThan(0);
    expect(en.onboarding.command).toContain('pnpm pick');
    const de = await labelsIn('de');
    expect(de.onboarding.steps).toHaveLength(3);
    expect(de.onboarding.steps[0]).toContain('pnpm pick');
  });

  it('leaves no chrome string empty, in either language', async () => {
    const stringsIn = (node: unknown): string[] => {
      if (typeof node === 'string') return [node];
      if (Array.isArray(node)) return node.flatMap(stringsIn);
      if (typeof node === 'object' && node !== null) return Object.entries(node).flatMap(([, v]) => stringsIn(v));
      return [];
    };
    for (const language of ['en', 'de']) {
      const words = stringsIn(await labelsIn(language));
      // 19 finished strings: 4 kickers/headline + 9 health + 6 onboarding.
      expect(words.length).toBeGreaterThanOrEqual(HEALTH_STATES.length + 11);
      for (const word of words) expect(word.trim().length).toBeGreaterThan(0);
    }
  });
});
