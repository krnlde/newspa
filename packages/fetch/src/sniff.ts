import type { SourceKind } from 'newspa-core';

/**
 * What arrived is decided **by the bytes, never by `content-type`** (D-006).
 * Measured on this machine: `old.reddit.com/r/worldnews/.rss` answers
 * `200 text/html` while serving a feed, and `ubuntu.com/blog/feed` answers
 * `application/rss+xml` for an RSS 2.0 document. A header that lies, trusted,
 * produces a quiet zero-item poll — the failure rule 5 forbids.
 *
 * Only the **leading** markup decides. A news page quotes `<feed>` and `<rss>`
 * in prose, and a `<body` inside a `<noscript>` is not the document's root, so
 * the scan runs over the first 512 characters after the lead-in.
 */

export interface Sniffed {
  readonly kind: SourceKind | null;
  /** The marker text that matched, lower-cased: the reason a health note can quote. */
  readonly marker: string;
  /** Character offset in the payload where the marker starts. */
  readonly offset: number;
  /** What was seen, in words, for the health note. */
  readonly reason: string;
}

/** Markers in priority order. The first match wins, so this order is the policy. */
const MARKERS: readonly { readonly marker: string; readonly kind: SourceKind }[] = [
  { marker: '<?xml', kind: 'rss' },
  { marker: '<!doctype rss', kind: 'rss' },
  { marker: '<rdf:rdf', kind: 'rss' },
  { marker: '<rss', kind: 'rss' },
  { marker: '<feed', kind: 'rss' },
  { marker: '<!doctype html', kind: 'html' },
  { marker: '<html', kind: 'html' },
  { marker: '<xhtml', kind: 'html' },
  { marker: '<body', kind: 'html' },
];

const WINDOW = 512;
const isSpace = (char: string | undefined): boolean =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

export interface LeadIn {
  /** Offset of the first byte that is not whitespace, a BOM, or a comment. */
  readonly from: number;
  /** True when a BOM was skipped: it shifts every offset and breaks `<?xml`. */
  readonly bom: boolean;
  /** True when a comment was skipped. */
  readonly comment: boolean;
  /** True when the payload is empty after the lead-in. */
  readonly blank: boolean;
  /** True when a `<!--` was opened and never closed. */
  readonly unterminated: boolean;
}

/** A leading `<!-- … -->` is a lead-in a publisher or proxy writes, not a document. */
export const leadIn = (text: string): LeadIn => {
  const bom = text.charCodeAt(0) === 0xfeff;
  let i = bom ? 1 : 0;
  let comment = false;
  for (;;) {
    while (isSpace(text[i])) i += 1;
    if (!text.startsWith('<!--', i)) break;
    const end = text.indexOf('-->', i + 4);
    if (end === -1) return { from: i, bom, comment: true, blank: false, unterminated: true };
    comment = true;
    i = end + 3;
  }
  return { from: i, bom, comment, blank: i >= text.length, unterminated: false };
};

const describe = (found: string, base: LeadIn): string =>
  `starts with '${found}'${base.bom ? ' after a byte-order mark' : ''}${base.comment ? ' after a comment' : ''}`;

/**
 * Decide the kind from the payload. `kind: null` means "not one of ours", and
 * the caller must report it — never parse it as the configured kind (D-006).
 */
export const sniff = (text: string): Sniffed => {
  const base = leadIn(text);
  if (base.blank) {
    return {
      kind: null,
      marker: base.comment ? '<!--' : '',
      offset: base.from,
      reason: base.comment ? 'a comment and nothing else' : 'no bytes',
    };
  }
  const window = text.slice(base.from, base.from + WINDOW).toLowerCase();
  const head = window[0] ?? '';
  for (const { marker, kind } of MARKERS) {
    const at = window.indexOf(marker);
    if (at === -1) continue;
    return { kind, marker, offset: base.from + at, reason: describe(marker, base) };
  }
  if (head === '{' || head === '[') {
    return { kind: 'json', marker: head, offset: base.from, reason: describe(head, base) };
  }
  return {
    kind: null,
    marker: head,
    offset: base.from,
    reason: `no feed, HTML or JSON marker in the first ${String(window.length)} characters`,
  };
};

/** Is this payload a feed document, whatever the `content-type` claimed? */
export const isFeedPayload = (text: string): boolean => sniff(text).kind === 'rss';
