# The run, and the device it runs on

Split out of `docs/state-server.md` at the 300-line cap of rule 1, on the seam the
repo already draws: that file is the surface a reader edits and the dev loop, this is
the **process** - the database claim, what the entry point takes, the scheme the
socket speaks, and what an installed device keeps (`docs/decisions-display.md` is the
matching decision file). Same facts, same rules, one owner per sentence.

## The claim, and who owns it

`db_lock` is the single-instance guarantee, and the row is the truth: no PID file, no
child process. Its rule is **age** - a live owner moves `taken_at` forward with every
heartbeat - and one more, added 2026-11-11: **the owner text is a process, and the
server knows it.** `start.ts` claims as `<uuid>@<host>:<pid>` and answers
`ownerIsAlive` (`process.kill(pid, 0)`), so a claim left by a force-killed server is
reclaimed on the spot, and the boot says so:

`db: took the claim from "0e9a…@desk:18424" (taken at 2026-11-11T14:02:11.481Z) - that
process is not running, so this is a force-killed server's claim, not a second server`

A foreign `<host>` is not answered at all (a pid means a process only where it was
written) and stays governed by the age rule; a live owner is never reclaimed, and the
refusal names the owner it waits for. D-041 in `docs/decisions-surface.md`. The words
are printed by `bootDb.ts`, which is also where `data/` is created before SQLite is
asked to open a file inside it.

## `start` takes no arguments

`pnpm start` and `pnpm server` accept **no** argv: a flag they ignored (the old
behaviour) is a setting the reader believes they changed, and `server.host` is the
access control (D-034). One argument is refused by name, exit **2**, with the sentence
that says the settings are `config.json` (`server.host`, `server.port`,
`scheduler.*`, `scoring.*`). `export --bundle` and `pick --id/--write` keep their
flags: every argv is parsed, and what is not parsed is refused. D-042.

## TLS: the scheme the socket speaks, and the certificate behind it

WP17. One config block, **paths**, relative to the project root:

```json
{ "server": { "host": "0.0.0.0", "tls": { "cert": "tls/newspa-cert.pem", "key": "tls/newspa-key.pem" } } }
```

Absent means plain HTTP, which is what shipped for the first 40 packages and stays the
default; `config.example.json` carries **no** `tls` block on purpose (D-039: a fresh
clone whose example names files that do not exist is a first run that cannot boot), so
the snippet above is the documentation, and `config/test/schema.test.ts` is the test.

**Mint a certificate the devices trust** (the only part that is not obvious):

```
mkcert -install
mkcert -key-file tls/newspa-key.pem -cert-file tls/newspa-cert.pem localhost 127.0.0.1 192.168.0.223 newspa.local
```

List **every name a panel dials**, including the IP: the check is against the address
the client used, and a certificate without it is refused there while working here.
`mkcert -install` trusts a local root CA **on the machine that runs it** — so it runs
on the server, and on every device that will read the paper. That is the kiosk case
D-039 names: a panel with no private CA, or no way to add one, connects to nothing, and
the answer is the `?theme=…&contrast=…` kiosk URL, never lowering the wall.
Where `mkcert` is not available, `openssl` does the same job — the v3 `req`
self-signs with the SAN in one command (`-addext "subjectAltName=DNS:newspa.local,IP:192.168.0.223"`),
and the result is a **self-signed leaf**: browsers accept it only after it is trusted
directly, which is why the recipe above is the CA form.

What the code promises, each arm tested (`tls.test.ts`, `startTls.test.ts`):

- **The pair is read before the database is claimed.** A typo in a path stops the boot
  having created no `data/`, run no migration and taken no `db_lock`.
- **No fallback to plain HTTP, ever.** On a LAN address, plain HTTP is not a secure
  context, so the install (WP16) quietly dies — and the rule-5 answer is the file, the
  reason and the words "not starting", printed.
- **The pair is parsed, not just read** (`X509Certificate`, `createPrivateKey`): a
  `fullchain` with no leaf first, a public key where the private one belongs, a root CA
  served as a leaf — each fails in the handshake as `EPROTO` with no path in it, so the
  boot names the file instead.
- **A PEM pasted into the config is refused by name**, and the key's text never reaches
  a log line (rules 17, 18: `config.json` is what `export --bundle` copies).
