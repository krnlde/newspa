import type { TFunction } from 'i18next';
import type { EditionStats } from 'newspa-core';
import type { HealthLabels, PaperLabels } from 'newspa-paper';
import type { LocaleApi } from './lib/useLocale.ts';

/**
 * The paper's chrome, in the reader's language (D-019).
 *
 * This is the only place the app's strings are assembled, and the rule it
 * enforces is that **every string is finished here**: `newspa-paper` receives
 * words and formatter functions, never keys, so a component cannot render
 * English by accident.
 *
 * Plurals go through i18next's `count`, and the **number** through `Intl` —
 * `count` selects the plural form, `value` is what the reader sees, because a
 * locale-aware thousands separator is `Intl`'s job, not i18next's.
 */
const counted = (t: TFunction, locale: LocaleApi, key: string, value: number): string =>
  t(key, { count: value, value: locale.count(value) });

const join = (parts: readonly string[]): string => parts.filter((part) => part.length > 0).join(' · ');

const healthLabelsOf = (t: TFunction, locale: LocaleApi): HealthLabels => ({
  headline: t('paper.health.headline'),
  allWell: (count: number) => counted(t, locale, 'paper.health.allWell', count),
  state: {
    ok: t('paper.health.state.ok'),
    blocked: t('paper.health.state.blocked'),
    'no-matches': t('paper.health.state.noMatches'),
    restructured: t('paper.health.state.restructured'),
    error: t('paper.health.state.error'),
    stale: t('paper.health.state.stale'),
    unknown: t('paper.health.state.unknown'),
  },
  cadence: (minutes: number) => counted(t, locale, 'paper.health.cadence', minutes),
  items: (count: number) => counted(t, locale, 'paper.health.items', count),
  neverFetched: t('paper.health.neverFetched'),
  lastPoll: (ago: string) => t('paper.health.lastPoll', { ago }),
  matches: (seen: number, expected: number) =>
    t('paper.health.matches', { seen: locale.count(seen), expected: locale.count(expected) }),
});

const statsLine = (t: TFunction, locale: LocaleApi, stats: EditionStats): string =>
  join([
    counted(t, locale, 'paper.stats.items', stats.items),
    counted(t, locale, 'paper.stats.new', stats.newItems),
    counted(t, locale, 'paper.stats.edited', stats.editedItems),
    counted(t, locale, 'paper.stats.sources', stats.sourcesFetched),
    stats.sourcesUnhealthy > 0 ? counted(t, locale, 'paper.stats.unhealthy', stats.sourcesUnhealthy) : '',
  ]);

export const paperLabelsOf = (t: TFunction, locale: LocaleApi): PaperLabels => ({
  newKicker: t('paper.kicker.new'),
  editedKicker: t('paper.kicker.edited'),
  changedLabel: t('paper.kicker.changed'),
  byline: (author: string) => t('paper.byline', { author }),
  opensInNewTab: (sourceLabel: string) => t('paper.opensInNewTab', { source: sourceLabel }),
  editSummary: (added: number, removed: number) =>
    t('paper.editSummary', {
      count: added,
      added: locale.count(added),
      removed: locale.count(removed),
    }),
  editedHeadline: t('paper.edited.headline'),
  health: healthLabelsOf(t, locale),
  stats: (stats: EditionStats) => statsLine(t, locale, stats),
  onboarding: {
    title: t('paper.onboarding.title'),
    lead: t('paper.onboarding.lead'),
    steps: [t('paper.onboarding.step1'), t('paper.onboarding.step2'), t('paper.onboarding.step3')],
    command: t('paper.onboarding.command'),
  },
});
