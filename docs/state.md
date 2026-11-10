# State of the tree

What exists, measured. The map of what is **open** is `docs/roadmap.md`; the
`why` of any decision here is `docs/decisions.md` / `docs/decisions-tooling.md`.
Dates and numbers below are measurements, not intentions — re-measure with
`pnpm test`, `pnpm lines` and `scripts/*` before trusting them.

Measured 2026-11-10, at the commit that finishes the Tailwind v4 migration.

## What the app is

A personal newspaper. It fetches RSS/HTML/JSON on a cadence, diffs each result
against the cached baseline in SQLite, scores items deterministically, and
renders the changes as a page that looks like a newspaper at
`http://127.0.0.1:8787`. One process, started by hand. The pipeline is
hard-coded: `fetch → parse → normalize → diff → score → publish` (D-001).

## Green, right now

`pnpm test` — 87 files, **1 063 tests, all passing**, 8.9 s. `pnpm typecheck`
clean. `pnpm lint` 0 errors / 9 warnings (the ceiling; rule 16).
`pnpm lines` passes — 280 files, every one ≤ 300 lines.
`pnpm test:design` — 12 assertions in real Edge, green (first time).

| package           | src                   | tests                   | project tests  |
| ----------------- | --------------------- | ----------------------- | -------------- |
| `packages/core`   | 15 files, 2 274 lines | 16 files, 2 593         | 250            |
| `packages/config` | 6, 858                | 6, 1 027                | 86             |
| `packages/db`     | 15, 2 323             | 16, 2 763               | 154            |
| `packages/fetch`  | 24, 3 440             | 22, 3 969 + 29 fixtures | 309            |
| `packages/paper`  | 10, 850               | 10, 1 501               | 107            |
| `packages/server` | 3, 356                | 7, 1 082                | 52             |
| `apps/web`        | 6, 366                | 12, 1 551               | 105 (+12 Edge) |

Coverage gate is 95 % per package (`vitest.coverage.json`); core measures
99.39 / 95.74 / 100 / 99.85, paper **100** on all four metrics, web
99.06 / 95.78 / 100 / 99.45. Run it **per package** — a root
`vitest run --coverage` prints a confident 0 % and gates nothing.

## What each package can do

**core** (browser-safe, no I/O): the record schema and the API contract
(`api.ts`: `itemView`, `sourceHealthView`, `edition`, `mastheadView`,
`stateResponse`, `itemsQuery`/`itemsResponse`, `editionsResponse`,
`addSourceRequest`/`Response`, `serverEvent` union + `parseServerEvent`),
`normalize`, `diff`, `score`, `teaser`, `health`, cadence + cron, `httpDate`,
`relativeParts` / `editionDate` (the locale-free i18n parts, rule 13).

**config**: zod schemas for sources and the app, file loading, watchlist and
OPML. `sources/*.json` in git is the truth (D-011).

**db**: `node:sqlite` behind a driver, `openDatabase` / `openInMemory`,
migrations (`MIGRATIONS`, `migrate`, `CURRENT_VERSION`), a cooperative lock
(`claimLock`, `extendClaim`, `readLock`, `releaseLock`), and the repositories:
`sourcesRepository`, `itemsRepository`, `itemEventsRepository`,
`snapshotsRepository` (`PollSnapshot`, `SnapshotOutcome`),
`validatorRepository`, plus `timeSpecOf` and the value codecs.

**fetch**: the HTTP transport (`fetchSource(spec, baseline, deps)`) implementing
the change-detection ladder of D-020 — `304` → body hash → declared timestamp →
full parse, where a cheap signal may skip work and **never** suppress an item —
charset detection, RSS/Atom parsing, HTML and JSON parsing, and 29 captured
fixtures under `test/fixtures/`.

**server**: the read side only. `index.ts` re-exports `editionOf` (rows →
`Edition`) and `stateOf` (+ `StateDeps`, `datelineFor`, the item/event limits).
Everything that writes — pipeline, scheduler, routes, SSE, static, toasts — is
absent.

