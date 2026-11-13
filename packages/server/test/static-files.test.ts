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

/**
 * The install files, and the two rules that make them work (WP16, D-039).
 *
 * A **cached service worker is a page that cannot be updated**: the browser
 * re-reads `/sw.js` byte-by-byte to decide whether to install a new worker, so an
 * `immutable` on it pins the reader to the old one for a year. The manifest is the
 * same class of fact — it names the icons and the start url, and a cached one
 * keeps a device pointing at an app that no longer exists.
 *
 * And the SPA fallback must not shadow `/sw.js`: a file the build did not emit has
 * to be a 404, because serving `index.html` under that name gives the browser an
 * HTML document where it asked for a worker script — a registration that fails
 * with a MIME error, on a page that looks fine.
 */
describe('the install files', () => {
  const withInstallFiles = async (): Promise<string> => {
    const root = await dist();
    await writeFile(join(root, 'manifest.webmanifest'), '{"name":"The Daily"}\n', 'utf8');
    await writeFile(join(root, 'sw.js'), 'self.addEventListener("install", () => self.skipWaiting());\n', 'utf8');
    return root;
  };

  it('serves the manifest as a manifest, never cached', async () => {
    const found = await staticFor(await withInstallFiles(), '/manifest.webmanifest');
    if (found === 'not-found' || found === 'no-build') throw new Error('the manifest must be served');
    expect(found.type).toBe('application/manifest+json');
    expect(found.cache).toBe('no-store');
  });

  it('serves the worker as a script, never cached', async () => {
    const found = await staticFor(await withInstallFiles(), '/sw.js');
    if (found === 'not-found' || found === 'no-build') throw new Error('the worker must be served');
    expect(found.type).toBe('text/javascript; charset=utf-8');
    expect(found.cache, 'a cached worker is a page that cannot be updated').toBe('no-store');
  });

  it('404s a missing worker by name, and does not answer it with the page', async () => {
    // The SPA fallback is for routes. `/sw.js` has an extension, so the fallback
    // must not reach it: an HTML body named `sw.js` is a registration that dies on
    // a MIME check, silently, and the reader has no offline paper to show for it.
    expect(await staticFor(await dist(), '/sw.js')).toBe('not-found');
  });
});
