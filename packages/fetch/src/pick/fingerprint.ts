import { outerHtmlCap, type PathStep, type PickFingerprint, pathMax, pickFail, textCap } from './types.ts';

/**
 * The fingerprint boundary (WP6): JSON from the browser in, a named verdict out.
 *
 * This is the only place the picker trusts a foreign shape, so it narrows
 * `unknown` field by field and collects **every** complaint: a payload with three
 * problems says three things, because a refusal that names one field and hides two
 * sends the reader on a hunt (rule 5's posture, one step up from the parser).
 *
 * The shape is deliberate: the fields are read into an accumulator, every check
 * pushes a problem, and **one** branch decides. A second guard that re-tests the
 * fields for null after the problem check is dead code by construction — every
 * null implies a problem — and dead code is a branch no test can reach, which is
 * how a coverage gate turns into a lie.
 *
 * Three rules the checks encode:
 *
 *  - tags are lower-cased, because the path is compared against a cheerio document
 *    (`xml: false`) while a browser spells `tagName` in upper case;
 *  - the caps **truncate** the evidence (markup and text are for a human, never
 *    input to the derivation) and **refuse** the runaway path (a 40-deep click is a
 *    bug in the injected script, and a derivation over a path that deep is a hang);
 *  - a missing `href` and a `null` href are the same accepted fact: the click had no
 *    link. Refusing that would throw away a list whose items are not anchors.
 */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const cap = (value: string, limit: number): string => (value.length > limit ? value.slice(0, limit) : value);

const MAX_TAG = 40;

const stepOf = (value: unknown, at: number, problems: string[]): PathStep | null => {
  const step = asRecord(value);
  const tag = step?.['tag'];
  const index = step?.['index'];
  if (typeof tag !== 'string' || tag.trim().length === 0 || tag.length > MAX_TAG) {
    problems.push(`path[${String(at)}].tag: an element name of at most ${String(MAX_TAG)} characters`);
    return null;
  }
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) {
    problems.push(`path[${String(at)}].index: a 1-based integer is required`);
    return null;
  }
  return { tag: tag.trim().toLowerCase(), index };
};

/** The accumulator: sentinels until every check has spoken, and the sentinels never escape. */
interface Fields {
  url: string;
  path: PathStep[];
  href: string | null;
  outerHtml: string;
  text: string;
  siblings: number;
}

const emptyFields = (): Fields => ({ url: '', path: [], href: null, outerHtml: '', text: '', siblings: 0 });

const readUrl = (value: unknown, fields: Fields, problems: string[]): void => {
  if (typeof value === 'string' && value.length > 0 && value.length <= 2_048) {
    fields.url = value;
    return;
  }
  problems.push('url: the document address, as a string');
};

const readPath = (value: unknown, fields: Fields, problems: string[]): void => {
  if (!Array.isArray(value)) {
    problems.push('path: the array of steps from <html>');
    return;
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
  fields.path = path;
};

const readHref = (value: unknown, fields: Fields, problems: string[]): void => {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    fields.href = value;
    return;
  }
  problems.push('href: an absolute URL, or null');
};

const readText = (name: 'outerHtml' | 'text', value: unknown, fields: Fields, problems: string[]): void => {
  if (typeof value === 'string') {
    fields[name] = value;
    return;
  }
  problems.push(`${name}: a string`);
};

const readSiblings = (value: unknown, fields: Fields, problems: string[]): void => {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
    fields.siblings = value;
    return;
  }
  problems.push('siblings: the element count under the same parent');
};

const PROVENANCE = 'the pick inspector sends url, path, href, outerHTML, text and siblings';

export type FingerprintResult = { readonly ok: true; readonly fp: PickFingerprint } | ReturnType<typeof pickFail>;

export const parseFingerprint = (value: unknown): FingerprintResult => {
  const body = asRecord(value);
  if (body === null) return pickFail('bad-fingerprint', 'the pick payload is not an object', [PROVENANCE]);

  const problems: string[] = [];
  const fields = emptyFields();
  readUrl(body['url'], fields, problems);
  readPath(body['path'], fields, problems);
  readHref(body['href'], fields, problems);
  readText('outerHtml', body['outerHtml'], fields, problems);
  readText('text', body['text'], fields, problems);
  readSiblings(body['siblings'], fields, problems);

  if (problems.length > 0) return pickFail('bad-fingerprint', problems.join('; '), [PROVENANCE]);

  return {
    ok: true,
    fp: {
      url: fields.url,
      path: fields.path,
      href: fields.href,
      outerHtml: cap(fields.outerHtml, outerHtmlCap),
      text: cap(fields.text, textCap),
      siblings: fields.siblings,
    },
  };
};
