import { outerHtmlCap, type PathStep, type PickFingerprint, pathMax, pickFail, textCap } from './types.ts';

/**
 * The fingerprint boundary (WP6): JSON from the browser in, a named verdict out.
 *
 * This is the only place the picker trusts a foreign shape, so it narrows
 * `unknown` field by field and collects **every** complaint: a payload with three
 * problems says three things, because a refusal that names one field and hides two
 * sends the reader on a hunt (rule 5's posture, one step up from the parser).
 *
 * Three rules are load-bearing:
 *
 *  - the tag is lower-cased here, because the path is compared against a cheerio
 *    document (`xml: false`, so tag names arrive lower-cased) while a browser's
 *    `tagName` is upper-case for HTML;
 *  - the caps **truncate, they do not refuse** — long markup is a normal page, and
 *    the fingerprint's text and markup are evidence for a human, never input to the
 *    derivation. The path length is the opposite: a 40-deep click is a bug in the
 *    injected script, and a runaway path is refused, not trimmed;
 *  - a missing `href` and a `null` href are the same fact — the click had no link —
 *    and both are accepted. Refusing them would throw away the pick of a list whose
 *    items are not anchors.
 */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const cap = (value: string, limit: number): string => (value.length > limit ? value.slice(0, limit) : value);

const tagOfStep = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= 40 ? value.trim().toLowerCase() : null;

const stepOf = (value: unknown, at: number, problems: string[]): PathStep | null => {
  const step = asRecord(value);
  const tag = step === null ? null : tagOfStep(step['tag']);
  const index = step?.['index'];
  if (tag === null) {
    problems.push(`path[${String(at)}].tag: an element name is required`);
    return null;
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) {
    problems.push(`path[${String(at)}].index: a 1-based integer is required`);
    return null;
  }
  return { tag, index };
};

/** The path, with the shape rules the derivation cannot do without. */
const pathOf = (value: unknown, problems: string[]): PathStep[] => {
  if (!Array.isArray(value)) {
    problems.push('path: the array of steps from <html>');
    return [];
  }
  const path: PathStep[] = [];
  value.forEach((step, at) => {
    const parsed = stepOf(step, at, problems);
    if (parsed !== null) path.push(parsed);
  });
  if (path.length === 0) problems.push('path: at least the <html> step');
  else if (path[0]?.tag !== 'html') problems.push(`path[0]: the path starts at <html>, not <${String(path[0]?.tag)}>`);
  if (value.length > pathMax) {
    problems.push(`path: ${String(value.length)} steps, over the guard of ${String(pathMax)}`);
  }
  return path;
};

const urlOf = (value: unknown, problems: string[]): string | null => {
  if (typeof value === 'string' && value.length > 0 && value.length <= 2_048) return value;
  problems.push('url: the document address, as a string');
  return null;
};

const hrefOf = (body: Record<string, unknown>, problems: string[]): string | null => {
  if (body['href'] === null || body['href'] === undefined) return null;
  if (typeof body['href'] === 'string') return body['href'];
  problems.push('href: an absolute URL, or null');
  return null;
};

const textOf = (body: Record<string, unknown>, name: string, problems: string[]): string | null => {
  const field = body[name];
  if (typeof field === 'string') return field;
  problems.push(`${name}: a string`);
  return null;
};

const siblingsOf = (value: unknown, problems: string[]): number | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  problems.push('siblings: the element count under the same parent');
  return null;
};

export type FingerprintResult = { readonly ok: true; readonly fp: PickFingerprint } | ReturnType<typeof pickFail>;

const PROVENANCE = 'the pick inspector sends url, path, href, outerHTML, text and siblings';

export const parseFingerprint = (value: unknown): FingerprintResult => {
  const body = asRecord(value);
  if (body === null) return pickFail('bad-fingerprint', 'the pick payload is not an object', [PROVENANCE]);

  const problems: string[] = [];
  const url = urlOf(body['url'], problems);
  const path = pathOf(body['path'], problems);
  const href = hrefOf(body, problems);
  const outer = textOf(body, 'outerHtml', problems);
  const text = textOf(body, 'text', problems);
  const siblings = siblingsOf(body['siblings'], problems);

  if (problems.length > 0) {
    return pickFail('bad-fingerprint', problems.join('; '), [PROVENANCE]);
  }
  if (url === null || path.length === 0 || outer === null || text === null || siblings === null) {
    return pickFail('bad-fingerprint', 'the pick payload is incomplete', [PROVENANCE]);
  }

  return { ok: true, fp: { url, path, href, outerHtml: cap(outer, outerHtmlCap), text: cap(text, textCap), siblings } };
};
