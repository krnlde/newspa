import { describe, expect, it } from 'vitest';
import type { ScoreInput, ScoreRules } from '../src/score.ts';
import { countWatchHits, defaultScoreRules, escapeRegExp, scoreItem, tierFor } from '../src/score.ts';

const NOW = new Date(2026, 10, 9, 12, 0, 0);
const hoursBefore = (hours: number): string => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

/**
 * The fixture's sighting defaults to **72 hours** — the age the scorer used to invent
 * for an undated story — so the suite's totals are the ones this file has always
 * asserted, and the sighting rule is visible as a variable rather than a constant.
 */
const anInput = (
  title: string,
  publishedAt: string | null = null,
  summary: string | null = null,
  firstSeenAt: string = hoursBefore(72),
): ScoreInput => ({
  title,
  summary,
  publishedAt,
  firstSeenAt,
  sourceLabel: 'Src',
});

const scored = (
  title: string,
  overrides: Partial<ScoreRules> = {},
  publishedAt: string | null = null,
  summary: string | null = null,
) => scoreItem(anInput(title, publishedAt, summary), defaultScoreRules(overrides), NOW);

describe('defaultScoreRules', () => {
  it('names the defaults a source starts with', () => {
    expect(defaultScoreRules()).toEqual({
      watchwords: [],
      blockwords: [],
      sourceWeight: 1,
      recencyHalfLifeHours: 24,
      maxWatchHitsScored: 6,
    });
  });

  it('applies overrides over the defaults', () => {
    expect(defaultScoreRules({ watchwords: ['transit'], sourceWeight: 3 })).toEqual({
      watchwords: ['transit'],
      blockwords: [],
      sourceWeight: 3,
      recencyHalfLifeHours: 24,
      maxWatchHitsScored: 6,
    });
  });
});

describe('escapeRegExp', () => {
  it('escapes every metacharacter so a watchword is literal', () => {
    expect(escapeRegExp('a.b*c(d)+e?f^g$h{i}j|k[l]m\\n')).toBe(
      'a\\.b\\*c\\(d\\)\\+e\\?f\\^g\\$h\\{i\\}j\\|k\\[l\\]m\\\\n',
    );
  });
});

describe('countWatchHits', () => {
  it('respects word boundaries, so ai does not match said, chair or Ukraine', () => {
    expect(countWatchHits('ai', 'said chair Ukraine')).toBe(0);
    expect(countWatchHits('ai', 'raises the air price')).toBe(0);
  });

  it('matches case-insensitively and counts repeated hits', () => {
    expect(countWatchHits('ai', 'AI and ai')).toBe(2);
    expect(countWatchHits('ai', 'ai, ai; AI!')).toBe(3);
    expect(countWatchHits('ai', 'the ai-model')).toBe(1);
  });

  it('is accent-insensitive and literal about symbols', () => {
    expect(countWatchHits('café', 'CAFÉ au café')).toBe(2);
    expect(countWatchHits('c++', 'c++ and cxx')).toBe(1);
  });

  it('counts nothing for an empty needle', () => {
    expect(countWatchHits('', 'anything at all')).toBe(0);
  });
});

describe('tierFor', () => {
  it('cuts the tiers at 12, 8 and 4.5', () => {
    expect(tierFor(12)).toBe('lead');
    expect(tierFor(11.99)).toBe('front');
    expect(tierFor(8)).toBe('front');
    expect(tierFor(7.99)).toBe('section');
    expect(tierFor(4.5)).toBe('section');
    expect(tierFor(4.49)).toBe('brief');
    expect(tierFor(0)).toBe('brief');
  });
});