**paper**: browser-safe, consumed by the app, ten modules. The barrel's public
surface is seven components (`Paper`, `Masthead`, `Section`, `Story`, `EditDiff`,
`HealthStrip`, `Onboarding`), the label/props types, and one string —
`sheetClass`, the shell's class string, public because the app's loading and
failure states are shells of the same page. `packages/paper/test/index.test.tsx`
pins that list, so a rename is a build failure and an undeclared export is a
failing test.

**web**: the SPA — `App.tsx`, `api.ts` (`/api/state`, `EventSource
'/api/events'`), i18n chrome, the dev API plugin and the seed.

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

## Styling: Tailwind v4, migration complete

Tailwind v4 (D-024). Four stylesheets remain, all of them the residue a utility
cannot express: `tokens.css` (`@theme` vocabulary + the dark / print / contrast
rebinding, so no `dark:` or `print:` variant exists), `base.css` (`@layer base`

- the flash keyframes), `marks.css` (the sketch layer: diagonal crossings 315°,
  dot grid, hairline inset ring, crop marks — geometry copied from
  tailwindcss.com's own stylesheet, recoloured to newsprint), `paper.css` (the
  entry, imported by `App.tsx`). The four BEM sheets — `sheet.css`, `blocks.css`,
  `front.css`, `stories.css`, 661 lines — are deleted, and no BEM class name
  survives in the repo's own code:

```
git grep -nE "[a-z]+__[a-z]+|[a-z]+--[a-z]+" -- ':!docs' ':!packages/fetch/test/fixtures'
```

