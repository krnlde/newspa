# Styling decisions

The paper's CSS law, its vocabulary and how it is measured: split out of
`decisions-tooling.md` at the 300-line cap (rule 1). Shared `D-` numbering; the
index is `decisions.md`.

## D-024 - Tailwind v4 for the paper's styling; the vocabulary is CSS, the classes are on the elements

The reader asked for this, and the reason is the kind that can be checked in the source: _"if I have to
read your handwritten stuff I am completely lost"_. A class string on the element is the stylesheet
readable at the place the element is built — in `Story.tsx`, `text-lead font-extrabold leading-display
tracking-kicker` says which volume the story prints in, next to the JSX that decides the volume. The
second reason is measurable: the bundle ships only the utilities that are used.

What it replaces: 808 lines of hand-written CSS in four files under `packages/paper/styles/`. That
stylesheet was good — every rule had a reason, and the reasons are all kept — but its values repeated:
`font-size: 0.66rem` appeared eight times, and each repetition was a chance to drift. The vocabulary is
now one list, in `tokens.css` under `@theme`: `--text-kicker`, `--leading-display`, `--color-paper`.
A utility exists because a line in that file defines it, and a component can only speak words from it.

- **The three theme mechanisms get cheaper, not harder.** Colours are plain custom properties mapped
  into the theme with `@theme inline`, so `bg-paper` emits `var(--paper)`. `[data-theme='dark']`,
  `prefers-color-scheme` and `@media print` rebind the same names, and every utility on the page
  follows — no `dark:` variant, no `print:` variant, anywhere.
- **`data-part` is the structural contract.** The print rules, the SSE flash and the design suite query
  `[data-part='headline']`, `[data-part='kicker']`, `[data-part='columns']`, `[data-part='health']`,
  `[data-part='theme-switch']`. A class string is a styling decision that changes with the design; a
  structural hook is what a test and a print rule may depend on. The BEM names this replaced lived on
  in unlayered stylesheets — and unlayered CSS beats every layer, which is what made the migration
  shippable in steps, and what made the last step atomic: the four sheets and the class names they
  styled had to go in one pass, because a page whose sheets are deleted while its components still
  carry `.foo__bar` is a page with no styling on those elements.
- **The residue is named.** A utility cannot express `@page`, `::first-letter` drop caps,
  `content: attr(href)` for print, keyframes, the theme rebinding, or Preflight's removal of list
  markers (the onboarding steps are a numbered list, so `ol` gets its markers back). That is
  `base.css`, in `@layer base`, so a component's utility always wins over it.
- **The design rules are untouched, and rule 11 says so in the same commit**: one typeface with no
  download (no font plugin, no CDN asset), hierarchy from size, weight and measure, hairline rules on
  `#f4ecd8`, no cards, no rounded corners, no saturated colour, no shadow except the documented scroll
  edge, and `text-align: justify` never.
- **Cost, stated.** `tailwindcss` and `@tailwindcss/vite` 4.3.5, exact in the catalog: +20 packages,
  1.9 s install, no install scripts, so `strictDepBuilds` and `ignoreScripts` stay intact. Biome's
  CSS parser needs `css.parser.tailwindDirectives: true` — it was `false`, so `@theme` and `@source`
  were parse errors. The migration touches five components and the design contract; the contract moves
  from "this BEM rule exists in that file" to "this element computes to this", which is the stronger
  test. Measured at the engine commit: the app's CSS is 15.83 kB (4.28 kB gzipped) with no utilities
  in use yet, and `pnpm shots` renders the front page in real Edge at 1440×900, 1024×768 and 390×844
  with a 323 / 712 / 324 px front grid and zero justified elements.

**Migration complete (2026-11-10).** `sheet.css`, `blocks.css`, `front.css` and `stories.css` — 661
lines — are deleted; the four files that remain are `paper.css` (the entry), `tokens.css`, `base.css`,
`marks.css`. The page shipped 22.03 kB of CSS (5.51 kB gzipped) at that commit, every rule of it a
utility in use
plus the named residue. Measured in real Edge at 1440×900: front grid `310px 682px 310px`, lead
headline 311→599 px (above the fold), lead photo 240 px, panel padding 16 px with an inset ring, the
sticky label's shadow, zero justified elements.

Two traps the migration cost, both invisible in the markup:

- **A Vitest browser project inherits no Vite plugin from the root config.** `apps/web/vitest.design.config.ts`
  listed `plugins: [react()]`, so `@import 'tailwindcss'` reached Edge as literal text, every utility
  computed to its initial value, and the design suite measured a page with no styling — three of its
  twelve claims passed **vacuously** (`gridTemplateColumns: none` reads as one column; a fold test
  measures zeroed rects). The suite's first test is now that compile guard: a `block-head` that is not
  `position: sticky` fails with the reason, before any measurement means anything.
- **A utility can lose to a utility by source order.** `h-auto` is emitted after an arbitrary height
  (byte offsets in the built sheet), so an image box carrying `h-auto h-[min(15rem,30vh)]` is auto-sized:
  the lead photo measured 352 px and the headline sat below the fold. The cap now lives in exactly one
  place per slot, and `pnpm shots` prints the photo's height and the headline's box, because a rule
  that fails this quietly is a rule that will fail again.
- **The harness styles the page too, and unlayered.** `@vitest/browser` injects `body { padding: 0;
  margin: 0 }` into the tester iframe (`dist/index.js:3460`), unlayered, and unlayered beats every
  layer: the app's `@layer base` rule on `body` computes to `0` inside the design suite and works on
  the real page. So a claim about `body` cannot be pinned in the Edge suite — it belongs in the text
  contract and in `pnpm shots`, which drives the real app. The suite keeps what the harness cannot
  reach (the sheet's own crop marks). The honest fix is **not** `!important` on the app.

**And the sheet needs a waste area (same day).** A full-bleed sheet hides the marks that live outside
its box. The sheet is `max-w-[104rem]` = 1 664 px, so every viewport below that is full width, and the
sheet's own `bg-paper` covered `body`'s diagonal crossings completely: visible stock **0 px² at 390,
620, 1024 and 1440**, appearing only past 1 664 CSS px — which is why the texture showed at 75% zoom on
a 2 560 px screen and nowhere at 100%. The crop marks, drawn `--mark-offset` (7 px) outside the box,
hung 6 px past the right edge, and every width had a horizontal scrollbar (`scrollWidth − clientWidth =
6`; removing the `cropmarks` utility alone took it to 0). One rule serves both: `body` carries
`padding-inline: var(--spacing-gutter)` and `padding-block: var(--mark-offset)`, and the print block
drops the whole sketch layer, ticks included, because a printed page's waste is the `@page` margin and
ink is not for texture. Measured by `pnpm shots` at four widths — stock 40+40 / 31+31 / 19+19 / 12+12
px, sideways scroll none — and the CSS is 22.25 kB (5.56 kB gzipped).
