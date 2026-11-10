import { z } from 'zod';

/**
 * Source definitions are files in the reader's own directory (`sources/`,
 * gitignored by D-025), never rows edited through the UI. The definition stays
 * reviewable - the picker prints what it wrote and `pnpm export --bundle` backs
 * the directory up - and a redesign is an authored change instead of a silent
 * database mutation.
 *
 * `kind` is discriminated because the web probe proved article data lives in
 * three places: HTML, JSON islands (`__NEXT_DATA__` on BBC was 91 KB of a
 * 370 KB page) and separate JSON endpoints. The JSON shape is the one that
 * survives a redesign.
 */

/**
 * CSS selectors only, deliberately. The picker emits CSS, cheerio evaluates CSS
 * on raw bytes, and a second selector language (XPath) would need an engine we
 * do not have — an unimplemented `mode` is worse than an absent one.
 */
export const cssPathSchema = z.string().min(1).max(500);
export type CssPath = z.infer<typeof cssPathSchema>;

/**
 * Fields every source shares. Spread into each kind schema rather than
 * `z.intersection`ed: zod cannot prove a discriminant through an intersection,
 * so `z.discriminatedUnion('kind', …)` degrades to `unknown` and every consumer
 * loses its narrowing. Measured on zod 4.6.7.
 */
const baseShape = {
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase kebab-case; it becomes the filename and the item key prefix'),
  label: z.string().min(1).max(80),
  url: z.url(),
  /** Grouping in the sources UI. Defaults to the label so a new source appears at once. */
  group: z.string().min(1).max(60).optional(),
  /**
   * Where this source's stories print, in the reader's own words: `"Iran"`,
   * `"Rail strikes"`, `"AI releases"`. A label the reader typed is data, not UI
   * chrome, so it is printed verbatim and never translated (D-019).
   *
   * **Absent means the text decides**: core's keyword ladder routes each story
   * (`sections.ts`). The two knobs are complementary, not competing — the
   * ladder makes 40 unlabelled sources readable, this is what you say when you
   * already know what a feed is. `group` is how a source is *listed*; `section`
   * is where it *prints*.
   */
  section: z.string().min(1).max(60).optional(),
  cadenceMinutes: z.int().min(1).max(43_200).default(20),
  /**
   * Optional 5-field cron, hidden from the UI (docs/decisions.md). It is the
   * *earliest allowed time*; jitter and failure backoff still apply on top, so
   * a cron-anchored source cannot re-hammer a site that answered 429.
   */
  cadenceCron: z
    .string()
    .min(9)
    .max(80)
    .refine((value) => value.trim().split(/\s+/).length === 5, 'cadenceCron must have exactly 5 fields')
    .optional(),
  /** Local-hour window in which this source is not polled (a sports blog at 04:00). */
  quietHours: z
    .object({
      startHour: z.int().min(0).max(23),
      endHour: z.int().min(0).max(23),
    })
    .optional(),
  enabled: z.boolean().default(true),
  /**
   * **The importance slider, 0..5.** The scorer adds `weight * 2` to every item
   * of this source (`score.ts`), and the tiers are 12 / 8 / 4.5, so the
   * arithmetic is worth stating. A **fresh** item scores 4 from recency;
   * watchwords (up to 6 hits) and a long headline (up to 2) add on top, so these
   * are floors:
   *
   * | `weight` | fresh item, no watchwords | tier      |
   * | -------- | ------------------------- | --------- |
   * | 5        | 14                        | `lead`    |
   * | 3        | 10                        | `front`   |
   * | 1        | 6                         | `section` |
   * | 0        | 4, and never above 6      | `brief`   |
   *
   * The lead is the highest score of the edition, so a `weight: 5` source is one
   * whose update **takes the title page**. That is the knob, and it is
   * deterministic: the same state prints the same front page.
   */
  weight: z.int().min(0).max(5).default(1),
  watchwords: z.array(z.string().min(1).max(80)).default([]),
  blockwords: z.array(z.string().min(1).max(80)).default([]),
  /**
   * `render: true` is a pick-time decision, not a later config tweak: a
   * selector authored against a hydrated DOM will match nothing in a raw
   * fetch, and the failure is silent (a quiet zero-item poll).
   */
  render: z.boolean().default(false),
  renderTimeoutMs: z.int().min(1_000).max(120_000).default(20_000),
  /**
   * Logged-in sources use a persistent Edge profile directory (`profiles/<id>`),
   * which is gitignored. `cookieFile` is the plain-fetch equivalent.
   *
   * There is intentionally **no** `cookies` field: `sources/*.json` is committed,
   * and a config file in git is the worst possible place for a session cookie.
   */
  profile: z.boolean().default(false),
  cookieFile: z.string().min(1).max(300).optional(),
  /**
   * Variant pin. BBC ships `vary: X-BBC-Edge-Scheme,bbc-mvt-1..10`, i.e. the
   * HTML you receive is an A/B variant; without a pin the diff churns forever.
   */
  headers: z.record(z.string(), z.string()).default({}),
  acceptLanguage: z.string().default('en-US,en;q=0.9'),
  userAgent: z.string().min(1).max(400).optional(),
  timeoutMs: z.int().min(1_000).max(120_000).default(15_000),
  maxBytes: z.int().min(1_024).max(33_554_432).default(8_388_608),
  /** Typo filter for stealth-edit detection: fraction of characters that must change. */
  minEditRatio: z.number().min(0).max(1).default(0.06),
  /** Match count recorded when the selector was authored. Drives rot detection. */
  matchCount: z.int().min(0).optional(),
  notes: z.string().max(500).optional(),
  /** Set by the picker when it baselines a source: "baselined, watching from now on". */
  baselinedAt: z.iso.datetime().optional(),
} as const;

