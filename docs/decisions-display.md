# Decisions - the device

Three questions that are not about the paper's content, and not about the pipeline:
**where the server sits**, **how the page looks on a screen that is not a laptop**,
and **how the page gets onto a device at all**. They are one file because they are
one reader request: _this should work on a Raspberry Pi with a screen connected to
it, or an ebook reader - an always-up-to-date news board._

`docs/decisions-surface.md` is the page and its address (D-002, D-025, D-034, D-035,
D-036); `docs/design.md` is the design law this file's axis composes with.

## D-037 - The server is a desk machine; the wall is a display  _(decided 2026-11-11)_

The reader's sentence is the decision: _the Raspi is only the display, the server can
sit somewhere else._ That is not a topology note - it decides what each end is
**allowed to be**, and two of this project's rules read it as a premise.

|                              |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The wall is a reader**     | it renders the paper (`/api/state`, `/api/events`), and nothing else. It is a browser in kiosk mode pointed at a URL that carries its own configuration (`?theme=dark&contrast=more`, D-038), so a device with no keyboard is set by a link. It needs no database, no files, no source of truth.                                                                                                                                                                                                         |
| **The desk is the writer**   | every act that **changes a file** belongs here: the sources editor (WP14), the picker (D-036, which opens a window **on the machine that runs the server**), `pnpm start`, `pnpm export --bundle`. This is not a policy invented for the wall - it is what D-034 and rule 20 already said, read at its consequence: a write needs a machine, and the picker needs a screen **on that machine**.                                                                                                          |
| **The tunnel, not the LAN**  | a remote server is reached with `ssh -L 8787:127.0.0.1:8787 server.local`, which makes the desk's browser a **loopback peer** of a server that is elsewhere: the editor and the picker work, and the reading list never leaves the server (rule 18). Binding `0.0.0.0` is the reader's line in `config.json` and is announced at boot with the firewall command (D-034) - it is the wall shape the reader chose, and it is the shape that makes the sources panel print a refusal sentence on the phone. |
| **A lost server is a state** | a wall device outlives its server (the desk sleeps). A page that goes blank when `/api/state` stops answering is a board that says nothing about why. This is the honest argument for WP16 (the last edition, **labelled** with its cache time) and against presenting any cache as live.                                                                                                                                                                                                                |
| **Cut**                      | no second server role (no sync, no hub, no push from the wall), no MQTT, no companion daemon on the Pi, no native app, no "offline mode" on the wall beyond WP16's labelled cache, and no remote-write UI: a phone that could edit `sources/` would be a mutation from a non-loopback peer, which rule 20 refuses outright.                                                                                                                                                                              |

**Reverse if:** a source must be added with no desk machine in reach. Then the shape
is a **pairing act** - a code on the wall, entered on the desk, which opens a
short-lived loopback-equivalent session - and not a LAN write with a shared secret,
which rule 17 and rule 20 both forbid.

## D-038 - Contrast is a second axis, not a third theme  _(implemented 2026-11-11)_

The report is physical, from the reader's own panel: on an e-ink screen the yellowed
stock `--paper: #f4ecd8` **dithers into a grey fog**, and the hairline rule
`--rule: #d8cdb4` is swallowed by the film. A 16-level panel cannot draw a tint
quietly; it draws noise instead. So the paper needs a mode that is pure stock, pure
ink, rules in ink.

