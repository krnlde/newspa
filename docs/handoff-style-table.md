# Handoff — the style table (WP1)

Every rule in the four BEM sheets, translated to utilities. This is the
mechanical half of `docs/handoff-tailwind-rewrite.md`: the markup contract, the
sketch layer, the tests and the fences are there; the translation is here.

Tokens that exist in `tokens.css` (so their utilities exist): colours `paper
paper-2 ink ink-2 muted rule rule-strong`; `font-paper`; `leading-display|
read|meta`; type `text-kicker|small|note|deck|deck-lead|section|brief|title|
headline|leader|lead|masthead`; `tracking-kicker|display`; spacing
`spacing-gutter|measure|column`; `shadow-scroll`. From `marks.css`:
`pattern-crossings`, `pattern-dots`, `panel`, `guide-frame`, `cropmarks`, and
`--spacing-box` / `--spacing-box-wide` (which must move from `:root` into
`@theme` to become `p-box` / `pt-box-wide`).

A hairline border is `border-b border-b-[length:var(--hair)] border-b-rule` —
the length must come from the token, because `prefers-contrast: more` thickens
`--hair` to 1 px and the rule must thicken with it.

## The sheet and the masthead

**sheet** `mx-auto max-w-[104rem] px-gutter pt-box pb-16 min-[40rem]:pt-box-wide
bg-paper guide-frame cropmarks relative`
**masthead** `pt-3 pb-2 border-t-2 border-t-ink text-center` ·
`dateline-strip` `flex justify-between items-baseline gap-4 pb-[0.4rem] border-b
border-b-[length:var(--hair)] border-b-rule` · `dateline` `m-0 text-kicker
font-bold tracking-kicker uppercase text-muted` · `theme-switch` `font-[inherit]
text-kicker font-bold tracking-kicker uppercase text-ink-2 bg-transparent border
border-[length:var(--hair)] border-rule-strong px-3 py-1.5 cursor-pointer
hover:border-ink hover:text-ink` · `title` `mt-[0.35rem] mb-[0.15rem]
text-masthead font-bold leading-[1.03] tracking-display text-balance` ·
`tagline` `m-0 text-small italic text-ink-2` · `summary-strip` `mt-[0.6rem]
pt-[0.35rem] border-t-4 border-t-ink border-b border-b-ink` · `summary` `m-0
py-[0.15rem] text-kicker font-bold tracking-kicker uppercase text-muted`

## The front page

**front** `grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1fr)]
items-start gap-x-measure pt-3 max-[900px]:grid-cols-1 max-[900px]:gap-y-6` ·
`lead` `pt-6 pb-2 max-w-[46rem] mx-auto border-x border-x-[length:var(--hair)]
border-x-rule px-measure max-[900px]:border-x-0 max-[900px]:border-y
max-[900px]:px-0` · `rail` `panel pt-[0.35rem]` · `rail-list` `m-0 p-0
list-none` and its `[data-part=story]` `py-[0.6rem] border-t
border-t-[length:var(--hair)] border-t-rule first:border-t-0 first:pt-[0.15rem]`
· `sections` `grid gap-8 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] pt-4
max-[639px]:grid-cols-1` · `ornament` `my-[1.25rem] mb-2 text-center
text-[1.1rem] text-muted`

**block-head** (sections and rails) `sticky top-0 z-[2] flex items-center
gap-[0.6rem] mb-2 text-section font-bold leading-meta tracking-kicker uppercase
bg-paper pt-[0.35rem] pb-[0.4rem] border-b border-b-[length:var(--hair)]
border-b-rule shadow-scroll` · `rule` `flex-1 h-px bg-ink` · `blurb` `mb-3
text-deck leading-read italic text-ink-2` · `columns` `gap-x-measure
[column-rule:1px_solid_var(--rule)] columns-[20rem] max-[639px]:columns-1
max-[639px]:max-w-[34rem] min-[1440px]:columns-[21rem]`

The `bg-paper` on `block-head` is not decoration: a sticky label over a scrolling
column needs an opaque background, and `shadow-scroll` is the paper's only
shadow (docs/design.md).

## The story

