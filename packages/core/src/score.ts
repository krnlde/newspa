import { normalizeText } from './normalize.ts';
import type { StoryTier } from './types.ts';

export interface ScoreRules {
  readonly watchwords: readonly string[];
  readonly blockwords: readonly string[];
  readonly sourceWeight: number;
  readonly recencyHalfLifeHours: number;
  readonly maxWatchHitsScored: number;
}

export const defaultScoreRules = (overrides: Partial<ScoreRules> = {}): ScoreRules => ({
  watchwords: [],
  blockwords: [],
  sourceWeight: 1,
  recencyHalfLifeHours: 24,
  maxWatchHitsScored: 6,
  ...overrides,
});

export interface ScoreInput {
  readonly title: string;
  readonly summary: string | null;
  readonly publishedAt: string | null;
  /**
   * The paper's own sighting of this item, per item and never null. It is the age
   * scored when the publisher declared none — see `scoreItem`.
   */
  readonly firstSeenAt: string;
  readonly sourceLabel: string;
}

export interface ScoreBreakdown {
  total: number;
  matched: readonly string[];
  reasons: readonly string[];
  tier: StoryTier;
}

export const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word, case- and accent-insensitive hit count. Word boundaries matter:
 * the watchword "ai" must not fire on "said", "chair" or "Ukraine" — with 40
 * words in the list, substring matching turns every story into a match.
 */
export const countWatchHits = (needle: string, haystack: string): number => {
  if (needle.length === 0) return 0;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'giu');
  return (haystack.match(re) ?? []).length;
};

export const tierFor = (total: number): StoryTier => {
  if (total >= 12) return 'lead';
  if (total >= 8) return 'front';
  if (total >= 4.5) return 'section';
  return 'brief';
};

const hoursSince = (iso: string | null, now: Date): number => {
  // 72 is the floor for an instant that **cannot be read**, never the answer for an
  // undated story: the caller hands the sighting in, so the age scored is the age
  // printed. An invented 3 days is what let a card read "seen just now" and rank
  // mid-list at once — one item, two clocks (D-047).
  if (iso === null) return 72;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 72;
  return Math.max(0, Math.min(336, (now.getTime() - at) / 3_600_000));
};

/**
 * The instant an age is measured from: the publisher's date, and the paper's own
 * sighting when the publisher declared none. The card prints that same instant, so
 * the ranked order and the printed age come from one number (D-047).
 */
const datedFrom = (input: ScoreInput): string | null => input.publishedAt ?? input.firstSeenAt;

/**
 * Deterministic scoring: recency decay + watchword hits + source weight.
 * No LLM, no randomness — the same input must produce the same front page,
 * on any machine, on a train, at 3am.
 */
export const scoreItem = (input: ScoreInput, rules: ScoreRules, now: Date): ScoreBreakdown => {
  const title = normalizeText(input.title);
  const summary = normalizeText(input.summary ?? '');
  const reasons: string[] = [];
  const matched: string[] = [];

  for (const word of rules.blockwords) {
    if (countWatchHits(word, `${title} ${summary}`) > 0) {
      return { total: 0, matched, reasons: [...reasons, `blocked by "${word}"`], tier: 'brief' };
    }
  }

  let total = 0;
  let hits = 0;
  for (const word of rules.watchwords) {
    if (hits >= rules.maxWatchHitsScored) break;
    const titleHits = countWatchHits(word, title);
    const summaryHits = countWatchHits(word, summary);
    if (titleHits === 0 && summaryHits === 0) continue;
    matched.push(word);
    hits += titleHits + summaryHits;
    total += titleHits * 3 + Math.min(summaryHits, 2) * 1.5;
  }
  if (matched.length > 0) reasons.push(`watch: ${matched.join(', ')}`);

  const sourceWeight = Math.max(0, Math.min(5, rules.sourceWeight));
  total += sourceWeight * 2;
  if (sourceWeight >= 3) reasons.push(`source weight ${sourceWeight}`);

  const age = hoursSince(datedFrom(input), now);
  const recency = 4 * 0.5 ** (age / Math.max(1, rules.recencyHalfLifeHours));
  total += recency;
  if (age <= 3) reasons.push('breaking');
  else if (age > 96) reasons.push('old');

  const words = title.split(/\s+/).filter((w) => w.length > 0).length;
  total += Math.min(2, words / 8);
  if (words < 4) {
    total -= 1;
    reasons.push('thin headline');
  }

  const total2 = Math.round(Math.max(0, total) * 100) / 100;
  return { total: total2, matched, reasons, tier: tierFor(total2) };
};
