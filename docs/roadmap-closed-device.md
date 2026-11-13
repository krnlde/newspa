# Closed work packages - the device

The certificate, the install, the offline edition: split out of
`roadmap-closed-surface.md` at the 300-line cap of rule 1, on the seam the repo
already draws - the picker, the styling and the panel are the surface a reader
edits, while WP16 and WP17 are the **device** the paper runs on
(`docs/decisions-display.md` is the matching decision file). Same numbering, same
rule: each package carries what it measured.

## WP17 - closed: TLS, two paths in the config (2026-11-13)

**Was.** `server.host` was the wall (D-034) and the socket spoke plain HTTP. On
`http://192.168.0.223:8787` a phone cannot register a service worker - not a secure
context - so WP16 was unreachable from the devices that want it, and the reading list's
text crossed the LAN in the clear.

**Is.** `server.tls: { cert, key }`, **paths** relative to the project root, `null` by
default (plain HTTP, unchanged). `packages/server/src/tls.ts` reads the pair - the
certificate through `X509Certificate`, the key through `createPrivateKey` - and
`start.ts` does that **before the database is opened**, so a pair with a typo in a path
stops the boot having created no `data/`, run no migration and taken no claim.
`schemeOf` is the only owner of the scheme, and `net.ts`'s reach line, the firewall
hint and the tests all read it from there: what the boot printed is what the socket
speaks. A key stays out of the config (rule 17 + rule 18: `config.json` is what
`export --bundle` copies), and the test certificate is minted per run into the OS temp
dir (D-040), so the repository holds **no PEM** and `check:secrets` is green by
construction.

**Measured, and it changed the code.**

- `@peculiar/x509@3.1.0` - D-040's first choice - does not load: it pulls `tsyringe`,
  which throws `tsyringe requires a reflect polyfill. Please add 'import
  "reflect-metadata"'` at its entry point. `selfsigned@5.5.0` is the same
  `@peculiar`/`pkijs` tree. **`node-forge@1.4.3`** (zero dependencies, pure JS, no
  install script) is what mints, and the mint is the only place it appears: `pnpm start`
  needs `node:crypto` alone.
- forge spells the certificate extension's field **`altNames`**; `alt` is the
  certification-**request** form. A certificate built with `alt` reaches the encoder at
  `x509.js:2273` and dies as `TypeError: Cannot read properties of undefined (reading
  'length')` - a message with the library's variable in it and no word about my call.
- The hand-assembled DER is not retried. It parsed, printed the right `subjectAltName`
  and then failed `X509Certificate#verify()`; the four traps are D-040's record. The
  forge mint passes that same check, which is why it is the fixture's assertion.
- **`node:https` has no `createHttps`.** `node:https`'s function is `createServer`, so
  the import is `createServer as createHttpsServer` - and `import { createHttps } from
  'node:https'` is a `TypeError: createHttps is not a function` at boot, not a type
  error, because the module namespace is `any`-shaped at the JS boundary.
