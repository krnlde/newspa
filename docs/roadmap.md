# Open work packages

What is **not** built, in the order that unblocks the most. Each package states
the measured gap, the acceptance test, and the rules it is answerable to.
`docs/state.md` (and `docs/state-server.md`, for the surface and the verbs) is the
inventory of what exists; `AGENTS.md` is the law.

The dependency spine was `WP2 → WP3 → WP4 → WP5`, then everything else. **WP2, WP3,
WP4 and WP5 are closed** (below): the poll, the scheduler, the two routes the app
calls, the SSE stream, the page, and the entry point that runs them - so `pnpm start`
(build, then one process) is a paper that fills itself, on a port, on the LAN if the
config says so (D-034), with `pnpm server` and `pnpm ui` as the development pair
(`docs/state-server.md`). `export --bundle` is built too (WP11, half), which closes
the one gap that was data loss. What is left is quality of life, not architecture:
**the sources UI (WP14, decided next)**, the renderer and the picker (WP6), search
(WP7), toasts (WP10), the watchlist knobs (WP9), the rest of the export/import formats
(WP11), the README (WP13). Closed and retired
packages - WP1, WP2, WP3, WP12 - are recorded in `docs/roadmap-closed.md` with what
each measured; read WP12 before reopening the same two files.

## WP3 — The scheduler  _(built 2026-11-11, MVP shape)_

**Was.** Nothing ran a poll on a cadence: `core` had `cadence.ts` and
`cadenceCron.ts` (parsing, next-run arithmetic) and `db` had the lock
(`claimLock`, `extendLock`, `releaseLock`), with no caller.

**Is.** Two modules, split at the seam that made them testable.
`packages/server/src/schedulePlan.ts` is a **pure** function of (source, failure
count, instant) → the next instant, the interval it implies, and the rule that made
it: paused at `maxFailuresBeforePause` → ×4 backoff → cron (only at zero failures,
so a cron-anchored source cannot re-hammer a `429`) → cadence, with the rendered
floor and the quiet-hours push applied on top. `packages/server/src/scheduler.ts` is
the loop: `dueSources(now, limit)`, one poll at a time, the plan written **after**
each poll — including a poll that threw, because a source with no plan is a source
the next batch picks up immediately, which is how a fault becomes a hammer — the
claim taken at start, extended per batch, released on stop, a catch per poll **and**
a catch per batch, and a `tally()` so every tick's decisions are countable (D-020).

**MVP spends, and names what it does not.** Polls are sequential, so
`AppConfig.scheduler.maxConcurrentFetches` is **unused** — parallel polls interleave
at their `await`s and the write budget is one transaction, so the knob is a
follow-up rather than a comment claiming it works. Jitter is once per **batch**, not
per source; a batch takes 24; the tick is 60 s; cron is honoured only at zero
failures. `nextRunAt` is **not** on the wire: `SourceHealthView` has no such field
and the paper does not ask for one.

**`render: true` needed no special case, and that was checked, not assumed.** The
transport refuses it **by name** (`reason: 'render-required'`, `errorKind: 'render'`,
D-007), so a render source is a poll that _reports_, and the scheduler relaxes it to
the ceiling and then the pause: the paper says so, nothing is swallowed (rule 5).

**Accept — 18 plan tests and 18 loop/batch tests over a real db.** A fresh database
polls everything first (a null `next_run_at` leads the batch); 30 sources are caught
up in 24 + 6; a disabled source is neither polled nor planned; `health: 'ok'` clears
the streak; a thrown poll is a log line, a counted failure and a plan; the claim is
live at the end of a batch and gone after `stop()`; a refused claim names its owner
and polls nothing; a batch that throws leaves the loop running. The plan tests pin
the ×4, the ceiling, the pause, cron winning at 0 failures and yielding at 1, the
5-minute floor on a 1-minute render source, and quiet hours in a daytime window and
in one that wraps past midnight.

## WP4 - The HTTP surface  _(built for the MVP 2026-11-11; the rest named)_