export const rssSourceSchema = z.object({
  ...baseShape,
  kind: z.literal('rss'),
  maxItems: z.int().min(1).max(500).default(60),
});

export const htmlFieldsSchema = z.object({
  title: cssPathSchema,
  link: cssPathSchema.optional(),
  date: cssPathSchema.optional(),
  summary: cssPathSchema.optional(),
  image: cssPathSchema.optional(),
  /** Item text used for stealth-edit detection; on index pages this is usually the deck. */
  body: cssPathSchema.optional(),
  linkAttr: z.string().min(1).default('href'),
  dateAttr: z.string().min(1).default('datetime'),
  imageAttr: z.string().min(1).default('src'),
});

/**
 * The fields a **page source** gets by default. They are inert: page mode
 * reads `<title>` and `meta[name=description]` by convention, not by selector,
 * so the defaults exist to keep `fields` a complete object in the type — the
 * item-mode parser never sees them.
 */
const PAGE_FIELDS = { title: 'title', linkAttr: 'href', dateAttr: 'datetime', imageAttr: 'src' } as const;

export const htmlSourceSchema = z.object({
  ...baseShape,
  kind: z.literal('html'),
  /**
   * Selects the repeating item nodes, not the container.
   *
   * **Absent (or `null`) means the page is the item.** That is the rule for a
   * page with no repeating structure — a download/version page, a status page,
   * a changelog: the item's identity is the hash of the **page's text
   * content** (core's `contentKey`), so "the text differs from the cache" is
   * the whole change model. The link is the page's own URL.
   */
  list: cssPathSchema.nullable().default(null),
  fields: htmlFieldsSchema.default(PAGE_FIELDS),
  /**
   * Selectors for content that must never reach the paper: timestamps that
   * print "3 minutes ago", ad slots, live-blog ticks. These churn the diff —
   * and in page mode they churn the page's own identity, which is why they
   * are stripped before the text is hashed.
   */
  strip: z.array(cssPathSchema).default([]),
});

/**
 * An HTML source in **item mode** — the `list` is a selector, not `null`.
 * `htmlSourceSchema` answers `list: string | null` because both modes are
 * legal; the parsers that need a selector take this narrower type, so a page
 * source cannot reach the item loop at all.
 */
export type HtmlItemSource = Omit<HtmlSource, 'list'> & { readonly list: string };