- **The reach line prints the scheme the socket speaks**, from the one function that
  chose it, and over TLS adds the CA fact. The firewall hint is the machine's own:
  `netsh advfirewall …` on Windows, `sudo ufw allow <port>/tcp` / `firewall-cmd` on
  Linux, the pane on macOS, and a stated silence elsewhere — an invented command is
  worse than none, because a bind that succeeds behind a firewall that drops inbound
  packets looks exactly like a dead server.
- **Nothing authenticates a reader.** TLS proves the server to the browser; the address
  stays the wall (D-034), and no token, cookie or shared secret appears (rule 20).

The test certificate is **minted per run into the OS temp dir** (D-040):
`packages/server/test/tlsFixture.ts` with `node-forge` — pure JS, zero dependencies, no
install script — so this public repository holds no PEM and `pnpm check:secrets` is
green by construction, not by exemption.

## The install: what a device keeps, and what the page says about it

`apps/web/public/` is the install identity, and all three files in it are
**hand-written** (D-039): `manifest.webmanifest` (`display: standalone`, `scope: "/"`,
`id: "/"`, a `start_url` with **no query** — the D-037 axes arrive by url and an install
that bakes one in pins a device to someone else's display choice), `icons/newspa.svg`
plus 192/512 PNGs (the authored art is SVG; `pnpm icons` =
`scripts/rasterise-icons.mjs` rasterises it in the Edge the repo already launches, and
the pair is committed so a fresh clone needs no browser), and `sw.js`. No
`vite-plugin-pwa`, no Workbox.

**The worker has two rules, named in the file.** The **shell** — the page, the hashed
assets, the manifest, the icons: network first, so a rebuild arrives; the cache is the
answer to "the server is not there". And the **edition** — the last `/api/state`, kept
and **stamped at write time**. Everything else is untouched: the story links (they belong
to the publishers), `/api/events` (caching a socket), `/api/sources` (rule 18: a copy of
the reading list on a device the machine cannot revoke), `/api/pick` (it launches a
window), and every non-GET.

**The stamp is the offline honesty of the page.** `sw.js` writes `newspa-cached-at` into
the cached copy; `apps/web/src/api.ts` reads it and hands the app `{ state, cachedAt }`;
the dateline strip's stats line grows a segment, `cached 06:12` / `Stand 06:12`, in the
strip's own vocabulary (D-039: not a widget). A live answer carries no header, so the
label appears exactly when it is true. With no net **and** no edition the worker answers
`503` with a sentence, and the page prints its failure panel: rule 5, in the browser.

**Two measurements decided the worker's shape.** (1) The server answers `index.html`, the
manifest and the icons `no-store`, and `Cache.put` honours that — `caches.open(SHELL).add('/')`
throws `Response is not cacheable` — so the worker writes its **own body-only copy**.
(2) A page is **not controlled by the worker it registers on that same load**, so the
first visit's `/api/state` goes past the worker: a worker that cached only what it
intercepted would cache nothing on the visit that installs the app, and the reader whose
_second_ visit is offline — the product — would get "no edition" from a device that has
read the paper once. Hence the worker's two acts of its own: **precache the shell at
`install`**, **prime the edition at `activate`**.

`main.tsx` registers the worker **only in the built app** (`import.meta.env.PROD`): a dev
server that installs one leaves a reader working on answers that are minutes old, with
nothing on screen saying so. A refusal is `console.warn`ed, not printed on the sheet; a
browser with no service worker keeps the page as a page, which is the fallback D-039
chose. The server's half is pinned in `packages/server/test/static-files.test.ts`:
`.webmanifest` → `application/manifest+json`, `sw.js` → **`no-store`** (a cached worker
is a page that cannot be updated), and a missing `/sw.js` is a 404 — never the SPA's
`index.html`, because an HTML body under that name is a registration that dies on a MIME
check, silently.

**The install entry is the dateline strip's third control**, in the same `CONTROL`
vocabulary as the two switches (D-035: the page has exactly one overlay, and the sources
editor is it). A button when Chromium hands over `beforeinstallprompt` — the event is
one-shot, so it is **kept**, and the control retires on the press, because a control
whose act is "nothing happens" is a lie. On iOS Safari, which has no such event, the
strip prints iOS's own words (`Share → Add to Home Screen`). On a browser with neither it
prints nothing. Both parts are `display: none` in print. Proved by
`apps/web/test/unit/install.test.tsx` (9, one arm per browser), the two install arms of
`apps/web/test/unit/app-paper.test.tsx`, and `packages/server/test/browser/offline.test.ts`
(real Edge: the built bundle booted, the reader opens twice, the server is **closed**, the
reload prints news with the label, and the strip's time is the time in the cache).
