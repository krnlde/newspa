import type { Edition, EditionSection, EditionStats, ItemView } from './api.ts';
import { sectionFor, sectionOf, sectionTitleFor } from './sections.ts';

/** Deterministic FNV-1a, 32-bit, hex-encoded. Browser-safe, no node:crypto. */
export const hashKey = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

/**
 * Identity for a whole document, from its **text content** — the rule for an
 * HTML source with no item selectors (a version page, a status page): there
 * is no repeating item to key on, so the page itself is the item, and "the
 * text differs from the cache" is the whole change model. Equal normalized
 * text → equal key → the diff reports an *edit*; changed text → new key →
 * the paper prints it as new.
 *
 * The hash runs on **whitespace-normalized text only**, deliberately:
 * `normalizeText` folds runs of whitespace, which a human reads as "the same
 * page" even when the publisher re-indented the markup. The parser strips
 * noise elements (ticking timestamps, ad slots) **before** handing text here,
 * because those churn; that is a policy decision, and so is this one.
 */
export const contentKey = (sourceId: string, text: string): string => `${sourceId}:h${hashKey(normalizeText(text))}`;

/**
 * Tracking params stripped from every link before it becomes an identity.
 * Deliberately conservative: `ref`, `src`, `feature` are NOT stripped, because
 * plenty of sites need them (YouTube, Slack, newsletters) and breaking a link
 * costs an article; a query param costs nothing.
 */
export const TRACKING_PARAMS: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'twclid',
  'ttclid',
  'yclid',
  'igshid',
  'igsh',
  'mc_cid',
  'mc_eid',
  'spm',
  'ncid',
  'ocid',
  'cmpid',
  'trk',
  'trkCampaign',
  'trkInfo',
  'scid',
  's_kwcd',
  'si',
  'share',
  'share_id',
  'srcid',
  'partner_id',
  'aff',
  'affid',
  'cx',
  'ivk',
  // Yahoo Finance appends `?.tsrc=rss` to every link in its per-ticker feeds
  // (measured: `feeds.finance.yahoo.com/rss/2.0/headline?s=AAPL`), so the query
  // key arrives as the literal `.tsrc`. Identity is the canonical link (D-005),
  // so both spellings are stripped: the same story arriving as `…html`,
  // `…html?.tsrc=rss` and `…html?tsrc=rss&from=…` is **one** item, not three.
  '.tsrc',
  'tsrc',
];

const TRACKING_PREFIXES: readonly string[] = ['utm_'];

export interface CanonicalizeOptions {
  readonly stripTrackingParams?: boolean;
  readonly stripFragment?: boolean;
  readonly stripAmp?: boolean;
  readonly stripTrailingSlash?: boolean;
  readonly keepParams?: readonly string[];
}