export const jsonFieldsSchema = z.object({
  title: z.string().min(1),
  link: z.string().min(1),
  date: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  image: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export const jsonSourceSchema = z.object({
  ...baseShape,
  kind: z.literal('json'),
  /** Path to the item array inside the document. `[]` marks an array step. */
  itemsPath: z.string().min(1),
  fields: jsonFieldsSchema,
  /**
   * When the JSON lives in a script island, the selector of that script tag
   * (e.g. `script#__NEXT_DATA__`). Omit to fetch `url` as JSON directly.
   */
  island: cssPathSchema.optional(),
  /** Path to the island payload root. Defaults to `props.pageProps`. */
  islandRoot: z.string().default('props.pageProps'),
});

export const sourceSchema = z.discriminatedUnion('kind', [rssSourceSchema, htmlSourceSchema, jsonSourceSchema]);

export type RssSource = z.infer<typeof rssSourceSchema>;
export type HtmlSource = z.infer<typeof htmlSourceSchema>;
export type JsonSource = z.infer<typeof jsonSourceSchema>;
export type SourceSpec = z.infer<typeof sourceSchema>;
export type HtmlFields = z.infer<typeof htmlFieldsSchema>;
export type JsonFields = z.infer<typeof jsonFieldsSchema>;
export type SourceKindOf<K extends SourceSpec['kind']> = Extract<SourceSpec, { kind: K }>;

/**
 * App config. `.prefault({})`, not `.default({})`, and the difference is not
 * cosmetic: `default` passes the value straight through, so a missing section
 * comes back as `{}` typed as a fully-populated object — `config.masthead.name`
 * is `undefined` at runtime while the compiler swears it is a string. `prefault`
 * feeds the value through the schema, so nested defaults are applied.
 * Measured on zod 4.6.7.
 */
export const appConfigSchema = z.object({
  masthead: z
    .object({
      name: z.string().min(1).max(40).default('The Daily'),
      tagline: z.string().min(1).max(120).default('As it happens, on your own machine'),
      dayStartHour: z.int().min(0).max(23).default(7),
      timezone: z.string().default('local'),
    })
    .prefault({}),
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.int().min(1).max(65_535).default(8787),
      openBrowser: z.boolean().default(true),
    })
    .prefault({}),
  scheduler: z
    .object({
      maxConcurrentFetches: z.int().min(1).max(16).default(4),
      maxConcurrentRenderers: z.int().min(1).max(4).default(1),
      jitterSpanMs: z.int().min(0).max(600_000).default(120_000),
      backoffBaseMs: z.int().min(1_000).max(600_000).default(60_000),
      backoffMaxMs: z.int().min(60_000).max(86_400_000).default(3_600_000),
      maxFailuresBeforePause: z.int().min(1).max(20).default(6),
      /** A source with no success this long ago is `stale`, not quiet. */
      staleAfterMinutes: z.int().min(60).max(10_080).default(2_880),
    })
    .prefault({}),
  scoring: z
    .object({
      watchwords: z.array(z.string().min(1).max(80)).default([]),
      blockwords: z.array(z.string().min(1).max(80)).default([]),
      recencyHalfLifeHours: z.number().min(1).max(336).default(24),
    })
    .prefault({}),
  burst: z
    .object({
      /** Above this fraction of new items, publish "source restructured" instead of a paper. */
      newRatioThreshold: z.number().min(0.05).max(1).default(0.4),
    })
    .prefault({}),
  retention: z
    .object({
      /** Raw response snapshots kept per source; older ones are deleted. */
      snapshotsPerSource: z.int().min(0).max(200).default(10),
      /** Edit diffs kept per item. Items themselves are kept forever. */
      editsPerItem: z.int().min(1).max(200).default(20),
      /** Days of item history the paper can page back through. */
      historyDays: z.int().min(1).max(2_000).default(120),
    })
    .prefault({}),
  notify: z
    .object({
      toasts: z.boolean().default(true),
      toastTitle: z.string().min(1).max(60).default('newspa'),
      minScoreForToast: z.number().min(0).default(6),
      maxToastsPerCycle: z.int().min(0).max(10).default(3),
      quietHours: z
        .object({
          startHour: z.int().min(0).max(23),
          endHour: z.int().min(0).max(23),
        })
        .optional(),
    })
    .prefault({}),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type MastheadConfig = AppConfig['masthead'];

export const defaultAppConfig = (): AppConfig => appConfigSchema.parse({});
