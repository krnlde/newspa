/**
 * What a payload says about itself: when it claims to have last changed, which
 * generator produced it, and how often it asks to be polled.
 *
 * These are **hints, never the truth** (docs/decisions.md D-020). The truth is
 * the diff of normalized items. A hint may skip the expensive work (parse,
 * score, emit events) — it may never suppress an item that was extracted, and
 * the reason a poll did the cheap thing is recorded, because an optimization
 * that silently never fires is invisible.
 *
 * Regex-based, deliberately: this runs on the server over raw bytes, where
 * there is no DOM, and the tags we read are a small, flat, attribute-only
 * surface. A tolerant HTML parser would be a dependency for 6 tag names.
 */

import { parseHttpDate } from './httpDate.ts';
import type { SourceKind } from './types.ts';

/** HTML is scanned up to `</head>`, else this many bytes: meta tags are in the head. */
const HEAD_SCAN_BYTES = 65_536;

/**
 * `content`/`href` values that declare "this changed at…". `article:published_time`
 * and `og:published_time` are **not** in this list: a page whose newest article
 * is old has not changed, and a publish date is not a modify date.
 */
const MODIFIED_KEYS: readonly string[] = [
  'last-modified',
  'lastmodified',
  'modified',
  'datemodified',
  'date-modified',
  'article:modified_time',
  'article:modified',
  'og:updated_time',
  'video:publication_date',
  'dcterms.modified',
  'dc.date.modified',
  'dc.modified',
  'dcterms.date',
  'itemprop:datemodified',
  'datemodified_meta',
];

/** `http-equiv` values that mean "do not trust a cached copy of this page". */
const NO_CACHE_META: readonly string[] = ['no-cache', 'no-store', 'must-revalidate', 'private', 'max-age=0'];

const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

const parseAttributes = (raw: string): Record<string, string> => {
  const attrs: { [name: string]: string } = {};
  for (const match of raw.matchAll(ATTR)) {
    const name = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name.length > 0 && !(name in attrs)) attrs[name] = value;
  }
  return attrs;
};

const headRegion = (text: string): string => {
  const end = text.toLowerCase().indexOf('</head>');
  return end === -1 ? text.slice(0, HEAD_SCAN_BYTES) : text.slice(0, end);
};

const all = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((m) => m[1] ?? '');

const maxIso = (values: readonly string[]): string | null => {
  let best: string | null = null;
  for (const value of values) {
    const iso = parseHttpDate(value);
    if (iso === null) continue;
    if (best === null || Date.parse(iso) > Date.parse(best)) best = iso;
  }
  return best;
};

const intFrom = (text: string, pattern: RegExp): number | null => {
  const match = pattern.exec(text);
  const raw = match?.[1]?.trim();
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 20_000 ? n : null;
};

/** RSS and Atom say when the feed was built and how often to poll it. */
const feedSignals = (
  text: string,
): { modified: string | null; generator: string | null; ttl: number | null; keys: string[] } => {
  const stamps: string[] = [];
  const keys: string[] = [];
  const push = (pattern: RegExp, key: string): void => {
    const found = all(text, pattern);
    if (found.length > 0) {
      keys.push(key);
      stamps.push(...found);
    }
  };
  push(/<lastbuilddate[^>]*>([\s\S]*?)<\/lastbuilddate>/gi, 'lastBuildDate');
  push(/<lastmod[^>]*>([\s\S]*?)<\/lastmod>/gi, 'lastmod');
  push(/<pubdate[^>]*>([\s\S]*?)<\/pubdate>/gi, 'pubDate');
  push(/<updated[^>]*>([\s\S]*?)<\/updated>/gi, 'updated');
  const generator = /<generator[^>]*>([\s\S]*?)<\/generator>/i.exec(text)?.[1]?.trim() ?? '';
  const ttl = intFrom(text, /<ttl[^>]*>(\d+)<\/ttl>/i);
  return { modified: maxIso(stamps), generator: generator.length === 0 ? null : generator, ttl, keys };
};