describe('scoreItem', () => {
  it('is deterministic: the same input scores the same, twice', () => {
    const rules = defaultScoreRules({ watchwords: ['transit', 'budget'], sourceWeight: 2 });
    const input = anInput('Transit budget passes', hoursBefore(2), 'The council voted at midnight.');
    expect(scoreItem(input, rules, NOW)).toEqual(scoreItem(input, rules, NOW));
  });

  it('adds up exactly: source weight, recency and headline length', () => {
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: 1 }, NOW.toISOString())).toEqual({
      total: 6.5,
      matched: [],
      reasons: ['breaking'],
      tier: 'section',
    });
  });

  it('zeroes a story that matches a blockword', () => {
    expect(scored('Opinion: the poll is close', { blockwords: ['opinion'], watchwords: ['poll'] })).toEqual({
      total: 0,
      matched: [],
      reasons: ['blocked by "opinion"'],
      tier: 'brief',
    });
    expect(scored('Opinion: the poll is close', { blockwords: ['cricket', 'opinion'] }).reasons).toEqual([
      'blocked by "opinion"',
    ]);
  });

  it('weighs a title hit over a summary hit', () => {
    const title = scored('Transit vote count', { watchwords: ['transit'], sourceWeight: 0 });
    const summary = scored('Budget vote count', { watchwords: ['transit'], sourceWeight: 0 }, null, 'transit plan');
    expect(title.matched).toEqual(['transit']);
    expect(title.total).toBe(2.88);
    expect(summary.total).toBe(1.38);
    expect(title.total - summary.total).toBeCloseTo(1.5, 5);
  });

  it('caps summary hits at two per watchword', () => {
    expect(
      scored('Vote now', { watchwords: ['transit'], sourceWeight: 0 }, null, 'transit transit transit transit').total,
    ).toBe(2.75);
  });

  it('stops scoring once maxWatchHitsScored is spent', () => {
    const breakdown = scored('alpha beta', { watchwords: ['alpha', 'beta'], maxWatchHitsScored: 1, sourceWeight: 0 });
    expect(breakdown.matched).toEqual(['alpha']);
    expect(breakdown.total).toBe(2.75);
  });

  it('clamps source weight into 0..5 and only reports a loud weight', () => {
    const loud = scored('Alpha Beta Gamma Delta', { sourceWeight: 10 });
    expect(loud.total).toBe(11);
    expect(loud.reasons).toEqual(['source weight 5']);
    expect(loud.tier).toBe('front');
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: -3 })).toEqual({
      total: 1,
      matched: [],
      reasons: [],
      tier: 'brief',
    });
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: 3 }).reasons).toContain('source weight 3');
  });

  it('treats an unparsable date as 72 hours old', () => {
    const fresh = scored('Alpha Beta Gamma Delta', { sourceWeight: 0 }, NOW.toISOString());
    expect(fresh.total).toBe(4.5);
    expect(fresh.tier).toBe('section');
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: 0 }, 'not-a-date').total).toBe(1);
  });

  it('scores an undated story from the paper’s sighting — the age the card prints (D-047)', () => {
    // A scraped page that declares no date left the scorer guessing 3 days, while
    // the meta line printed the sighting. One item, two clocks: the card read
    // "seen just now" and ranked mid-list. Now both read the same instant.
    const rules = defaultScoreRules({ sourceWeight: 0 });
    const justSeen = scoreItem(anInput('Alpha Beta Gamma Delta', null, null, hoursBefore(1)), rules, NOW);
    const longSeen = scoreItem(anInput('Alpha Beta Gamma Delta', null, null, hoursBefore(240)), rules, NOW);
    expect(justSeen.reasons).toEqual(['breaking']);
    expect(longSeen.reasons).toEqual(['old']);
    // The swing is the whole recency weight: the fresh sighting gets it, the old one
    // has decayed away, and under the invented 72 hours **both** got the same number.
    expect(justSeen.total - longSeen.total).toBeGreaterThan(3.8);
  });

  it('ignores the sighting when the publisher declared a date', () => {
    // The ladder is a ladder: the page's own instant is used only where the
    // publisher said nothing, never over what the publisher said.
    const dated = scoreItem(
      anInput('Alpha Beta Gamma Delta', hoursBefore(240), null, hoursBefore(1)),
      defaultScoreRules({ sourceWeight: 0 }),
      NOW,
    );
    expect(dated.reasons).toEqual(['old']);
  });

  it('decays with the half-life and clamps the age', () => {
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: 0 }, hoursBefore(5)).total).toBe(3.96);
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: 0 }, hoursBefore(120)).reasons).toEqual(['old']);
    const ancient = scored('Alpha Beta Gamma Delta', { sourceWeight: 0 }, hoursBefore(24 * 1000));
    expect(ancient.total).toBe(0.5);
    expect(ancient.reasons).toEqual(['old']);
    expect(scored('Alpha Beta Gamma Delta', { sourceWeight: 0, recencyHalfLifeHours: 0 }, hoursBefore(24)).total).toBe(
      0.5,
    );
  });

  it('scores a future timestamp as breaking, not negative', () => {
    const future = scored(
      'Alpha Beta Gamma Delta',
      { sourceWeight: 0 },
      new Date(NOW.getTime() + 5 * 3_600_000).toISOString(),
    );
    expect(future.total).toBe(4.5);
    expect(future.reasons).toEqual(['breaking']);
  });

  it('penalises a thin headline and stops counting length at two', () => {
    const thin = scored('Alpha Beta', { sourceWeight: 0 }, NOW.toISOString());
    expect(thin.total).toBe(3.25);
    expect(thin.reasons).toEqual(['breaking', 'thin headline']);
    const long = scored(Array.from({ length: 16 }, (_, i) => `w${i}`).join(' '), { sourceWeight: 0 });
    expect(long.total).toBe(2.5);
    expect(long.reasons).toEqual([]);
  });

  it('promotes a watched, heavy, fresh story to the lead', () => {
    const lead = scored(
      'Transit budget plan passes',
      { watchwords: ['transit', 'budget', 'plan', 'passes'], sourceWeight: 5 },
      NOW.toISOString(),
    );
    expect(lead.total).toBe(26.5);
    expect(lead.tier).toBe('lead');
    expect(lead.reasons).toEqual(['watch: transit, budget, plan, passes', 'source weight 5', 'breaking']);
  });

  it('lists no watch reason when nothing matched', () => {
    expect(scored('Weather tomorrow', { watchwords: ['transit'] }).matched).toEqual([]);
  });
});
