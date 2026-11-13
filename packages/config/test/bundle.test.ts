/**
 * The bundle's shape (D-014, rule 18): a document that validates on the way in, and
 * a writer that refuses a source the schema rejects.
 *
 * The stakes are the ones the rules give it: `sources/` is gitignored, so this file
 * is the reading list's only copy. A `$schemaVersion` that gates, an appConfig whose
 * defaults are the loader's defaults, and a `sources` array that cannot be written
 * half-broken are the three things that make a restore possible.
 */
import { describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../src/appSchema.ts';
import { BUNDLE_FILENAME, BUNDLE_SCHEMA_VERSION, bundleSchema, parseBundle, serializeBundle } from '../src/bundle.ts';
import { type SourceSpec, sourceSchema } from '../src/schema.ts';
import { BUNDLE_SCHEMA_URL } from '../src/schemaUrls.ts';

const anRss = (id: string): SourceSpec =>
  sourceSchema.parse({ id, kind: 'rss', label: `The ${id} feed`, url: `https://${id}.example/feed.xml`, weight: 3 });

describe('bundleSchema', () => {
  it('fills every default, so an empty document is a valid, empty bundle', () => {
    const parsed = bundleSchema.parse({});
    expect(parsed.sources).toEqual([]);
    expect(parsed.$schemaVersion).toBe(BUNDLE_SCHEMA_VERSION);
    expect(parsed.appConfig.masthead.name).toBe(defaultAppConfig().masthead.name);
    expect(parsed.appConfig.server.host).toBe('127.0.0.1');
  });

  it('refuses a source that is not a source, and names the path', () => {
    const parsed = bundleSchema.safeParse({ sources: [{ id: 'ok-but-no-url', kind: 'rss', label: 'x' }] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toContain('sources.0.url');
  });

  it('gates on the version, so an old bundle is a clear error, not a partial migration', () => {
    expect(bundleSchema.safeParse({ $schemaVersion: 'newspa.bundle.v0' }).success).toBe(false);
  });
});

describe('parseBundle', () => {
  it('reports a file that is not JSON as one line', () => {
    const parsed = parseBundle('{');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.messages[0]).toContain('not JSON');
  });

  it('reports every schema issue, in the loader’s shape', () => {
    const parsed = parseBundle('{"sources":[{"id":"a","kind":"nope"}]}');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.messages.join('\n')).toContain('sources.0.kind');
  });

  it('names an issue with no path as the root, so the line is never an empty string', () => {
    const parsed = parseBundle('[]');
    expect(parsed.ok).toBe(false);
    if (parsed.ok === false) expect(parsed.messages.join('\n')).toContain('(root):');
  });
});

describe('serializeBundle', () => {
  it('points $schema at the published schema, and sorts the sources by id', () => {
    const text = serializeBundle({
      appConfig: defaultAppConfig(),
      sources: [anRss('zeta'), anRss('alpha')],
      exportedAt: '2026-11-09T10:00:00.000Z',
    });
    const parsed = parseBundle(text);
    if (parsed.ok === false) throw new Error(parsed.messages.join('; '));
    expect(parsed.bundle.$schema).toBe(BUNDLE_SCHEMA_URL);
    expect(parsed.bundle.sources.map((spec) => spec.id)).toEqual(['alpha', 'zeta']);
    expect(parsed.bundle.exportedAt).toBe('2026-11-09T10:00:00.000Z');
  });

  it('is byte-stable, so two exports of one tree can be diffed', () => {
    const args = {
      appConfig: defaultAppConfig(),
      sources: [anRss('beta'), anRss('alpha')],
      exportedAt: '2026-11-09T10:00:00.000Z',
    };
    expect(serializeBundle(args)).toBe(serializeBundle(args));
    expect(serializeBundle({ ...args, sources: [anRss('alpha'), anRss('beta')] })).toBe(serializeBundle(args));
  });

  it('is a total order: equal ids keep the order they arrived in, and the array is not deduplicated', () => {
    // The schema does not police uniqueness — the loader's filename-vs-id rule is the
    // one that does — so the writer must not lose a source, and the comparator's tie
    // arm must be the identity it looks like.
    const text = serializeBundle({
      appConfig: defaultAppConfig(),
      sources: [anRss('alpha'), anRss('alpha')],
      exportedAt: '2026-11-09T10:00:00.000Z',
    });
    const parsed = parseBundle(text);
    if (parsed.ok === false) throw new Error(parsed.messages.join('; '));
    expect(parsed.bundle.sources).toHaveLength(2);
  });

  it('names the file the reader writes it to, and that name is gitignored', () => {
    expect(BUNDLE_FILENAME).toBe('newspa-bundle.json');
  });
});