const isTrackingParam = (name: string, keep: readonly string[]): boolean => {
  const lower = name.toLowerCase();
  if (keep.includes(lower)) return false;
  if (TRACKING_PARAMS.includes(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
};

/**
 * Canonical URL used as item identity. Two rules dominate:
 *  - a fragment is never identity (one story, many anchor positions);
 *  - `index.html`, `www.` and the default port are cosmetic.
 */
export const canonicalizeUrl = (raw: string, base?: string, options: CanonicalizeOptions = {}): string => {
  const {
    stripTrackingParams = true,
    stripFragment = true,
    stripAmp = true,
    stripTrailingSlash = false,
    keepParams = [],
  } = options;

  // Empty in, empty out, and no placeholder base: `new URL('not a url',
  // 'https://newspa.invalid/')` *succeeds* as a relative path, so a placeholder
  // origin leaks into the result and is `https:`-shaped — `itemId`'s guard
  // accepts it and every linkless item on a source collapses onto one identity,
  // making the documented title+day fallback unreachable. Without a base, an
  // absolute URL is required; relative links are resolved by `resolveLink`
  // against the document URL, which is the caller that actually has one.
  const text = raw.trim();
  if (text.length === 0) return '';

  let url: URL;
  try {
    url = base === undefined ? new URL(text) : new URL(text, base);
  } catch {
    return text;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return text;

  url.hash = stripFragment ? '' : url.hash;
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  // No default-port stripping: the WHATWG parser already drops `:80`/`:443` at
  // construction, so `url.port` is never the default port here.

  if (stripAmp) {
    url.searchParams.delete('amp');
    url.searchParams.delete('amp#');
    url.searchParams.delete('outputType');
    url.pathname = url.pathname.replace(/\/amp(\/|$)/i, '$1').replace(/\.amp$/i, '');
  }

  if (stripTrackingParams) {
    for (const name of [...url.searchParams.keys()]) {
      if (
        isTrackingParam(
          name,
          keepParams.map((k) => k.toLowerCase()),
        )
      )
        url.searchParams.delete(name);
    }
  }

  // Sorted params: the same story reached in a different param order is the same story.
  url.searchParams.sort();

  let href = url.toString();
  if (stripTrailingSlash && url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/$/, '');
    href = url.toString();
  }
  return href.replace(/index\.html$/i, '');
};

/** Whitespace normalization for text that will be compared across polls. */
export const normalizeText = (value: string): string =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Identity for a parsed item. `link` is the only stable key on the open web,
 * so it wins whenever it exists; title+day hashing is the last resort.
 *
 * A declared `guid` / Atom `id` is **not** part of the key (decided 2026-11,
 * after building it and reading the fallout): a publisher-vetted identifier
 * needs `isPermaLink` parsing, per-grammar hashing and a strategy knob — and
 * the failure it prevents, a re-titled release printing as two stories, is a
 * cost the paper accepts. One rule, no configuration: canonical link, else
 * title+day. The parser still *reads* guids (feeds differ, and the field
 * travels to the health notes), it just does not hand them to the key.
 */
export const itemId = (sourceId: string, link: string, title: string, publishedAt: string | null): string => {
  const canonical = canonicalizeUrl(link);
  if (canonical.length > 0 && /^https?:/.test(canonical)) {
    const u = new URL(canonical);
    return `${sourceId}:${hashKey(`${u.host}${u.pathname}${u.search}`)}`;
  }
  const day = (publishedAt ?? '').slice(0, 10);
  return `${sourceId}:t${hashKey(`${normalizeText(title).toLowerCase()}|${day}`)}`;
};

/** Absolute link resolution against the document URL (never trust `href` raw). */
export const resolveLink = (href: string, documentUrl: string): string => {
  try {
    return new URL(href, documentUrl).toString();
  } catch {
    return href;
  }
};

export const emptyStats = (): EditionStats => ({
  items: 0,
  newItems: 0,
  editedItems: 0,
  sourcesFetched: 0,
  sourcesUnhealthy: 0,
  cycles: 0,
});

/**
 * The section a story prints in. **The source's own words win**; the keyword
 * ladder is the fallback, because the author of a source knows what it is, and
 * the ladder is what makes the 40 sources nobody labelled readable.
 */
const headingOf = (
  item: ItemView,
  declared: ReadonlyMap<string, string>,
): { readonly id: string; readonly title: string } => {
  const label = declared.get(item.sourceId);
  if (label !== undefined) return sectionOf(label);
  const id = sectionFor(`${item.title} ${item.teaser} ${item.sourceLabel}`);
  return { id, title: sectionTitleFor(id) };
};

export const buildEdition = (
  id: string,
  generatedAt: string,
  dateline: string,
  items: readonly ItemView[],
  stats: EditionStats,
  declared: ReadonlyMap<string, string> = new Map(),
): Edition => {
  const sorted = [...items].sort((a, b) => b.score - a.score || compareIso(b.publishedAt, a.publishedAt));
  const lead = sorted[0] ?? null;
  const buckets = new Map<string, { readonly id: string; readonly title: string; readonly items: ItemView[] }>();
  for (const item of sorted) {
    const heading = headingOf(item, declared);
    const bucket = buckets.get(heading.id);
    if (bucket === undefined) buckets.set(heading.id, { ...heading, items: [item] });
    else bucket.items.push(item);
  }
  const sections: EditionSection[] = [...buckets.values()]
    .map((bucket) => ({
      id: bucket.id,
      title: bucket.title,
      blurb: bucket.items[0]?.teaser ?? null,
      items: bucket.items,
    }))
    .sort((a, b) => b.items.reduce((sum, i) => sum + i.score, 0) - a.items.reduce((sum, i) => sum + i.score, 0));

  return {
    id,
    generatedAt,
    dateline,
    lead,
    sections,
    edited: sorted.filter((i) => i.editCount > 0),
    stats,
  };
};

/** ISO strings sort lexically, which keeps this cheap and stable. */
export const compareIso = (a: string | null, b: string | null): number => {
  const x = a ?? '';
  const y = b ?? '';
  if (x === y) return 0;
  return x < y ? -1 : 1;
};
