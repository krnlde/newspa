# Open work packages

What is **not** built, in the order that unblocks the most. Each package states
the measured gap, the acceptance test, and the rules it is answerable to.
`docs/state.md` is the inventory of what exists; `AGENTS.md` is the law.

The dependency spine was `WP2 → WP3 → WP4 → WP5`, then everything else; **WP2 and
WP3 are closed** (below), so the remaining path to a paper that fills itself is the
**entry point** and **WP4** (the HTTP surface). The MVP order chosen 2026-11-11 is:
scheduler → `start.ts` → routes/SSE/static → `export --bundle`, and WP5 is
re-scoped to that. Seven root scripts (`start`, `pick`, `login`, `status`,
`search`, `export`, `import`) point at `packages/server/src/cli.ts`, which **does
not exist**, so `pnpm start` fails today — while the poll and the scheduler that
run it are built, so the paper is one entry point and one route file from being
live. Closed and retired packages — WP1, WP2, WP3, WP12 — are recorded in
`docs/roadmap-closed.md` with what each measured; read WP12 before reopening the
same two files.

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

## WP5 — the entry point (`start.ts`), not a CLI  _(re-scoped 2026-11-11 for MVP)_

**Gap.** `package.json` runs `node packages/server/src/cli.ts …` for `start`,
`pick`, `login`, `status`, `search`, `export`, `import`; the file is absent, so all
seven exit non-zero — a module-not-found, where the rule is that a silent zero is a
bug.

**Re-scope.** A terminal UI is not on the path to a paper that fills itself, so MVP
builds the **entry point** and one data-safety command:

- **`start`** — load and report the config and the watchlist, `ensureSourcesDir`
  (D-025: creating the directory is boot's job, not a side effect of a read), open
  and migrate the db, take the lock, run the scheduler, serve. No argv dispatcher,
  no flags, no help text: `node packages/server/src/start.ts`.
- **`export --bundle`** — rule 18: `sources/` is gitignored, so the bundle **is the
  only backup of the reading list**. About forty lines, and its absence is data
  loss, not a missing nicety.

**Cut, named, not deleted:** `status` (the paper's health strip says it), `search`
(the paper's box; FTS5 is built), `pick` (WP6), `login` (WP8), `sources:migrate`
(D-030 rung 3 — rung 1 self-heals a permanent redirect, and the reader moves a URL
by editing the file, which is where the truth lives, D-011). A cut script prints a
one-line named refusal rather than a stack trace, so `pnpm status` cannot read as a
broken pipe.

**Accept.** `pnpm build && pnpm start` serves a paper built from a **real** poll of
the local `sources/`, on the configured port, and `pnpm export --bundle` writes a
bundle `import` reads back. From a fresh clone — no `sources/` — `start` creates the
directory, prints the `no-sources` report and the `pnpm sources:init` hint, and
serves an empty paper without polling anything (rule 5: the emptiness is stated).

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

## WP13 — README

**Gap.** No `README.md`. A first-time reader has `AGENTS.md` (rules for an
agent) and `docs/*` (why), and nothing that says "run these three commands".

**Build.** A page a human reads: what the paper is, `pnpm install`,
`pnpm hooks:install`, `pnpm seed` + `pnpm dev` (the seeded paper, offline),
`pnpm start` (the real one, once WP5 lands), `pnpm shots`, and a pointer to
`docs/state.md` and `docs/roadmap.md`.

**Accept.** Every command in it is run and quoted with its real output, and it
stays under 300 lines (rule 1).
