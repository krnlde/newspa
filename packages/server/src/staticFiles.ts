/**
 * The static half of the server (WP4): the built app from `apps/web/dist`.
 *
 * Three rules decide every response here, and two of them are about caching:
 *
 *  - **`index.html` is never cached.** It is the only file whose *content* the
 *    build changes while its *name* stays the same, so a cached one pins the
 *    reader to an old bundle by reference. `no-store`, and the bundles it names
 *    are content-hashed, so the pair is safe.
 *  - **A hashed asset is immutable.** `max-age=… , immutable` on `/assets/` is
 *    the other half of the same fact, and it is what makes a reload cheap.
 *  - **A missing `dist` is a report, not a 404.** `pnpm start` before `pnpm build`
 *    must say so, with the path it looked at, in the body the browser shows
 *    (rule 5). A blank page and a 404 in a log is the silent zero, wearing a
 *    server's clothes.
 */
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { normalize as normalizeUrlPath } from 'node:path/posix';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const FALLBACK_TYPE = 'application/octet-stream';

/** Vite's content-hashed output lives here; anything else must be revalidatable. */
const isImmutablePath = (path: string): boolean => path.startsWith('/assets/');

const typeOf = (path: string): string => CONTENT_TYPES[extname(path).toLowerCase()] ?? FALLBACK_TYPE;

export interface StaticFile {
  readonly body: Buffer;
  readonly type: string;
  readonly cache: string;
}

/** A path that stays inside `dist`: URL semantics first, containment on absolutes. */
const safeJoin = (dist: string, urlPath: string): string | null => {
  const raw = urlPath.split('?')[0] ?? '/';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // a stray `%` is a request that cannot name a file, not a crash
  }
  if (decoded.includes('\0')) return null;
  // `node:path/posix`, not `node:path`: a URL path is `/`-delimited on every
  // platform, and `normalize('/')` on Windows returns `'\'`, which then fails every
  // `startsWith('/')` test a URL needs. Measured, on this machine.
  const clean = normalizeUrlPath(decoded);
  if (!clean.startsWith('/')) return null;
  const root = resolve(dist);
  const target = resolve(dist, `.${clean}`);
  return target === root || target.startsWith(`${root}${sep}`) ? target : null;
};

const readIfFile = async (target: string): Promise<StaticFile | null> => {
  try {
    const found = await stat(target);
    if (!found.isFile()) return null;
    return { body: await readFile(target), type: typeOf(target), cache: 'no-store' };
  } catch {
    return null;
  }
};

/**
 * The file for a request path, or a named `missing`:
 *
 *  - `/` → `index.html`;
 *  - a path with an extension → itself, and a **404 by name** if it is not there
 *    (a hashed bundle that vanished is a build fact the reader should see, not a
 *    silently served `index.html`);
 *  - a path without one → the app's route, so `index.html`;
 *  - nothing at all in `dist` → `no-build`, which is what "run `pnpm build`" means.
 */
export const staticFor = async (dist: string, urlPath: string): Promise<StaticFile | 'no-build' | 'not-found'> => {
  const target = safeJoin(dist, urlPath);
  if (target === null) return 'not-found';
  const clean = normalizeUrlPath(urlPath.split('?')[0] ?? '/');
  const requested = clean.endsWith('/') ? `${clean}index.html` : clean;

  if (requested === '/index.html') {
    const found = await readIfFile(join(dist, 'index.html'));
    return found ?? 'no-build';
  }

  const direct = await readIfFile(target);
  if (direct !== null) {
    return isImmutablePath(clean) ? { ...direct, cache: 'public, max-age=31536000, immutable' } : direct;
  }
  // No extension: a client-side route. An extension: a real 404.
  if (extname(clean) !== '') return 'not-found';
  const index = await readIfFile(join(dist, 'index.html'));
  return index ?? 'no-build';
};
