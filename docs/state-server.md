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
firewall command). The
paper fills itself from a poll of the local `sources/`, and `start.test.ts` proves it
over a socket with a fixture feed, offline. `bundleExport.ts` answers
`export --bundle` (WP11): `config/src/bundle.ts` is the shape (`newspa.bundle.v1`, the
fifth published schema), and the command is **complete or refuses** — any source file
that failed to parse is a `BundleRefusedError` with every issue line and **no file
written**, because rule 18 makes this the reading list's only copy and a backup that
silently dropped a source is a backup that lies. What is still absent: the items and
search routes, `POST /api/sources`, `import` and the watchlist/OPML exports, toasts
(WP10), the picker and the renderer (WP6).

**The sources routes are built** (WP14, the half before the form). `sourcesApi.ts`
answers `GET /api/sources` with the directory as it is — every `*.json`, **its own
text**, the loader's issues for that file, the row's health and `enabled`, and the
peer's `writable` fact — `POST` with a write of **raw file text** through the loader's
own `parseSourceJson` (so the editor can never disagree with the poll, and the browser
carries no second copy of the source schema), and `DELETE ?id=` with a removal of the
file **and the disabling of the row**: the poll stops, the items and history stay, and
the source is listed as disabled instead of vanishing (rule 5 applied to a deletion).
A posted `filename` is checked, not obeyed — the file written is `<id>.json`, because
D-011's one-file-per-id rule is what makes a directory listing readable as a source
list. `requestBody.ts` reads a body with a 64 KiB ceiling and answers 413 **mid-body**;
measured, `req.destroy()` on overflow kills the connection and the client sees
`TypeError: fetch failed` instead of the 413, so the answer goes first, the request is
paused, and the 413 says `connection: close` (the body was never consumed, so the
socket is not reusable). Nothing in these routes authenticates anything: `net.ts`
refused the LAN write **before routing** (a test's spy proves the route was not
reached), and rule 20 forbids inventing a token to make a LAN write safe.

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
