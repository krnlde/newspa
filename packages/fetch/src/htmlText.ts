import { load } from 'cheerio';
import { normalizeText } from 'newspa-core';

/**
 * Markup to text, with the paragraph structure intact. Three measured reasons
 * this is a function and not cheerio's `.text()`:
 *
 * 1. `.text()` inserts **nothing** at an element boundary: `<p>One</p><p>Two</p>`
 *    reads back as `OneTwo`, and `<p>a<br>b</p>` as `ab`. Core's
 *    `firstParagraph` splits on blank lines, so a deck built that way is a
 *    run-on sentence and an edited paragraph disappears from the diff.
 * 2. `.text()` includes `<script>` and `<style>` content (measured on a real
 *    page: `var x=1;a{}real`). A page's inline JS inside an item node would
 *    then be the story body, and it churns every time the bundle is rebuilt.
 * 3. `load()` on a **fragment with no element** drops that text, so every
 *    fragment here goes in through a wrapper element — and the wrapper is
 *    selected by tag, not by id: `$('#root')` on `<root>` matches nothing
 *    (measured, and it silently returns the empty string).
 */

/** Elements whose text is never the story. */
export const NOISE_SELECTOR =
  'script, style, noscript, template, iframe, object, embed, canvas, form, svg, link, meta, picture, source';

/** Closing tags that end a paragraph in the markup feeds and index pages ship. */
const PARAGRAPH_END =
  /<\/(?:p|div|li|ul|ol|dl|dd|dt|h[1-6]|blockquote|tr|article|section|figure|figcaption|pre|table|tbody|thead|tfoot|td|th|col|colgroup|caption|header|footer|nav|aside|main)\s*>/gi;

const LINE_END = /<br\s*\/?>/gi;

const ROOT = 'root';

/** A wrapper element, because a document with no element drops its text. */
const fragment = (markup: string): ReturnType<typeof load> => load(`<${ROOT}>${markup}</${ROOT}>`);

const paragraphs = (raw: string): string =>
  raw
    .split(/\s*\n\s*/)
    .map((part) => normalizeText(part))
    .filter((part) => part.length > 0)
    .join('\n\n');

/**
 * Entities decoded, tags gone, paragraphs kept. Feeds escape HTML into
 * `description` (the Guardian's ships `<p>` blocks plus a "Continue reading…"
 * link) and `content:encoded` ships whole articles, so the result is capped by
 * core's `capBody` before it is stored (D-017).
 */
export const markupToText = (markup: string): string => {
  const marked = markup.replace(LINE_END, '\n\n').replace(PARAGRAPH_END, '\n\n');
  const $ = fragment(marked);
  $(NOISE_SELECTOR).remove();
  return paragraphs($(ROOT).text());
};

/**
 * Entities decoded, markup left alone. parse5 decodes attribute values itself
 * (`href="/a?x=1&amp;y=2"` reads back as `/a?x=1&y=2`), so this is for the
 * places that hand over text, not attributes: an XML `link` text node and a
 * JSON string, where a literal `&amp;` becomes a parameter named `amp;b`.
 */
export const decodeEntities = (value: string): string => {
  const $ = fragment('');
  const root = $(ROOT);
  root.append(value);
  return root.text();
};
