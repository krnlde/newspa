import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_BASE_URL,
  SCHEMA_BRANCH,
  SCHEMA_NAMES,
  SCHEMA_OWNER,
  SCHEMA_REPO,
  schemaUrlFor,
  WATCHLIST_SCHEMA_URL,
} from '../src/schemaUrls.ts';

describe('the published schema location', () => {
  it('is a URL a human and an editor can resolve', () => {
    // Asserted as a literal on purpose: an editor matches a document by the
    // schema's `$id`, so changing this string is a breaking change for every
    // export written before it, and a passing test is what makes it visible.
    // It moved once already, and the old value was not a breaking change to
    // fix: `krnl` is not this repository, so every `$schema` URL 404'd
    // (measured at raw.githubusercontent.com, 2026-11-09) and no editor ever
    // resolved a schema. A URL that resolves is the whole contract.
    expect(SCHEMA_BASE_URL).toBe('https://raw.githubusercontent.com/krnlde/newspa/main/schemas');
    expect([SCHEMA_OWNER, SCHEMA_REPO, SCHEMA_BRANCH]).toEqual(['krnlde', 'newspa', 'main']);
  });

  it('builds one URL per schema, from the base, with the generated file name', () => {
    for (const name of SCHEMA_NAMES) {
      expect(schemaUrlFor(name)).toBe(`${SCHEMA_BASE_URL}/${name}.schema.json`);
    }
    expect(schemaUrlFor('watchlist')).toBe(`${SCHEMA_BASE_URL}/watchlist.schema.json`);
    expect(WATCHLIST_SCHEMA_URL).toBe(schemaUrlFor('watchlist'));
  });

  it('names exactly the schema files that exist in schemas/', async () => {
    // The drift that matters: a `$schema` URL pointing at a file that is not in
    // the repo is a 404 in the user's editor, and `schemas/` is gitignored from
    // the app's view, so nothing else connects the two lists.
    const files = await readdir(new URL('../../../schemas', import.meta.url));
    const onDisk = files
      .filter((file) => file.endsWith('.schema.json'))
      .map((file) => file.replace(/\.schema\.json$/, ''))
      .sort();
    expect(onDisk).toEqual([...SCHEMA_NAMES].sort());
  });

  it('has a URL for every name it declares, and no name is a duplicate', () => {
    const urls = SCHEMA_NAMES.map((name) => schemaUrlFor(name));
    expect(new Set(urls).size).toBe(SCHEMA_NAMES.length);
    for (const url of urls) expect(url.startsWith('https://raw.githubusercontent.com/')).toBe(true);
  });
});
