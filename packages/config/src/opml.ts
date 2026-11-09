import { z } from 'zod';

/**
 * OPML 2.0: the standard exit ramp for feeds. Every RSS reader eats it, so the
 * subscription list is never trapped here.
 *
 * The asymmetry worth stating (docs/decisions.md D-014): OPML has no field for
 * source weights or watchwords, so it is an exit ramp, not the archive. The
 * native watchlist format carries those.
 */

export const OPML_VERSION = 'opml2.0';

export const opmlFeedSchema = z.object({
  title: z.string().min(1).max(120),
  xmlUrl: z.url(),
  htmlUrl: z.string().min(1).max(500).optional(),
  /** Nested `<outline>` group name, used as the source's `group`. */
  group: z.string().min(1).max(60).optional(),
});

export type OpmlFeed = z.infer<typeof opmlFeedSchema>;

const decode = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&amp;/g, '&');

/**
 * An attribute value, in **either** quote style. Single quotes are legal XML,
 * and readers emit them; the first cut of this file matched only `"…"`, which
 * made a single-quoted `<outline>` vanish — measured, `parseOpml` returned the
 * other feeds with `issues: []`, i.e. a silent zero (rule 5). The leading
 * `(^|\s)` is the word boundary the first cut lacked: `data-xmlUrl` was
 * measured matching as `xmlUrl`.
 */
const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const raw = match?.[1] ?? match?.[2];
  return raw === undefined ? undefined : decode(raw);
};

export interface OpmlParseResult {
  feeds: OpmlFeed[];
  issues: string[];
}

const pickAttribute = (tag: string, names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = attribute(tag, name);
    if (value !== undefined && value.length > 0) return value;
  }
  return undefined;
};

interface OutlineParts {
  group?: string;
  feed?: OpmlFeed;
  issue?: string;
}

/** An outline with a label and no `xmlUrl` is a folder in every reader. */
const parseOutline = (tag: string, group: string | undefined): OutlineParts => {
  const xmlUrl = pickAttribute(tag, ['xmlUrl', 'xmlurl']);
  if (xmlUrl === undefined) {
    const label = pickAttribute(tag, ['text', 'title', 'name']);
    return label === undefined ? {} : { group: label };
  }
  const title = pickAttribute(tag, ['title', 'text']) ?? xmlUrl;
  const htmlUrl = attribute(tag, 'htmlUrl');
  const parsed = opmlFeedSchema.safeParse({
    title,
    xmlUrl,
    ...(htmlUrl === undefined ? {} : { htmlUrl }),
    ...(group === undefined ? {} : { group }),
  });
  return parsed.success
    ? { feed: parsed.data }
    : { issue: `${xmlUrl}: ${parsed.error.issues[0]?.message ?? 'invalid feed'}` };
};

/**
 * One `<outline>` start tag, quotes respected: `[^>…]` would end the tag at the
 * first `>`, and `>` is legal inside an attribute value — measured,
 * `text="A > B"` truncated the tag, dropped that feed, and reported nothing.
 * Values run in quoted runs, so a `>` inside one cannot close the tag, and a
 * tag may be written across lines.
 */
const OUTLINE_TAG = /<outline\b(?:[^<>"']|"[^"]*"|'[^']*')*>|<\/outline\s*>/gi;

/**
 * Intentionally minimal: a scanner over `<outline>` tags is enough for OPML,
 * with one exception that matters — folders. `</outline>` pops the group, so a
 * feed that follows a closed folder is not silently filed inside it. Failure
 * modes are reported, never dropped silently: a document that yields no feed
 * says so, and a feed whose `xmlUrl` fails the schema is an issue naming it.
 */
export const parseOpml = (text: string): OpmlParseResult => {
  const feeds: OpmlFeed[] = [];
  const issues: string[] = [];
  if (!/<opml[\s>]/i.test(text)) issues.push('not an OPML document: no <opml> element');

  const folders: string[] = [];
  let outlines = 0;
  for (const match of text.matchAll(OUTLINE_TAG)) {
    const tag = match[0];
    if (tag.startsWith('</')) {
      folders.pop();
      continue;
    }
    outlines += 1;
    const parts = parseOutline(tag, folders[folders.length - 1]);
    if (parts.group !== undefined && !tag.endsWith('/>')) folders.push(parts.group);
    if (parts.feed !== undefined) feeds.push(parts.feed);
    if (parts.issue !== undefined) issues.push(parts.issue);
  }
  // A zero-item result never leaves the caller guessing which of the three it
  // is: no outlines at all, outlines whose attributes matched nothing (the
  // shape a quote-style bug produces), or outlines that all failed the schema
  // (already reported, naming each url).
  if (outlines > 0 && feeds.length === 0 && issues.length === 0) {
    issues.push(`${outlines} outline element(s), none with a usable xmlUrl`);
  }
  if (outlines === 0 && issues.length === 0) issues.push('no outlines with xmlUrl');
  return { feeds, issues };
};

const encode = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const outlineFor = (feed: OpmlFeed, depth: number): string => {
  const pad = ' '.repeat(4 + depth);
  const htmlUrl = feed.htmlUrl === undefined ? '' : ` htmlUrl="${encode(feed.htmlUrl)}"`;
  return `${pad}<outline type="rss" text="${encode(feed.title)}" title="${encode(feed.title)}" xmlUrl="${encode(feed.xmlUrl)}"${htmlUrl}/>`;
};

/**
 * Groups become nested outlines, because that is how readers show folders — and
 * ungrouped feeds stay at `<body>` level, so a serialize → parse round trip
 * does not invent a group for them.
 */
export const serializeOpml = (feeds: readonly OpmlFeed[], title: string): string => {
  const groups = new Map<string | undefined, OpmlFeed[]>();
  for (const feed of [...feeds].sort((a, b) => a.title.localeCompare(b.title))) {
    const key = feed.group;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [feed]);
    else bucket.push(feed);
  }
  const lines: string[] = ['  <body>'];
  for (const [group, members] of [...groups.entries()].sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))) {
    if (group === undefined) {
      lines.push(...members.map((feed) => outlineFor(feed, 2)));
      continue;
    }
    lines.push(`    <outline text="${encode(group)}" title="${encode(group)}">`);
    lines.push(...members.map((feed) => outlineFor(feed, 4)));
    lines.push('    </outline>');
  }
  lines.push('  </body>', '</opml>');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${encode(title)}</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    ...lines,
  ].join('\n');
};
