# The paper: visual contract

The output is a newspaper, not a dashboard. Every rule below exists because
real newspapers learned it in print, where bad typography costs readers.

## One typeface, no downloads

**Single family for everything**, headlines and body alike, from the system:

```css
--font: Georgia, 'Iowan Old Style', 'Times New Roman', 'Source Serif 4', serif;
```

Georgia is present on Windows and macOS, so the paper renders identically with
**zero network access** — no webfonts, no CDN, no FOIT. A tool you open at 6am
on a train must not depend on a font host. Hierarchy therefore comes from
**size, weight, measure, letterspacing and rules**, never from a second font.

- Kickers / labels / captions: `uppercase` + `letter-spacing: 0.08em`, 0.62–0.72rem, `font-weight: 700`.
- Headlines: **`font-weight: 800`**, `line-height: var(--lh-display)`, `letter-spacing: -0.018em`, `text-wrap: balance`.
- Body and decks: 400, `line-height: var(--lh-read)`, `orphans/widows: 2`, `text-wrap: pretty`.

**Leading is a scale, not a per-block number.** Three tokens — `--lh-display`
1.06, `--lh-read` 1.62, `--lh-meta` 1.35 — and nothing outside them sets
`line-height`. The page used to set 1.02, 1.03, 1.2, 1.5 and 1.55 in five
places, and it read as five different textures stacked on top of each other.

**Never `text-align: justify` — not in any block, theme, width or print rule.**
Justification distributes the _spaces_, not the letters, so a ~40-character
column grows a river of whitespace down the page, and a floated drop cap makes
it worse because the line breaker has two fewer lines to work with. Justified
text is what print does at 3 inches and 8pt type; it is not what the web does at
16px and 34ch. Text is aligned `start`. `hyphens: auto` is out for the same
reason: an italic deck turns into a hyphen storm. Measure, leading and size do
the readability work — `packages/paper/test/design-contract.test.tsx` fails the
build if a rule reintroduces either.

## Type scale (big titles, small text)

| Element        | Size                              | Notes                          |
| -------------- | --------------------------------- | ------------------------------ |
| Masthead       | `clamp(2.6rem, 7vw, 5.5rem)`      | the biggest thing on the page  |
| Lead headline  | `clamp(1.9rem, 4.4vw, 3.4rem)`    | one story above the fold       |
| Section head   | `1.05rem` uppercase + double rule |                                |
| Story headline | `clamp(1.05rem, 1.7vw, 1.5rem)`   |                                |
| Deck           | `0.95rem`, italic                 | only on lead + section leaders |
| Body / summary | `0.86rem`                         | small, as in print             |
| Byline / meta  | `0.66rem` uppercase, muted        |                                |

## Measure and columns

Readability in print is a **measure** rule: 45–75 characters, ideally 60–66.
That is what "small columns" means, and CSS multi-columns enforce it natively:

| Viewport    | Columns                              | Column width |
| ----------- | ------------------------------------ | ------------ |
| < 640px     | 1 (full measure, `max-width: 34rem`) |              |
| 640–1024px  | 2                                    | ~20rem       |
| 1024–1440px | 3                                    | ~21rem       |
| ≥ 1440px    | 4                                    | ~21rem       |

`column-gap: 1.75rem`, `column-rule: 1px solid var(--rule)`, and
`break-inside: avoid` on every story block — a headline never splits from its
deck, a deck never splits from its summary.

## Rules, not cards

No cards, no shadows, no rounded rectangles, no chips. Structure is **typographic
weight and hairlines**:

- Masthead: `2px` rule above, `4px` below with a `1px` partner (the classic thick/thin pair).
- Dateline strip: uppercase, `0.5px` hairlines above and below.
- Section head: uppercase label with a `1px` rule extending to the column edge, **sticky** — see below.
- Story separators inside a column: `0.5px` hairline, `1.25rem` of air.
- Ornament (`❦`) between the lead and the fold, centred, muted.
- Drop cap (`::first-letter`, 2-line) on the lead deck only.

**The sticky section head, and the paper's one shadow.** A section label is
`position: sticky; top: 0`, so it floats over its own column while the copy
scrolls: three stories down, you still know which section you are in. No JS, no
scroll listener — the grid item is the containing block, so the label stops at
the bottom of its own section. Two consequences are mandatory:

- **The background is opaque** (`var(--paper)`). A label sitting on the words
  scrolling under it is illegible, not transparent.
- It carries **a shadow** — the only shadow in the paper, and it is a **scroll
  edge, not a card**. Without it, the top of a headline row slides up to the
  label's baseline and the two collide into a grey smear. The no-shadow rule is
  about decoration; a shadow that says _"content is passing under this"_ is
  structure, so this is the recorded exception rather than a silent violation.

## The sketch layer: marks a press makes

The paper is allowed marks, as long as each one is a mark a printing press
actually makes, in newsprint, and never a card. The geometry was **read out of
tailwindcss.com's own stylesheet** (CSSOM, 2026-11-09) rather than eyeballed, and
only the palette changed — the ink is the paper's own ink at 10%, the ring is the
hairline, and there is no radius, no fill and no shadow:

