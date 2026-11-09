import { describe, expect, it } from 'vitest';
import * as core from '../src/index.ts';
import {
  buildEdition,
  CADENCE_PRESETS,
  classifyFetch,
  countWatchHits,
  describeCadence,
  editReport,
  emptyStats,
  isSourceKind,
  parseServerEvent,
  scoreItem,
  teaserFor,
  wordDiff,
} from '../src/index.ts';
import { SOURCE_KINDS } from '../src/types.ts';

/** Every value the barrel owes its four consumers: server, db, fetch, web. */
const VALUE_EXPORTS: readonly string[] = [
  'addSourceRequestSchema',
  'addSourceResponseSchema',
  'diffOpSchema',
  'editReportSchema',
  'editionSchema',
  'editionSectionSchema',
  'editionStatsSchema',
  'editionsResponseSchema',
  'healthStateSchema',
  'itemViewSchema',
  'itemsQuerySchema',
  'itemsResponseSchema',
  'mastheadViewSchema',
  'parseServerEvent',
  'serverEventSchema',
  'sourceHealthViewSchema',
  'sourceKindSchema',
  'stateResponseSchema',
  'storyTierSchema',
  'CADENCE_PRESETS',
  'describeCadence',
  'effectiveCadenceMinutes',
  'inQuietHours',
  'isKnownCadence',
  'MAX_CADENCE_MINUTES',
  'MIN_CADENCE_MINUTES',
  'MIN_RENDERED_CADENCE_MINUTES',
  'CRON_RANGES',
  'describeCron',
  'nextCronTime',
  'parseCron',
  'editReport',
  'renderDiffText',
  'tokenize',
  'wordDiff',
  'CHALLENGE_MARKERS',
  'classifyFetch',
  'describeState',
  'detectBurst',
  'errorKindOf',
  'isStale',
  'looksLikeChallenge',
  'buildEdition',
  'canonicalizeUrl',
  'compareIso',
  'contentKey',
  'emptyStats',
  'hashKey',
  'itemId',
  'normalizeText',
  'resolveLink',
  'sectionFor',
  'SECTION_IDS',
  'sectionIdFor',
  'sectionOf',
  'sectionTitleFor',
  'TRACKING_PARAMS',
  'countWatchHits',
  'defaultScoreRules',
  'escapeRegExp',
  'scoreItem',
  'tierFor',
  'BODY_MAX_CHARS',
  'capBody',
  'firstParagraph',
  'isBoilerplateTeaser',
  'TEASER_MAX_CHARS',
  'teaserFor',
  'truncate',
  'pageSignals',
  'conditionalHeaders',
  'formatHttpDate',
  'freshnessSeconds',
  'hasValidators',
  'parseCacheControl',
  'parseHttpDate',
  'retryAfterMs',
  'validatorsFromHeaders',
  'isSourceKind',
  'SOURCE_KINDS',
];

/** The time API that is locale-free, so it is pinned here in full. */
const TIME_EXPORTS: readonly string[] = [
  'backoffMs',
  'editionDate',
  'editionIdFor',
  'editionWindow',
  'isDue',
  'jitterMs',
  'nowIso',
  'relativeParts',
];

/**
 * The locale-locked formatters are gone, not "temporarily tolerated": the paper's
 * language is a UI concern, so `Intl` in the web app does the formatting and core
 * only ships parts. A barrel that re-grows one of these is a regression.
 */
const BANNED_TIME_EXPORTS: readonly string[] = ['clockTime', 'datelineFor', 'relativeTime'];

describe('the core barrel', () => {
  it('exposes every core value, so a rename is a build failure', () => {
    const surface: Record<string, unknown> = { ...core };
    for (const name of VALUE_EXPORTS) expect(surface[name], name).toBeDefined();
    for (const name of TIME_EXPORTS) expect(surface[name], name).toBeDefined();
  });

  it('exports nothing the barrel did not declare', () => {
    const allowed = new Set([...VALUE_EXPORTS, ...TIME_EXPORTS]);
    const extras = Object.keys({ ...core }).filter((name) => !allowed.has(name));
    expect(extras).toEqual([]);
  });

  it('keeps locale-locked formatters out of the barrel', () => {
    const surface: Record<string, unknown> = { ...core };
    for (const name of BANNED_TIME_EXPORTS) expect(surface[name], name).toBeUndefined();
  });

  it('re-exports the modules themselves, not copies', () => {
    expect(core.parseServerEvent).toBe(parseServerEvent);
    expect(core.buildEdition).toBe(buildEdition);
    expect(core.emptyStats).toBe(emptyStats);
    expect(core.classifyFetch).toBe(classifyFetch);
    expect(core.countWatchHits).toBe(countWatchHits);
    expect(core.scoreItem).toBe(scoreItem);
    expect(core.teaserFor).toBe(teaserFor);
    expect(core.wordDiff).toBe(wordDiff);
    expect(core.editReport).toBe(editReport);
    expect(core.describeCadence).toBe(describeCadence);
    expect(core.CADENCE_PRESETS).toBe(CADENCE_PRESETS);
  });

  it('carries the constants that bound a source file', () => {
    expect(core.MIN_CADENCE_MINUTES).toBe(1);
    expect(core.MAX_CADENCE_MINUTES).toBe(10_080);
    expect(core.BODY_MAX_CHARS).toBe(1200);
    expect(core.TEASER_MAX_CHARS).toBe(240);
    expect(core.healthStateSchema.options).toHaveLength(7);
  });
});

describe('isSourceKind', () => {
  it('accepts exactly the kinds the fetcher implements', () => {
    expect(SOURCE_KINDS).toEqual(['rss', 'html', 'json']);
    for (const kind of SOURCE_KINDS) expect(isSourceKind(kind), kind).toBe(true);
    expect(isSourceKind('atom')).toBe(false);
    expect(isSourceKind('RSS')).toBe(false);
    expect(isSourceKind('')).toBe(false);
  });
});