- A self-signed leaf is accepted by a client that passes **the leaf itself as `ca`**
  (the test's client), and by no one else - which is the kiosk case D-039 names: a
  panel needs `mkcert -install`'s root, because the device must trust the issuer.
- **A plaintext request to the TLS port is refused in the handshake**, by OpenSSL, not
  by the router: no route runs, no API body leaks. `startTls.test.ts` asserts that at
  the socket.
- The probe caught a rule-17 leak of my own making: a PEM pasted into the config
  produced a log line containing the resolved **path built from the key's text** - a
  thousand characters, key material first. `absolute()` now refuses any value with
  `-----BEGIN` in it, by name, and quotes at most 24 characters.
- A test that names `root/tls` names a directory it has not made: `writeTo` **mkdirs**.

**One deviation from the written accept, deliberate.** WP17 asked
`config.example.json` to carry the shape; it ships **no `tls` block**, because the
example is a fresh clone's first config and an example naming files that do not exist
is a first run that cannot boot. The snippet and both recipes live in
`docs/state-device.md`; `config/test/schema.test.ts` covers the arms the example would
have carried (a pair of paths parses, `{cert}` alone / `{}` / a bare string / an empty
path all refuse).

**Accept.** server 346 tests (`tls.test.ts` 8: the parse refusals, the swapped files,
the pasted PEM; `startTls.test.ts` 5: HTTPS at the socket, the reach line's scheme, the
plaintext refusal, the typo'd path that leaves no `data/`; `net.test.ts` +5: the scheme
and the four platform arms); config 118 (+1, the `server.tls` arms); `pnpm check` green
at 427 files ≤ 300, lint 0/9, typecheck clean. WP16 is now reachable on the LAN.

## WP16 — closed: the installable paper, and a cache that says it is a cache (2026-11-13)

**Was.** A tab. `apps/web` shipped no manifest, no icons a browser could use and no
service worker, so there was no home screen, no standalone window, and — the real loss
for a wall — **nothing on the screen when the server was down** (D-039).

**Is.** `apps/web/public/manifest.webmanifest`, hand-written, and `apps/web/public/sw.js`,
hand-written: no `vite-plugin-pwa`, no Workbox. The icons are authored as SVG
(`public/icons/newspa.svg`) and rasterised to 192/512 PNG by `pnpm icons`
(`scripts/rasterise-icons.mjs`, `playwright-core` + `channel: 'msedge'`, the `pnpm shots`
recipe), committed, so a fresh clone needs no browser and the generator is in the repo.
The worker has **two named rules**: the shell (the page, the hashed assets, the manifest,
the icons) and the last edition (`/api/state`, kept and **stamped at write time**). The
stamp is the offline honesty of the page: `sw.js` writes `newspa-cached-at` into the
cached copy, `api.ts` reads it, and the dateline strip's own stats line grows a segment,
`cached 06:12` / `Stand 06:12`. A live answer carries no header, so the label appears
exactly when it is true. The install entry is the strip's **third control**, in the
`CONTROL` vocabulary: a button when the browser has a prompt in hand, iOS's recipe
(`Freigeben → Zum Startbildschirm hinzufügen`) when it has none, and silence on a browser
with neither — never a second overlay (D-035), never a control whose act is nothing.
`main.tsx` registers the worker **only in the built app** (`import.meta.env.PROD`): a dev
server that installs a worker leaves a developer editing answers that are minutes old.

**Measured, and it changed the code.**

- **A `file://` image taints the canvas**, so `toDataURL` throws `SecurityError`; a
  `data:` URL is same-origin, and the SVG travels to the page as base64 text.
- **An XML comment may not contain a double hyphen.** The "why" prose inside the icon
  (`--paper`, `--ink`) made the file invalid XML, and as an image it failed with a
  wordless `onerror`: the canvas drew nothing, and the PNG that came out was a valid
  blank tile. The art file carries no comment now, and the generator refuses a tile
  whose mark is not 2–50% of its area (9.5% measured).
- **`Cache.put` honours `no-store`, and the server answers `index.html` `no-store`**
  (`staticFiles.ts`, on purpose: a cached page pins a reader to an old bundle). So
  `caches.open(SHELL).add('/')` throws `Response is not cacheable`, and a worker that
  caches what the server sends has no shell to serve. The worker writes its **own
  copy** of the body — the network-first rule keeps freshness, and the cache answers a
  different question: "the server is not there".
- **A page is not controlled by the worker it registers on that same load.** The first
  visit's `/api/state` goes past the worker, so a worker that caches only what it
  intercepts caches nothing on the visit that installs the app — and the reader whose
  _second_ visit is offline, which is the product, gets "no edition" from a device that
  has read the paper once. Hence the worker's two acts of its own: it precaches the
  shell at `install`, and it primes the edition at `activate`.
- **happy-dom puts its own `URL` on the global**, and `readFile(new URL(rel,
  import.meta.url))` opens a file named `undefined`; the install test resolves paths
  with `node:url`'s own `URL`, the same note `packages/server/test/boundary.test.ts`
  carries.
- `playwright-core` has no `expect` (it lives in the test runner), so the browser test
  waits with the locator's own `waitFor` and asserts with vitest.
- The manifest is a **static file**: `theme_color` cannot read `--paper`, so
  `test/unit/manifest.test.ts` pins the manifest's colours to the values
  `packages/paper/styles/tokens.css` owns, and pins every `src` to a file that exists,
  and each PNG's own IHDR to the `sizes` the manifest claims.

**Accept, and where it is proved.** The manifest parses and names icons that exist
(`apps/web/test/unit/manifest.test.ts`, 5). The worker is **registered for real** in real
Edge, in a new node project (`packages/server/test/browser/offline.test.ts`, 2, run by
`pnpm test:design`): the built bundle is booted on a loopback port, the reader opens the
paper twice, the server is **closed**, the page is reloaded, and the assertion is that the
dateline strip prints the label and the sheet prints news, not the failure panel — and
that the time on the page is the time in the cache. The second arm is the honest floor:
with the edition cache emptied the worker answers `503` with a sentence (`newspa is
offline…`), and `/api/sources` **fails** offline, because the reading list is never
served out of a cache on a device the machine cannot revoke (rule 18).
`packages/server/test/static-files.test.ts` pins the two server rules: `.webmanifest` →
`application/manifest+json`, `sw.js` → `no-store` (a cached worker is a page that cannot
be updated), and a missing `/sw.js` is a 404, never the SPA's `index.html`.

**And on the machine, 2026-11-13.** A pair minted by `mkcert`, `server.tls` set, the socket
HTTPS only: an Edge that verifies the chain registered the worker, cached the stamped
edition and fired `beforeinstallprompt`, which the app captured. That is the acceptance the
roadmap asked for, observed by hand, and it names the one thing the tests cannot supply: **a
device that trusts the CA** (D-039 carries the measurement, including the arm where the chain
is untrusted — the paper reads, the install does not come).

**Numbers.** web 205 tests (99.35/95.28/100/99.5, `install.ts` 100% statements), paper
175 (99.55/98.44/100/100), server 349 + 2 in the Edge project (99.00/95.36/96.96/99.38),
`test:design` 38 in real Edge across three projects, 441 files ≤ 300, lint 0 errors / 9
warnings, schemas match zod, `check:secrets` clean with the PNGs tracked (binaries
exempt).

**Cut, as D-039 ruled, and unbuilt.** No push (WP10's own toast line is the paper's), no
background sync, no offline mutation, no app shell that hides the offline sentence.
