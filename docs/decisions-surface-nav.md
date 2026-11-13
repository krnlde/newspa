# Decisions — the page's navigation, and its marks

Two rulings about **what the page shows you to navigate by, and what it prints
behind the words**: the spine (D-043) and the marks that may sit under copy
(D-044). Numbering is shared with the other decision files; the surface's own
decisions (the address, the reading list, the one overlay) are in
`decisions-surface.md`, the styling law in `decisions-styling.md`.

## D-043 — The spine: squares over the scrollbar, and the row of squares is a submenu _(implemented 2026-11-13)_

The paper is long — 113 stories in the seed edition, a document 14 600 px deep — and
it had no way to jump to a section. The feature is **the spine**: the sections as
marks on a rail that sits over the scrollbar, fixed, in the sheet's own gutter.

**Every shape below was the reader's ruling, made after reading the live page, and
each one replaced something I had built and defended.** Recorded in the order the
rulings arrived, because the order is the lesson.

1. **Bullets, not labels.** A tablet has no hover and a label is not a tap target, so
   the rail carries position and nothing else. The first build drew a **1px hairline
   tick**: "the thin lines are almost impossible to click". So the visible mark is a
   **5px square of ink** inside a box that is `--spine-tap` (24px, WCAG 2.2's minimum
   target) — and a click at the box's **bottom edge** was verified by real mouse
   events in Edge, not by the markup.
2. **No lines at all.** The rail grew a guideline (`--guide`), a printer's
   registration tick at each end, a hatched reading-progress band and a hatched
   slice-of-screen band. The reader: _"there are some lines following the scrollbar —
   are they just for debugging?"_ and then _"remove all the lines, just keep the
   squares, they look beautiful"_. A mark that makes the reader ask what it is for has
   failed, whatever the intent. So the rail draws **squares and nothing else**, and the
   progress/window machinery is deleted, not commented: the two tokens, the
   `@supports (animation-timeline: scroll())` block, `windowRatio`, the
   `windowFraction` prop, two spans, three parts, four tests.
3. **A place on the rail is one y.** The first build **fanned** colliding marks apart
   by a pitch, so the front page — WORLD, TOP STORIES and POLITICS printed in one row,
   at one document position — drew a **column of three squares** where the page says
   they are at one place. The reader named it: _"they are aligned under each other,
   but in reality they are at the same y-axis position"_. So a **cluster** is a place:
   the sections of one place sit **side by side**, one square each, in a row. Nothing
   is dropped and nothing is faked — `cluster()` is total (every section lands in
   exactly one cluster) and its threshold is the CSS's own square pitch
   (`--spine-pitch`, 7px), read from the page by a test so the two cannot drift.
4. **No menu.** The rail opened a `CONTENTS` panel of titles — the paper's own `panel`
   box, `PANEL_HEAD`, the page's one control, a fragment way out, Esc. The reader's
   ruling: _"when I hover (or click) on the bullets the actual titles appear … No extra
   menu should open. This essentially works as a submenu."_ So the panel is deleted and
   the rail **is** the navigation: expanding a cluster turns its row of squares into a
   **vertical list**, each square keeping its place at the rail's right edge and
   growing its own title to the left, and **the title is the link** that goes to the
   section's position.
5. **The target is the text, not the strip.** The expanded box was `min(14rem, 40vw)`
   wide, so it answered clicks meant for the column under it. The ruling: _"the click
   area should only be as big as the text"_. Expanded, the box is `max-content`, which
   is what `interpolate-size: allow-keywords` lets it animate to. Measured in Edge at
   1440: three titles of 60px, 94px, 67px, every right edge at **1428**, marks **24px**
   apart, and `elementFromPoint` 24px left of a title answers the page.
6. **No hatch on the pressed mark.** The expanded cluster took `--crossing-image`, and
   the stock behind the rail is already the crossings: _"forget the hatching background,
   this is colliding with the already existing hatching"_. The expanded state is carried
   by ink alone.
7. **The scroll stays the browser's.** A 250ms JS glide (`requestAnimationFrame`,
   `pushState` for the fragment) was built for a request, and removed when the reader
   tried it: _"Now there is no animation at all … leave `scroll-behavior: smooth` as
   is."_ The page's own scroll felt like the page; the scripted one did not. **There is
   no scroll-duration number in this repo**, and a reader who wants a faster jump
   changes it in the browser.

### What the spine is made of

- **CSS, where CSS can reach.** The reveal is `:hover` and `:focus-within` (the
  keyboard's and the pen's way in, and the only one a test can drive in a real
  browser — a synthetic event cannot set `:hover`); the animation is a `transform` +
  `inline-size` transition on `--i`, the mark's index in the cluster; the knockout
  behind a title is `--paper`, the stock's own colour; the smooth jump is
  `scroll-behavior` (`base.css`), gated on `prefers-reduced-motion`.
- **JS only where it must.** One `IntersectionObserver` on a band across the top fifth
  of the viewport answers _"which section am I in"_, and one `ResizeObserver` on the
  sections and the document re-measures when heights move. **There is no scroll
  listener in the spine.** The script reads the layout: `--at` is a fraction, so a
  window resize needs no work beyond the rail's own height, which the observer reports.
