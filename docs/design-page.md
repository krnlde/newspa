# The paper: the grid, the behaviour, the printed page

The second half of the visual contract. `docs/design.md` is the typeface, the
type scale, the measure and columns, rules not cards, the one overlay, the
sketch marks, colour and the index rule; this file is the front page’s grid,
the behaviour of a live page, and what `@media print` removes. One law, two
files, because AGENTS rule 1 caps a file at 300 lines and splits by
responsibility — and each half cites the other where a claim crosses the seam.

## Front page: what is big, and where a story prints

The page is composed by deterministic rules, and every rule is a knob in a
source file — the reader decides, not a model:

- **The lead** is the edition's highest-scoring story. Nothing else chooses it.
- **Importance** is `weight: 0..5`, worth **+2 per point** to every item of that
  source, against tiers at **12 / 8 / 4.5**. A fresh item adds 4 from recency, so
  `weight: 5` scores 14 and **takes the title page**; `weight: 0` cannot pass 6
  and never reaches the front page. Watchwords and a long headline add on top,
  so those numbers are floors.
- **Where a story prints** is `section: "Iran"`, the reader's own words: that
  becomes the heading, **verbatim** (a label the reader typed is data, not UI
  chrome — D-019). Without `section`, core's keyword ladder routes the story by
  its text, which is what makes 40 unlabelled sources readable.
- **Section order** is the total score each section carries, so the section the
  reader cares about floats up.
- **Above the fold** is one story, centred, with the **two strongest sections as
  narrow rails** beside it — a magazine front page, and the whitespace above the
  fold is gone because the rails fill the columns on either side of the lead.
  Which sections are strongest is not a paper decision: core orders sections by
  the score they carry, so `sections[0]` and `sections[1]` _are_ the answer.
- **A rail is a pointer, not an index**: at most 4 items, at the quietest
  (`brief`) volume, **no photographs** (a rail of thumbnails is a photo blog),
  and it **never repeats the lead** — the same headline twice on one screen is
  not an index. A rail with nothing left to show renders **nothing**, so the
  grid never grows an empty column. Below the fold, the sections print as the
  list.
- **DOM order is lead → rail → rail**, and CSS grid places them in columns
  1 / 2 / 3. Reading, screen-reader and print order therefore all begin with the
  story that matters. CSS `order` was rejected: it moves the lead visually and
  leaves it second to a screen reader, which is a divergence between what you
  see and what you hear.
- **Styling**: Tailwind v4 (D-024). `packages/paper/styles/paper.css` is the one
  entry a consumer imports; it `@import`s `tailwindcss`, then `tokens.css` (the
  `@theme` vocabulary: the colours, the three leading values, the named type
  steps, the gutter and the measure), then `base.css` (what a utility cannot
  express: the `html` defaults, keyboard focus, the print rules, `@page`, the SSE
  flash), then the stylesheets that still carry BEM rules mid-migration. The
  utilities themselves sit on the elements, in `packages/paper/src/*.tsx`, next to
  the markup they style — the volume, the measure and the rule width are visible
  where the element is built. Cascade order is fixed **in CSS**, not in
  JavaScript imports, because a linter reorders those.
- **Structural hooks are `data-part` attributes**, never class names: the print
  rules, the flash animation and the design suite query `[data-part='headline']`,
  `[data-part='kicker']`, `[data-part='columns']`, `[data-part='health']`,
  `[data-part='theme-switch']`. A class string is a styling decision, free to
  change with the design; a structural hook is what a test and a print rule are
  allowed to depend on.

## Behaviour

- **Links**: a headline link has **no underline, at rest or on hover**. The block
  is clickable, the address is in the status bar, and focus is a visible outline —
  that is the affordance. The only underlines in the paper are the edit diff's
  inserted text and the edited strip's links, which are underlined permanently,
  because there the underline carries meaning rather than a mouse position.
- **Theme**: `prefers-color-scheme` is the default; the switcher writes
  `data-theme` on `<html>` plus `localStorage`. An inline script in `index.html`
  applies it **before first paint** — no white flash on a dark-theme device.
- **SSE updates**: the changed story's kicker flashes once (`300ms`) via a
  `::before` rule thickening; `prefers-reduced-motion: reduce` disables it.
- **Focus**: `2px solid var(--ink)` outline, `2px` offset. Visible everywhere.
- **`prefers-contrast: more`**: rules go to `1px`, body text to `--ink`, measure widens.
- Unread/new items are marked by a **`●` glyph in the kicker** (a mark, not a colour).

## Print

The page is the product (D-002), so print is the browser's own: Print → Save as
PDF on the live paper, styled by `@media print` in the paper CSS —
`@page { size: A4; margin: 14mm }`, forced light palette via a
`[data-theme]`-independent print block, `print-color-adjust: exact`, 3 columns,
masthead preserved, nav and switcher hidden, the story's own address printed
after its headline (an index you cannot follow is a list of titles),
`break-after: avoid` on headlines so a title never orphans at a page
bottom. It prints the state you are looking at, which is the honest answer to
"what did the paper say" in a tool with no editions.

And it prints **no editor** (WP14): the theme switch, the sources control, the modal,
its close button and the panel inside it are all `display: none` in print. A form spends
ink on affordances a page cannot use — a textarea, three buttons per source — and it
prints the absolute path of the watchlist directory, which is the reading list (rule 18).
The same reasoning removes the **install entry** (WP16: a printed page cannot be
installed, and the iOS recipe names a Share button that exists on a screen) and the
**spine** (D-043: a rail pinned to the scrollbar has no scrollbar on paper, and a
printed page is already its own index).
`@media print` is not reachable from a screen viewport, so the claim is pinned **as text**
in `packages/paper/test/design-contract.test.tsx`, which extracts the block's
`display: none` selectors and demands all six names.
