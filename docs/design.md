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

## The one overlay: a modal, and a native one

The page has exactly one overlay: the sources editor (`SourcesModal`, WP14). It is a
native `<dialog>` opened with `showModal()`, because the top layer, Esc and the tab loop
are the browser's, and a `div` with a state flag re-implements each of them badly —
`z-index` is a ladder somebody loses, and a fake modal traps nothing.

What the existing law requires of it, spelled out because a modal is the one place a
designer is tempted to break it:

- **No shadow.** The page casts one shadow, the scroll edge. The dialog has a hairline,
  and what dims the paper behind it is a **scrim**: `::backdrop` is a flat wash of
  `--ink-2` at 62%, not a drop shadow. A modal that floats on a shadow is a card, and
  this paper has no cards.
- **No radius, one typeface, `p-box` padding** — the same rules as every box with a rule.
- **Two ways out**: Esc and the close control, both reported through the dialog's native
  `close` event, which is also how the app learns the reader left. The scrim is **not** a
  third: a mouse-only target on a non-interactive element has no keyboard route, and a
  way out only a mouse finds is not an affordance.
- **The head owns the label.** The modal prints the block label, the rule to the edge, and
  the close control on one line; the panel inside prints no label of its own and carries
  no `panel` class. A ringed, dotted box inside a bordered box is two boxes — measured in
  Edge, where the dot grid printed inside the dialog and read as a frame within a frame.
- **It is the sheet's opposite.** The sheet is the page's one panel of newsprint, so a
  form — a row per source, a textarea of JSON, the absolute path of the watchlist
  directory — does not belong on it. The entry is one control in the dateline strip,
  beside the theme switch, in the same `CONTROL` vocabulary as every other control; and
  the modal **unmounts** when it closes, so the page keeps no hidden form, nothing is
  tabbable that cannot be seen, and the sheet's part list stays the paper's.

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

## The rest of the law

The front page’s grid (what is big, and where a story prints), the behaviour of
a live page (links, theme, the flash, focus, contrast) and what `@media print`
takes away are in **`docs/design-page.md`**. Same law, two files: rule 1 caps a
file at 300 lines, and the split is by responsibility — type and marks here,
composition and output there.
