# State of the tree

What exists, measured. The map of what is **open** is `docs/roadmap.md`; the
`why` of any decision here is `docs/decisions.md` / `docs/decisions-tooling.md`.
Dates and numbers below are measurements, not intentions — re-measure with
`pnpm test`, `pnpm lines` and `scripts/*` before trusting them.

Measured 2026-11-09 at `e0edc35` + the sketch-layer commit.

## What the app is

A personal newspaper. It fetches RSS/HTML/JSON on a cadence, diffs each result
against the cached baseline in SQLite, scores items deterministically, and
renders the changes as a page that looks like a newspaper at
`http://127.0.0.1:8787`. One process, started by hand. The pipeline is
hard-coded: `fetch → parse → normalize → diff → score → publish` (D-001).

## Green, right now

`pnpm test` — 86 files, **1055 tests, all passing**, 8.25 s. `pnpm typecheck`
clean. `pnpm lint` 0 errors / 10 warnings (the ceiling; rule 16).
`pnpm lines` passes, so every file ≤ 300 lines.

| package           | src                   | tests                   | project tests |
| ----------------- | --------------------- | ----------------------- | ------------- |
| `packages/core`   | 15 files, 2 274 lines | 16 files, 2 593         | 250           |
| `packages/config` | 6, 858                | 6, 1 027                | 86            |
| `packages/db`     | 15, 2 323             | 16, 2 763               | 154           |
| `packages/fetch`  | 24, 3 440             | 22, 3 969 + 29 fixtures | 309           |
| `packages/paper`  | 7, 558                | 10, 1 361               | 99            |
| `packages/server` | 3, 356                | 7, 1 082                | 52            |
| `apps/web`        | 6, 358                | 9, 1 444                | 105           |

Coverage gate is 95 % per package (`vitest.coverage.json`); core measures
99.39 / 95.74 / 100 / 99.85 and paper 100. Run it **per package** — a root
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

**paper**: five components (`Paper`, `Masthead`, `Section`, `Story`,
`HealthStrip`) plus `types.ts` / `index.ts`, browser-safe, consumed by the app.

**web**: the SPA — `App.tsx`, `api.ts` (`/api/state`, `EventSource
'/api/events'`), i18n chrome, the dev API plugin and the seed.

## The dev loop, which is how the page is seen today

`pnpm --filter newspa-web run seed` writes `apps/web/dev/state.json` (113
stories, 6 edited, 8 sources) from the parser fixtures; `apps/web/dev/apiPlugin.ts`
serves `/api/state` and `/api/events` from it, so `pnpm dev` prints a paper with
real publisher text while `packages/server` is incomplete. `pnpm shots`
(`scripts/screenshot-paper.mjs`, `playwright-core` + `channel: 'msedge'`, D-003)
renders the paper at 1440×900, 1024×768 and 390×844 and reports the front grid,
the column count and the `justify` count. The in-app browser is ~620 px wide and
always shows the phone stack, so `pnpm shots` is the only desktop truth.

## Styling: mid-migration, deliberately

Tailwind v4 (D-024). Landed: `tokens.css` (`@theme` vocabulary + the dark /
print / contrast rebinding, so no `dark:` or `print:` variant exists),
`base.css` (`@layer base` residue + the flash keyframes), `marks.css` (the
sketch layer: diagonal crossings 315°, dot grid, hairline inset ring, crop
marks — geometry copied from tailwindcss.com's own stylesheet, recoloured to
newsprint), `paper.css` (the entry, imported by `App.tsx`).

Still to delete: the four BEM sheets `sheet.css`, `blocks.css`, `front.css`,
`stories.css` — unlayered, so they win over utilities while the components
still depend on them. The translation table is
`docs/handoff-tailwind-rewrite.md`.

`packages/paper/test/design-contract.test.tsx` is a text contract over the CSS
**and** the components: never `justify`, no absolute leading, one typeface with
no `@font-face` and no CDN URL, no radius, no shadow outside the guideline ring
and the scroll edge, no gradient inside a component. It caught three real
defects the day it was rewritten (see below).

`pnpm test:design` is **red**: `apps/web/test/design/` holds no tests, so Vitest
exits 1 with "No test files found". The Edge project is wired
(`apps/web/vitest.design.config.ts`), the assertions are not. That is why
`test:design` is not in the pre-commit floor.

## Measured defects, open

1. `classifyFetch({ status: 304, ok: true, itemCount: 0 })` returns `unknown`,
   so the paper prints _"Baselined, watching from now on"_ for every
   conditional-GET hit. The ladder is right; the health classification of a
   `304` is not.
2. core's `errorKindOf` collapses a TLS failure behind Node's `fetch failed`
   wrapper to `network`, so a certificate problem reads as a connectivity
   problem (rule 5: the paper must name the real cause).
3. `Story.tsx` renders the lead's figure **before** its headline, and the lead
   image is capped at 46 vh, so at 1440×900 the lead headline starts below the
   fold — the intent is stated in `stories.css` and violated by the component.
4. The paper page logs one unexplained `404` at `localhost`. Not chased.
5. `AGENTS.md` claims `packages/db` ships "FTS5 search": there is **no**
   `fts5` in `packages/db/src`. The claim is the plan, not the state
   (roadmap WP7).

Fixed by the commit that added the design contract, because the contract caught
it: `sheet/blocks/front/stories.css` referenced `--lh-*`, `--measure-gap` and
`--font` after the `@theme` rename to `--leading-*` / `--measure` /
`--font-paper`. A dangling `var()` is invalid at computed-value time, so those
declarations were silently inheriting — invisible breakage, found by a text
scan.

## Gates, and what they cost

`pnpm check` is the gate before declaring work done: it is minutes (per-package
coverage, the Edge projects, the audit) and it currently fails on the red
`test:design` and on `check:hooks` in a clone where the hook is inactive.
`.husky/pre-commit` is the floor, ~11 s: `biome check --staged`, the 300-line
scan, the secret scan, `schemas:check`, `pnpm typecheck`, `pnpm test:fast`
(core/db/web/fetch), under `set -e`. Husky activates from a `prepare` script
that `ignoreScripts: true` suppresses, so **a fresh clone has no hook** until
`pnpm hooks:install` (rule 16). `core.hooksPath` is `.husky/_`, which is why
`.git/hooks/pre-commit` looks absent while the hook is live.