|                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two axes**                       | `data-theme` answers **which stock**, `data-contrast` answers **how hard**. Not four themes: the wall wants _black on white_ **and** _white on black_, which is a pair of knobs, and four palettes are four chances to drift. `[data-theme='dark'][data-contrast='more']` composes them, and is the last block in `tokens.css`, because `[data-a][data-b]` outranks each single attribute.                                         |
| **Palette only**                   | the ruling, taken against the alternatives: the marks, the stock's crossings, the crop marks, the images and the page's one shadow **stay**. High contrast is not a penalty for asking, and the ask is about dithering, not about decoration. What changes: `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--muted`, `--rule`, `--rule-strong`, `--hair`.                                                                            |
| **Two triggers, one law**          | `prefers-contrast: more` (the system's ask) and `[data-contrast='more']` (the page's). The system block is gated on `:root:not([data-contrast])`, so **the page's choice beats the OS**: a wall device set to `normal` has expressed an opinion. `packages/paper/test/design-contract.test.tsx` pins the gate, because a media query is not reachable from a viewport.                                                             |
| **One owner per value**            | measured, 2026-11-11: `tokens.css`'s blocks are **unlayered**, so they beat `@layer base` for the same names. `base.css` had a duplicate `[data-contrast='more']` block; `--muted` computed `#333333` (the token), not `var(--ink-2)` - dead CSS, now deleted. `base.css` keeps the one job the tokens cannot do (the system trigger), `marks.css` keeps its attribute block, because the tokens say nothing about `--pattern-fg`. |
| **The controls**                   | two toggles in the dateline strip - the page's one control row - in the same `CONTROL` string, no new CSS (rule 11). Each names the state the **press gives** (`Dark`, `High contrast`, `Plain`), and `aria-pressed` says which is on. The paper's props are optional, so a control that has no handler never renders, and the paper owns no opinion about which axes to expose.                                                   |
| **A wall device is set by a link** | the url answers first, then `localStorage`, then the system - and the **url writes nothing**, so a phone that opens a wall link once keeps the choice it made for itself. The pre-paint script in `index.html` applies both axes before first paint (D-002, extended), because a dark device must not flash the yellowed stock.                                                                                                    |
| **Silence is not `normal`**        | with no attribute written, the system's `prefers-contrast: more` is still in force. Writing `normal` **refuses** it, which is why the attribute is written on a press and never defaulted.                                                                                                                                                                                                                                         |

**Measured at acceptance** (real Edge, `apps/web/test/design/contrast.test.tsx`, 15
claims over the four combinations): the tokens on `:root`, the utilities that emit
`var(--paper)`/`var(--ink)` (the sheet, the masthead's name, the muted dateline, the
tagline - no component knows the mode exists), and the dateline strip's rule, whose
colour goes from beige to ink. Light-high is `#ffffff`/`#000000`/`#000000` at 1px,
dark-high is `#000000`/`#ffffff`/`#ffffff` at 1px. Also measured and recorded in the
test: **Chromium floors a border width to one device pixel**, so the token's `0.5px`
measures as `1px` at a device-pixel-ratio of 1 - the colour is what the axis changes
on a 1x panel, and the token moves `0.5px → 1px` for the 2x ones.

**Reverse if:** a panel wants a page with **no greys at all** (some readers set a
Kobo to its harshest rendering). Then the change is one more value in the palette
block - `--muted: var(--ink)` - and the axis stays two values, because a third
`data-contrast` value is a ladder of modes, which is the shape this decision refused.

## D-039 - The installable paper, and TLS as its prerequisite  _(decided 2026-11-11, **built** 2026-11-13: WP17, WP16)_

_We need to offer to install the web app as a PWA._ For a wall and a phone, "a tab
I open" is the wrong noun; the product is a **device that shows the paper**. The
decision is recorded before the build because it forces two others: no new
dependency, and TLS.

