/**
 * The static resolver, called **directly**: the paths a browser will not send
 * (a server normalises those first) and the types the map does not name.
 *
 * The HTTP tests in `http-app.test.ts` drive the same module through a socket; this
 * file is where the guard arms are pinned, because `fetch` and `node:http` quietly
 * repair a path like `/../x` before it reaches a handler — which is good for the
 * server and useless for a test of the guard.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { staticFor } from '../src/staticFiles.ts';

const dist = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'newspa-static-'));
  await writeFile(join(dir, 'index.html'), '<title>paper</title>\n', 'utf8');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'assets', 'app-1.js'), 'export const a = 1;\n', 'utf8');
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'data', 'payload.dat'), 'bytes\n', 'utf8');
  return dir;
};

describe('staticFor', () => {
  it('refuses a path that does not start at the root, in either spelling', async () => {
    const root = await dist();
    expect(await staticFor(root, 'assets/app-1.js')).toBe('not-found');
    expect(await staticFor(root, 'C:\\windows\\win.ini')).toBe('not-found');
    expect(await staticFor(root, '/a\0b')).toBe('not-found');
  });

  it('refuses a malformed percent-escape as a request that names no file', async () => {
    expect(await staticFor(await dist(), '/%zz/x.js')).toBe('not-found');
  });

  it('serves a type the map does not name as bytes, and keeps the query out of the name', async () => {
    const root = await dist();
    const bytes = await staticFor(root, '/data/payload.dat');
    expect(bytes).not.toBe('not-found');
    if (bytes === 'not-found' || bytes === 'no-build') return;
    expect(bytes.type).toBe('application/octet-stream');
    expect(bytes.cache).toBe('no-store');

    const hashed = await staticFor(root, '/assets/app-1.js?v=2');
    if (hashed === 'not-found' || hashed === 'no-build') throw new Error('a query must not break a hashed asset');
    expect(hashed.cache).toBe('public, max-age=31536000, immutable');
  });

  it('answers a directory, and a path with no extension, with the page', async () => {
    const root = await dist();
    for (const path of ['/assets', '/assets/', '/some/route']) {
      const found = await staticFor(root, path);
      if (found === 'not-found' || found === 'no-build') throw new Error(`${path} → ${found}`);
      expect(found.type, path).toBe('text/html; charset=utf-8');
    }
  });

  it('says `no-build` for an empty tree, and a missing asset is a 404 by name', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'newspa-empty-'));
    expect(await staticFor(empty, '/')).toBe('no-build');
    expect(await staticFor(empty, '/deep/route')).toBe('no-build');
    expect(await staticFor(await dist(), '/assets/app-0.js')).toBe('not-found');
  });
});