is empty. The fixtures still match, because they are **captured publisher
markup** (CNN's own `card--lite`): a fixture edited to satisfy a scanner stops
proving the parser handles the real site (the same exemption as rule 1).

The components carry their own class strings and every element a `data-part`
hook. `packages/paper/src/` is now eight modules: the composition (`Paper.tsx`),
the front page's grid (`FrontPage.tsx`), the diff panel (`EditedStrip.tsx`), the
shared block label (`blockHead.ts`), plus `Story`, `Section`, `Masthead`,
`HealthStrip`, `types`, `index`. The split is rule 1 (300 lines), and the shared
label exists because `Section.tsx` had a **copy** of the sticky label's class
string — two copies is how the rails and the sections stop being the same label.

`packages/paper/test/design-contract.test.tsx` is a text contract over the CSS
**and** the components: never `justify`, no absolute leading, one typeface with
no `@font-face` and no CDN URL, no radius, no shadow outside the guideline ring
and the scroll edge, no gradient inside a component, `data-part` and never BEM.

`pnpm test:design` is **green** — 2 files, 12 computed assertions in real Edge
(`apps/web/test/design/`): the compile guard, no `justify` at 1440/1024/390, 3
front columns at 1440 with the lead wider than a rail, 1 column at 900, the
sticky label's position and opaque background, a panel's padding and inset ring,
the crossings on `body` and the dots in a panel, the lead headline above the
fold. It is out of the pre-commit floor because it launches a real Edge.

`pnpm shots` prints the measured layout at 1440×900, 1024×768 and 390×844 —
front grid tracks, lead headline size and box, the fold verdict, the `justify`
count, and any console error. At the styling commit: `310px 682px 310px`, lead
headline 311→599 px of 900 px (above the fold), 0 justified, no page problems.

Three traps this migration found, all invisible in the markup, all now written
down (D-024):

- **A dangling `var()` is invalid at computed-value time.** The `@theme` rename
  left `--lh-*`, `--measure-gap` and `--font` referenced in the old sheets, so
  those declarations were silently inheriting — the command block in the default
  face, the meta lines at normal leading. The design contract's "every
  `font-family` is exactly `var(--font-paper)`" scan caught it.
- **A utility can lose to a utility by source order** (`h-auto` beats
  `h-[…]`), which is how the lead photo broke the fold twice.
- **A Vitest browser project inherits no Vite plugin from the root config**, so
  the design suite measured an unstyled page and passed three claims vacuously.
  The suite's first test is the compile guard that makes the rest mean something.

## Measured defects, open

1. `AGENTS.md` claims `packages/db` ships "FTS5 search": there is **no**
   `fts5` in `packages/db/src`. The claim is the plan, not the state
   (roadmap WP7).

Closed by the styling commit, both named by measurement rather than guessed at:

- The lead's figure printed **before** its headline, and the lead image was
  capped at `min(24rem, 46vh)`, so at 1440×900 the headline started below the
  fold. Order is now kicker → headline → deck → figure → meta, the cap is
  `min(15rem, 30vh)`, and the real cause was a **utility losing to a utility**:
  the box carried `h-auto` and the slot's `h-[min(15rem,30vh)]`, and Tailwind
  emits `h-auto` last, so the photo sized to the file (measured 352 px). See
  D-024.
- One `404` in the console on every page load. It was **`/favicon.ico`**: with no
  icon declared, the browser asks for one and the dev server answers 404. The
  app's tab now carries the paper's own ornament as an inline SVG
  (`apps/web/index.html`) — no file, no request, no CDN asset. It hid for a
  session because the in-app browser never requests a favicon; real Edge does,
  and `m.location()` named the URL in one probe.

## Two things that look like defects and are not

Both were written into the notes as bugs. Both are deliberate, and both are
pinned by a named test. Read the tests before "fixing" either (rule 14).

- **`classifyFetch({ status: 304, ok: true, itemCount: 0 })` → `unknown` is the
  intent.** A `304` tells the health classifier nothing, because the parser
  never ran: `itemCount` is `0` by construction, so calling it `ok` would be a
  confident answer built on a number that was never observed. The composition
  rule belongs to the pipeline, and it is stated by
  `packages/fetch/test/transportHealth.test.ts:59` — _"a 304 composes to
  unknown on a fresh health state, and the pipeline keeps the last good one: a
  304 is not a zero"_. The read side refuses the invented zero too:
  `packages/server/test/edition-health.test.ts:127` asserts a `not-modified`
  snapshot yields `matchCount: null`. So _"Baselined, watching from now on"_
  prints only where there is no prior success to keep, which is exactly what the
  sentence describes, and `HealthStrip` has a separate `neverFetched` label for
  a source that has never been fetched.
- **`errorKindOf` collapsing TLS to `network` is only true of the fallback.**
  Core's classifier is a last resort whose `network` answer for an unrecognised
  cause is documented as "the honest default, not a guess". The real path is
  `classifyThrown` in `packages/fetch/src/transportErrors.ts`: it walks the
  whole cause chain collecting `code`, `errno`, `name` and `message`, and
  answers `tls` from `TLS_CODES` / `TLS_WORDS` **before** the fallback, with
  DNS, timeout and connect tables in between. A certificate failure on a real
  poll is named `tls`, and the paper says so.

## Gates, and what they cost

`pnpm check` is the gate before declaring work done: it is minutes (per-package
coverage, the Edge projects, the audit), and it is **green at this commit** —
`pnpm check` exit 0, with the hook active. `check:hooks` fails in a clone where
the hook is inactive — deliberately: an unguarded checkout must not look set up.
`.husky/pre-commit` is the floor, ~11 s: `biome check --staged`, the 300-line
scan, the secret scan, `schemas:check`, `pnpm typecheck`, `pnpm test:fast`
(core/db/web/fetch), under `set -e`. Husky activates from a `prepare` script
that `ignoreScripts: true` suppresses, so **a fresh clone has no hook** until
`pnpm hooks:install` (rule 16). `core.hooksPath` is `.husky/_`, which is why
`.git/hooks/pre-commit` looks absent while the hook is live.
