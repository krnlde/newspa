# Open work packages

What is **not** built, in the order that unblocks the most. Each package states
the measured gap, the acceptance test, and the rules it is answerable to.
`docs/state.md` is the inventory of what exists; `AGENTS.md` is the law.

The dependency spine was `WP2 → WP3 → WP4 → WP5`, then everything else; **WP2 is
closed** (below), so it is `WP3 → WP4 → WP5`. Seven root scripts (`start`,
`pick`, `login`, `status`, `search`, `export`, `import`) point at
`packages/server/src/cli.ts`, which **does not exist**, so `pnpm start` fails
today — and the poll that writes the database now exists, so the shortest path
from "a package that passes tests" to "an app you can run" is WP3 → WP4 → WP5.
WP12 is retired: read it before reopening the same two files.

## WP1 — closed: the styling migration is finished (2026-11-10)

**What landed.** The four BEM sheets (`sheet.css`, `blocks.css`, `front.css`,
`stories.css`, 661 lines) are deleted; every rule they held is a utility on the
element, and every structural hook is `data-part`. `packages/paper/src` split
into ten modules (rule 1), the app's loading and failure states are the paper's
own shell (`sheetClass`) and panel (`Onboarding`), the sketch layer is one
recipe in `marks.css`, every box with a rule is padded, and the lead's headline
leads. The two traps the migration exposed — a utility losing by source order
(`h-auto` beat the photo's cap), and a Vitest browser project inheriting no
`tailwindcss()` plugin — are recorded in D-024, with the measurements.

**Measured at acceptance.** `git grep -nE "[a-z]+__[a-z]+|[a-z]+--[a-z]+"`
outside `docs` and the fetched fixtures: empty. `pnpm test:design`: 12 assertions
in real Edge, green for the first time. `pnpm shots`: front grid
`310px 682px 310px` at 1440×900, lead headline 311→599 px of 900 px (above the
fold), 1 column at 390, 0 justified elements, no page problems at any width.
Paper coverage 100 % on all four metrics, web 99.06 / 95.78 / 100 / 99.45.
The waste-area commit that followed (docs/design.md) inset the sheet by the
gutter, so the grid measures `291px 640px 291px` now and the suite is 13
assertions.

**Nothing is left in it.** The handoff files it was worked from
(`docs/handoff-tailwind-rewrite.md`, `docs/handoff-style-table.md`) are deleted —
a stale handoff is a lie in the tree.

## WP2 — closed: the poll writes one source end to end (2026-11-10)

**What landed.** `pollOne(spec, deps)` in `packages/server`, and the pipeline is
hard-coded as planned: `fetch → parse → normalize → diff → score → publish`
(D-001). Seven modules, 922 lines of `src`: `poll.ts` (174) is the ladder and
the **one** write path — a single `inTx` that writes the snapshot, the ladder
state, the fast-path counters, the health patch and, on the slow path, the items
and their events; `pollVerdicts.ts` (173) is each rung's meaning, as pure data;
`pollBaseline.ts` (133) is the ladder's state, including the RFC 9110 §15.4.5
rule that a `304` updates the stored **validators** and nothing about the body;
`pollItems.ts` (161) is the publish step (score, section, the upsert's
arithmetic, the `editReport`); `pollHealth.ts` (153) maps a fault to the
`HealthState` the paper prints and the one line beside it; `pollTypes.ts` (97)
and `pollDeps.ts` (31) are the seams — and the socket is a **required** dep, so
the pipeline never reaches for a global: `pollDepsOf` hands over
`globalThis.fetch`, and a poll cannot silently start talking to the internet
because a caller forgot to inject one.

**The three numbers a reader judges it by.** `snapshots.item_count` is `null`
when a rung skipped the parse — never a `0` the paper would read as a dead
source. `fast_path_hits` / `fast_path_misses` are written on every poll that has
a state row, so a ladder that never fires is visible. `lastSuccessAt` is written
only on a success, so a failing source ages into `stale` instead of looking
quiet.

**Measured at acceptance.** `packages/server`: 14 test files, 98 tests (was 55),
coverage 100 / 98.7 / 100 / 100. The repo: 94 files, 1 110 tests. A fixture poll
of each source kind — the real BBC capture for `rss`, a card page and a table
page for `html`, the Algolia front page for `json`, plus an items-path miss for
`json` — writes items, one snapshot with the right `outcome`, and an `Edition`
whose `new`/`edited` counts equal the diff. A second identical poll answers
`not-modified` with **zero** items, keeps the source's last good health, and
prints `matchCount: null` (never an invented zero). Layer 1 (`same-body`) and
layer 2 (`declared-unchanged`) each have their own test, and so does layer 2's
cost: an edit the feed does not declare is never parsed. D-005's identity rule is
pinned at the poll: a `?utm_source=` copy of a story is **one** row with one
event history, the link the reader clicks keeps the publisher's own text, and —
the deliberate boundary — a `?ref=` copy is a second story.
Rule 5 is pinned from nine directions — a refused payload, a selector
that matches nothing, a challenge wall, a `403`, a `500` (retried, waits
recorded, `lastSuccessAt` untouched), a payload of the wrong kind, a
`render: true` source (no request made), a body that stops parsing (the last
good items survive, the baseline does not move), and an unregistered source,
which **throws** and rolls the poll back.

**Left in it, on purpose.** Two things the roadmap owns elsewhere: the `gone`
event (decidable only with the source's complete key set — `items.list` is a
page of 200, and inferring "gone" from "not on this page" is the silent zero) and
`score_digest` (the digest pass's column; a poll writes `0` because no digest has
run).

## WP3 — The scheduler

**Gap.** Nothing runs a poll on a cadence. `core` has `cadence.ts` and
`cadenceCron.ts` (parsing, next-run arithmetic) and `db` has the lock
(`claimLock`, `extendClaim`, `releaseLock`), with no caller.

**Build.** A timer loop in `packages/server` that picks due sources by
`nextRunAt`, respects `cadence`, runs one poll at a time per source and one
process-wide write at a time via the db lock, extends the claim during a long
poll, and recomputes `nextRunAt` from `cadenceCron` after each run. Jitter the
starts; never overlap a source with itself. On start, run the due catch-up set
in bounded batches, not all at once.

**Accept.** With fake timers: a 20-minute source polls on schedule, a crashed
tick does not stop the loop, a held lock defers the run, and a slow poll extends
the claim. Every tick's decisions are observable (a counter per path), because
an optimization that never fires is invisible (D-020).

## WP4 — The HTTP surface: routes, SSE, static

**Gap.** The app calls `GET /api/state` and opens `EventSource
'/api/events'` (`apps/web/src/api.ts`); the dev plugin answers those two from a
seed file (`apps/web/dev/apiPlugin.ts`), and nothing answers them for
`pnpm start`. `core/api.ts` already fixes the shapes of the rest:
`itemsQuery`/`itemsResponse`, `editionsResponse`, `addSourceRequest`/
`addSourceResponse`, `serverEvent`.

**Build.** `node:http` in `packages/server`: `GET /api/state` (→
`stateOf`/`editionOf`), `GET /api/items`, `GET /api/editions`,
`POST /api/sources` (validated by `addSourceRequestSchema`), `GET /api/events`
(`text/event-stream`, `serverEventSchema` messages, `parseServerEvent` on the
client), and the static app from `apps/web/dist` with a cache-busting rule for
`index.html`. Parse every request body with the zod schema and answer 4xx with
the issue, never a stack trace. One port, 8787, one process (D-002).

**Accept.** Contract tests per route against the zod schemas in `core` (a
response that fails its own schema is a failing test, not a broken page); an SSE
test that a publish produces one event and that a client disconnect stops the
writer; the dev plugin stays for offline dev and is never in the bundle.

## WP5 — `cli.ts`: the seven commands the scripts already name

**Gap.** `package.json` runs `node packages/server/src/cli.ts …` for `start`,
`pick`, `login`, `status`, `search`, `export`, `import`; the file is absent, so
all seven exit non-zero.

**Build.** One file per command under `packages/server/src/cli/`, a thin argv
dispatcher, and `start` = ensure the source dir (`ensureSourcesDir`, D-025: a
fresh clone has no `sources/`, and creating it is boot's job, not a side effect
of a read), load and report it, open the db, migrate, take the lock, start the
scheduler, serve. `status` prints per source: state, last poll, outcome, item
count, cadence — the health strip in a terminal (rule 5). Node builtins only
(`node:sqlite` via `newspa-db`, `node:fs/promises`).

**Accept.** Each command runs from a fresh `data/` and exits 0; `start` prints
the URL, then serves a paper from a real poll; every command has a test that
drives `main(argv)` with a temp db and asserts on stdout, no network. **From a
fresh clone** — no `sources/` — `start` creates the directory, prints the
`no-sources` report and the `pnpm sources:init` hint, and serves an empty paper
without polling anything (rule 5: the emptiness is stated).

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

## WP10 — Notifications

**Gap.** D-010 promises a local Windows toast on a publish; nothing emits one.

**Build.** `packages/server/src/toasts.ts`: on a publish, raise a Windows toast
(a PowerShell call, no new dependency), suppressed when the paper is being read
(the SSE stream has a client) and by a flag.

**Accept.** A publish with no connected client calls the notifier once with the
edition summary; with a connected client it does not; a notifier failure is a
log line, never a failed poll.

## WP11 — Export and import formats

**Gap.** D-014: exports are file formats, validated on the way in. `schemas/` is
generated from zod and `pnpm schemas:check` gates the drift; `pnpm export` /
`pnpm import` have no implementation (WP5).

**Build.** `export` (edition JSON, `editionsResponseSchema`; watchlist,
`watchlist.ts`) and `import` (validate first, write second), with
`$schema` pointing at `schemas/` in every export, and `pnpm check:repo` keeping
the published owner/repo honest.

**Accept.** A round trip through the file restores an identical state; a file
edited to violate the schema is refused with the issue, and the store is
untouched.

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

## WP13 — README

**Gap.** No `README.md`. A first-time reader has `AGENTS.md` (rules for an
agent) and `docs/*` (why), and nothing that says "run these three commands".

**Build.** A page a human reads: what the paper is, `pnpm install`,
`pnpm hooks:install`, `pnpm seed` + `pnpm dev` (the seeded paper, offline),
`pnpm start` (the real one, once WP5 lands), `pnpm shots`, and a pointer to
`docs/state.md` and `docs/roadmap.md`.

**Accept.** Every command in it is run and quoted with its real output, and it
stays under 300 lines (rule 1).
