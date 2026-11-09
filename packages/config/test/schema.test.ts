import { describe, expect, it } from 'vitest';
import {
  appConfigSchema,
  defaultAppConfig,
  htmlSourceSchema,
  jsonSourceSchema,
  rssSourceSchema,
  sourceSchema,
} from '../src/schema.ts';

const minimalHtml = {
  id: 'bbc-news',
  label: 'BBC News',
  url: 'https://www.bbc.com/news',
  kind: 'html',
  list: 'section[data-testid="list"] li',
  fields: { title: 'h2', link: 'a' },
};

describe('sourceSchema', () => {
  it('applies defaults, so a source file states only intent', () => {
    const spec = sourceSchema.parse(minimalHtml);
    expect(spec.kind).toBe('html');
    if (spec.kind !== 'html') return;
    expect(spec.cadenceMinutes).toBe(20);
    expect(spec.enabled).toBe(true);
    expect(spec.weight).toBe(1);
    expect(spec.render).toBe(false);
    expect(spec.strip).toEqual([]);
    expect(spec.headers).toEqual({});
    expect(spec.minEditRatio).toBe(0.06);
    expect(spec.maxBytes).toBe(8_388_608);
    expect(spec.acceptLanguage).toBe('en-US,en;q=0.9');
  });

  it('takes a declared section verbatim, and no section as the ladder’s business', () => {
    // `section` is the reader's own words ("Rail strikes"): the schema keeps them
    // exact, because the section title is printed as typed (D-019: data, not chrome).
    const spec = sourceSchema.parse({ ...minimalHtml, section: 'Rail strikes' });
    expect(spec.section).toBe('Rail strikes');
    expect(sourceSchema.parse(minimalHtml).section).toBeUndefined();
    expect(sourceSchema.safeParse({ ...minimalHtml, section: '' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, section: 'x'.repeat(61) }).success).toBe(false);
  });

  it('reads an html source with no `list` as a page source', () => {
    // Page mode: no repeating items, so the identity is the page's own text.
    // `fields` is absent with `list`, and `strip` is what keeps a ticking
    // "last updated" from churning that identity.
    const { list, fields, ...rest } = minimalHtml;
    const parsed = htmlSourceSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.list).toBeNull();
    // `fields` keeps its inert default: page mode reads `<title>` and
    // `meta[name=description]` by convention, so it needs no selectors, and
    // keeping the object complete is what keeps the parser's types honest.
    expect(parsed.data.fields.title).toBe('title');
    expect(parsed.data.strip).toEqual([]);
  });

  it('parses an rss source and its item cap', () => {
    const spec = rssSourceSchema.parse({ id: 'npr-world', label: 'NPR World', url: 'https://x.test/rss', kind: 'rss' });
    expect(spec.maxItems).toBe(60);
    expect(rssSourceSchema.parse({ ...spec, maxItems: 500 }).maxItems).toBe(500);
    expect(rssSourceSchema.safeParse({ ...spec, maxItems: 501 }).success).toBe(false);
  });

  it('parses a json source, island included', () => {
    const spec = jsonSourceSchema.parse({
      id: 'bbc-island',
      label: 'BBC island',
      url: 'https://www.bbc.com/news',
      kind: 'json',
      itemsPath: 'worldNews.items',
      fields: { title: 'headline', link: 'url' },
      island: 'script#__NEXT_DATA__',
    });
    expect(spec.islandRoot).toBe('props.pageProps');
    expect(spec.island).toBe('script#__NEXT_DATA__');
    expect(spec.fields.link).toBe('url');
  });

  it('rejects an id that is not kebab-case, because it becomes a filename', () => {
    for (const id of ['a', 'BBC', 'bbc news', '-bbc', 'bbc_news', 'x'.repeat(65)]) {
      expect(sourceSchema.safeParse({ ...minimalHtml, id }).success, id).toBe(false);
    }
  });

  it('rejects a url that is not a url', () => {
    expect(sourceSchema.safeParse({ ...minimalHtml, url: 'bbc.com/news' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, url: 'not a url at all' }).success).toBe(false);
  });

  it('rejects a cadence outside 1 minute..30 days', () => {
    expect(sourceSchema.safeParse({ ...minimalHtml, cadenceMinutes: 0 }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, cadenceMinutes: 43_201 }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, cadenceMinutes: 10_080 }).success).toBe(true);
  });

  it('validates cadenceCron shape, and keeps it optional', () => {
    expect(sourceSchema.safeParse({ ...minimalHtml, cadenceCron: '0 7 * * 1' }).success).toBe(true);
    expect(sourceSchema.safeParse({ ...minimalHtml, cadenceCron: 'every morning' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, cadenceCron: '0 7 * *' }).success).toBe(false);
  });

  it('keeps quietHours as two local hours', () => {
    expect(sourceSchema.safeParse({ ...minimalHtml, quietHours: { startHour: 6, endHour: 23 } }).success).toBe(true);
    expect(sourceSchema.safeParse({ ...minimalHtml, quietHours: { startHour: 24, endHour: 23 } }).success).toBe(false);
  });

  it('has no cookies field: sources/*.json is committed, cookies are not', () => {
    const withCookies = { ...minimalHtml, cookies: { session: 'secret' } };
    const parsed = htmlSourceSchema.parse(withCookies);
    expect(parsed).not.toHaveProperty('cookies');
    expect(htmlSourceSchema.parse({ ...minimalHtml, profile: true }).profile).toBe(true);
    expect(htmlSourceSchema.parse({ ...minimalHtml, cookieFile: 'profiles/bbc-news/cookies.json' }).cookieFile).toBe(
      'profiles/bbc-news/cookies.json',
    );
  });

  it('bounds the edit-ratio, weight and byte cap', () => {
    expect(sourceSchema.safeParse({ ...minimalHtml, minEditRatio: 1.5 }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, weight: 6 }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, maxBytes: 512 }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, renderTimeoutMs: 999 }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, notes: 'x'.repeat(501) }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, userAgent: '' }).success).toBe(false);
  });

  it('records matchCount and baselinedAt from the picker', () => {
    const spec = sourceSchema.parse({ ...minimalHtml, matchCount: 27, baselinedAt: '2026-11-08T07:00:00.000Z' });
    if (spec.kind !== 'html') throw new Error('expected html');
    expect(spec.matchCount).toBe(27);
    expect(spec.baselinedAt).toBe('2026-11-08T07:00:00.000Z');
    expect(sourceSchema.safeParse({ ...minimalHtml, baselinedAt: 'yesterday' }).success).toBe(false);
    expect(sourceSchema.safeParse({ ...minimalHtml, matchCount: -1 }).success).toBe(false);
  });

  it('reports the offending field for a union member, not a generic union failure', () => {
    const parsed = sourceSchema.safeParse({ ...minimalHtml, kind: 'json', fields: { title: 'headline' } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('fields.link');
  });

  it('rejects an unknown kind outright', () => {
    expect(sourceSchema.safeParse({ ...minimalHtml, kind: 'atom' }).success).toBe(false);
  });
});

