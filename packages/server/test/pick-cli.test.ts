/**
 * `pnpm pick`, as a function (WP6, D-036): the run, the merge, and the write.
 *
 * The claims are the ones the terminal driver has to keep:
 *
 *  - **a pick of a bare url writes nothing, ever.** It prints the keys to paste. A
 *    tool that invented a source file from a click would be authoring the reader's
 *    reading list behind their back (D-011);
 *  - **`--write` is the only verb that touches a file**, and what it writes is
 *    `applyPick`'s merge — the reader's own keys intact, the proved selectors in,
 *    the answer re-validated by the loader's parser;
 *  - **without `--write` the file is untouched**, byte for byte, and the answer says
 *    how to make the write happen;
 *  - a fault is the same sentence the page prints (`describePickRun`), not a
 *    paraphrase: two drivers, one story.
 *
 * The window is a stub that reports a real fingerprint against a real page, so this
 * runs on a machine with no browser — which is the whole point of the seam (rule 16:
 * the pre-commit floor cannot launch Edge, and neither can a headless box).
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type SourceSpec, sourceFilePath } from 'newspa-config';
import type { PickLaunchOptions, PickSessionResult } from 'newspa-fetch';
import { describe, expect, it } from 'vitest';
import { parsePickArgs } from '../src/commands.ts';
import { runPickCommand } from '../src/pickCli.ts';
import { CARD_HTML, cardFingerprint, sourceText } from './pickSupport.ts';

const windowAt =
  (url: string): ((options: PickLaunchOptions) => Promise<PickSessionResult>) =>
  async () => ({ ok: true, payload: cardFingerprint, navigated: url });

const noWindow: (options: PickLaunchOptions) => Promise<PickSessionResult> = async () => ({
  ok: false,
  reason: 'launch-refused',
  detail: 'no browser to pick in: ENOENT msedge',
});

const bytes = async (): Promise<string> => CARD_HTML;

/** A watchlist with one html source, in a temp directory: the file is the truth (D-011). */
const dirWith = async (id: string, text: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'newspa-pick-cli-'));
  await writeFile(join(dir, `${id}.json`), text, 'utf8');
  return dir;
};

const plan = (args: readonly string[]) => {
  const parsed = parsePickArgs(args);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed;
};

const ran = async (args: readonly string[], dir: string, over: Partial<Parameters<typeof runPickCommand>[1]> = {}) =>
  await runPickCommand(plan(args), {
    dir,
    launch: windowAt('https://example.invalid/world'),
    fetchText: bytes,
    ...over,
  });

