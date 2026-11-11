# Decisions - the surface

The decisions about **where the paper lives, and who sees what**: the page as the
product (D-002), the reading list staying local (D-025), the address as the access
control (D-034) and the page’s one overlay (D-035).

Numbering is shared across the decision files: pipeline, identity, diff, scoring
and detection in `decisions.md`; tooling, dependencies and testing in
`decisions-tooling.md`; selectors, the ladder, `gone` and the measured cost of the
browser in `decisions-detection.md`; the **device** — where the server sits, the
display axes, install and TLS — in `decisions-display.md` (D-037, D-038, D-039).

## D-002 — The page is the product; no static edition, no SSR (**reversed from the first cut**)

The paper is one ever-changing page at `http://127.0.0.1:8787`: SSE pushes what
changed, the DOM re-renders, read markers and search work on the same state. There
is **no edition file, no `editions/` directory, no `react-dom/server`, no cycle-time
artifact, no static route**. The DB is the record; the page is the paper.

The first cut of this decision said the opposite: at the end of every cycle, render
`editions/<id>/index.html` with `renderToStaticMarkup` (inlined CSS, zero JS). It
was reversed on the evidence of the product's own shape — **there is no single
cycle and no single edition.** The page changes continuously, so a file named after
a day does not describe it, and the "print the edition" story was a print-era habit
imported into a tool that prints nothing. Cost of the reversal: no mailable single
file, and the record is a database query rather than a document.

What survives from the reasoning, because it was never about the file:

- **No request-time SSR.** At `127.0.0.1` the render cost is identical and merely
  relocated into the process that runs the poller and the Edge pool; measured
  latency to real sites is 121–648 ms, localhost 1–5 ms, so first paint was never
  the bottleneck. SSR would add hydration mismatch, CSS ordering, a dual-environment
  data layer and a crash surface to the one process that must survive 3am.
- **A record must exist**, because stealth-edit detection is meaningless without
  what the page said at the time. It does: `items`, `item_events` with the word
  diff, and `snapshots` (one row per poll, 304s included). `pnpm search` reaches it.
- **`@media print` stays** in the paper CSS (3 columns, masthead preserved, hairlines
  kept): browser Print → Save as PDF on the live page is 80% of the print value for
  free, and it is honest about which state it prints — the one you are looking at.

**Reverse if:** a dated document becomes the point (a weekly digest by email, a
printout for a fridge). Then it is an _export_ on demand — `pnpm export --paper
2026-11-08` writing one self-contained file from the same `packages/paper`
components — not a cycle-time side effect with a retention policy.

## D-025 — The reading list stays local; the repo ships examples

The repository is public. A source definition is not a config detail, it is a
statement about a person: the URL set, `watchwords`/`blockwords`, the `section`
labels in the reader's own words, the free-text `notes`, and the fact that a
source needs `profile: true` at all. Publish that and the tool has published its
reader. So:

|                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`sources/`**         | gitignored, local, **not version-controlled**. The loader takes a directory (`config/src/load.ts`), so D-011 is untouched — only which tree is public changed.                                                                                                                                                                                                                                                                                                                                                                             |
| **`sources.example/`** | tracked, placeholder definitions, so a fresh clone boots and the editor's `$schema` association resolves. `.vscode/settings.json` matches both directories.                                                                                                                                                                                                                                                                                                                                                                                |
| **Backup**             | `pnpm export --bundle` already carries `sources/` (D-014), and `export --watchlist` / `--opml` are the portable forms.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **First run**          | Creation is a **named boot step**, `ensureSourcesDir(dir)`: idempotent, creates parents, touches no file. `loadSources` deliberately does not create — a reader with a side effect hides it, and the empty paper has to be _reported_ (`missing-dir`, `no-sources`), so the mkdir and the report stay separate. `writeSource` already made the directory for itself, so the picker, `POST /api/sources` and `sources:migrate` never need `pnpm sources:init`; that command's only job is copying **example files**, which no mkdir can do. |
| **Enforcement**        | `scripts/check-secrets.mjs` fails the build when a path under `sources/` is tracked — the same posture as rule 17: the floor enforces it, so a helpful future agent cannot re-add a reading list.                                                                                                                                                                                                                                                                                                                                          |
| **History**            | none, deliberately. Selector history in `git log` was D-011's stated benefit; it is given up here on purpose. The answer to "did the source change shape, or did I edit the selector?" is the `matchCount` a poll compares against (`no-matches` names the recorded count) and the `snapshots` row per poll, not a diff.                                                                                                                                                                                                                   |