describe('appConfigSchema', () => {
  it('fills every section from an empty object', () => {
    const config = appConfigSchema.parse({});
    expect(config.masthead.name).toBe('The Daily');
    expect(config.masthead.dayStartHour).toBe(7);
    expect(config.server.port).toBe(8787);
    expect(config.scheduler.maxConcurrentFetches).toBe(4);
    expect(config.scoring.watchwords).toEqual([]);
    expect(config.burst.newRatioThreshold).toBe(0.4);
    expect(config.retention.snapshotsPerSource).toBe(10);
    expect(config.notify.toastTitle).toBe('newspa');
  });

  it('has no editions section: the page is the product, not a generated file', () => {
    expect(appConfigSchema.parse({})).not.toHaveProperty('editions');
    expect(Object.keys(appConfigSchema.shape)).not.toContain('editions');
  });

  it('applies nested defaults when a section is partially present', () => {
    const config = appConfigSchema.parse({ server: { port: 9000 }, notify: { toasts: false } });
    expect(config.server.port).toBe(9000);
    expect(config.server.host).toBe('127.0.0.1');
    expect(config.notify.toasts).toBe(false);
    expect(config.notify.maxToastsPerCycle).toBe(3);
  });

  it('prefault is not default: a missing section comes back populated, not {}', () => {
    const config = appConfigSchema.parse({});
    // `.default({})` would pass the empty object straight through and leave
    // `masthead.name` undefined at runtime while typed as string.
    expect(Object.keys(config.masthead).length).toBe(4);
    expect(typeof config.masthead.tagline).toBe('string');
  });

  it('reports a bad nested value with its path', () => {
    const parsed = appConfigSchema.safeParse({ masthead: { name: 12 } });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.path).toEqual(['masthead', 'name']);
  });

  it('bounds the knobs that keep the process polite', () => {
    expect(appConfigSchema.safeParse({ server: { port: 70_000 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ scheduler: { maxConcurrentFetches: 99 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ scoring: { recencyHalfLifeHours: 0 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ burst: { newRatioThreshold: 0.01 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ retention: { historyDays: 0 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ retention: { historyDays: 2_001 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ notify: { maxToastsPerCycle: 11 } }).success).toBe(false);
    expect(appConfigSchema.safeParse({ scheduler: { staleAfterMinutes: 30 } }).success).toBe(false);
  });

  it('accepts a notify quiet window and a masthead name within limits', () => {
    const config = appConfigSchema.parse({
      masthead: { name: 'Kai’s Daily', tagline: 'printed at home' },
      notify: { quietHours: { startHour: 22, endHour: 7 } },
    });
    expect(config.masthead.name).toBe('Kai’s Daily');
    expect(config.notify.quietHours).toEqual({ startHour: 22, endHour: 7 });
  });

  it('defaultAppConfig is the same as parsing {}', () => {
    expect(defaultAppConfig()).toEqual(appConfigSchema.parse({}));
  });
});
