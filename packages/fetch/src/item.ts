import type { SourceSpec } from 'newspa-config';
import type { PickedItem } from 'newspa-core';
import { capBody, itemId, normalizeText, parseHttpDate, resolveLink } from 'newspa-core';
import { decodeEntities } from './htmlText.ts';

/**
 * One place to turn extracted fields into a `PickedItem`, so no parser invents
 * identity, a timestamp grammar or a body length of its own:
 *
 * - **identity** is core's (`itemId`, D-005: canonical link, then title+day).
 * - **timestamps** are core's `parseHttpDate`, never `Date.parse` (D-020: a
 *   zone-less stamp is UTC here, always, so a story's age does not depend on
 *   which machine opens the paper).
 * - **`body` is capped** by core (`capBody`, 1 200 characters): evidence for
 *   edit detection and scoring, never display (D-017).
 *
 * No clock is read. A parser that called `Date.now()` could not be tested
 * deterministically, and nothing in this slice needs to know what time it is.
 */

export interface RawFields {
  readonly title: string;
  readonly link: string;
  readonly publishedAt: string | null;
  readonly summary: string | null;
  readonly image: string | null;
  readonly author: string | null;
  readonly body: string;
}

export const emptyFields = (): RawFields => ({
  title: '',
  link: '',
  publishedAt: null,
  summary: null,
  image: null,
  author: null,
  body: '',
});

const clean = (value: string | null): string | null => {
  const text = value === null ? '' : normalizeText(value);
  return text.length > 0 ? text : null;
};

/**
 * A link, made absolute against the source's URL: feeds and index pages ship
 * root-relative links (`/world/2026/nov/08/…`), and a relative link is not a
 * clickable one.
 *
 * Entities decode first — `?a=1&amp;b=2` in HTML is one URL with two
 * parameters, and a literal `&amp;` left in place makes a parameter named
 * `amp;b` — and `&amp;` in an XML `href` is the same URL.
 */
export const absoluteLink = (href: string, baseUrl: string): string => {
  const text = normalizeText(decodeEntities(href));
  if (text.length === 0) return '';
  return resolveLink(text, baseUrl);
};

export const toIsoDate = (value: string | null): string | null => parseHttpDate(value ?? undefined);

/**
 * Fields → a `PickedItem`.
 *
 * `key` overrides the identity, and only the page-level HTML parser passes it:
 * a whole document is keyed by its **text content** (core's `contentKey`), and
 * that hash has to be taken on the **full** text — `body` is capped to 1 200
 * characters here, so a key derived from the stored body would ignore the
 * bottom of the page. Every other parser leaves it out and gets D-005's key
 * (canonical link, else title+day). A feed's `guid` / Atom `id` is not part of
 * any key: identity is one rule, no configuration.
 */
export const buildItem = (spec: Pick<SourceSpec, 'id' | 'url'>, raw: RawFields, key?: string): PickedItem => {
  const title = normalizeText(raw.title);
  const link = raw.link.length > 0 ? absoluteLink(raw.link, spec.url) : '';
  const publishedAt = toIsoDate(raw.publishedAt);
  return {
    key: key ?? itemId(spec.id, link, title, publishedAt),
    title,
    link,
    publishedAt,
    summary: clean(raw.summary),
    image: raw.image === null ? null : clean(absoluteLink(raw.image, spec.url)),
    author: clean(raw.author),
    body: capBody(normalizeText(raw.body)),
  };
};

/** Why an item node is not publishable. The reason is the point (rule 5). */
export const unusableReason = (raw: RawFields): string | null => {
  if (normalizeText(raw.title).length === 0) return 'no title';
  if (raw.link.length === 0) return 'no link';
  return null;
};
