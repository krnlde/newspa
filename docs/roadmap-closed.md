# Closed work packages

The record of packages that closed, kept out of `docs/roadmap.md` for the
same reason that file is a plan and not a log: the roadmap is what is **not** built,
and a plan that carries its own history stops being readable (rule 1 is the
mechanical reason, and the two files are 106 and 216 lines).

Each entry says what landed and what was measured, because the numbers are the
part that is hard to recover. WP12 is here as a **retirement**: read it before
reopening the same two files.

---

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
