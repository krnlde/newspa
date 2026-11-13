# Closed work packages - the surface

The picker, the styling migration, the sources panel, TLS: split out of
`roadmap-closed.md` at the 300-line cap (rule 1). The pipeline records -
WP1, WP2, WP3 - stay in `roadmap-closed.md`. Same numbering, same rule: each
package carries what it measured.

## WP12 — retired: the two "health defects" are not defects

**What happened.** The notes recorded two bugs: that
`classifyFetch({ status: 304, ok: true, itemCount: 0 })` yielding `unknown`
makes the paper say _"Baselined, watching from now on"_ on every conditional-GET
hit, and that core's `errorKindOf` collapses a TLS failure to `network`. Neither
survives reading the code under it, so the recorded gap was a wrong expectation
about intended behaviour, not a defect (rule 14). `docs/state.md` §"Two things
that look like defects and are not" carries the evidence: the `304` answer is
`unknown` **because** the parser never ran and `itemCount` is `0` by
construction — the pipeline keeps the last good state, and the read side refuses
an invented `matchCount` — and the TLS path is `classifyThrown` in
`packages/fetch/src/transportErrors.ts`, which walks the cause chain and names
`tls` long before core's fallback is reached.

**Do not** "fix" either one. What is genuinely open around health is WP2 (the
pipeline must perform that composition) and the one unexplained `404` in
`docs/state.md`.

## WP14 - closed: the sources panel (2026-11-11)

**Was.** Sources are files, and the page showed them read-only: `apps/web` had no form,
`POST /api/sources` was named in the body of a 404, and the only writer was
`packages/config`'s `writeSource`/`removeSource` — built, tested, unreachable.

