/* eslint-disable no-restricted-globals */
/*
 * The paper's service worker (WP16, D-039) — hand-written, on purpose. No
 * `vite-plugin-pwa`, no Workbox: a generated precache manifest is a second
 * bundler's opinion about the app's own cache, and rule 8 is few moving parts.
 *
 * Two rules, and they are the only two:
 *
 *   1. SHELL — the page and its hashed assets. Served from the network when the
 *      network is there, and from the cache when it is not, so a phone on a
 *      train opens *a paper* rather than a browser error. A hashed asset is
 *      immutable by name, so the cache never serves a stale bundle.
 *   2. EDITION — the last `/api/state` answer, kept, and **stamped when it was
 *      written**. A worker that serves that answer without the stamp is a page
 *      that looks live and is not, which is rule 5 in the browser: the paper's
 *      own freshness vocabulary carries `cached 06:12` in the dateline strip.
 *      The stamp is written by the worker and read by `src/api.ts`; a live
 *      answer carries none, so the label appears exactly when it is true.
 *
 * What is never touched, and why: the story links (they belong to the
 * publishers, not to us to keep); `/api/events` (the SSE stream — caching it is
 * caching a socket); `/api/sources` (rule 18: the reading list, loopback-only,
 * and a cache of it is a copy of it on a device that is not the machine);
 * `/api/pick` (it launches a window, D-036); and every non-GET (the page writes
 * through the panel's SAVE, and a worker that replays a write is a worker that
 * lies about what the reader did).
 *
 * `sw.js` is served `no-store` by `packages/server/src/staticFiles.ts`: a cached
 * service worker is a page that cannot be updated.
 */

const SHELL = 'newspa-shell-v2';
const EDITION = 'newspa-edition-v2';
const STATE_PATH = '/api/state';
const SHELL_PATH = '/';
const CACHED_AT = 'newspa-cached-at';

const stamp = (response, at) =>
  new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers({ ...Object.fromEntries(response.headers), [CACHED_AT]: at }),
  });

/** Drop this worker's old caches; anything else on the device is not ours. */
const keepOnly = (names) =>
  caches
    .keys()
    .then((found) =>
      Promise.all(
        found.filter((name) => name.startsWith('newspa-') && !names.includes(name)).map((name) => caches.delete(name)),
      ),
    );

/**
 * Write a response into a cache **as a cacheable copy**.
 *
 * The server answers `index.html`, the manifest and the icons `no-store`
 * (`staticFiles.ts`: the only file whose content changes while its name stays is
 * the page itself, and a cached one pins a reader to an old bundle). `Cache.put`
 * honours that and **refuses** such a response — measured: `caches.open(…).add('/')`
 * throws `Response is not cacheable`. That is right for HTTP and wrong for the
 * offline rule, so the worker writes its own copy: the body, and the content type.
 *
 * Nothing is lost by that. The worker's shell rule is **network first**, so a
 * rebuild arrives on the next online open; the cache is the answer to "the server
 * is not there", which is a different question and wants a different policy.
 */
const put = async (cache, path, response) => {
  if (response.status !== 200) return;
  const body = await response.arrayBuffer();
  const type = response.headers.get('content-type') ?? 'application/octet-stream';
  await cache.put(path, new Response(body, { headers: { 'content-type': type } }));
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // The shell, the manifest and the icons. The first navigation of an install
      // is not intercepted — the worker is registered *by* that page, and a
      // navigation is only seen once a controller exists — so this is the only
      // moment the shell can be put in place. A device that installs on wifi and
      // opens on a train is the product (D-039), and it opens on this list.
      for (const target of [SHELL_PATH, '/manifest.webmanifest', '/icons/newspa-192.png', '/icons/newspa-512.png']) {
        try {
          await put(cache, target, await fetch(target));
        } catch (cause) {
          // One file missing is not an install that fails: the offline rule answers
          // with a stated 503 for what it does not have. Spoken in the console the
          // reader's dev tools show, because a silent precache is a silent zero.
          console.warn(
            `the shell precache skipped ${target}: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
      // Take over on the next navigation, not in three days: a reader who installs
      // the paper expects the new one to be the one that opens.
      await self.skipWaiting();
    })(),
  );
});

/**
 * Keep an edition at activation, not only at request time.
 *
 * A page that registers a worker on its own load is **not controlled by it** for
 * the requests it has already made: the first visit's `/api/state` goes to the
 * network, past a worker that did not exist yet. A worker that only caches what
 * it intercepts therefore caches nothing on the visit that installs the app — and
 * the reader whose second visit is offline, which is the whole product (D-039),
 * gets "no edition" from a device that has read the paper once.
 *
 * So the worker asks for the edition itself, once, at activation. A failure is
 * spoken and skipped: no network at install time is normal, and the request rule
 * stays the one that answers for the rest of the device's life.
 */
const prime = async () => {
  try {
    const store = await caches.open(EDITION);
    const response = await fetch(STATE_PATH, { headers: { accept: 'application/json' } });
    if (response.ok) await store.put(STATE_PATH, stamp(response, new Date().toISOString()));
  } catch (cause) {
    console.warn(`the edition prime skipped: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
};

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([keepOnly([SHELL, EDITION]), self.clients.claim(), prime()]));
});

/** Rule 2: the last edition, stamped at write time, served when the net is not. */
const edition = async (request) => {
  const network = await fetch(request).catch(() => null);
  if (network?.ok) {
    const store = await caches.open(EDITION);
    await store.put(STATE_PATH, stamp(network.clone(), new Date().toISOString()));
    return network;
  }
  const cached = await caches.match(STATE_PATH);
  if (cached !== undefined) return cached;
  // No net and no edition: a stated answer, not a silent one (rule 5). A
  // `503` with a sentence reaches `src/api.ts` as an `ApiError`, and the page
  // prints the paper's failure panel — the reader learns the server is gone.
  return new Response('newspa is offline, and this device has never seen an edition.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};

/** Rule 1: the shell. Network first, so a rebuild arrives; cache to fall back on. */
const shell = async (request) => {
  const network = await fetch(request).catch(() => null);
  if (network?.ok) {
    const store = await caches.open(SHELL);
    // A failed write must not lose the answer the reader asked for.
    await put(store, SHELL_PATH, network.clone()).catch(() => undefined);
    return network;
  }
  const cached = await caches.match(SHELL_PATH);
  if (cached !== undefined) return cached;
  return new Response('newspa is offline, and this device has never opened the paper.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};

/** A content-hashed asset: the name is the version, so the cache is the answer. */
const asset = async (request) => {
  const cached = await caches.match(request);
  if (cached !== undefined) return cached;
  const network = await fetch(request);
  const store = await caches.open(SHELL);
  await store.put(request, network.clone());
  return network;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === STATE_PATH) {
    event.respondWith(edition(request));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate' || url.pathname === SHELL_PATH) {
    event.respondWith(shell(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request));
  }
});
