# The server, the surface, and the dev loop

The half of the state that is about **running** the paper: the package that polls,
the HTTP surface a browser talks to, the verbs that start it, and how the page is
seen while it is being written. The data path (core, config, db, fetch, paper,
web), the styling rules, the open defects and the gate costs are in
`docs/state.md`. (Split 2026-11-11: `docs/state.md` passed the 300-line cap of
rule 1, and the seam is the same one `architecture.md` draws — the pipeline, and
the surface in front of it.)

**server**: the read side **and** the poll. `index.ts` re-exports `editionOf`
(rows → `Edition`), `stateOf` (+ `StateDeps`, `datelineFor`, the item/event
limits), and `pollOne` with `pollDepsOf` (the composition seam: a `Database` in,
the repositories, the transaction and the test seams out). `poll.ts` is the
ladder and the single write path; the rungs' meanings, the ladder state, the
publish step, the **disappearance ladder** (`pollGone.ts`, D-029: which polls
settle the item set, and the write) and the health mapping are each their own
module (WP2 in `docs/roadmap.md` records the measurements). **The scheduler is
built** (WP3, MVP shape): `schedulePlan.ts` is the pure policy — paused → ×4 backoff
→ cron (only at zero failures, so a cron-anchored source cannot re-hammer a `429`) →
cadence, with the rendered floor (D-033) and the quiet-hours push on top — and
`scheduler.ts` is the loop: `dueSources(now, limit)`, one poll at a time, the plan
written after **every** poll including one that threw, the `db_lock` claim taken at
start, extended per batch and released on stop, a catch per poll **and** a catch per
batch, and a `tally()` so a tick's decisions are countable (D-020). Its state is two
columns migration 5 added (`next_run_at`, `consecutive_failures`), read by
`dueSources` and written by `setSchedule`, and deliberately absent from
`StoredSource`: the pipeline upserts every source on every load, and a column named
by that upsert would reset a countdown at every restart.

**The surface is built** (WP4/WP5, MVP). `cli.ts` is the process edge — argv, signals,
exit codes, coverage-excluded as `main.tsx` is — and its commands are **data** in
`commands.ts`: two built (`start`, `export --bundle`), the rest refused **by name**,
each with the place the answer lives; `test/commands.test.ts` pins the root scripts
against that list — by the **argv command inside each script body**, because `pnpm
server` runs `cli.ts start` and it is `start` that needs an answer — so `package.json`
cannot name a command with no answer. `start.ts`'s `boot(deps)` reads
and reports the config, `ensureSourcesDir`s the watchlist directory (D-025), opens and
migrates the db (the open is what takes the `db_lock` claim), upserts the sources,
starts the scheduler publishing its cycles to the SSE hub, and serves. `httpApp.ts` is
the router (`GET /api/state`, `GET /api/events`, the sources routes, the page from
`apps/web/dist`, and a 404 that names what is not built), `sse.ts` the fan-out,
`staticFiles.ts` the cache rules (`index.html` never cached, a hashed asset forever, a
missing build answered with `pnpm build`), `net.ts` the address policy (D-034: reads
for the LAN, writes loopback-only, the reach line with the typeable URLs and the
firewall command), `tls.ts` the pair `server.tls` names (WP17, D-039: paths, parsed
before the first socket, no fallback to plain HTTP) and `bootDb.ts` the db open in the
boot's words (the `data/` directory, the refusal of a second server, the takeover of a
dead process's claim, D-041). The
paper fills itself from a poll of the local `sources/`, and `start.test.ts` proves it
over a socket with a fixture feed, offline. `bundleExport.ts` answers
`export --bundle` (WP11): `config/src/bundle.ts` is the shape (`newspa.bundle.v1`, the
fifth published schema), and the command is **complete or refuses** — any source file
that failed to parse is a `BundleRefusedError` with every issue line and **no file
written**, because rule 18 makes this the reading list's only copy and a backup that
silently dropped a source is a backup that lies. What is still absent: the items and
search routes, `POST /api/sources`, `import` and the watchlist/OPML exports, toasts
(WP10) and the polling render tier (WP6b).

