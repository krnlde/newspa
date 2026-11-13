import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAppConfig } from '../src/appSchema.ts';
import {
  ensureSourcesDir,
  loadAppConfig,
  loadSources,
  parseSourceJson,
  removeSource,
  sourcePath,
  writeSource,
} from '../src/load.ts';
import { sourceSchema } from '../src/schema.ts';

const htmlSource = {
  id: 'npr-world',
  label: 'NPR World',
  url: 'https://feeds.npr.org/1001/rss.xml',
  kind: 'html' as const,
  list: 'article',
  fields: { title: 'h2' },
};

const rssSource = {
  id: 'treasury',
  label: 'Treasury press releases',
  url: 'https://home.treasury.gov/rss.xml',
  kind: 'rss' as const,
};

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'newspa-sources-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseSourceJson', () => {
  it('parses a valid file and applies defaults', () => {
    const parsed = parseSourceJson(JSON.stringify(rssSource), 'treasury.json');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spec.id).toBe('treasury');
    if (parsed.spec.kind !== 'rss') return;
    expect(parsed.spec.maxItems).toBe(60);
  });

  it('reports invalid JSON as an issue, naming the file', () => {
    const parsed = parseSourceJson('{ "id": ', 'broken.json');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issue.reason).toBe('invalid-json');
    expect(parsed.issue.file).toBe('broken.json');
    expect(parsed.issue.messages[0]).toContain('JSON');
  });

  it('reports schema violations one line per field', () => {
    const parsed = parseSourceJson(JSON.stringify({ ...htmlSource, id: 'BAD ID', weight: 9 }), 'bad.json');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issue.reason).toBe('schema');
    expect(parsed.issue.messages.join('\n')).toContain('id');
    expect(parsed.issue.messages.join('\n')).toContain('weight');
  });

  it('labels a root-level issue "(root)": the file is valid JSON, not an object', () => {
    // A non-object root makes zod emit one issue with an empty path. Without
    // the `(root)` label the line reads ": Invalid input: …", which looks like
    // a missing field name and points at nothing.
    const roots: readonly (readonly [string, string])[] = [
      ['[]', 'array'],
      ['"a string"', 'string'],
      ['null', 'null'],
    ];
    for (const [text, received] of roots) {
      const parsed = parseSourceJson(text, 'root.json');
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.issue.reason).toBe('schema');
      expect(parsed.issue.messages).toEqual([`(root): Invalid input: expected object, received ${received}`]);
    }
  });
});

describe('loadSources', () => {
  it('reads every .json file, sorted, and ignores the rest', async () => {
    await writeFile(path.join(dir, 'b-bbc.json'), JSON.stringify({ ...htmlSource, id: 'b-bbc' }), 'utf8');
    await writeFile(path.join(dir, 'a-npr.json'), JSON.stringify({ ...htmlSource, id: 'a-npr' }), 'utf8');
    await writeFile(path.join(dir, 'README.md'), 'notes', 'utf8');
    const result = await loadSources(dir);
    expect(result.sources.map((spec) => spec.id)).toEqual(['a-npr', 'b-bbc']);
    expect(result.issues).toEqual([]);
    expect(result.dir).toBe(dir);
  });

  it('collects an issue per broken file and keeps the good ones', async () => {
    await writeFile(path.join(dir, 'good.json'), JSON.stringify(rssSource), 'utf8');
    await writeFile(path.join(dir, 'json-broken.json'), 'nope', 'utf8');
    await writeFile(path.join(dir, 'schema-broken.json'), JSON.stringify({ id: 'x' }), 'utf8');
    const result = await loadSources(dir);
    expect(result.sources.map((spec) => spec.id)).toEqual(['treasury']);
    expect(result.issues.map((issue) => issue.file).sort()).toEqual(['json-broken.json', 'schema-broken.json']);
    expect(result.issues.map((issue) => issue.reason).sort()).toEqual(['invalid-json', 'schema']);
  });

  it('reports an unreadable file instead of skipping it', async () => {
    await mkdir(path.join(dir, 'locked.json'), { recursive: true });
    const result = await loadSources(dir);
    expect(result.sources).toEqual([]);
    expect(result.issues[0]?.reason).toBe('unreadable');
    expect(result.issues[0]?.messages[0]).toBeTruthy();
  });

  it('reports a source directory that does not exist: a fresh clone has none (D-025)', async () => {
    const result = await loadSources(path.join(dir, 'nope'));
    expect(result.sources).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe('missing-dir');
    expect(result.issues[0]?.file).toContain('nope');
    expect(result.issues[0]?.messages[0]).toContain('pnpm sources:init');
  });

  it('reports an existing directory with no sources, rather than printing an empty paper', async () => {
    const result = await loadSources(dir);
    expect(result.sources).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe('no-sources');
    expect(result.issues[0]?.messages[0]).toContain('sources.example');
  });

  it('flags a duplicate id, and says which files collide', async () => {
    await writeFile(path.join(dir, 'a.json'), JSON.stringify({ ...rssSource, id: 'same' }), 'utf8');
    await writeFile(path.join(dir, 'b.json'), JSON.stringify({ ...htmlSource, id: 'same' }), 'utf8');
    const result = await loadSources(dir);
    expect(result.sources).toHaveLength(2);
    const duplicate = result.issues.find((issue) => issue.messages[0]?.includes('duplicate source id'));
    expect(duplicate?.file).toContain('same.json');
    expect(duplicate?.reason).toBe('schema');
  });
});