|                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Manifest, hand-written worker**                                  | a `manifest.webmanifest` and a **hand-written** `sw.js`. No `vite-plugin-pwa`, no Workbox: a plugin that injects a generated precache manifest is a second bundler's opinion about the app's own cache, and rule 8 is exact versions and few moving parts. The cache is two rules, stated in the file: the shell (the built asset, hashed, immutable) and **the last edition** (the `/api/state` answer, kept, labelled).                                                                                                                                                                                                           |
| **Offline is labelled**                                            | the paper a service worker serves when the server is down is the **last edition, with its cache time on the page** - never a page that looks live. This is rule 5 in the browser: a stale edition that says `cached 06:12` is a report; a stale edition that presents itself as news is a silent zero with a masthead on it. The freshness line is the paper's existing `lastPoll` vocabulary (`docs/design.md`), not a new widget.                                                                                                                                                                                                 |
| **The install control is inline**                                  | the dateline strip, the page's one control row - **not** a second overlay (D-035 says the page has exactly one, and the sources editor is it). It appears when the browser offers it (`beforeinstallprompt`), and when the browser does not (iOS Safari) the line **names the recipe** ("Share → Add to Home Screen") instead of vanishing: a control that is silently absent is a feature the reader cannot find.                                                                                                                                                                                                                  |
| **Icons are drawn, then rasterised by the Edge we already launch** | the marks are authored as **SVG in the repo**, and `scripts/` rasterises them with `playwright-core` + `channel: 'msedge'` - the `pnpm shots` recipe (D-003). No icon dependency, no CDN asset (rule 11), no image toolchain: PNG 192/512 with a maskable pair, generated, and the generator is in the repo so the icons cannot rot.                                                                                                                                                                                                                                                                                                |
| **TLS is the prerequisite, not a feature**                         | a service worker registers only in a **secure context**. `http://127.0.0.1:8787` is one; `http://192.168.0.223:8787` is not, and that is the address the LAN reader has. So WP17 adds `server.tls { cert, key }` to the config and the process answers `https://`. The keys live in `data/` (gitignored), `scripts/check-secrets.mjs` fails a committed `-----BEGIN … KEY-----`, and the docs carry the `mkcert` recipe (and openssl's, for a machine with no mkcert). Rule 17 is untouched: TLS authenticates **the server to the browser**, and nothing authenticates a reader to the server. The address stays the wall (D-034). |
| **Two install shapes, and both are first-class**                   | a phone: HTTPS + the manifest + the worker, added to the home screen. A desk Pi or a kiosk: `msedge --app=http://127.0.0.1:8787/?theme=dark&contrast=more` - no service worker, no certificate, no prompt, and the D-037 url carries the display axes. An e-ink reader's browser may not trust a private CA at all, so the kiosk URL is not a fallback: it is the wall's product.                                                                                                                                                                                                                                                   |
| **Cache policy is the server's**                                   | `sw.js` is **never** `immutable` (a cached service worker is a page that cannot be updated), `index.html` stays `no-store`, and the SPA fallback must not shadow `/sw.js` - the rules `packages/server/src/staticFiles.ts` already spells for hashed assets, widened by two names.                                                                                                                                                                                                                                                                                                                                                  |
| **Cut**                                                            | no push notifications from the worker (notifications are retired by D-045, and a server with no authentication has no push credential to keep), no background sync, no offline mutation of any kind, no app shell that hides the "not live" sentence.                                                                                                                                                                                                                                                                                                                                                                               |

**Reverse if:** the reader's panel cannot install (a Boox browser with no service
worker, which is likely). Then the kiosk URL **is** the product, WP17's TLS serves
only the phone, and nothing about the paper changes - which is why the offline
sentence lives in the page's own vocabulary and not in the worker.

**Built (2026-11-13), and what the devices said.** The manifest, the worker and the
icons are hand-written (`apps/web/public/`), the worker has two named rules (the shell;
the last edition, **stamped at write time** with `newspa-cached-at`), the stamp reaches
the dateline strip's stats line as `cached 06:12` / `Stand 06:12`, and the install entry
is the strip's third control - a button when Chromium hands over `beforeinstallprompt`,
iOS's own words where it does not, silence on a browser with neither. Two measurements
built the worker's shape, and both were invisible from the spec: **`Cache.put` honours
`no-store`** and the server answers `index.html` `no-store`, so the worker writes its own
body-only copy; and **a page is not controlled by the worker it registers on that same
load**, so the worker precaches the shell at `install` and primes the edition at
`activate` - a worker that cached only what it intercepted would cache nothing on the
visit that installs the app (the records, with the traps, are in
`docs/roadmap-closed-device.md`).

TLS arrived as WP17 and is now in use on a real machine, and the honest finding is that
**the install is a trust question, not a scheme question.** With a pair minted by
`mkcert` and configured as `server.tls` (two paths; the socket is HTTPS only, plain HTTP
is gone), an Edge that **verifies** the chain - no bypass, no flags - loaded the paper,
registered the worker, cached the edition with its stamp, and fired
`beforeinstallprompt`, which the app captured. Where the CA is not in the device's trust
store the reader can still _read_ the paper over an accepted warning, and that is the arm
that has no install: Chromium's installability gate wants a valid chain, so the prompt
never arrives and the offline paper never exists. So the CA is per device - on Windows
`mkcert -install` writes `Cert:\CurrentUser\Root`, which Edge honours; a phone needs
`rootCA.pem` installed (Android: a user CA; iOS: a profile, then full trust) - and
loopback stays the kiosk's address, a secure context with no certificate at all.

**D-040 - A test certificate is minted at test time, and nothing key-shaped is committed (2026-11-11, ruled).**

WP17 (TLS) needs an HTTPS server in a test. Four sources for that certificate were
on the table, and the deciding fact is that **this repository is public on GitHub**.

