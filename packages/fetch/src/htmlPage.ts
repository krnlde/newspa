import type { CheerioAPI } from 'cheerio';
import type { HtmlSource } from 'newspa-config';
import { normalizeText, pageKey } from 'newspa-core';
import type { NodeSet } from './htmlSelectors.ts';
import { markupToText, NOISE_SELECTOR } from './htmlText.ts';
import type { RawFields } from './item.ts';

/**
 * The page-level HTML parser: the source has **no `list`**, so the document
 * itself is the item, at a stable address (`node-versions:page`, core's
 * `pageKey`).
 *
 * That is the rule for a page with no repeating structure — a download page
 * (the nodejs.org release list, where a new version is a line of text), a status
 * page, a changelog. It is also the user's change model in its simplest form:
 * compare the text with the cache, and when it differs, report the edit.
 *
 * The address is **not** a hash of the text, and that is the fix (D-028): the
 * hash moved on every edit, so one slot printed as a new story twelve times and
 * asked the reader to mark it read twelve times. `pollItems` now finds the same
 * row by key and compares its text, so the paper says *edited* — which is what
 * the reader acts on — and `capPageBody` keeps the compared text wide enough to
 * contain a new version line below the display window.
 *
 * `strip` is applied **before** the text is compared, which is what makes the
 * model work on a page that prints "last updated 3 minutes ago": ticking text
 * would report an edit on every poll.
 */

/** The document's own body, falling back to the root for a fragment. */
const bodyOf = ($: CheerioAPI): NodeSet => {
  const body = $('body');
  return body.length > 0 ? body : $.root();
};

/** The first non-empty text among these selectors. */
const firstText = ($: CheerioAPI, selectors: readonly string[]): string => {
  for (const selector of selectors) {
    const node = $(selector).first();
    if (node.length === 0) continue;
    const text = normalizeText(node.text());
    if (text.length > 0) return text;
  }
  return '';
};

/** The first non-empty attribute among these selectors. */
const firstAttr = ($: CheerioAPI, selectors: readonly string[], attr: string): string | null => {
  for (const selector of selectors) {
    const node = $(selector).first();
    if (node.length === 0) continue;
    const value = node.attr(attr);
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return null;
};

const TITLE_SELECTORS = ['title', 'h1'];
const TITLE_META_SELECTORS = ['[property="og:title"]', '[name=twitter:title]'];
const DESCRIPTION_SELECTORS = ['meta[name=description]', '[property="og:description"]', '[name=description]'];
const IMAGE_SELECTORS = ['[property="og:image"]', '[name=twitter:image]', 'img'];
const DATE_SELECTORS = ['[property="article:published_time"]', 'meta[name=date]', 'time[datetime]', '[datetime]'];

/**
 * The page as fields, plus its identity. `null` when the page has **no text**
 * after stripping: that is a fault, and the caller names it — an empty page is
 * never "no news" (rule 5).
 *
 * The link is the source's own URL: the paper links out to the page it read.
 * The body is the **full** stripped text, uncapped here; the page-mode caller
 * applies `capPageBody`, so the compared text reaches well past the display
 * window (`body` on a `PickedItem` is 6 000 chars for this mode, D-028).
 *
 * `meta` fields are read from `content`, never from text: a `meta` element has
 * no text node, so a description read as text is `''` on every page on the web.
 */
export const pageFields = (
  $: CheerioAPI,
  spec: HtmlSource,
): { readonly fields: RawFields; readonly key: string; readonly chars: number } | null => {
  const scoped = spec.strip.length > 0 ? `${NOISE_SELECTOR}, ${spec.strip.join(', ')}` : NOISE_SELECTOR;
  const body = bodyOf($);
  body.find(scoped).remove();
  const markup = body.html();
  const text = normalizeText(markupToText(markup === null ? body.text() : markup));
  if (text.length === 0) return null;

  const title = firstText($, TITLE_SELECTORS) || (firstAttr($, TITLE_META_SELECTORS, 'content') ?? '');
  const summary = firstAttr($, DESCRIPTION_SELECTORS, 'content') ?? '';
  return {
    key: pageKey(spec.id),
    fields: {
      title: title.length > 0 ? title : spec.label,
      link: spec.url,
      publishedAt: firstAttr($, DATE_SELECTORS, 'content') ?? firstAttr($, DATE_SELECTORS, 'datetime'),
      summary: summary.length > 0 ? summary : null,
      image: firstAttr($, IMAGE_SELECTORS, 'content') ?? firstAttr($, IMAGE_SELECTORS, 'src'),
      author: null,
      body: text,
    },
    chars: text.length,
  };
};
