/**
 * The backup (rule 18): `export --bundle` against a **temp tree**, and the one rule
 * that makes it a backup — a bundle is complete, or the command fails and writes
 * nothing.
 */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_SCHEMA_URL, BUNDLE_SCHEMA_VERSION, parseBundle } from 'newspa-config';
import { describe, expect, it } from 'vitest';
import { BundleRefusedError, exportBundle, readBundle } from '../src/bundleExport.ts';
import { anHtmlSpec, anRssSpec } from './support.ts';

const T0 = new Date('2026-11-09T10:00:00Z');

const tree = async (files: Record<string, unknown>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'newspa-bundle-'));
  for (const [path, value] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }
  return root;
};

describe('exportBundle', () => {
  it('writes the reading list and the config, validated by the bundle schema', async () => {
    const root = await tree({
      'config.json': { masthead: { name: 'The Backup Ledger' } },
      'sources/bbc.json': anRssSpec(),
      'sources/cards.json': anHtmlSpec(),
    });
    const result = await exportBundle(root, { now: () => T0 });

    expect(result.sources).toBe(2);
    expect(result.file).toBe(join(root, 'newspa-bundle.json'));
    const text = await readFile(result.file, 'utf8');
    expect(result.bytes).toBe(Buffer.byteLength(text, 'utf8'));
    const parsed = parseBundle(text);
    if (parsed.ok === false)
      throw new Error(`the bundle the command wrote does not parse: ${parsed.messages.join('; ')}`);
    expect(parsed.bundle.sources.map((spec) => spec.id)).toEqual(['bbc', 'cards']);
    expect(parsed.bundle.appConfig.masthead.name).toBe('The Backup Ledger');
    expect(parsed.bundle.$schema).toBe(BUNDLE_SCHEMA_URL);
    expect(parsed.bundle.$schemaVersion).toBe(BUNDLE_SCHEMA_VERSION);
    expect(parsed.bundle.exportedAt).toBe(T0.toISOString());
  });

  it('is byte-identical for an unchanged tree, so a backup can be diffed', async () => {
    const root = await tree({ 'sources/bbc.json': anRssSpec(), 'sources/cards.json': anHtmlSpec() });
    const first = await exportBundle(root, { now: () => T0 });
    const text = await readFile(first.file, 'utf8');
    const second = await exportBundle(root, { now: () => T0 });
    expect(await readFile(second.file, 'utf8')).toBe(text);
    // The config fell back to defaults, and that is said, not swallowed.
    expect(first.messages.join('\n')).toContain('not present; using defaults');
  });

  it('refuses, with every issue line, and writes no file, when a source file does not parse', async () => {
    const root = await tree({ 'sources/bbc.json': anRssSpec(), 'sources/broken.json': { id: 'broken', kind: 'rss' } });
    const cause = await exportBundle(root, { now: () => T0 }).catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(BundleRefusedError);
    if (!(cause instanceof BundleRefusedError)) return;
    expect(cause.issues.join('\n')).toContain('broken.json');
    const missing = await readFile(join(root, 'newspa-bundle.json'), 'utf8').catch(() => null);
    expect(missing).toBeNull();
  });

  it('refuses a tree with no sources at all: a backup of nothing is a lie', async () => {
    const root = await mkdtemp(join(tmpdir(), 'newspa-empty-'));
    const cause = await exportBundle(root, { now: () => T0 }).catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(BundleRefusedError);
  });

  it('reads a bundle back, and reports a file that is not one', async () => {
    const root = await tree({ 'sources/bbc.json': anRssSpec() });
    const written = await exportBundle(root, { now: () => T0 });
    const back = await readBundle(written.file);
    expect(back.ok).toBe(true);

    const bad = join(root, 'not-a-bundle.json');
    await writeFile(bad, '{ "sources": [ { "id": "x" } ] }\n', 'utf8');
    const refused = await readBundle(bad);
    expect(refused.ok).toBe(false);
    if (refused.ok === false) expect(refused.messages.length).toBeGreaterThan(0);
  });
});
