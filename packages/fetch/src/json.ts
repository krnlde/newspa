import type { JsonSource } from 'newspa-config';
import { challengeOf } from './challenge.ts';
import { loadDocument } from './htmlSelectors.ts';
import type { RawFields } from './item.ts';
import { buildItem, toIsoDate, unusableReason } from './item.ts';
import { isRecord, itemsAt, resolvePath, scalar } from './jsonPath.ts';
import type { ParseFailureReason, ParseResult } from './results.ts';
import { failWith, skipNotes, succeed } from './results.ts';
import type { Sniffed } from './sniff.ts';

/**
 * A JSON endpoint, or a JSON island inside a page, → items.
 *
 * The island case is why `island` exists: the BBC probe found 91 KB of
 * `__NEXT_DATA__` inside a 370 KB page (D-008), and a JSON path is the one
 * source shape that survives a redesign.
 *
 * `islandRoot` (schema default `props.pageProps`) is applied **only when
 * `island` is set**. The field's own comment says "path to the *island* payload
 * root", and applying the default to a plain endpoint would look for
 * `props.pageProps` inside Algolia- and Reddit-shaped payloads and report
 * `no-items-path` on every source that is not an island.
 */

interface PayloadRoot {
  readonly ok: true;
  readonly root: unknown;
  readonly island: boolean;
}

type PayloadOutcome =
  | PayloadRoot
  | { readonly ok: false; readonly reason: ParseFailureReason; readonly detail: string };

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false; detail: string } => {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, detail: `not JSON: ${message}` };
  }
};

const fieldOf = (item: Record<string, unknown>, path: string | undefined): string | null => {
  if (path === undefined) return null;
  for (const value of resolvePath(item, path).values) {
    const text = scalar(value);
    if (text !== null && text.trim().length > 0) return text;
  }
  return null;
};

/**
 * `JsonFields` has no author field, so the byline is read from the conventions
 * publishers use — `author.name` (Algolia's Hacker News index), a plain
 * `author` (Reddit), `byline` and `credit` (newsroom APIs). A source whose
 * byline is elsewhere cannot say so: that is a schema gap, not a parser bug.
 */
const authorOf = (item: Record<string, unknown>): string | null =>
  fieldOf(item, 'author.name') ??
  fieldOf(item, 'author') ??
  fieldOf(item, 'byline') ??
  fieldOf(item, 'credit.name') ??
  fieldOf(item, 'credit');

const fieldsFrom = (item: Record<string, unknown>, spec: JsonSource): RawFields => {
  const fields = spec.fields;
  const summary = fieldOf(item, fields.summary);
  const body = fieldOf(item, fields.body);
  const date = fieldOf(item, fields.date);
  return {
    title: fieldOf(item, fields.title) ?? '',
    link: fieldOf(item, fields.link) ?? '',
    publishedAt: toIsoDate(date),
    summary,
    image: fieldOf(item, fields.image),
    author: authorOf(item),
    body: body ?? summary ?? '',
  };
};

/** `script#__NEXT_DATA__` is a script tag holding JSON; its text is the payload. */
const islandText = (text: string, spec: JsonSource): { ok: true; value: string } | { ok: false; detail: string } => {
  const island = spec.island;
  if (island === undefined) return { ok: true, value: text };
  const nodes = loadDocument(text)(island);
  if (nodes.length === 0)
    return { ok: false, detail: `'${island}' matched 0 elements, so the page has no island to read` };
  const html = nodes.first().html();
  if (html === null || html.trim().length === 0) {
    return { ok: false, detail: `'${island}' matched an element with no content in it` };
  }
  return { ok: true, value: html };
};

const objectAt = (value: unknown, path: string): Record<string, unknown> | null => {
  const first = resolvePath(value, path).values[0];
  return isRecord(first) ? first : null;
};

/**
 * A path that misses is the most common source-author error, and the useful
 * answer names the **deepest prefix that did resolve** and the keys there: an
 * island root of `props.pageProps.missing` is fixed by the keys of
 * `props.pageProps`, not by the keys of the document.
 */
const nearMiss = (value: unknown, path: string): string => {
  const segments = path.split('.');
  for (let depth = segments.length - 1; depth >= 0; depth -= 1) {
    const prefix = segments.slice(0, depth).join('.');
    const node = objectAt(value, prefix);
    if (node !== null && Object.keys(node).length > 0) {
      const where = prefix.length === 0 ? 'the root' : `'${prefix}'`;
      return `the keys at ${where} are: ${Object.keys(node).slice(0, 10).join(', ')}`;
    }
  }
  return 'the payload is not an object, so no path can resolve';
};

const rootOf = (value: unknown, spec: JsonSource): { ok: true; root: unknown } | { ok: false; detail: string } => {
  if (!spec.island || spec.islandRoot.length === 0) return { ok: true, root: value };
  const first = objectAt(value, spec.islandRoot);
  if (first === null) {
    return { ok: false, detail: `'${spec.islandRoot}' resolved to nothing; ${nearMiss(value, spec.islandRoot)}` };
  }
  return { ok: true, root: first };
};

const payloadOf = (text: string, spec: JsonSource): PayloadOutcome => {
  const island = islandText(text, spec);
  if (island.ok === false) return { ok: false, reason: 'no-island', detail: island.detail };
  const parsed = parseJson(island.value);
  if (parsed.ok === false) {
    const wall = challengeOf(text);
    if (wall !== null)
      return { ok: false, reason: 'challenge', detail: `the payload is a challenge page: '${wall.marker}'` };
    return { ok: false, reason: spec.island === undefined ? 'malformed' : 'island-not-json', detail: parsed.detail };
  }
  const root = rootOf(parsed.value, spec);
  if (root.ok === false) return { ok: false, reason: 'no-items-path', detail: root.detail };
  return { ok: true, root: root.root, island: spec.island !== undefined };
};

/** Parse a JSON payload — direct, or out of a script island. */
export const parseJsonPayload = (text: string, spec: JsonSource, sniffed: Sniffed): ParseResult => {
  const base = { kind: spec.kind, sniffed: sniffed.kind, marker: sniffed.marker } as const;
  const payload = payloadOf(text, spec);
  if (payload.ok === false) {
    return failWith({
      ...base,
      reason: payload.reason,
      detail: payload.detail,
      cause: spec.island ?? spec.itemsPath,
      notes: [sniffed.reason],
    });
  }
  const items = itemsAt(payload.root, spec.itemsPath);
  if (items.ok === false) {
    return failWith({
      ...base,
      reason: 'no-items-path',
      detail: items.detail,
      cause: spec.itemsPath,
      matchCount: 0,
      notes: [sniffed.reason],
    });
  }
  const built = [];
  const skipped = [];
  for (const [index, node] of items.items.entries()) {
    const fields = fieldsFrom(node, spec);
    const why = unusableReason(fields);
    if (why !== null) {
      skipped.push({ index, why });
      continue;
    }
    built.push(buildItem(spec, fields));
  }
  const notes = [sniffed.reason, ...skipNotes(skipped)];
  if (built.length === 0) {
    return failWith({
      ...base,
      reason: 'no-usable-items',
      detail: `${String(items.items.length)} object(s) at '${spec.itemsPath}', none with a title and a link`,
      cause: spec.itemsPath,
      matchCount: items.items.length,
      notes,
    });
  }
  return succeed({
    items: built,
    kind: spec.kind,
    sniffed: 'json',
    marker: sniffed.marker,
    notes,
    skipped: skipped.length,
    matchCount: items.items.length,
  });
};
