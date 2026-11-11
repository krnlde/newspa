/**
 * The pick's faults (WP6, D-036): the five ways a pick writes nothing, each **named
 * by stage**, in the same sentence `pnpm pick` prints.
 *
 * This is rule 5 one layer up. A parser that answers "no items" when the truth is
 * "no browser" is the failure this project exists to refuse, and a pick has more of
 * those layers than a poll does: a window to open, a payload to trust, bytes to
 * fetch, a derivation to run, a merge to validate. Each one gets a state (`failed`),
 * a stage, a reason, and a line the reader can act on — and `text: null`, so the
 * editor is never filled with a half-answer.
 *
 * The claim that `sentence` **equals** `describePickRun`'s text is the point of the
 * file: page and CLI are two drivers of one sequence, and two stories about one run
 * is how a tool becomes untrustworthy.
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSourceJson, sourceFilePath } from 'newspa-config';
import type { PickStatusResponse } from 'newspa-core';
import { describePickRun, type PickRun } from 'newspa-fetch';
import { describe, expect, it } from 'vitest';
import { readSourceForPick } from '../src/pickApi.ts';
import { bagOf, refusedLaunch, settled, shellFingerprint, sourceText } from './pickSupport.ts';

const settledOf = (bag: ReturnType<typeof bagOf>): Promise<PickStatusResponse> => settled(bag.routes, 'example-world');

describe('a pick that writes nothing, said in the page’s own words', () => {
  const expectSentence = (report: PickStatusResponse, run: Extract<PickRun, { ok: false }>): void => {
    expect(report.state).toBe('failed');
    expect(report.text).toBeNull();
    expect(report.sentence).toBe(
      describePickRun(run, { url: 'https://example.invalid/world', label: 'Example World' }),
    );
  };

  it('a browser that is not there is a failed job, with the CLI’s sentence', async () => {
    const bag = bagOf({ launch: async () => refusedLaunch });
    await bag.routes.start('example-world');
    const report = await settledOf(bag);
    expectSentence(report, {
      ok: false,
      stage: 'launch',
      reason: 'launch-refused',
      detail: refusedLaunch.detail,
      notes: ['a pick writes nothing until a click is captured, so the source is unchanged'],
    });
    expect(report.messages.join(' ')).toContain('the source is unchanged');
    expect(bag.logs.join('\n')).toContain('pick failed for example-world: launch/launch-refused');
  });

  it('the DOM the click happened in, missing from the bytes, is D-007 named (render)', async () => {
    const bag = bagOf({
      launch: async () => ({ ok: true, payload: shellFingerprint, navigated: 'https://example.invalid/world' }),
    });
    await bag.routes.start('example-world');
    const report = await settledOf(bag);
    expect(report.state).toBe('failed');
    expect(report.sentence).toContain('derive / path-unmapped');
    expect(report.messages.join(' ')).toContain('render: true');
    expect(report.text).toBeNull();
  });

  it('a driver that throws is a state, not a job that runs forever', async () => {
    const bag = bagOf({
      launch: async () => {
        throw new Error('the stub exploded');
      },
    });
    await bag.routes.start('example-world');
    const report = await settledOf(bag);
    expect(report.state).toBe('failed');
    expect(report.sentence).toContain("pick for 'example-world' ended in an exception");
    expect(report.sentence).toContain('the stub exploded');
    expect(report.messages.join(' ')).toContain('not touched');
    expect(bag.logs.join('\n')).toContain('pick threw for example-world');
  });

  it('bytes that cannot be fetched name the transport’s own reason', async () => {
    const bag = bagOf({
      fetchText: async () => {
        throw new Error('credential-required: this source asks for a logged-in profile');
      },
    });
    await bag.routes.start('example-world');
    const report = await settledOf(bag);
    expect(report.state).toBe('failed');
    expect(report.sentence).toContain('fetch / fetch-failed');
    expect(report.messages.join(' ')).toContain('fails in the poll too');
  });

  it('a window that fails with something that is not an Error still gets a sentence (rule 5)', async () => {
    const bag = bagOf({
      launch: async () => {
        throw 'a string, not an Error';
      },
    });
    await bag.routes.start('example-world');
    const report = await settled(bag.routes, 'example-world');
    expect(report.state).toBe('failed');
    expect(report.sentence).toContain('a string, not an Error');
    expect(report.sentence).not.toContain('undefined');
  });

  it('hands the window the session budgets it was given, and none it was not', async () => {
    const budgeted = bagOf({ budgetMs: 60_000, navTimeoutMs: 5_000 });
    await budgeted.routes.start('example-world');
    await settled(budgeted.routes, 'example-world');
    expect(budgeted.seen[0]).toMatchObject({ budgetMs: 60_000, navTimeoutMs: 5_000 });

    const plain = bagOf();
    await plain.routes.start('example-world');
    await settled(plain.routes, 'example-world');
    expect(plain.seen[0]).not.toHaveProperty('budgetMs');
    expect(plain.seen[0]).not.toHaveProperty('navTimeoutMs');
  });

  it('an editor text that does not validate is refused, with the loader’s lines', async () => {
    const loaded = parseSourceJson(sourceText(), 'sources/example-world.json');
    if (!loaded.ok) throw new Error('the fixture file must validate');
    const bag = bagOf({ specOf: async () => ({ ok: true, spec: loaded.spec, text: '{ "id": ' }) });
    await bag.routes.start('example-world');
    const report = await settledOf(bag);
    expect(report.state).toBe('failed');
    expect(report.messages.join(' ')).toContain('does not validate');
  });
});

describe('the source file a pick reads (the editor’s own view)', () => {
  const fromAFile = async (body: string | null): Promise<Awaited<ReturnType<typeof readSourceForPick>>> => {
    const dir = await mkdtemp(join(tmpdir(), 'newspa-pick-'));
    if (body !== null) await writeFile(join(dir, 'example-world.json'), body, 'utf8');
    return readSourceForPick(dir, 'example-world', (path) => readFile(path, 'utf8'), sourceFilePath);
  };

  it('answers with the text verbatim and the parsed spec', async () => {
    const loaded = await fromAFile(sourceText());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.text).toBe(sourceText());
    expect(loaded.spec.id).toBe('example-world');
  });

  it('a file that is not there is a message naming the path it tried', async () => {
    const loaded = await fromAFile(null);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.message).toContain('example-world.json');
    expect(loaded.message).toContain('could not be read');
  });

  it('a file the loader refuses is quoted, with its path, and no spec', async () => {
    const loaded = await fromAFile('{ "id": "example-world", "kind": "nope" }');
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.message).toContain('does not validate');
    expect(loaded.message).toContain('example-world.json');
  });

  it('a read that fails with something that is not an Error is still named', async () => {
    const loaded = await readSourceForPick(
      'sources',
      'x',
      () => Promise.reject('EIO: the disk is gone'),
      sourceFilePath,
    );
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.message).toContain('EIO: the disk is gone');
    expect(loaded.message).not.toContain('undefined');
  });
});