- **A committed PEM pair** under the rule-17 fixtures exemption discloses nothing - a
  self-signed cert for `127.0.0.1` has no identity, no data and no trust relationship
  behind it, so it is not a credential in rule 17's sense. What it costs is not
  disclosure: it is that the first private-key block in a public commit
  teaches every later session that the pattern is allowed _here_; that
  `cp test/fixtures/tls/*.pem config/` is one command away when "TLS isn't working",
  and the file it produces is a key the world has; and that GitHub's secret scanner
  files an alert on it, leaving a permanent "we knowingly committed a key" record on a
  public repo. Rule 17 is a habit, and a habit is not maintained by arguing the
  exception is harmless.
- **`.NET`/PowerShell minting** is Windows-only, so the test cannot run on the device
  this project is for (the Raspi wall) or on Linux CI.
- **`mkcert`** needs a binary on PATH _and_ a local root CA installed on the machine -
  a test that cannot pass on a fresh clone, which is the same objection the repo
  already raises about a pre-commit hook that needs Edge.
- **Hand-assembling X.509 DER in Node** was attempted, to zero dependencies, and the
  measured cost is the reason this decision exists: the certificate parsed, printed
  the right `subjectAltName`, and then `X509Certificate#verify()` returned **false** -
  a cert that looks right and cannot complete a handshake. Four traps, each of which
  produced a cert that parsed, printed and then failed: extension numbers **are** the
  context tags;
  a self-signed leaf needs SKID **and** AKID; context tags are **primitive**, which is
  why one host name works and two answer `asn1 encoding routines::wrong tag`; and
  `Array.prototype.flat` does not flatten a `Uint8Array`, so `[u8, u8].flat()` is two
  elements and `new Uint8Array` of that is **zeros**.
- **`@peculiar/x509`**, this record's first choice, **does not load.** It depends on
  `tsyringe@4.10.0`, a dependency-injection container, whose entry point throws
  `tsyringe requires a reflect polyfill. Please add 'import "reflect-metadata"'`. So
  one test certificate would have arrived with a DI container **and** a global
  `Reflect` patch, imported at the entry of `packages/server`, changing reflection for
  every module loaded after it - the only side-effect import in a tree whose seams are
  all plain function parameters (`BootDeps`, `PollDeps`, `PickApiDeps`).
  `selfsigned@5.5.0` is the same `@peculiar`/`pkijs` tree.

**Chosen: `node-forge@1.4.3` + `@types/node-forge@1.3.14` as a devDependency of
`packages/server`** - pure JS, **zero dependencies**, no install/build script, so
`ignoreScripts: true` and `strictDepBuilds: true` in `pnpm-workspace.yaml` stay intact
and it runs on the board's Linux host - **minting a fresh self-signed pair per run into
the OS temp dir** (`test/tlsFixture.ts`). The repo then contains no PEM, so
`check:secrets` is green by construction rather than by exemption, the pair is
cross-platform, and the same fixture mints the arms the tests need: a pair for a LAN
IP, an expired pair, a certificate whose key is a different file. The runtime grows by
nothing: `pnpm start` reads a certificate with `node:crypto` alone, and the
dependency appears in test code only.

One measured trap in the keeper, because the message names neither the caller nor the
field: forge spells the **certificate** extension's list `altNames`; `alt` is the
certification-**request** form. Built with `alt`, the extension reaches the encoder
unset and dies at `x509.js:2273` as `TypeError: Cannot read properties of undefined
(reading 'length')`.

Two consequences, both deliberate:

- **the dependency arrives with the code that uses it, not before.** A devDependency
  with no test importing it is a promise with no proof, and rule 8 asks for a note
  beside a _used_ dependency;
- the fixtures exemption in `scripts/check-secrets.mjs` stays what it always was -
  for **captured payloads** (a parser fixture that carries a token shape), not for
  keys. Nothing in this repo needs a committed key, and the scanner keeps saying so.

**Reverse if:** Node grows a certificate API in a release the repo can depend on
(the dependency then exists for one file), or the devDependency's tree gains a native
module or an install script, which rule 8 forbids - at that point the honest options
are a checked-in pair generated by a documented script into a **gitignored** path,
with the tests that need it reporting loudly that the path is empty (rule 5: a silent
skip is a silent zero, which is why "generate by hand, skip if absent" was rejected).