- **No library.** The npm search for a "scroll spine" finds no package; the two
  maintained React scroll-progress libraries were refused (one is Svelte, the other
  paywalled and Next-only), and `react-intersection-observer` (5 543 stars, 0 deps)
  was refused in favour of the platform: the widget here is one observer over a band,
  which is 20 lines and needs no dependency to keep.
- **No ids invented.** `Section.tsx` already stamps `id="section-<id>"`; the spine
  points at what the page has. `spineSectionsOf` prefixes; nothing else adds an id.

### Measured traps, each one found in real Edge and none visible in the markup

- **The rail must exist before its marks are measured.** `Paper` gated the spine on
  `entries.length ≥ 2`, and the entries need the rail's height: a rail mounted by its
  own ticks measures zero, so every mark piled at the top. Now the **app** decides
  (from `edition.sections.length`), and the component prints what it is given.
- **A `position: fixed` fragment target makes Chromium scroll the document.** Pointing
  a mark at the panel moved the page **92px** as it opened. The fix was to point the
  mark at a span at the sheet's top and show the panel with `:has()`; the panel is gone
  now, and the law is what it says: the spine is an overlay, and an overlay moves
  nothing.
- **A focused element is scrolled into view.** Pressing a square moved the page
  **7px** (`activeElement` was the mark). `scroll-margin-block: 100vh` on the cluster
  makes the fixed mark count as already in view.
- **`:target` is resolved at navigation time.** A hash present **at load** never opens
  a React-rendered box: the element does not exist when the browser chooses its target.
  (Recorded while the panel existed; it is why a reload-with-hash test was written.)
- **The overlay's width is set by measurement, not taste.** `pnpm shots` prints the
  sheet's own gutter: **40px at 1440, 30.7px at 1024, 23px at 768**. A 1.25rem rail
  lives inside it at every width the spine prints at, over the scrollbar, covering no
  rule, no column and no word. Below 640px the paper is one column and the spine is not
  printed at all.
- **No relayout, asserted twice.** `apps/web/test/design/spine.test.tsx` measures
  `[data-part='columns']` with and without the spine (identical to the pixel, `x`
  81 at 1440) and with a cluster open, and compares the document's scroll width with
  and without the rail. The rail's `pointer-events: none` keeps the strip's air from
  stealing a click from a link.

### Lineage, stated so the shape is not mistaken for invention

The design ancestor is the reader's own 2013 plugin,
`github.com/krnlde/jquery.timeline-scroll`. **Its document-proportional mapping is
adopted** (a mark's place is the section's fraction of the document, which is what
`--at` is). **Its collision rule is rejected**: it hides colliding items, which drops a
keyboard target and a section from the page's index — the spine keeps every section and
puts the colliding ones side by side, which is also what the reader ruled. Its
`animate({scrollTop})` and `return false` are rejected (a scripted scroll swallows the
fragment and the back button; the spine's jump is a native anchor). Its `role="menubar"`
is rejected (this is a list of links, not a menubar). **No code is copied** — the plugin
is GPL-3.0 and the spine is MIT.

## D-044 — No mark is printed behind copy: `panel` is the ring and the padding _(implemented 2026-11-13)_

The paper's sketch layer (D-024, `marks.css`) owns three patterns and one recipe each.
The `panel` utility printed the **dot grid** inside every box, and the health strip
printed the **crossings** behind each source row. Both are `--pattern-fg` — **10% of
`--ink`, the same ink the copy is set in** — so behind text a pattern is that text made
noisy, at the text's own colour. The reader ruled it out twice, by screenshot: first
WORLD and TOP STORIES (the front page's rails, three columns of the page's loudest
body copy), then "the same for the Edited and Sources panels", then the sources'
hatching.

- **`panel` is now the ring and the padding, with no field.** One name, one meaning;
  the `panel-bare` utility introduced mid-ruling was folded back in, and `FrontPage`,
  `EditedStrip`, `HealthStrip` and `Onboarding` needed no class change.
- **The crossings stay on the stock, which is the paper's ground**, and on the
  block-head label's own box. The health row's hatch is gone: the absence it named
  ("a cross-hatch where a photograph is missing") is named by what is left — the state
  word, the source's own note, and the hairline between rows. An `ok` source still
  prints no row at all, which was the mark's real job.
- **`pattern-dots` and `pattern-crossings` remain in the vocabulary**, because the marks
  have one recipe and a box with **no copy** may want one. Nothing on this page prints a
  pattern behind words.
- **`apps/web/test/design/boxes.test.tsx` measures it in real Edge**: the body carries
  the crossings, and the rails, "edited" and health carry **no** background field while
  keeping their inset ring and their `--spacing-box` padding. A utility scan
  (`design-contract.test.tsx`) forbids a component writing its own gradient, so the
  pattern cannot be re-introduced behind copy without a test going red.

The rule for the future, in one line: **a mark may frame a box, shade a region, or be
the page's ground — it may not sit behind words.**