**Built.** `GET /api/state` (the composed read side, `no-store`), `GET
/api/events` (`text/event-stream`: `cycle:start`/`cycle:done` from the scheduler,
`retry:`, a keep-alive comment, a client that cannot be written dropped **and
logged**), and the app from `apps/web/dist` with the pair of cache rules that make a
reload cheap (`index.html` never cached, a hashed asset immutable for a year). A
missing `dist` answers with `pnpm build` and the path it looked at, plus the fact
that the API is up (rule 5: a blank page and a 404 in a log is the silent zero in a
server's clothes). `net.ts` is the address policy (D-034): the LAN reads, writes are
loopback-only, refused on the address **before** routing.

**Named as not built, in the body of the 404:** `/api/items`, `/api/editions`,
`/api/search` (FTS5 exists in `packages/db`; the box is WP7) and
`POST /api/sources` (the file writer, D-025). Every 4xx is a line with the reason;
no answer is a stack.

**Accept - met.** Contract tests parse what the routes answer with **core's own
schemas** (`stateResponseSchema` on `/api/state`, `serverEventSchema` on the frames),
so a response that fails its shape is a failing test, not a broken page. The SSE
tests prove a publish arrives, a disconnect removes the client, `close()` ends every
stream, a late subscribe is a 503 with a reason, and the headers a proxy obeys are
present. 33 tests across `net`, `sse`, `http-app` and `static-files`, over a real
socket on port 0. The dev plugin (`apps/web/dev/apiPlugin.ts`) is untouched, stays
for offline dev, and is never in the bundle.

## WP5 - the entry point  _(built 2026-11-11, including `export --bundle`)_

**Built.** `packages/server/src/cli.ts` is the process edge the root scripts name —
argv, `console`, signals, exit codes — coverage-excluded as `main.tsx` is. Its
commands are **data** in `commands.ts`: two built (`start`, `export --bundle`), the
rest refused **by
name**, each line naming where the answer lives (the health strip is the paper, the
file is the truth, the picker is WP6, the credential is WP8). `test/commands.test.ts`
reads the root `package.json` and fails if any script naming `cli.ts` has no answer,
so the scripts and the commands cannot drift: `pnpm status` prints a sentence, exit 1;
an unknown name prints the list, exit 2.

`start.ts`'s `boot(deps)` is the whole boot as a function of a deps bag: report the
config, `ensureSourcesDir` (D-025), open and migrate (the open takes the `db_lock`
claim, so a second `pnpm start` is refused by name before it can interleave a write),
upsert the watchlist and print every issue, start the scheduler publishing to the
hub, serve. `test/start.test.ts` boots a **temp tree** and asserts the acceptance the
old WP5 asked for — a paper from a real poll of `sources/` — over a socket, offline,
with a captured feed as the transport's answer: the source is `ok`, the items print,
the plan is in the row, and the tally's count equals the wire's.

**Built, and it was the gap that was data loss:** `export --bundle` — rule 18 makes
`sources/` gitignored, so the bundle is the only backup of the reading list. Its rules
(complete-or-refuse, byte-stable, gitignored itself) are WP11's, below. `import` is
still open, and refuses by name, pointing at the schema to restore by hand.

## WP6 — `render` and the headed picker

**Gap.** `AGENTS.md`'s layout names `packages/fetch`'s `render` and `pick`;
neither exists. `vitest.coverage.json` already excludes `src/render/launch.ts`
and `src/pick/launch.ts`, so the gate expects them.

**Build.** `render.ts`: launch `playwright-core` with `channel: 'msedge'`
(D-003, never `playwright`), fetch a page, return the rendered DOM for the HTML
parser, with a hard timeout and a `HealthState` on failure. `pick.ts`: the
headed session where the reader points at the nodes, producing a source
definition (`render: true` is a pick-time decision, D-007) — the output is a
`sources/<id>.json` the reader pastes into the local, gitignored source dir
(D-025) — the picker never writes to git.

**Accept.** A render test runs the real Edge against a local fixture page
(browser project, so not in the pre-commit floor); a blocked page yields
`blocked`, not `[]`. The picker is exercised by a scripted page: a chosen
selector round-trips into a validated `html` source spec.

## WP7 — Search

**Gap.** `AGENTS.md` claims FTS5 in `packages/db`; `grep -i fts5 packages/db/src`
is empty. `ItemsQuery` exists in the contract and has no server.

**Build.** A migration adding an FTS5 content table over the item
title/teaser/source, kept in sync by triggers, a `search` method on
`itemsRepository` with BM25 ordering, `GET /api/items` (WP4), and the search
field in the app — chrome strings through i18n, results rendered as story rows
(the styling migration is finished, so a new row type is utilities on the
element, per rule 11).

**Accept.** A fixture db of ~200 items returns the expected order for a
two-word query, respects the section filter and the limit, and a prefix query
matches. The migration is tested forward **and** the FTS table is verified to
survive a reopen.

## WP8 — `login`: the browser profile is the credential

**Gap.** `pnpm login -- <url>` names a command that does not exist (rule 17
says it is the only credential mechanism).

**Build.** Launch a headed Edge with a persistent profile under `profiles/`
(gitignored), let the reader sign in, close it, and have `fetch`/`render` use
that profile for sources that need it. Nothing in git can authenticate anything:
no cookie jar in `sources/*.json`, no token in any tracked file
(`scripts/check-secrets.mjs` enforces it).

**Accept.** A source marked `profile: <name>` renders through the stored profile
(the test uses a local page that echoes its own cookie header), and a source
without one never touches the profile dir. `pnpm check:secrets` stays green.

## WP9 — The reader's two knobs, and the watchlist

**Gap.** D-021 says `section` and `weight` are the reader's file knobs;
`packages/config` has `watchlist.ts` and `opml.ts`, and `pnpm export --watchlist`
/ `pnpm import --watchlist file.json` point at the missing CLI (WP5).

**Build.** Apply `section` and `weight` in the scoring/placement path so a
source's declared section and weight change where its stories land, and wire the
watchlist round trip: export the reader's list as a validated file, import
it back.

**Accept.** Two sources differing only in `weight` land in the expected
slots in `editionOf`; the export → import round trip is byte-stable for the
same input; an imported file that violates the schema fails with the zod issue
and writes nothing (D-014).

## WP14 — Managing sources from the page  _(routes built 2026-11-11; the form is next)_

**Built: the routes.** `GET /api/sources` answers the directory — every `*.json`,
**its own text**, the loader's issues for it, the row's health and `enabled`, and
`writable` for the peer who asked. `POST` takes core's existing
`addSourceRequestSchema` — **raw file text** — validates with `parseSourceJson` (the
loader's own function, so the editor can never disagree with the poll), writes
`sources/<id>.json`, refreshes the row (so the paper shows it and `dueSources` polls
it first), and answers the path it wrote. `DELETE ?id=` removes the file and
**disables the row**: the poll stops, the items and history stay, and the source is
listed as disabled rather than vanished. A posted `filename` is **checked, not
obeyed** — writing `<id>.json` is D-011's rule, so a body naming `evil.json` with
`id: "bbc"` is refused rather than given a second name.

**The body is read with a ceiling** (`MAX_SOURCE_BODY_BYTES`, 64 KiB) and 413 is
answered **while the body is still arriving** — measured: `req.destroy()` on overflow
kills the connection and the client sees `TypeError: fetch failed` instead of the 413,
so the answer is written first and the request is paused, with `connection: close`
because the body was never consumed.

**Boundary, and it is the whole security story**: `net.ts`'s guard runs **before
routing**, so every write from a non-loopback peer is a 403 that never reaches this
code (pinned: the routes bag's spy records that `remove` was not called). Rule 20
forbids bolting a token on to make a LAN write safe; `writable:false` in the list
answer is that same fact, told so a form on a phone can say "editing is from this
machine only" instead of offering a button that must fail.

**Open: the form.** `packages/paper/src/SourcesPanel.tsx` (a `panel` with
`data-part` hooks, per rule 11), the app's fetch/save/delete wiring, the chrome
strings in both locales, and `kind: 'html'` saying the picker is WP6 rather than
offering a selector box nothing can validate.

**Accept, for the half built.** 34 tests: `sources-api.test.ts` drives the handlers on
a temp tree and a real db (list, a file that does not parse listed with its issues,
the filename-is-the-id refusal, the writable flag, the empty and missing directories;
write → file + row + due-at-once, invalid JSON, schema issues, the filename check,
the `render: true` note; delete → file gone + row disabled + items kept, 404 naming
the directory, traversal ids refused by shape); `sources-routes.test.ts` the same over
a socket (verbs, 405, 413 mid-body, non-JSON 400 in the write shape, LAN 403 that
never reaches the route); `start.test.ts` boots a temp tree and adds a source through
the route, then sees it in `/api/state`.

## WP10 — Notifications

**Gap.** D-010 promises a local Windows toast on a publish; nothing emits one.

**Build.** `packages/server/src/toasts.ts`: on a publish, raise a Windows toast
(a PowerShell call, no new dependency), suppressed when the paper is being read
(the SSE stream has a client) and by a flag.

**Accept.** A publish with no connected client calls the notifier once with the
edition summary; with a connected client it does not; a notifier failure is a
log line, never a failed poll.

## WP11 - Export and import formats  _(half built 2026-11-11: `export --bundle`)_

**Built, and it is the half rule 18 asks for.** `packages/config/src/bundle.ts` is
the shape (`bundleSchema`, `$schemaVersion: newspa.bundle.v1`, `$schema` at the
generated `schemas/bundle.schema.json` — the fifth published schema, so
`schemas:check` gates it like the other four); `packages/server/src/bundleExport.ts`
is the command. A bundle is the app config **plus every source in `sources/`**, which
is that tree's only backup, since the tree is gitignored on purpose.

**The one hard rule: complete, or refuse, and write nothing.** `loadSources` _drops_
a source file that does not parse — right for a poll, where the paper must run without
it — so a backup built on the loader's output would silently be a shorter list, and
the loss is discovered at restore time, when the original was the only copy. So any
issue turns into `BundleRefusedError`, with every issue line, and no file. A config
that fell back to defaults is **said, not fatal**: a fresh clone has no
`config.json`, and refusing to back up a reading list over a default masthead is not
the reader's friend. Sources are sorted by id, so two exports of an unchanged tree are
**byte-identical** — a backup you can diff is a backup you can trust. The file
(`newspa-bundle.json`) is gitignored, because it _is_ the reading list (rule 18).

**Open.** `import` (it pairs, and refuses by name, pointing at the schema),
`export --watchlist` and `export --opml` (`watchlist.ts`/`opml.ts` exist and are
tested; the CLI flags do not), and the edition JSON export.

**Accept, for the half built.** `bundle.test.ts` (9) pins the defaults, the
`$schemaVersion` gate, a source that is not a source named by path, the sort, the
byte-stability, the tie arm of the comparator (a writer that loses a source is a
lying backup), and a root-path issue printed as `(root):` rather than an empty string.
`bundle-export.test.ts` (5) writes to a temp tree, reads it back through
`bundleSchema`, and proves the refusal writes **no file** — including for a tree with
no sources at all, which is a backup of nothing.

## WP13 — README

**Gap.** No `README.md`. A first-time reader has `AGENTS.md` (rules for an
agent) and `docs/*` (why), and nothing that says "run these three commands".

**Build.** A page a human reads: what the paper is, `pnpm install`,
`pnpm hooks:install`, `pnpm seed` + `pnpm dev` (the seeded paper, offline),
`pnpm start` (the real one, once WP5 lands), `pnpm shots`, and a pointer to
`docs/state.md` and `docs/roadmap.md`.

**Accept.** Every command in it is run and quoted with its real output, and it
stays under 300 lines (rule 1).
