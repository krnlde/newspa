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
 *   edit detection and scoring, never display (D-017). The page-mode caller
 *   passes `capPageBody` (6 000) instead, because since D-028 its stored text
 *   *is* the diff input and 1 200 characters is a window on the page, not a page.
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

/**
 * The spec, with its **link base** pointed at the URL that answered (D-030).
 *
 * A payload is read where it was served from. Resolving its root-relative links
 * against the URL in the source file is the bug that `absoluteLink` cannot fix:
 * after a permanent redirect, the item's text is from the new place and its link
 * is from the old one, and the link dies with the old host. `TransportOk.url` is
 * the URL after the redirects (it falls back to `spec.url` when the runtime
 * reports none), so this is the whole fix — self-healing, one hop per poll, and
 * silent. Making the move **permanent** is the reader's decision, not the
 * poller's: `pnpm sources:migrate` writes it through `writeSource` (D-011).
 *
 * The cost is named, because it is real: identity is the canonical link (D-005),
 * so the poll that starts resolving on the new host keys its items differently —
 * **once**. Apply the migration and the keys stop moving.
 */
export const withBase = <S extends SourceSpec>(spec: S, url: string): S => {
  const served: S = { ...spec, url };
  return served;
};

export const toIsoDate = (value: string | null): string | null => parseHttpDate(value ?? undefined);

/**
 * Fields → a `PickedItem`.
 *
 * `key` overrides the identity, and only the page-level HTML parser passes it: a
 * whole document is one item at a **stable address** (core's `pageKey`, D-028),
 * not a hash of its text — the hash made one slot print as a new story on every
 * edit. Every other parser leaves it out and gets D-005's key (canonical link,
 * else title+day). A feed's `guid` / Atom `id` is not part of any key: identity
 * is one rule, no configuration.
 *
 * `cap` is the body window, and only the page-level parser passes it: that
 * source's stored text is what the diff compares once the key stopped moving, so
 * it gets `capPageBody` rather than the 1 200-char display window.
 */
export const buildItem = (
  spec: Pick<SourceSpec, 'id' | 'url'>,
  raw: RawFields,
  key?: string,
  cap: (text: string) => string = capBody,
): PickedItem => {
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
    body: cap(normalizeText(raw.body)),
  };
};

/** Why an item node is not publishable. The reason is the point (rule 5). */
export const unusableReason = (raw: RawFields): string | null => {
  if (normalizeText(raw.title).length === 0) return 'no title';
  if (raw.link.length === 0) return 'no link';
  return null;
};
