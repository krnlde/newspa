import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSources, parseSourceJson } from '../src/load.ts';

/**
 * The non-`Error` arms of the two catches in `load.ts` (`'cannot read'` at the
 * `readFile` catch, `'unparseable'` at the `JSON.parse` catch) cannot be
 * provoked by real I/O: measured on Node 26, `fs.promises.readFile` rejects
 * with an `Error` carrying `code: 'EISDIR'` for a directory and `code:
 * 'ENOENT'` for a missing file, and `JSON.parse` throws a `SyntaxError`. A
 * directory path — the trick `load.test.ts` uses — therefore covers the
 * `Error` arm and never this one.
 *
 * The arms exist for one reason: a rejection of an unexpected shape must still
 * become an issue that reaches the paper, never a silent zero, and never a
 * crash. That contract can only be pinned by fabricating the rejection, so it
 * is done here, in its own file, so the `node:fs/promises` mock cannot leak
 * into `load.test.ts`, which needs the real filesystem.
 */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // Only this one name is faked; every other call is the real thing.
    readFile: (file: string, encoding: BufferEncoding) =>
      file.endsWith('string-rejection.json')
        ? Promise.reject('this rejection is not an Error')
        : actual.readFile(file, encoding),
  };
});

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'newspa-load-failures-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('non-Error rejections', () => {
  it('reports an unreadable file whose rejection is not an Error, and carries on', async () => {
    await writeFile(path.join(dir, 'string-rejection.json'), 'ignored', 'utf8');
    const result = await loadSources(dir);
    expect(result.sources).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.reason).toBe('unreadable');
    expect(result.issues[0]?.file).toBe('string-rejection.json');
    expect(result.issues[0]?.messages).toEqual(['cannot read']);
  });

  it('reports unparseable text whose throw is not an Error, naming the file', () => {
    vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw 'this throw is not an Error';
    });
    const parsed = parseSourceJson('{ "id": ', 'broken.json');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issue.reason).toBe('invalid-json');
    expect(parsed.issue.file).toBe('broken.json');
    expect(parsed.issue.messages).toEqual(['unparseable']);
  });
});
