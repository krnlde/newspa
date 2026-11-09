import type { CheerioAPI } from 'cheerio';
import type { HtmlSource } from 'newspa-config';
import { challengeOf, noscriptOnly } from './challenge.ts';
import { pageFields } from './htmlPage.ts';
import type { NodeSet } from './htmlSelectors.ts';
import { collectNodes, fieldsOfItem, loadDocument } from './htmlSelectors.ts';
import { buildItem, unusableReason } from './item.ts';
import type { ParseResult, SkippedItem } from './results.ts';
import { failWith, skipNotes, succeed } from './results.ts';
import type { Sniffed } from './sniff.ts';

/**
 * An index page → items. Everything that can go wrong is named: the selector
 * that matched nothing (with the count the picker recorded), the selector the
 * CSS engine rejected, the wall that answered instead of the page.
 *
 * Two modes, decided by the source: **item mode** (`list` present) reads a
 * repeating node list; **page mode** (`list` absent) treats the whole document
 * as one item keyed by its text (`htmlPage.ts`) — the shape of a version page,
 * a status page, a changelog.
 *
 * `render: true` is the source saying its selectors were authored against a
 * hydrated DOM. The parser cannot fetch, so all it can do is say so: a
 * `no-matches` on a rendered source points at the render layer, not at the
 * selector.
 */

/** A wall is checked when the page produced nothing, so an article that only mentions a captcha is not blocked. */
const wallOrEmpty = (
  text: string,
  spec: HtmlSource,
  sniffed: Sniffed,
  seen: number,
  detail: string,
  notes: readonly string[],
  cause: string | null = spec.list ?? null,
) => {
  const scope = cause === null ? 'the page' : `'${cause}'`;
  const wall = challengeOf(text);
  if (wall === null) {
    return failWith({
      reason: seen === 0 ? 'no-matches' : 'no-usable-items',
      kind: spec.kind,
      detail,
      sniffed: sniffed.kind,
      marker: sniffed.marker,
      cause,
      matchCount: seen,
      notes: [
        ...notes,
        noscriptOnly(text)
          ? 'the page has a <noscript> block: render: true is the fix'
          : 'the payload has no <noscript> block',
      ].filter((note) => note.length > 0),
    });
  }
  return failWith({
    reason: 'challenge',
    kind: spec.kind,
    detail: `the payload is a challenge page: '${wall.marker}' (${
      seen === 0 ? `${scope} matched 0 elements` : `no item was usable out of ${String(seen)}`
    })`,
    sniffed: sniffed.kind,
    marker: sniffed.marker,
    cause: wall.marker,
    matchCount: seen,
    notes: [
      ...notes,
      `the marker came from ${wall.source === 'core' ? "core's CHALLENGE_MARKERS" : 'the extended wall list'}`,
    ],
  });
};

/** The first selector in the source that the CSS engine rejects, if any. */
export const rejectedSelector = (
  probe: NodeSet,
  spec: Pick<HtmlSource, 'list' | 'fields' | 'strip'>,
): string | null => {
  const selectors = [
    spec.fields.title,
    spec.fields.link,
    spec.fields.date,
    spec.fields.summary,
    spec.fields.image,
    spec.fields.body,
    ...spec.strip,
  ];
  for (const selector of selectors) {
    if (selector === undefined) continue;
    try {
      probe.find(selector);
    } catch {
      return selector;
    }
  }
  return null;
};

