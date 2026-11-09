import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HtmlItemSource, HtmlSource, JsonSource, RssSource } from 'newspa-config';
import { htmlSourceSchema, jsonSourceSchema, rssSourceSchema } from 'newspa-config';
import type { PickedItem } from 'newspa-core';
import type { ParseFailure, ParseResult, ParseSuccess } from '../src/results.ts';

/**
 * Test helpers. Fixtures are read as **text**, because a parser's input is the
 * decoded body (`index.ts` says the transport owns the charset), and sources are
 * built by the real zod schemas, so a test cannot drift from what
 * `sources/*.json` is allowed to say.
 */

const fixturesDir = new URL('./fixtures/', import.meta.url);

/** A fixture's text, exactly as the file is stored. */
export const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(name, fixturesDir)), 'utf8');

/** The source every builder starts from: a kebab id, and a base URL for relative links. */
const base = {
  id: 'test-source',
  label: 'Test source',
  url: 'https://example.invalid/',
} as const;

/** A valid RSS source. Feeds have no selectors: the tag ladders in `rssFields.ts` are the source. */
export const rssSource = (overrides: Partial<RssSource> = {}): RssSource =>
  rssSourceSchema.parse({ ...base, kind: 'rss', ...overrides });

/** A valid HTML source with a list selector and the given fields. */
export const htmlSource = (
  list: string,
  fields: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): HtmlItemSource => ({
  ...htmlSourceSchema.parse({ ...base, kind: 'html', list, fields: { title: '.title', ...fields }, ...overrides }),
  list,
});

/**
 * A valid HTML source in **page mode**: no `list`, so the document is one item
 * keyed by its text. The default page URL is a version page's URL, because
 * that is what this mode is for.
 */
export const pageSource = (overrides: Record<string, unknown> = {}): HtmlSource =>
  htmlSourceSchema.parse({
    ...base,
    id: 'node-versions',
    label: 'Node.js versions',
    url: 'https://nodejs.org/en/download',
    kind: 'html',
    ...overrides,
  });

/** A valid JSON source with an items path and the given field paths. */
export const jsonSource = (
  itemsPath: string,
  fields: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): JsonSource =>
  jsonSourceSchema.parse({
    ...base,
    kind: 'json',
    itemsPath,
    fields: { title: 'title', link: 'url', ...fields },
    ...overrides,
  });

/** The ISO instant core emits: `Date#toISOString`, so milliseconds and a `Z`. */
export const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A core item key: the source id, then `t` for the title+day arm, then 8 hex. */
export const linkKey = /^test-source:[0-9a-f]{8}$/;
export const titleKey = /^test-source:t[0-9a-f]{8}$/;

/** Item at an index, with a failure that names the index instead of a stack trace. */
export const itemAt = (items: readonly PickedItem[], index: number): PickedItem => {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at index ${String(index)} of ${String(items.length)}`);
  return item;
};

/** Unwrap a success, so a failure prints its own report instead of an assertion's noise. */
export const okResult = (result: ParseResult): ParseSuccess => {
  if (result.ok === false) {
    throw new Error(`expected items, got ${result.reason}: ${result.detail} :: ${result.notes.join(' | ')}`);
  }
  return result;
};

/** The items of a success. */
export const okItems = (result: ParseResult): readonly PickedItem[] => okResult(result).items;

/** The failure of a result, narrowed. */
export const failed = (result: ParseResult): ParseFailure => {
  if (result.ok === true) throw new Error(`expected a fault, got ${String(result.items.length)} item(s)`);
  return result;
};