**Capture fixtures logged out.** `packages/fetch/test/fixtures/**` is exempt from
the secret scan for rule 1's reason, and the exemption is symmetric: a payload
captured from a signed-in page carries the reader's own data into a public file.

## D-034 - The paper is on the LAN, and the address is the wall  _(implemented 2026-11-11)_

The reader wants the page on a phone in the next room. That collides with two facts
the repo already commits to: the server **authenticates nothing** (rule 17), and
`/api/state` **is** the reading list (rule 18: every source URL, label, `section`,
`note`, the `profile: true` fact). With no auth, the bind address is the access
control, so it is decided in one module (`packages/server/src/net.ts`) and printed
at boot.

|                         |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default**             | `server.host` stays `127.0.0.1`. LAN is a line in `config.json` - nothing changes for a clone that never asks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Reads**               | any peer on the network: the page, the paper, the stream. That is the requirement, and it is said out loud at boot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Writes**              | **loopback only**, refused on the address before routing: 403 with a reason that cites this decision. A page on the LAN that could write a `sources/*.json` file is a hole with no lock on it, and the guard's teeth are pinned by a test (`http-app.test.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **The reading list**    | `/api/sources` is **loopback-only for every verb**, reads included (`readingListAllowed` in `net.ts`). Its answer is each source file's **verbatim text** — the URL set, the `watchwords`/`blockwords`, the `section` labels in the reader's words, the `notes`, the `profile: true` fact — and rule 18 keeps exactly that set local and unversioned, on the grounds that publishing it publishes its reader. Serving it to the household, in clear text, from a server that authenticates nothing, is the leak that rule exists to prevent. So the editor is a machine-local tool and **the phone gets the paper**. No token, cookie or "shared secret" is introduced to make a LAN read "safe": that is rule 20, and the wall is the same bind, read once more. |
| **The line**            | binding past loopback prints the typeable URLs (from `os.networkInterfaces()`: LAN addresses, and `127.0.0.1` - `0.0.0.0` is not a URL), the sentence that the source **names** are now visible to the household while the files and every write stay loopback-only, and the exact `netsh advfirewall` command. Windows drops inbound `8787`; a bind that succeeds while every packet is dropped is indistinguishable from a dead server, and rule 5 is that a silent zero is a bug.                                                                                                                                                                                                                                                                              |
| **The stream**          | `no-store`, `no-transform`, `x-accel-buffering: no`, `retry:`, and a keep-alive comment on the hub's one timer. Each of those is a middlebox that otherwise turns a push into a stall, a cache, or a paper that quietly stops updating.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **The single instance** | unchanged, and it covers this: the database claim (`db_lock`, taken at open) is what refuses a second process, so two binds on two ports cannot both poll. A claim on the **port** is not built and is not needed for that.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**IPv4 URLs only, on purpose.** A link-local IPv6 (`fe80::1`) is not typeable in a
browser's address bar (it needs a scope id), and a printed URL that does not work is
worse than one that is merely old-fashioned.

**In practice the reader meets Windows' own prompt.** The firewall asks "allow access"
the first time the process listens, so the `netsh` command above is the **fallback**:
for a prompt dismissed without reading, a public profile, or a domain network that
never shows one. The printed line stays, because a bind that succeeds while every
packet is dropped is indistinguishable from a dead server. Measured with
`server.host: "0.0.0.0"`: the boot prints
`listening on http://192.168.0.223:8787, http://127.0.0.1:8787 — anyone on this network
can read the paper, and /api/state shows your source names to them; the source files
themselves (watchwords, notes, sections) and every write stay loopback-only`,
`GET http://192.168.0.223:8787/api/state` answers 200 with the masthead and the source
count, and `GET http://192.168.0.223:8787/api/sources` answers 403 with the sentence
`readingListAllowed` writes — which is what the page prints, in the panel's own status
region, on the phone.

`isLoopback` is the whole policy, so it is tested on the forms a socket actually
presents (`::ffff:127.0.0.1`, `::1`, `localhost`, `127.0.0.53`) and on the
addresses a phone has (`192.168.x`, `10.x`, `fe80::`, `2001:db8::`).
"Reachable over LAN", "loopback-only writes" and "loopback-only reading list" are the
same function read three times.