**Is.** Three verbs and a panel. `GET /api/sources` answers the directory — every
`*.json`, **its own text**, the loader's issues for that file, the row's health and
`enabled`, and `writable` for the peer who asked. `POST` takes core's existing
`addSourceRequestSchema` — **raw file text** — validates with `parseSourceJson` (the
loader's own function, so the editor can never disagree with the poll), writes
`sources/<id>.json`, refreshes the row (so the paper shows the source and `dueSources`
polls it first), and answers the path it wrote. `DELETE ?id=` removes the file and
**disables the row**: the poll stops, the items and history stay, and the source is
listed as disabled rather than vanished. A posted `filename` is **checked, not obeyed** —
`<id>.json` is D-011's rule, so a body naming `evil.json` with `id: "bbc"` is refused
rather than given a second name.

**Measured, and it changed the code.**

- `req.destroy()` on a body over the 64 KiB cap kills the connection: the client saw
  `TypeError: fetch failed`, not the 413. So the answer is written **first**, the request
  is paused, and the 413 says `connection: close` — the body was never consumed, so that
  socket is not reusable.
- `stream.destroy('a string')` hands the listener `undefined`, not the string, so the body
  reader prints `String(cause)`: "the request body did not arrive: undefined" names
  nothing (rule 5).
- A refusal that _returns_ is data — and a panel that reacts only to a **throw** closes
  the box on it, so the reader's typed JSON vanished on every refused write. `api.ts`
  keeps the answer as data (a 404 is the route's sentence, not a broken wire),
  `SourcesSection` rejects the mutation with `RefusalError`, and the editor keeps the
  bytes beside the loader's reason. Pinned in `sources-write.test.tsx`.

**The boundary is the whole security story, and the route moved it.** `net.ts`'s guard
runs **before routing**, so a write from a non-loopback peer is a 403 that never reaches
this code (pinned: a spy on the routes bag records that `remove` was not called). The new
route forced the second half of D-034: `GET /api/sources` answers each file's **verbatim
text** — the URL set, the `watchwords`/`blockwords`, the `section` labels in the reader's
words, the `notes`, the `profile: true` fact — which is exactly the field rule 18 keeps
unversioned. So the route is loopback-only for **every verb** (`readingListAllowed`), and
the boot line says "source **names**", not "source list". The phone gets the paper and
prints the server's refusal sentence; the editor is a machine-local tool. No token, no
cookie (rule 20).

**The panel** is `SourcesPanel`/`SourceRow`/`SourceEditor`/`sourceStyle` in
`packages/paper`: `data-part` hooks (`sources`, `source-row` with `data-file/-state/
-enabled/-issues`, `source-text`, `issues`, `confirm`, `sources-status`), no strings of
its own (labels arrive as a prop object, D-019), no fetch, no `node:*`. The loader's lines
sit under `pattern-crossings` — the mark that names an absence, which is what a file that
does not parse is. A delete asks once, in the page. `writable: false` renders the sentence
and **no** affordance. The whole block is `display: none` in print: a form is not news,
and it prints the absolute path of the watchlist directory. Pinned as text in
`design-contract.test.tsx`, because `@media print` is not reachable from a screen viewport.

**Accept.** 104 tests. `sources-api.test.ts` (16) drives the handlers on a temp tree and a
real db: the list, a file that does not parse listed with its issues, the
filename-is-the-id refusal, the empty and the missing directory; write → file + row +
due-at-once; invalid JSON, the schema issues, the filename check, the `render: true`
note; delete → file gone + row disabled + items kept, 404 naming the directory, traversal
ids refused by shape. `sources-routes.test.ts` (12) the same over a socket — verbs, 405,
413 mid-body, non-JSON 400 in the write shape, LAN refusals that never reach the route.
`request-body.test.ts` (6) on the stream arms. `start.test.ts` boots a temp tree, POSTs a
source, and sees it in `/api/state`. `paper/test/sources-*.test.tsx` (31) on the panel's
speech and its affordances. `web/test/unit/sources-*.test.tsx` (39) on the wire, the
stated states, the phone case, the two mutations and the language. Coverage: paper
100/100/100/100, web 98.7/96.4/97.9/98.9, server 99.0/95.3/97.2/99.2.

## WP6 - closed: the picker, a click in real Edge that fills a source file (2026-11-11)

**Was.** An `html` source's `list` and `fields` were authored by hand, and the failure
mode was the one D-026 measured: a selector matching `0` nodes, or `999`, pollutes the
paper quietly. The requirement was the reader's: _go to the URL, click the item I want
to observe, and make the selector from that click._

**Is.** Four layers, each in the package that owns it (D-036).
`packages/fetch/src/pick/` launches headed Edge (`playwright-core`,
`channel: 'msedge'`), gives it `profiles/<id>` only for a source that declared
`profile: true`, and injects an inspector that mirrors DevTools' picker: hover rings one
element and names it, a **click** captures it, **Up/Down walk the ancestor chain**,
**Esc** cancels, and a budget with no click is a **timeout, named** — never an empty
answer. The payload is a **structural fingerprint** (the nth-child path from `<html>`,
the nearest `a[href]`, the node's `outerHTML`, the document URL): the page is a witness,
not an author. `packages/config`'s `applyPick` merges the proved selectors into the
reader's **own text** — `fields.link` is replaced including by absence, `fields.summary`
is kept when the pick derived none, `render` becomes `false` with a line saying the file
said otherwise, `matchCount` is re-based (D-026), a positional list says "positional",
and the result is parsed by the loader's own parser before anyone sees it.
`packages/core/src/apiPick.ts` is the wire contract of a session (`api.ts` is the
paper's, and at rule 1's cap). `packages/server` runs it as a job: `POST /api/pick`
answers **202 `running` at once** (a request that waits for a cursor dies in a proxy),
`GET /api/pick?id=` reports, **one window at a time** (a second start is a 409 naming
the running source), and the answer carries the merged **text** — `PickApiDeps` has no
write function at all, so a click cannot put D-011's truth under a mouse. The page's
PICK control fills the editor and the reader presses SAVE.

**The CLI is the same sequence, told by the same sentence.** `pnpm pick -- <url>`
proves a selector and prints the keys to paste, and writes **nothing, ever**: a bare
url has no file, and inventing one from a click is authoring the reader's reading list
behind their back. `pnpm pick -- --id <source> [--write]` runs against a real file, and
`--write` is the only verb that touches it. A pick needs no database, so it runs while
the server runs, with no `db_lock` to fight over. `commands.ts` holds the argv as a
**decision in data** (a token recursion, then the rules), so every refusal is tested
where a browser is not, and `commands.test.ts`'s gate — every command a root script
names has an answer — is what made moving `pick` from the cut list to the built ones
legal.

**Measured, and it changed the code.**

- `new Response(body, { status: 304 })` **throws**: a 304 needs a null body. A fixture
  that fakes a conditional-GET answer is written with the spec, not the shortcut.
- `pathOf` answered `''` for an empty request target, which fell **past every route**
  and out of the server with no reason attached. It answers `/` now.
- The two refusals of `/api/pick` are **not symmetric**, and the order is the rule: a
  LAN `POST` dies at the mutation guard **before routing**; a LAN `GET` reaches the
  route and dies at the reading-list wall. A test that asserted only the second would
  hide the first, so `pick-http.test.ts` pins both, and the reason names `/api/pick` —
  a refusal that points at another route's URL is a dead end (rule 5).
- `join('profiles', id)` yields **backslashes** on Windows: assert with `join`, never
  with a spelled path.
- The pick's report fills the editor, and the panel can have **two editors open** (each
  row owns its own `editing` state). Un-keyed, one reader's click put `Picking...` on
  both rows and dropped a stranger's selectors into a box nobody picked on, so `pick`
  and `pickFill` are keyed by **source id** and the row shows nothing for the others.
- StrictMode invokes an effect twice: an un-armed setup arm left the poll dead for the
  rest of the modal's life after the first simulated unmount, so the lifetime flag is
  written as setup **and** teardown.
- `SourcesPanel.tsx` crossed rule 1's cap under the new props, so the skeleton menu is
  `SourcesNew.tsx`, registered in `locale-boundary.test.tsx`'s file list on purpose.

**Accept.** fetch 380 + the **real-Edge** loop (`packages/fetch/test/browser/`, 8:
the click on the third card derives a list the parser re-reads on the served bytes;
a real cursor walks Up two steps and captures at that depth; Esc cancels; a budget
with no click times out; a scripted page's click exists in the DOM **and the bytes
refuse it by name**, D-007); config 117 (99.67/97.24/100/100), including the merge
arms where a merge says **nothing**; server 316 (98.81/95.43/96.75/99.21) — the job,
the five ways a pick writes nothing (each sentence pinned **equal to**
`describePickRun`'s, so page and CLI cannot tell two stories), the route over a socket,
the CLI, the transport; paper 172, web 185 on the control, the gate, the fill, the
id keying, the poll stopping on `picked`/`failed`/error/unmount, and **no
`POST /api/sources`** when a pick lands. The stub window reports a real fingerprint
against a real page, so the pre-commit floor (rule 16) runs all of this on a machine
with no browser.
