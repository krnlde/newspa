# Closed work packages

The record of packages that closed, kept out of `docs/roadmap.md` for the
same reason that file is a plan and not a log: the roadmap is what is **not** built,
and a plan that carries its own history stops being readable (rule 1 is the
mechanical reason, and the two files are 106 and 216 lines).

Each entry says what landed and what was measured, because the numbers are the
part that is hard to recover. WP12 is here as a **retirement**: read it before
reopening the same two files.

---

The surface - the picker (WP6), the styling migration (WP12), the sources panel (WP14) - is in `roadmap-closed-surface.md`.

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
layer 2 (`selection-unchanged`, D-027) each have their own test, and so does the
rung that was **removed**: an edit the feed does not declare **is** parsed,
because a declared stamp records and never suppresses. D-005's identity rule is
pinned at the poll: a `?utm_source=` copy of a story is **one** row with one
event history, the link the reader clicks keeps the publisher's own text, and —
the deliberate boundary — a `?ref=` copy is a second story.
Rule 5 is pinned from nine directions — a refused payload, a selector
that matches nothing, a challenge wall, a `403`, a `500` (retried, waits
recorded, `lastSuccessAt` untouched), a payload of the wrong kind, a
`render: true` source (no request made), a body that stops parsing (the last
good items survive, the baseline does not move), and an unregistered source,
which **throws** and rolls the poll back.

**Left in it, on purpose.** One thing the roadmap still owns: `score_digest` (the
digest pass's column; a poll writes `0` because no digest has run). The `gone`
event, deferred here for exactly that reason — `items.list` is a page of 200, and
inferring "gone" from "not on this page" is the silent zero — is **closed**
(2026-11-11, D-029 level 1): `items.storedKeys` reads the whole key set, core counts
the streak over settled polls, and the paper prints _Archived_ as the third kicker.

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