- 2026-11-11: **the reading list is loopback-only for every verb**
  (`readingListAllowed` in `net.ts`). WP14 added `GET /api/sources`, and its answer is
  each source file's **verbatim text** — the URL set, the `watchwords`/`blockwords`, the
  `section` labels in the reader's words, the `notes`, the `profile: true` fact. That is
  precisely the field rule 18 keeps local and unversioned, on the grounds that publishing
  it publishes its reader, so "reads for the LAN" was widened by the new route and had to
  be narrowed by it. No token was invented (rule 20): the bind is still the wall. The boot
  line's wording follows the fact — "source **names**", not "source list" — and the page
  a phone gets prints the server's own refusal sentence, in the panel's status region,
  because a blank panel would read as "no sources" (rule 5).

## D-035 - The sources editor is a modal above the sheet  _(implemented 2026-11-11)_

The reading list needed an editor on the page (WP14). The question was not whether
to build one - D-011 says the UI writes **files**, and D-025 keeps them local - but
**where a form is allowed to print**, in a page whose whole design law is newsprint.

|                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The box**           | a native `<dialog>` opened with `showModal()`: the top layer, Esc and the tab loop are the browser’s. A `div` with a state flag re-implements each of them badly - `z-index` is a ladder somebody loses, a fake modal traps nothing, Esc is a key handler somebody forgets. Nothing was added to get it (rule 8).                                                                                                                                                                |
| **Above, not inside** | the sheet is the page’s one panel of newsprint - its own `bg-paper`, its guideline ring, its crop marks. A form inside it (a row per source, a textarea of JSON, the **absolute path** of the watchlist directory) spends ink on affordances, and that path **is** the reading list (rule 18). So the sheet prints news and the tool opens above it.                                                                                                                             |
| **One control**       | the entry sits in the dateline strip - the page’s one control row - beside the theme switch, in the same `CONTROL` string (`blockHead.ts`), the third copy of that string being how a page grows three button looks.                                                                                                                                                                                                                                                             |
| **No second box**     | the modal owns the head, the rule to the edge, the close control and the border; the panel inside prints no headline and carries no `panel` class. Measured in Edge: a ringed, dot-gridded panel inside the dialog’s hairline reads as a frame within a frame.                                                                                                                                                                                                                   |
| **Scrim, not shadow** | `::backdrop` is a flat wash of `--ink-2` at 62 %. This page casts exactly one shadow - the scroll edge - and a modal floating on a drop shadow is a card, which the law forbids. Radius 0; `p-box` padding inside `p-0`, because rule 11 pads every box that has a rule.                                                                                                                                                                                                         |
| **Two ways out**      | Esc, and the close control - both arrive as the dialog’s native `close` event, which does not bubble (hence React’s `onClose` on the element). **No scrim click**: Biome’s `useKeyWithClickEvents` is an `error`, and it is right - a mouse-only target on a non-interactive element has no keyboard route, so a way out only a mouse finds is not an affordance.                                                                                                                |
| **It unmounts**       | closing takes the dialog out of the page: no hidden form to tab through, the sheet’s `data-part` list stays the paper’s (the design suite queries it), and the list refetches on the next open, because the files are the truth (D-011) and a cached list is a list the reader did not write. The price is that the browser’s focus return has no node to return to, so the trigger hands the app **its own element** (`SourcesControl.onOpen(control)`) and the app focuses it. |
| **The lazy wire**     | `/api/sources` is asked for when the control is pressed, not on page load: its answer is the reader’s source files, and rule 18 keeps them to a loopback peer, so a page load asks for them only when a reader asked to see them.                                                                                                                                                                                                                                                |
| **The peer**          | a non-loopback peer gets the same control, and the modal prints the server’s refusal sentence (`/api/sources` is loopback-only for every verb, rule 18 + D-034). No new endpoint to hide the button on a phone: a blank panel would read as “no sources” (rule 5), and a route answering “who are you” is new surface bought for a cosmetic win.                                                                                                                                 |
| **Print**             | the trigger, the modal, its close control and the panel inside are `display: none` in print - a form prints buttons and an absolute path. `@media print` is not reachable from a screen viewport, so the claim is pinned **as text** in `packages/paper/test/design-contract.test.tsx`, which extracts the block’s `display: none` selectors and demands all six names.                                                                                                          |

**Measured at acceptance** (real Edge, `server.host: "0.0.0.0"`, 1 440 px): the
control row is `["SOURCES", "DARK"]`; the open dialog computes `background rgb(244,
236, 216)`, `border 0.4px solid`, `border-radius 0px`, `box-shadow none`, backdrop
`oklab(0.3645 … / 0.62)`; 8 source rows print in the box, the sheet carries no
`form` and no `textarea`; the phone’s peer reads the refusal sentence, in the
panel’s own status region, with the paper behind it.