**story** `relative break-inside-avoid pb-5 mb-5 border-b
border-b-[length:var(--hair)] border-b-rule last:border-b-0 last:mb-0` ·
`kicker` `flex items-baseline gap-[0.45rem] mb-[0.2rem] text-kicker font-bold
tracking-kicker uppercase text-ink-2` · `mark` `before:content-['●']
before:text-[0.6em] before:tracking-normal` · `source` `ms-auto text-muted
font-normal` · `headline` `mb-1 font-extrabold leading-display tracking-display
text-balance break-after-avoid` + by slot `text-lead|text-leader|text-headline|
text-brief` · `link` `after:content-[''] after:absolute after:inset-0` (the
whole-block click, no CSS file) · `deck` `mb-[0.3rem] text-deck leading-read
text-ink-2 text-pretty [orphans:2] [widows:2]`; lead and leader add
`text-deck-lead italic`; lead adds `first-letter:float-left
first-letter:text-[3.1em] first-letter:font-bold first-letter:leading-[0.85]
first-letter:pr-[0.08em] first-letter:mt-[0.04em]` · `meta` `m-0 text-kicker
font-bold tracking-kicker leading-meta uppercase text-muted` · `figure` `mb-[0.6rem]
cropmarks` · `image` `block w-full h-auto grayscale contrast-[1.06]
brightness-[1.02] border-b border-b-[length:var(--hair)]
border-b-rule-strong`; lead `h-[min(15rem,30vh)] object-cover object-[50%_25%]`;
leader `h-44 object-cover object-[50%_30%]` · `caption` `pt-[0.2rem] text-kicker
italic text-muted`

The lead image cap is the fix for the fold defect (`h-[min(15rem,30vh)]`, was 46
vh): a lead photo taller than the screen pushes the headline off the page, which
is what `stories.css` says and what `Story.tsx` did not do. See
`docs/handoff-tailwind-rewrite.md` §7 for the order.

## The blocks

**edited** `mt-10 panel` · `block-head` `flex items-center gap-[0.6rem] mb-3
text-section font-bold tracking-kicker uppercase` · `edited-row` `py-3 border-b
border-b-[length:var(--hair)] border-b-rule break-inside-avoid` · `headline`
`flex flex-wrap items-baseline gap-2 m-0 text-section font-bold leading-[1.15]
break-after-avoid` and its `a` `underline decoration-[length:var(--hair)]
underline-offset-[0.15em]` · `source` `m-0 text-kicker font-bold
tracking-kicker uppercase text-muted` · `meta` same with `font-normal`
**health** `mt-10 panel text-small` · `block-head` `flex items-center
gap-[0.6rem] mb-2 text-small font-bold tracking-kicker uppercase` · `list` `m-0
p-0 list-none` · `row` `flex flex-wrap gap-2 py-[0.3rem] border-b
border-b-[length:var(--hair)] border-b-rule pattern-crossings` (every row here
is a non-`ok` state: the crossings are the absence mark) · `label` `font-bold
text-ink` · `state` `font-bold tracking-kicker uppercase text-kicker
text-ink-2` · `detail` `text-muted` · `line` (the well line) `m-0 text-muted`
**onboarding** `mt-8 max-w-[34rem] panel` · `onboarding-title` `mb-2 text-title
leading-[1.1] font-bold` · `onboarding-lead` `mb-4 text-deck italic text-ink-2`
· `onboarding-steps` `mb-4 ps-5 text-note` · `onboarding-command` `m-0 p-box
border border-[length:var(--hair)] border-rule-strong bg-paper-2 font-paper
text-[0.8rem] whitespace-pre-wrap`
**diff** `mt-[0.2rem] text-note leading-read text-ink-2` · `count` `block mb-1
text-kicker font-bold tracking-kicker uppercase text-muted`

## What does not survive

Anything a utility cannot express and the paper does not want: the BEM selectors
themselves, `@layer`-free element selectors over the sheets' own tree, and every
`--lh-*` / `--font` / `--measure-gap` reference (the tokens are `--leading-*` /
`--font-paper` / `--measure`, and a dangling `var()` is invalid at
computed-value time — the declaration silently inherits, which is how a rename
becomes invisible breakage; the design contract now fails on it).