/** Parse an HTML payload with the source's selectors. */
export const parseHtmlPayload = (text: string, spec: HtmlSource, sniffed: Sniffed): ParseResult => {
  const $ = loadDocument(text);
  const base = { kind: spec.kind, sniffed: sniffed.kind, marker: sniffed.marker } as const;
  const notes: string[] = [sniffed.reason];
  if (spec.render) notes.push('the source is marked render: true, so these selectors expect a hydrated DOM');
  if (spec.list === null) return parsePage($, text, spec, sniffed, notes);
  const collected = collectNodes($, spec.list, spec.matchCount);
  if (collected.ok === false) {
    if (collected.reason === 'invalid-selector') {
      return failWith({
        ...base,
        reason: collected.reason,
        detail: collected.detail,
        cause: spec.list,
        matchCount: null,
        notes,
      });
    }
    return wallOrEmpty(text, spec, sniffed, 0, collected.detail, notes);
  }
  const rejected = rejectedSelector(collected.nodes.eq(0), spec);
  if (rejected !== null) {
    return failWith({
      ...base,
      reason: 'invalid-selector',
      detail: `'${rejected}' is not a selector the CSS engine accepts`,
      cause: rejected,
      matchCount: collected.seen,
      notes,
    });
  }
  const items = [];
  const skipped: SkippedItem[] = [];
  for (let index = 0; index < collected.seen; index += 1) {
    const fields = fieldsOfItem(collected.nodes.eq(index), spec);
    const why = unusableReason(fields);
    if (why !== null) {
      skipped.push({ index, why });
      continue;
    }
    items.push(buildItem(spec, fields));
  }
  notes.push(...skipNotes(skipped));
  if (items.length === 0) {
    return wallOrEmpty(
      text,
      spec,
      sniffed,
      collected.seen,
      `${String(collected.seen)} element(s) matched '${spec.list}', none with a title and a link`,
      notes,
    );
  }
  return succeed({
    items,
    kind: spec.kind,
    sniffed: 'html',
    marker: sniffed.marker,
    notes,
    skipped: skipped.length,
    matchCount: collected.seen,
  });
};

/** The first strip selector the CSS engine rejects. */
const firstRejected = (probe: NodeSet, selectors: readonly string[]): string | null => {
  for (const selector of selectors) {
    try {
      probe.find(selector);
    } catch {
      return selector;
    }
  }
  return null;
};

/**
 * Page mode (`list` absent): one item, keyed by the page's text.
 *
 * The wall is checked **here**, unlike in item mode. An index page needs a
 * title and a link per item, so a captcha page fails on its own and the wall is
 * only the explanation of an empty result; a page source needs nothing, so a
 * login wall's own text ("Sign in to continue") would become the story and
 * churn on every poll. A wall is a fault, never news.
 *
 * It is checked on the **stripped text**, which is what a reader sees: a page
 * that ships a `<noscript>` fallback ("enable JavaScript") is not a wall to a
 * browser with JavaScript, and checking the raw payload would report one on
 * every such page.
 */
const parsePage = ($: CheerioAPI, text: string, spec: HtmlSource, sniffed: Sniffed, notes: string[]): ParseResult => {
  const base = { kind: spec.kind, sniffed: sniffed.kind, marker: sniffed.marker } as const;
  const rejected = firstRejected($.root(), spec.strip);
  if (rejected !== null) {
    return failWith({
      ...base,
      reason: 'invalid-selector',
      detail: `'${rejected}' is not a selector the CSS engine accepts`,
      cause: rejected,
      matchCount: null,
      notes,
    });
  }
  const page = pageFields($, spec);
  if (page === null) {
    return wallOrEmpty(text, spec, sniffed, 1, 'the page has no text content left after stripping its noise', notes);
  }
  const wall = challengeOf(page.fields.body);
  if (wall !== null) {
    return failWith({
      ...base,
      reason: 'challenge',
      detail: `the payload is a challenge page: '${wall.marker}', so the page's text is the wall and not the news`,
      cause: wall.marker,
      matchCount: null,
      notes: [
        ...notes,
        `the marker came from ${wall.source === 'core' ? "core's CHALLENGE_MARKERS" : 'the extended wall list'}`,
      ],
    });
  }
  notes.push(`the page is one item: ${String(page.chars)} characters of text, keyed by content`);
  return succeed({
    items: [buildItem(spec, page.fields, page.key)],
    kind: spec.kind,
    sniffed: 'html',
    marker: sniffed.marker,
    notes,
    matchCount: 1,
  });
};