describe('a pick of a source the reader has', () => {
  it('prints the sentence, and writes nothing until --write says so', async () => {
    const dir = await dirWith('example-world', sourceText());
    const before = await readFile(join(dir, 'example-world.json'), 'utf8');
    const seen: PickLaunchOptions[] = [];

    const run = await ran(['--id', 'example-world'], dir, {
      launch: async (options) => {
        seen.push(options);
        return await windowAt('https://example.invalid/world')(options);
      },
    });

    expect(run.ok).toBe(true);
    expect(run.lines[0]).toContain('pick: Example World (https://example.invalid/world)');
    expect(run.lines[0]).toContain('list       .card');
    expect(run.lines.join('\n')).toContain('add --write');
    expect(seen[0]?.headless).toBe(false);
    expect(await readFile(join(dir, 'example-world.json'), 'utf8')).toBe(before);
  });

  it('--write merges the proved selectors into the file, and keeps the reader’s keys', async () => {
    const dir = await dirWith('example-world', sourceText());
    const written: SourceSpec[] = [];

    const run = await ran(['--id', 'example-world', '--write'], dir, {
      write: async (_dir, spec) => {
        written.push(spec);
        return sourceFilePath(_dir, spec.id);
      },
    });

    expect(run.ok).toBe(true);
    expect(run.lines.at(-1)).toContain('wrote');
    expect(written).toHaveLength(1);
    const spec = written[0];
    if (spec === undefined || spec.kind !== 'html') throw new Error('the writer never saw a spec');
    expect(spec.list).toBe('.card');
    expect(spec.matchCount).toBe(4);
    expect(spec.render).toBe(false);
    expect(spec.weight).toBe(3);
    expect(spec.watchwords).toEqual(['iran']);
    expect(spec.notes).toBe('the reader’s own words');
  });

  it('an argv the parser refused is reported, and no window is opened', async () => {
    const dir = await dirWith('example-world', sourceText());
    const opened: string[] = [];
    const run = await runPickCommand(parsePickArgs(['--write']), {
      dir,
      launch: async (options) => {
        opened.push(options.url);
        return await windowAt(options.url)(options);
      },
      fetchText: bytes,
    });
    expect(run.ok).toBe(false);
    expect(run.lines.join(' ')).toContain('nothing to pick');
    expect(opened).toEqual([]);
  });

  it('a feed is refused by name, before a window opens', async () => {
    const dir = await dirWith('guardian-world', sourceText({ kind: 'rss', list: undefined, fields: undefined }));
    const opened: string[] = [];
    const run = await ran(['--id', 'guardian-world'], dir, {
      launch: async (options) => {
        opened.push(options.url);
        return await windowAt(options.url)(options);
      },
    });
    expect(run.ok).toBe(false);
    expect(run.lines.join(' ')).toContain("'rss'");
    expect(opened).toEqual([]);
  });

  it('a page source is refused with D-028, and a missing file with the path it tried', async () => {
    const dir = await dirWith('example-world', sourceText({ list: null }));
    const page = await ran(['--id', 'example-world'], dir);
    expect(page.ok).toBe(false);
    expect(page.lines.join(' ')).toContain('D-028');

    const gone = await ran(['--id', 'never-written'], dir);
    expect(gone.ok).toBe(false);
    expect(gone.lines.join(' ')).toContain('never-written.json');
  });

  it('a browser that is not there prints the page’s own sentence, and writes nothing', async () => {
    const dir = await dirWith('example-world', sourceText());
    const run = await ran(['--id', 'example-world', '--write'], dir, { launch: noWindow });
    expect(run.ok).toBe(false);
    expect(run.lines[0]).toContain('pick wrote nothing for Example World');
    expect(run.lines[0]).toContain('launch / launch-refused');
    expect(await readFile(join(dir, 'example-world.json'), 'utf8')).toBe(sourceText());
  });

  it('a profile source gets the persistent profile, and a bare url never does (rule 17)', async () => {
    const dir = await dirWith('example-world', sourceText({ profile: true }));
    const seen: PickLaunchOptions[] = [];
    await ran(['--id', 'example-world'], dir, {
      profilesDir: 'profiles',
      launch: async (options) => {
        seen.push(options);
        return await windowAt('https://example.invalid/world')(options);
      },
    });
    expect(seen[0]?.profileDir).toBe('profiles/example-world');

    const bare: PickLaunchOptions[] = [];
    await runPickCommand(plan(['https://example.invalid/anywhere']), {
      dir,
      profilesDir: 'profiles',
      fetchText: bytes,
      launch: async (options) => {
        bare.push(options);
        return await windowAt(options.url)(options);
      },
    });
    expect(bare[0]).not.toHaveProperty('profileDir');
  });
});

describe('a pick of a page the reading list does not know', () => {
  it('writes nothing and leaves the keys to paste', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'newspa-pick-cli-'));
    const run = await ran(['https://example.invalid/anywhere'], dir);

    expect(run.ok).toBe(true);
    const text = run.lines.join('\n');
    expect(text).toContain('nothing was written: a bare url has no source file');
    expect(text).toContain('"list": ".card"');
    expect(text).toContain('"matchCount": 4');
    expect(text).toContain('"fields"');
  });

  it('a page whose list is built by script is refused with the render sentence (D-007)', async () => {
    const run = await runPickCommand(plan(['https://example.invalid/shell']), {
      dir: await mkdtemp(join(tmpdir(), 'newspa-pick-cli-')),
      launch: windowAt('https://example.invalid/shell'),
      fetchText: async () => '<html><body><div id="app"></div><script>buildList()</script></body></html>',
    });
    expect(run.ok).toBe(false);
    expect(run.lines.join(' ')).toContain('derive / path-unmapped');
    expect(run.lines.join(' ')).toContain('render: true');
  });

  it('a target the source schema refuses is named, and no window opens', async () => {
    const opened: string[] = [];
    const run = await runPickCommand(
      { ok: true, mode: 'url', url: 'not a url' },
      {
        dir: await mkdtemp(join(tmpdir(), 'newspa-pick-cli-')),
        fetchText: bytes,
        launch: async (options) => {
          opened.push(options.url);
          return await windowAt(options.url)(options);
        },
      },
    );
    expect(run.ok).toBe(false);
    expect(run.lines.join(' ')).toContain('the schema refused it');
    expect(opened).toEqual([]);
  });
});