describe('ensureSourcesDir', () => {
  it('creates a missing directory and says it created it (D-025: a clone has none)', async () => {
    const target = path.join(dir, 'sources');
    const ensured = await ensureSourcesDir(target);
    expect(ensured.created).toBe(true);
    // Boot reads after creating, and an empty directory is still a report, not silence.
    const result = await loadSources(target);
    expect(result.sources).toEqual([]);
    expect(result.issues[0]?.reason).toBe('no-sources');
  });

  it('is idempotent, creates parents, and never touches a file', async () => {
    await writeFile(path.join(dir, 'treasury.json'), JSON.stringify(rssSource), 'utf8');
    expect((await ensureSourcesDir(dir)).created).toBe(false);
    expect((await ensureSourcesDir(dir)).created).toBe(false);
    const nested = path.join(dir, 'deep', 'sources');
    expect((await ensureSourcesDir(nested)).created).toBe(true);
    const result = await loadSources(dir);
    expect(result.sources.map((spec) => spec.id)).toEqual(['treasury']);
    expect(result.issues).toEqual([]);
  });
});

describe('writeSource and removeSource', () => {
  it('writes a file named after the id, formatted, that round-trips', async () => {
    const spec = sourceSchema.parse(htmlSource);
    const target = await writeSource(dir, spec);
    expect(target).toBe(sourcePath(dir, spec));
    const text = await readFile(target, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')[1]).toBe('  "id": "npr-world",');
    expect(parseSourceJson(text, 'npr-world.json').ok).toBe(true);
  });

  it('creates the directory when there is none', async () => {
    const nested = path.join(dir, 'sources');
    await writeSource(nested, sourceSchema.parse(rssSource));
    expect(sourcePath(nested, sourceSchema.parse(rssSource))).toContain('treasury.json');
  });

  it('removes a source file, and is quiet when it is already gone', async () => {
    const spec = sourceSchema.parse(rssSource);
    await writeSource(dir, spec);
    await removeSource(dir, 'treasury');
    await expect(readFile(path.join(dir, 'treasury.json'), 'utf8')).rejects.toThrow();
    await expect(removeSource(dir, 'treasury')).resolves.toBeUndefined();
  });
});

describe('loadAppConfig', () => {
  it('uses defaults when the file is absent, and says so', async () => {
    const result = await loadAppConfig(path.join(dir, 'newspa.config.json'));
    expect(result.config).toEqual(defaultAppConfig());
    expect(result.messages).toEqual(['config: not present; using defaults']);
    expect(result.file).toContain('newspa.config.json');
  });

  it('says so when the file is not JSON', async () => {
    const file = path.join(dir, 'newspa.config.json');
    await writeFile(file, 'the daily one', 'utf8');
    const result = await loadAppConfig(file);
    expect(result.config.server.port).toBe(8787);
    expect(result.messages[0]).toContain('invalid JSON');
  });

  it('uses defaults for a config file that parses as JSON but is not an object', async () => {
    // `[]` is valid JSON, so it lands in the schema path, not the syntax path:
    // the message must name the root, and the run must still get a full config.
    const file = path.join(dir, 'newspa.config.json');
    await writeFile(file, '[]', 'utf8');
    const result = await loadAppConfig(file);
    expect(result.config).toEqual(defaultAppConfig());
    expect(result.messages).toEqual(['(root): Invalid input: expected object, received array']);
  });

  it('keeps the good parts of a partly invalid config', async () => {
    const file = path.join(dir, 'newspa.config.json');
    await writeFile(file, JSON.stringify({ server: { port: 70_000 }, masthead: { name: 'Home' } }), 'utf8');
    const result = await loadAppConfig(file);
    expect(result.config.masthead.name).toBe('The Daily');
    expect(result.config.server.port).toBe(8787);
    expect(result.messages.join('\n')).toContain('server.port');
  });

  it('reads a valid config', async () => {
    const file = path.join(dir, 'newspa.config.json');
    await writeFile(
      file,
      JSON.stringify({ masthead: { name: 'Home', tagline: 'home paper', dayStartHour: 6 } }),
      'utf8',
    );
    const result = await loadAppConfig(file);
    expect(result.config.masthead.dayStartHour).toBe(6);
    expect(result.messages).toEqual([]);
  });
});