**The pick is built** (WP6, D-036), and it is the one route that **launches a program**.
`POST /api/pick` with `{"id": "…"}` opens a headed Edge window **on the machine that
runs the server** and answers **202 `running` at once** — a request that waits for a
cursor dies in a proxy — and `GET /api/pick?id=` reports the job
(`running` → `picked`/`failed`, with the merged text and the sentence). Four rules the
shape enforces: **one window at a time** (a second start is a 409 naming the running
source, because two Edge windows compete for one reader); **the body is an id, never a
url** (the url, the headers, the limits and the `profile: true` fact belong to the
source file, and a route that fetched an address a request named is a fetch the reading
list never agreed to); **the answer carries text and no route writes a file**
(`PickApiDeps` has no write function, so a click cannot put D-011's truth under a
mouse — the editor fills and SAVE is the reader's act); and **the job is never a
floating promise** — a throw, including one that is not an `Error`, becomes a `failed`
state with a sentence, because a job that dies in a promise leaves the page watching
`running` forever (rule 5). The address is the wall twice over: launching a browser on
a machine is a write (rule 20) and a pick reads the reading list (rule 18), so **every
verb** is loopback-only — a LAN `POST` dies at the mutation guard **before routing**, a
LAN `GET` reaches the route and dies at the reading-list wall, and both refusals name
`/api/pick` in their reason. The CLI is the same sequence (`pnpm pick -- <url>` proves
a selector and writes nothing, ever; `--id <source> [--write]` merges into the file),
it needs no database, and it runs while the server runs.

**The sources routes and the panel are built** (WP14). `sourcesApi.ts`
answers `GET /api/sources` with the directory as it is - every `*.json`, **its own
text**, the loader's issues for that file, the row's health and `enabled`, and the
peer's `writable` fact - `POST` with a write of **raw file text** through the loader's
own `parseSourceJson` (so the editor can never disagree with the poll, and the browser
carries no second copy of the source schema), and `DELETE ?id=` with a removal of the
file **and the disabling of the row**: the poll stops, the items and history stay, and
the source is listed as disabled instead of vanishing (rule 5 applied to a deletion).
A posted `filename` is checked, not obeyed - the file written is `<id>.json`, because
D-011's one-file-per-id rule is what makes a directory listing readable as a source
list. `requestBody.ts` reads a body with a 64 KiB ceiling and answers 413 **mid-body**;
measured, `req.destroy()` on overflow kills the connection and the client sees
`TypeError: fetch failed` instead of the 413, so the answer goes first, the request is
paused, and the 413 says `connection: close` (the body was never consumed, so the
socket is not reusable). Nothing in these routes authenticates anything, and none of
them needs it: `readingListAllowed` refuses **every verb** of `/api/sources` from a
non-loopback peer, because the answer **is the files** and the files are the reading
list (rule 18) - the phone gets the paper, the editor stays machine-local, a test's spy
proves the guard runs **before routing**, and rule 20 forbids inventing a token to make
a LAN write safe.

The panel is the paper's half (`SourcesPanel`, `SourceRow`, `SourceEditor`,
`sourceStyle.ts`): a row per file with `data-part="source-row"` +
`data-file/-state/-enabled/-issues`, the file's bytes in a `data-part="source-text"`
box, the loader's lines under `pattern-crossings` (a mark that names an absence, which
is what a file that does not parse is), a two-step delete that asks in the page, and
**no affordance at all** for a peer that is not loopback - the sentence, not a Save
button that must fail. It prints no strings of its own (labels come in as a prop
object, D-019) and it is `display: none` in print: a form with a textarea is not news,
and the panel prints the absolute path of the watchlist directory.
`apps/web/src/SourcesSection.tsx` owns the wire - `useQuery(['sources'])`, two
mutations, both queries settled after any answer (a write upserts the row, so the
paper's news moves with it) - and a refusal **rejects the mutation** (`RefusalError`),
which is the only way the editor learns to keep the reader's typed JSON beside the
loader's reason instead of closing the box on it.

**The page's two display axes are client state, not server state** (D-002, D-038):
`data-theme` and `data-contrast` on `<html>`, `localStorage` under `newspa.theme` /
`newspa.contrast`, and the inline script in `apps/web/index.html` that applies **both**
before first paint, because a dark device or an e-ink wall must not flash the yellowed
stock. The order of arrival is the **url**, then storage, then the system — so a device
on the wall is set by a link (`?theme=dark&contrast=more`, D-037) with no keyboard and
no storage to clear, and a url visit **writes nothing**: a phone that opens a wall link
once keeps the choice it made for itself. Nothing is sent to the server, no cookie is
set, and the paper's components take the pair as props and render the control only when
the app has one to offer.

**The four run verbs** are pinned by tests, not by prose: `pnpm start` = `pnpm build`
then the process (the product: poll + routes + the built page, bind is config);
`pnpm server` = the process alone, no build, so the page is served only if `dist`
exists and the missing-build 404 names the command; `pnpm ui` = Vite on 5173 in
`--mode server`, which installs **no** dev middleware and proxies `/api` to 8787 — hot
reload against live news; `pnpm dev` = Vite on the fixture seed, offline. `pnpm
--filter newspa-server start` is `server` in the package. The gate is
`server/test/commands.test.ts` (the argv command inside every script naming `cli.ts`
must be built or refused, the script list is pinned, and the build/no-build/proxy shape
of the four verbs is asserted) plus `apps/web/test/unit/devModes.test.ts` (the mode
decision, and that **no dev mode names a host** — the LAN is `pnpm start`, D-034).

## The dev loop, which is how the page is seen today

`pnpm --filter newspa-web run seed` writes `apps/web/dev/state.json` (113
stories, 6 edited, 8 sources) from the parser fixtures; `apps/web/dev/apiPlugin.ts`
serves `/api/state` and `/api/events` from it, so `pnpm dev` prints a paper with
real publisher text while `packages/server` is incomplete. `pnpm shots`
(`scripts/screenshot-paper.mjs`, `playwright-core` + `channel: 'msedge'`, D-003)
renders the paper at 1440×900, 1024×768 and 390×844 and prints, per width: the
front grid's computed tracks, the lead headline's size, its box and **whether it
is above the fold**, the count of justified elements, and any console error,
failed request or page error. Its selectors are `data-part` hooks, never classes
(rule 11): a layout claim that queries a styling class is a claim about the
styling. The in-app browser is ~620 px wide and
always shows the phone stack, so `pnpm shots` is the only desktop truth.

**The verbs, run and measured (2026-11-11).** `pnpm ui` starts Vite with
`--mode server` (the argv arrives as `vite --port 5173 --strictPort --mode server`, and
Vite's banner prints `server ready in 294 ms`), so `/api` is a proxy to 8787 and hot
reload runs against live news; `pnpm server` is that process, with no build step, so a
tree with no `dist` answers the API and the named missing-build line for the page. Two
facts worth writing down because they read as failures: Vite's default bind here is
**IPv6 loopback only** (`http://localhost:5173` answers, `http://127.0.0.1:5173` is
`ECONNREFUSED`), and a process killed with the tree (not `SIGINT`) leaves the
`db_lock` claim, so the next start is **refused with the owner's token and timestamp**
until the claim ages out (10 minutes at boot's setting). Both speak, which is the
point: `start`/`server` exit 1 with `start failed: …— not starting`, and the
running-loop handlers are installed only after the boot succeeds, so a run that never
opened its database no longer promises to "survive" it.

## The run, the address, and the install

The process side moved out at the 300-line cap of rule 1: the database claim and who
owns it, `start` taking no arguments, TLS as the scheme (D-039, D-041) and the
installable paper - the manifest, the worker, the stamped cache and the install entry -
are in **`docs/state-device.md`**.