| mark               | what it is                                                                            | where it prints                                                              |
| ------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| diagonal crossings | `repeating-linear-gradient(315deg, …1px, transparent 0, transparent 50%)`, 10 px tile | the stock under the sheet (fixed, **never in print**); a non-`ok` health row |
| dot grid           | `radial-gradient(… 1px, transparent 0)`, 10 px tile                                   | inside a panel                                                               |
| guideline          | 1 px inset ring                                                                       | the sheet and every panel                                                    |
| crop marks         | the printer's corner ticks                                                            | the sheet and the lead's figure, **in the waste outside the box**            |

The crossings are the cross-hatch a newspaper prints **where a photograph is
missing**, so a health row that carries them marks an absence — that is what
keeps the layer structural rather than decorative. The sheet is a solid panel of
paper lying on that stock. Rails, "edited", health and onboarding are panels:
ring, dots, padding.

**Every box with a rule is padded.** `--spacing-box` is 1 rem, `--spacing-box-wide`
2 rem from 40 rem. A border with content flush to it is the defect every
hand-written version of this page shipped with, and it is the reason the padding
is a token and a computed test (`apps/web/test/design/boxes.test.tsx` measures a
panel's padding and its inset ring in real Edge) rather than a preference.

**The sheet lies on the stock, so the page has a waste area.** `body` carries
`padding-inline: var(--spacing-gutter)` (0.75 rem at a phone, 2.5 rem at a desk)
and `padding-block: var(--mark-offset)` (7 px), and the sheet is inset by that
air. One rule, two measured reasons. With the sheet full-bleed — `max-w-[104rem]`
= 1 664 px, so the full viewport width below that — its own `bg-paper` covered the
crossings **completely**: visible stock was 0 px² at 390, 620, 1024 and 1440, and
the pattern appeared only past 1 664 CSS px, which is why it showed at 75% zoom on
a 2 560 px screen and nowhere at 100%. The crop marks, drawn 7 px outside the box,
hung 6 px past the viewport's right edge, so every screen had a horizontal
scrollbar (`scrollWidth - clientWidth = 6` at all four widths; deleting the
`cropmarks` utility alone took it to 0). **A mark outside the box needs an
outside-the-box.** Measured now by `pnpm shots` at 1440, 1024, 620 and 390: stock
40 + 40 px, 31 + 31, 19 + 19, 12 + 12, sideways scroll none. In print the whole
layer goes — the crossings, the dots and the ticks (`content: none`) — because a
printed page's waste area is the `@page` margin, and ink is not for texture.

The structural hooks are `data-part` attributes, never class names: the design
suite, the print rules and the SSE flash all query **structure**, and a query
that reads a styling class breaks when the styling does.

## Colour: grayscale on yellowed paper

Light theme is **not** `#ffffff`. Aged-paper stock, because the eye prefers a
warm, low-luminance field over a bright one; dark theme is warm charcoal, not black.

```
LIGHT  --paper: #f4ecd8   (yellowed stock)   --paper-2: #efe5cc  --ink: #1f1b16  --ink-2: #453d31  --muted: #7a705c  --rule: #d8cdb4  --rule-strong: #b9ac90
DARK   --paper: #16150f   (warm charcoal)    --paper-2: #1c1b14  --ink: #e9e4d6  --ink-2: #c3bcab  --muted: #8d8778  --rule: #34322a  --rule-strong: #4a463a
```

No saturated hue anywhere. The only non-gray marks in the paper are

- `inserted text` in an edit diff: **underlined**, and
- `deleted text`: **line-through**, muted —
  which is how print copy-editing marks them, so the diff needs no colour to be legible.

Scraped images are forced to monochrome: `filter: grayscale(1) contrast(1.06) brightness(1.02)`,
with a `0.5px` rule under, italic caption in `--muted`. No image → no placeholder box.
A photograph is **capped and cropped** — the lead's box is `min(15rem, 30vh)`
with `object-fit: cover`, a leader's `11rem` — because a newspaper crops, and a
photo taller than the screen pushes the headline off the fold. The lead's figure
therefore prints **after** the deck, so the first thing above the fold is the
headline; a section leader keeps figure-then-headline, because it is a card in a
column and the lead is the page.

The cap is measured, not asserted (`pnpm shots` prints the lead photo's height
and the headline's box at all three widths). It replaced `height: auto` rather
than joining it: **Tailwind emits `h-auto` after an arbitrary height** (byte
offsets in the built stylesheet), so a class string carrying both is auto-sized,
and the lead photo measured 352 px at 1440×900 with the headline below the fold.
A utility that loses to another utility in source order is invisible in the
markup — the reason the image box's height lives in exactly one place per slot.

## The paper is an index, not a mirror

A story in the paper is a **teaser**, and the paper never renders full text:

- **Headline**, then **one paragraph**: the publisher's deck (`summary`) when the
  source has one, otherwise the first paragraph of the scraped text, truncated
  at a word boundary to 240 characters with a trailing `…`. No "Read more"
  button — there is nothing more to read _here_.
- **The headline is the link**: `target="_blank" rel="noopener noreferrer"`, the
  whole story block clickable, middle-click and copy-link working as usual. The
  publisher keeps the reader.
- **Hero image, optional**: picked from the source (`og:image`, RSS
  `enclosure`/`media:content`, the JSON `image` field). Only the lead story and
  section leaders get one; it is forced to monochrome, with an italic caption in
  `--muted`. **No image, no placeholder box** — an empty div is not a photograph.
- `ItemView` has no `body` field, so this is structural: the full text is never
  sent to the browser. The edit diff shows changes in the teaser fields only.

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
