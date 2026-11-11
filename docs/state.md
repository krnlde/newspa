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

`pnpm test` — 94 files, **1 110 tests, all passing**, 8.4 s. `pnpm typecheck`
clean. `pnpm lint` 0 errors / 9 warnings (the ceiling; rule 16).
`pnpm lines` passes — 293 files, every one ≤ 300 lines.
`pnpm test:design` — 13 assertions in real Edge, green.

| package           | src                   | tests                   | project tests  |
| ----------------- | --------------------- | ----------------------- | -------------- |
| `packages/core`   | 15 files, 2 274 lines | 16 files, 2 593         | 250            |
| `packages/config` | 6, 858                | 6, 1 027                | 86             |
| `packages/db`     | 15, 2 323             | 16, 2 763               | 154            |
| `packages/fetch`  | 24, 3 440             | 22, 3 969 + 29 fixtures | 309            |
| `packages/paper`  | 10, 850               | 10, 1 541               | 108            |
| `packages/server` | 10, 1 281             | 14, 2 280               | 98             |
| `apps/web`        | 6, 366                | 12, 1 588               | 105 (+13 Edge) |

Coverage gate is 95 % per package (`vitest.coverage.json`); core measures
99.39 / 95.74 / 100 / 99.85, paper **100** on all four metrics, web
99.06 / 95.78 / 100 / 99.45, server 100 / 98.7 / 100 / 100 — the two uncovered
branches are both the "the parser left no note" form, which today's parsers
never produce (every success carries its sniff note: `starts with '<?xml'`,
`starts with '{'`, the doctype), kept because that note is a printed line in the
paper and a dangling separator is the failure it guards. Run it **per package** —
a root `vitest run --coverage` prints a confident 0 % and gates nothing.

## What each package can do

**core** (browser-safe, no I/O): the record schema and the API contract
(`api.ts`: `itemView`, `sourceHealthView`, `edition`, `mastheadView`,
`stateResponse`, `itemsQuery`/`itemsResponse`, `editionsResponse`,
`addSourceRequest`/`Response`, `serverEvent` union + `parseServerEvent`),
`normalize`, `diff`, `score`, `teaser`, `health`, cadence + cron, `httpDate`,
`relativeParts` / `editionDate` (the locale-free i18n parts, rule 13).

**config**: zod schemas for sources and the app, file loading, watchlist and
OPML. The source files are the truth (D-011); the directory is local and
gitignored (D-025), and `loadSources(dir)` is what makes that a parameter.

**db**: `node:sqlite` behind a driver, `openDatabase` / `openInMemory`,
migrations (`MIGRATIONS`, `migrate`, `CURRENT_VERSION`), a cooperative lock
(`claimLock`, `extendClaim`, `readLock`, `releaseLock`), and the repositories:
`sourcesRepository`, `itemsRepository`, `itemEventsRepository`,
`snapshotsRepository` (`PollSnapshot`, `SnapshotOutcome`),
`validatorRepository`, plus `timeSpecOf` and the value codecs. The disappearance
ladder's two columns (D-029) live in `itemsStreaks.ts` — `storedKeys` reads the
source's **whole** key set, `markStreaks` writes the verdicts scoped to the source —
and `itemsRepository`'s upsert does not name them, so re-seeing a key never resets
a count.

**fetch**: the HTTP transport (`fetchSource(spec, baseline, deps)`) implementing
the change-detection ladder of D-020 and D-027 — `304` → body hash → **selection
hash** (the node the source watches) → full parse, where a cheap signal may skip
work and **never** suppress an item — charset detection, RSS/Atom parsing, HTML
and JSON parsing (relative links resolve against the URL that answered, D-030),
and 31 captured fixtures under `test/fixtures/`.

**server**, the surface, the run verbs and the dev loop: `docs/state-server.md` —
the poll and the read side as one package, `cli.ts`/`commands.ts`/`start.ts`,
routes, SSE, the address policy (D-034), the four verbs, and the loop that prints
the page.

**paper**: browser-safe, consumed by the app, fourteen modules. The barrel's public
surface is eight components (`Paper`, `Masthead`, `Section`, `Story`, `EditDiff`,
`HealthStrip`, `Onboarding`, `SourcesPanel`), the label/props types — including
`SourcesLabels`/`SourcesProps`, because the panel prints no string of its own (D-019) —
and one string —
`sheetClass`, the shell's class string, public because the app's loading and
failure states are shells of the same page. `packages/paper/test/index.test.tsx`
pins that list, so a rename is a build failure and an undeclared export is a
failing test.

