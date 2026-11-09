# Open work packages

What is **not** built, in the order that unblocks the most. Each package states
the measured gap, the acceptance test, and the rules it is answerable to.
`docs/state.md` is the inventory of what exists; `AGENTS.md` is the law.

The dependency spine is `WP12 → WP2 → WP3 → WP4 → WP5`, then everything else.
Seven root scripts (`start`, `pick`, `login`, `status`, `search`, `export`,
`import`) point at `packages/server/src/cli.ts`, which **does not exist**, so
`pnpm start` fails today — the shortest path from "a package that passes tests"
to "an app you can run" is WP2 → WP4 → WP5.

## WP1 — Finish the styling migration (CSS wipe)

**Gap.** `sheet.css`, `blocks.css`, `front.css`, `stories.css` (661 lines of
hand-written BEM) still drive the page; the components carry BEM class names, so
structural hooks are class names rather than `data-part` (rule 11).
`pnpm test:design` is red: `apps/web/test/design/` holds no tests.

**Build.** `docs/handoff-tailwind-rewrite.md` is the brief, with the full
rule-by-rule translation table and the `BEM → data-part` map. Includes defect 3
of `docs/state.md` (the lead's headline must lead) and the Edge suite:
computed assertions in real Edge — no `justify`, 3 columns at 1440 / 1 at 900,
the sticky block head with an opaque background, a panel's padding ≥ 16 px and
its inset ring, the crossings on `body` and the dots in a panel, the lead
headline above the fold.

**Accept.** `git grep -nE '[a-z]+__[a-z]+|[a-z]+--[a-z]+'` is empty;
`pnpm test:design` green for the first time; `pnpm shots` shows the lead
headline on the first screen at all three widths and the reader has seen the
images; every box with a rule has padding.

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
A second identical poll produces **zero** items, one snapshot, and a `304`
outcome — and, with WP12, a health state that is not `unknown`.

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
(no new component styling mid-WP1: land after WP1).

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

## WP12 — The two health defects (small, do it first)

**Gap.** `docs/state.md` defects 1–2: `classifyFetch({ status: 304, ok: true,
itemCount: 0 })` yields `unknown`, so the paper says _"Baselined, watching from
now on"_ for a conditional-GET hit; `errorKindOf` collapses TLS failures behind
Node's `fetch failed` wrapper to `network`.

**Build.** A `304` with a known baseline is `ok` (nothing changed is a
**successful** poll); a `304` with no baseline is the real "baselined" case.
`errorKindOf` walks `cause` (`node:crypto`'s `ERR_TLS_*`,
`CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY…`) before
falling back to `network`.

**Accept.** Table tests over `classifyFetch` for `200/304/401/403/404/5xx`,
with and without a baseline, and over `errorKindOf` for a wrapped TLS error, a
timeout abort, and a DNS failure — each naming its own kind. Both fixes are
pure core functions: no I/O, two commits (`fix(core): …`).

## WP13 — README

**Gap.** No `README.md`. A first-time reader has `AGENTS.md` (rules for an
agent) and `docs/*` (why), and nothing that says "run these three commands".

**Build.** A page a human reads: what the paper is, `pnpm install`,
`pnpm hooks:install`, `pnpm seed` + `pnpm dev` (the seeded paper, offline),
`pnpm start` (the real one, once WP5 lands), `pnpm shots`, and a pointer to
`docs/state.md` and `docs/roadmap.md`.

**Accept.** Every command in it is run and quoted with its real output, and it
stays under 300 lines (rule 1).
