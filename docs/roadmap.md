# Open work packages

What is **not** built, in the order that unblocks the most. Each package states
the measured gap, the acceptance test, and the rules it is answerable to.
`docs/state.md` is the inventory of what exists; `AGENTS.md` is the law.

The dependency spine is `WP2 → WP3 → WP4 → WP5`, then everything else.
Seven root scripts (`start`, `pick`, `login`, `status`, `search`, `export`,
`import`) point at `packages/server/src/cli.ts`, which **does not exist**, so
`pnpm start` fails today — the shortest path from "a package that passes tests"
to "an app you can run" is WP2 → WP4 → WP5. WP12 is retired: read it before
reopening the same two files.

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

**Nothing is left in it.** The handoff files it was worked from
(`docs/handoff-tailwind-rewrite.md`, `docs/handoff-style-table.md`) are deleted —
a stale handoff is a lie in the tree.

## WP2 — The poll: one source, end to end

**Gap.** `packages/fetch` can fetch (`fetchSource(spec, baseline, deps)`) and
`packages/db` can store, and `packages/server/src/edition.ts` + `state.ts` can
read it back, but nothing joins them: no code writes a poll result.

**Build.** `pollOne(source, deps)` in `packages/server`: `fetch → parse →
normalize → diff → score → publish` (D-001, hard-coded, no agent graph). Write
the item set (`itemsRepository`), the events (`itemEventsRepository`: new,
edited, read), the baseline (etag/last-modified/body hash/declared timestamp for
the ladder), one `PollSnapshot` row per poll with its **`outcome`** and the
per-source fast-path counters, and the source's `HealthState`
(`sourcesRepository`). A parse failure must produce a health state that reaches
the paper — never `catch { return [] }` (rule 5).

**Accept.** A fixture-backed poll of each source kind (`rss`, `html`, `json`)
inserts items, records one snapshot with the right `outcome`, and produces an
`Edition` through `editionOf` whose `edited`/`new` counts equal the diff.
A second identical poll produces **zero** items and one snapshot whose
`outcome` is `not-modified`, the source's stored health stays the **last good**
one (that composition is the design: `transportHealth.test.ts:59`, and
`edition-health.test.ts:127` keeps `matchCount` `null` instead of inventing a
zero), and the paper prints no ghost stories.

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
dispatcher, and `start` = open the db, migrate, take the lock, start the
scheduler, serve. `status` prints per source: state, last poll, outcome, item
count, cadence — the health strip in a terminal (rule 5). Node builtins only
(`node:sqlite` via `newspa-db`, `node:fs/promises`).

**Accept.** Each command runs from a fresh `data/` and exits 0; `start` prints
the URL, then serves a paper from a real poll; every command has a test that
drives `main(argv)` with a temp db and asserts on stdout, no network.

## WP6 — `render` and the headed picker

**Gap.** `AGENTS.md`'s layout names `packages/fetch`'s `render` and `pick`;
neither exists. `vitest.coverage.json` already excludes `src/render/launch.ts`
and `src/pick/launch.ts`, so the gate expects them.

**Build.** `render.ts`: launch `playwright-core` with `channel: 'msedge'`
(D-003, never `playwright`), fetch a page, return the rendered DOM for the HTML
parser, with a hard timeout and a `HealthState` on failure. `pick.ts`: the
headed session where the reader points at the nodes, producing a source
definition (`render: true` is a pick-time decision, D-007) — the output is a
`sources/*.json` fragment the reader pastes, never a write to git.

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