**web**: the SPA — `App.tsx`, `api.ts` (`/api/state`, `EventSource
'/api/events'`, and the three source verbs, each answer parsed by a core schema before
the app sees it), `SourcesSection.tsx` (the panel's wire: the list query, the two
mutations, and the rule that a refusal **rejects** so the editor keeps the reader's
text), `sourcesTemplates.ts` (the three skeletons), i18n chrome, the dev API plugin and
the seed.

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
hook. `packages/paper/src/` is now fourteen modules: the composition
(`Paper.tsx`, which takes `children` so a section prints **inside the one sheet** —
a sibling would sit on the cross-hatched stock with no paper under it), the front
page's grid (`FrontPage.tsx`), the diff panel (`EditedStrip.tsx`), the health strip,
the sources panel (`SourcesPanel`/`SourceRow`/`SourceEditor` + `sourceStyle.ts`,
WP14: the reading list as files, edited in a `<textarea>` of the file's own bytes),
the shared block label (`blockHead.ts`), plus `Story`, `Section`, `Masthead`,
`types`, `index`. The split is rule 1 (300 lines), and the shared
label exists because `Section.tsx` had a **copy** of the sticky label's class
string — two copies is how the rails and the sections stop being the same label.
The editor's JSON box has **no monospace face**: the law is one family, and
`font-paper text-[0.8rem] whitespace-pre` is the onboarding command block's existing
precedent for code-shaped text.

`packages/paper/test/design-contract.test.tsx` is a text contract over the CSS
**and** the components: never `justify`, no absolute leading, one typeface with
no `@font-face` and no CDN URL, no radius, no shadow outside the guideline ring
and the scroll edge, no gradient inside a component, `data-part` and never BEM —
and, in the `@media print` block, that the pattern is stripped and that the theme
switch, the health strip **and the sources panel** are `display: none`: a printed
page has no clicks, and a form that prints the absolute path of the watchlist
directory is not news.

`pnpm test:design` is **green** — 2 files, 13 computed assertions in real Edge
(`apps/web/test/design/`): the compile guard, no `justify` at 1440/1024/390, 3
front columns at 1440 with the lead wider than a rail, 1 column at 900, the
sticky label's position and opaque background, a panel's padding and inset ring,
the crossings on `body` and the dots in a panel, the crop marks' computed size and
offset, the lead headline above the fold. It is out of the pre-commit floor
because it launches a real Edge.

`pnpm shots` prints the measured layout at 1440×900, 1024×768, 620×800 and
390×844 — front grid tracks, lead headline size and box, the fold verdict, the
`justify` count, the visible stock on both sides of the sheet, the sideways-scroll
verdict, and any console error. At the waste-area commit: `291px 640px 291px`,
lead headline 318→664 px of 900 px (above the fold), stock 40+40 / 31+31 / 19+19
/ 12+12 px, sideways scroll none at every width, 0 justified, no page problems.
620 is in the list because it is the in-app browser's width, and it is where the
6px horizontal scrollbar was visible to the reader.

Four traps this migration found, all invisible in the markup, all now written
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
- **The harness's own CSS beats the app's layers.** `@vitest/browser` injects an
  unlayered `body { padding: 0; margin: 0 }` into the tester iframe
  (`dist/index.js:3460`), and unlayered CSS beats every layer — so `body`'s waste
  area computes to 0 **inside the design suite** and works on the real page. That
  is not a reason to `!important` the app: it decides where a claim is pinned.
  The body rule is pinned as text (the paper's contract) and measured by
  `pnpm shots`, which drives the real app; the Edge suite keeps the claims the
  harness cannot reach (the sheet's marks).

## Measured defects, open

1. `AGENTS.md` claims `packages/db` ships "FTS5 search": there is **no**
   `fts5` in `packages/db/src`. The claim is the plan, not the state
   (roadmap WP7).

Closed by the styling commits, all named by measurement rather than guessed at:

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
- **A horizontal scrollbar on every screen, and a texture nobody saw.** The
  crossings were in the stylesheet and not on the page: the sheet is
  `max-w-[104rem]` = 1 664 px, so below that it is full-bleed and its own
  `bg-paper` covered `body`'s pattern — visible stock **0 px²** at 390, 620, 1024
  and 1440, appearing only past 1 664 CSS px (which is why it showed at 75% zoom
  on a 2 560 px screen). The same full-bleed put the sheet's crop marks, drawn
  7 px outside its box, 6 px past the viewport's right edge:
  `scrollWidth - clientWidth = 6` at all four widths, and deleting the `cropmarks`
  utility alone took it to 0. One rule fixes both — `body`'s waste area
  (`padding-inline: var(--spacing-gutter)`, `padding-block: var(--mark-offset)`) —
  measured now at 40+40 / 31+31 / 19+19 / 12+12 px of stock, sideways scroll none.
  The two symptoms looked unrelated, a missing texture and a stray scrollbar; both
  were the marks having no waste to land in (docs/design.md).

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