/** A JSON feed/endpoint: a top-level timestamp and generator, if it declares them. */
const jsonSignals = (text: string): { modified: string | null; generator: string | null; keys: string[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { modified: null, generator: null, keys: [] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return { modified: null, generator: null, keys: [] };
  const record = parsed as Record<string, unknown>;
  const keys: string[] = [];
  const stamps: string[] = [];
  for (const key of [
    'modified',
    'modifiedAt',
    'updated',
    'updatedAt',
    'last_modified',
    'lastModified',
    'lastBuildDate',
  ]) {
    const value = record[key];
    if (typeof value === 'string') {
      const iso = parseHttpDate(value);
      if (iso !== null) {
        keys.push(key);
        stamps.push(value);
      }
    }
  }
  const generator = record['generator'];
  return {
    modified: maxIso(stamps),
    generator: typeof generator === 'string' && generator.length > 0 ? generator : null,
    keys,
  };
};

export interface PageSignals {
  /** Newest timestamp the payload declares for itself, UTC ISO, `null` if none. */
  readonly declaredModifiedAt: string | null;
  /** `<meta name=generator>` / `<generator>` — a change here predicts a restructure. */
  readonly generator: string | null;
  /** RSS `<ttl>`, in minutes: the source's own poll-cadence hint. */
  readonly ttlMinutes: number | null;
  /** The payload says "do not cache me", so a 304 fast path is not expected. */
  readonly noCacheMeta: boolean;
  /** Which signal names were found, so a health note can name what it trusted. */
  readonly signals: readonly string[];
}

const EMPTY: PageSignals = {
  declaredModifiedAt: null,
  generator: null,
  ttlMinutes: null,
  noCacheMeta: false,
  signals: [],
};

/**
 * Read the self-declared change signals out of a payload.
 *
 * `maxIso` over every stamp found is the whole policy: the newest declared
 * timestamp is the one that says "this page moved". A publisher that stamps
 * the footer with a build time is a source that declares a change on every
 * poll — that costs a full parse, which is the correct price for a page that
 * tells us nothing useful, and `signals` makes it diagnosable.
 */
export const pageSignals = (text: string, kind: SourceKind): PageSignals => {
  if (text.length === 0) return EMPTY;
  if (kind === 'json') {
    const json = jsonSignals(text);
    return { ...EMPTY, declaredModifiedAt: json.modified, generator: json.generator, signals: json.keys };
  }
  if (kind === 'rss') {
    const feed = feedSignals(text);
    return {
      declaredModifiedAt: feed.modified,
      generator: feed.generator,
      ttlMinutes: feed.ttl,
      noCacheMeta: false,
      signals: feed.keys,
    };
  }

  const head = headRegion(text);
  const stamps: string[] = [];
  const keys: string[] = [];
  let generator: string | null = null;
  let noCacheMeta = false;

  for (const match of head.matchAll(/<(meta|link)\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[2] ?? '');
    const key = (attrs['name'] ?? attrs['property'] ?? attrs['http-equiv'] ?? '').toLowerCase();
    const rel = (attrs['rel'] ?? '').toLowerCase();
    const content = attrs['content'] ?? attrs['href'] ?? '';
    if (key === 'generator') {
      if (content.length > 0) {
        generator = content;
        keys.push('generator');
      }
      continue;
    }
    if (key === 'expires') {
      // The no-cache idiom (a 1997 date, or `0`). Browsers ignore a meta
      // `Expires`, so nobody puts one there to be obeyed: it is a statement
      // about the response, and reading it needs no clock.
      noCacheMeta = true;
      keys.push('expires');
      continue;
    }
    if (key === 'cache-control' || key === 'pragma') {
      const lower = content.toLowerCase();
      if (NO_CACHE_META.some((token) => lower.includes(token))) {
        noCacheMeta = true;
        keys.push(key);
      }
      continue;
    }
    // `rel=lastmod` (RFC 822 in `href`) is a page-level change signal with no
    // `name`/`property`, so it is matched on the rel token.
    const isModified = MODIFIED_KEYS.includes(key) || (key.length === 0 && rel === 'lastmod');
    if (isModified && content.length > 0) {
      const iso = parseHttpDate(content);
      if (iso !== null) {
        stamps.push(content);
        keys.push(key.length > 0 ? key : 'link[rel=lastmod]');
      }
    }
  }

  return {
    declaredModifiedAt: maxIso(stamps),
    generator,
    ttlMinutes: null,
    noCacheMeta,
    signals: [...new Set(keys)],
  };
};