**Reverse if:** a second overlay arrives (the picker, WP6, is the likely one). Then
the modal is a **pattern to extract** - the rules above are the pattern’s, not the
sources editor’s - and the page still gets exactly one kind of overlay, styled once.

## D-036 - The picker is a DevTools-style inspector in a real Edge window  _(implemented 2026-11-11)_

The requirement is the reader's: _open the URL, click the item I want to observe, and
let that click be the selector._ The tool that does this already exists - DevTools'
"Select an element to inspect it" - so the decision is how much of it to build, where
to run it, and what a click is allowed to write.

|                                   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The window**                    | headed Edge (`playwright-core`, `channel: 'msedge'`, D-003) on **the machine that runs the server**, at the source's URL; `profiles/<id>` when `profile: true`, because the browser profile is the only credential (rule 17). A refused launch is **reported**, never an empty answer (rule 5).                                                                                                                                                                                                                                                                                       |
| **The affordance**                | the injected inspector mirrors DevTools' picker: hover rings one element and names it, a **click** captures it, **Up/Down walk the ancestor chain** (the click lands on a `<span>` inside the card, so the parent step is what makes the picker usable), **Esc** cancels. Chrome DevTools Protocol's `Overlay.setInspectMode` is the real inspector and is **not** used: it hands back a `backendNodeId`, and the value we want is a CSS path, so the mapping costs a `DOM.resolveNode` + `Runtime.callFunctionOn` round-trip to buy a cursor this can draw in 40 lines.              |
| **The escape hatch, free**        | the window is a real browser, so `F12` is there: DevTools' own picker and **Copy → Copy selector** work, and cheerio accepts the `#id > nth-child` path it emits. Nothing to build, so document it.                                                                                                                                                                                                                                                                                                                                                                                   |
| **What a click sends**            | a **structural fingerprint**, not a selector: the nth-child path from `<html>` to the clicked node, the nearest `a[href]`'s absolute address, the node's `outerHTML`, the document URL. The page is a **witness**, not an author.                                                                                                                                                                                                                                                                                                                                                     |
| **Where the selector is derived** | in **Node**, against the **raw fetched bytes**, through the real parser. The path maps to a node in the raw HTML; the sibling set generalises (drop segments while the count holds); the count is written as `matchCount`, the rot baseline (D-026). D-007's whole problem is measured here, at pick time: **if the path does not map into the raw fetch, the DOM you clicked is not the DOM the poller fetches** - so the picker records `render: true`, says so, and the transport's named refusal makes the paper report it. **A selector that matched nothing is never written.** |
| **Who presses SAVE**              | the click fills the modal's editor with the merged JSON; SAVE writes, through the one validated path (WP14). A click that rewrote a file would make D-011's truth a side effect of a mouse.                                                                                                                                                                                                                                                                                                                                                                                           |
| **The address**                   | `POST /api/pick` and `GET /api/pick?id=` are **loopback-only** (rule 20: launching a browser on a machine is a write; rule 18: the reading list is loopback's), and the pick state prints **inside** the modal's one overlay (D-035) as a status line, never as a second dialog. A peer reads the refusal sentence.                                                                                                                                                                                                                                                                   |
| **Cut**                           | `kind: 'html'` only. No pagination (`pick.maxHops`), no scroll-to-load, no cookie-banner auto-dismiss (the reader dismisses it in the window, which is free). No **bookmarklet**: Private Network Access and mixed content block a public page's fetch to `127.0.0.1` in an unflagged browser, and a surface behind flags is not a surface. No **in-page iframe**: rule 7 says the paper is an index, not a mirror, and a selector authored against a proxied DOM is not the selector the poller sees. No **polling** render tier (WP6b; D-033 keeps a browser off the poll).         |

**Reverse if:** the injected inspector fights a site's own overlay - a cookie wall that
swallows a capture-phase click. Then CDP `Overlay.setInspectMode` is the fallback,
because it is drawn by the browser's own compositor and a page cannot intercept it, and
the round-trip is bought for a **proven** need rather than in advance.

**What the build added to the decision** (2026-11-11, `docs/roadmap-closed.md` WP6).
The table said "the click fills the modal's editor", singular; the modal can have **two
editors open** (each row owns its own open state), so the job and the fill are keyed by
**source id** — un-keyed, one reader's click labelled a row nobody picked on and
overwrote bytes in a box nobody opened. The CLI's argv is a **decision in data**
(`parsePickArgs`), because every refusal has to be testable on a machine with no
browser (rule 16), and a **bare url writes nothing, ever**: inventing a source file
from a click would author the reader's reading list behind their back. Two facts the
code had to learn by measurement: `new Response(body, { status: 304 })` **throws** (a
304 needs a null body), and the two refusals of `/api/pick` are **not symmetric** — a
LAN `POST` dies at the mutation guard before routing, a LAN `GET` reaches the route and
dies at the reading-list wall — so the order is pinned in `pick-http.test.ts`, because a
test that asserted only the second would hide the first.

## D-041 - A claim is about a process, so a dead owner's claim is taken at once — and the takeover is spoken (2026-11-11)

`db_lock` is the single-instance guarantee (D-022's neighbourhood: one process polls
one paper). Its rule was **age**: a claim older than `lockStaleAfterMs` is an
abandoned one, because a live owner moves `taken_at` forward through `extendLock`.
Ten minutes of age is the right shape for a process that vanished, and the wrong
shape for a reader whose server was force-killed: the row says _taken at 14:02_, the
process died at 14:03, and the next boot answered **"another process holds this
database"** for a quarter of an hour, about a process that did not exist. Measured on
this machine, twice, and the reason a `pnpm start` killed with its process tree was
called a papercut.

**Chosen:** `claimLock` takes an `isAlive` seam. `packages/db` never touches
`node:process` and the owner text is opaque to it, so **the caller that wrote the text
answers** — `packages/server/src/lockOwner.ts` makes it
`<uuid>@<host>:<pid>` and answers with `process.kill(pid, 0)` (`ESRCH` is "no such
process", `EPERM` is "it exists and I may not signal it"). A provably dead owner's
claim is taken on the spot, by an update written against **the dead owner's own
token**, so two newcomers produce exactly one winner and the loser is refused by the
row it can read. The takeover is **printed**, naming the owner text it took: silent, a
second server starting over a live one is indistinguishable from an old one being
reaped, and D-034's rule is that the state of the paper is said, not inferred.

Three edges are the decision, not footnotes:

- **a foreign host is not answered.** A `pid` means a process only on the machine that
  wrote it, so a claim from another host — a shared `data/` over a mount — falls back
  to the age rule, exactly as before. `ownerIsAlive` answers `true` for anything it
  cannot prove: this function may reclaim a claim **it can prove abandoned**, and
  nothing wider. `status`-style "who owns it" reporting is unchanged.
- **the nonce, not the pid, is the identity.** Pids are reused by the OS: a token that
  is a bare pid lets a restarted server inherit a live process's claim and never learn
  that two are running. The heartbeat extends the nonce, so `extendClaim()` on the
  reaped process now returns `false` and its scheduler stops — which is why the
  takeover has to be printed.
- **`start`'s `--port`/`--host` is not a flag to support** (D-042, same shape of
  failure): the settings are `config.json`, and D-034 makes `server.host` the access
  control.

**Reverse if:** a machine exists where a pid probe is unreliable (a container that
reaps as PID 1, a `data/` on a cluster filesystem), and the answer there is the age
rule alone: the seam is optional, and `openDatabase` without `ownerIsAlive` is the
pre-2026-11-11 behaviour, tested to stay working.

## D-042 - `start` takes no argv, and refuses one by name, exit 2 (2026-11-11)

`cli.ts start` ignored extra arguments. That is not neutral here: `server.host` is the
access control (D-034), so a reader who types `start --host 0.0.0.0` and gets a paper
that stayed on loopback **believes they opened the household to it**, and
`start --port 8788` believes the wall is on a number it is not. A flag that is read
nowhere and answered with silence is the same class of bug as a source that matched
nothing and printed zero items (rule 5), in the direction of _more_ confidence.

**Chosen:** `parseStartArgs` is a decision in data (the process edge prints it;
`commands.test.ts` pins it, which is why the argv decision lives in `commands.ts` and
not in the coverage-excluded `cli.ts`): no arguments runs, any argument is refused with
the arguments named and the sentence that says the settings are `config.json`
(`server.host`, `server.port`, `scheduler.*`, `scoring.*`). Exit **2** — the shell's
branch for "you asked for something that does not exist", which is what an unknown
command already gets, and not exit 1, which this repo reserves for _a command that
refused to run its own job_.

`export` and `pick` keep their flags because they have arguments to have: a target file
and `--bundle`, a url and `--id`/`--write`. The rule is not "no flags"; it is **every
argv is parsed, and what is not parsed is refused by name.**

**Reverse if:** a flag earns its place — the honest shape is a _named_ setting that
belongs on a command line (an override of `config.json`'s path, a one-shot
`--once` that polls once and exits), and each one arrives as a parse, a test, and a
line in `docs/state-server.md`, not as an ignored token.
