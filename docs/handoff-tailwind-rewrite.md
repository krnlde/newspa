# Handoff — wipe the paper's CSS, finish the Tailwind v4 rewrite

One-shot brief for a fresh agent: this is **WP1 of `docs/roadmap.md`**. When the
slice lands, **delete this file and `docs/handoff-style-table.md`** — a stale
handoff is a lie in the tree. `AGENTS.md` is the law; `docs/state.md` is the
inventory; these two files are the map for this one job.

## 1. Mission

`packages/paper/styles/` holds four hand-written BEM stylesheets (661 lines) and
four Tailwind files. **Delete the four.** Express every one of their rules as
utility classes on the elements in `packages/paper/src/*.tsx`, keep the sketch
vocabulary the reader asked for (§5), pad every box, and fix the lead-order
defect the screenshots exposed (§6).

Definition of done:

- `sheet.css`, `blocks.css`, `front.css`, `stories.css` are gone, and **no BEM
  class name (`foo__bar`, `foo--baz`) survives anywhere in the repo** — check
  with `git grep -nE '[a-z]+__[a-z]+|[a-z]+--[a-z]+'`.
- Every component carries its own class strings; structural hooks are
  `data-part` attributes (§3).
- `pnpm check` is green **including `pnpm test:design`** (it is red at HEAD
  because `apps/web/test/design/` is empty).
- `pnpm shots` renders the front page at 1440×900, 1024×768, 390×844 with the
  lead **headline above the fold**, `justify` counted 0, and the reader has seen
  the images.

## 2. Rules that bind this work (from AGENTS.md; read it)

1 no file over 300 lines, every file type · 2 100% typed, no `any`, no
`@ts-ignore` · 3 no build step for the backend, ESM, relative imports end `.ts`
· 4 `packages/paper` is browser-safe: never `node:*` in its `src` · 5 silent
zeros are bugs · **11** the styling policy: theme in CSS (`@theme`), utilities
on the elements, only the residue in `@layer base`, structural hooks are
`data-part` and never BEM, one typeface with no download, hierarchy from size /
weight / measure, hairlines, grayscale, `--paper: #f4ecd8`, no cards, no
rounded corners, no shadow except `--shadow-scroll`, and **never
`text-align: justify`** · 12 every behaviour gets a test, 95% coverage per
package · 14 a failing test is a report: never weaken one — here the markup
contract changes **on purpose**, so selector updates are legitimate and must be
stated in the commit · 15 Conventional Commits, one behaviour per commit · 16
the floor `pnpm test:fast` stays green, never `--no-verify` · 17 no credential
in git.

Also binding: **no new dependency**; **no `tailwind.config.js`** (v4's config is
CSS); no CDN asset, no font download; `@apply` is allowed **only inside
`packages/paper/styles/*.css`**, never in a component.

## 3. State on disk — verify before you start

Tip is the sketch-layer commit; green at it: **1055 tests** (`pnpm test`,
8.25 s), typecheck clean, lint 0 errors / 10 warnings, every file ≤ 300 lines.
The full inventory is `docs/state.md`. The parts that matter here:

- `packages/paper/styles/`: `paper.css` is the entry — `@import 'tailwindcss'`,
  `tokens.css`, `base.css`, `marks.css`, then **the four BEM files**, then
  `@source` for both packages. `marks.css` is imported and is the sketch
  vocabulary (§5). `tokens.css` is the `@theme` vocabulary plus the dark / print
  / contrast rebinding.
- `--spacing-box: 1rem` and `--spacing-box-wide: 2rem` currently sit in
  `:root` in `tokens.css` and **must move into the `@theme` block** so the
  utilities `p-box` / `pt-box-wide` exist. `marks.css`'s `panel` reads
  `var(--spacing-box)`.
- `packages/paper/src/`: `Paper.tsx` 233 · `Story.tsx` 95 · `HealthStrip.tsx` 76
  · `Section.tsx` 33 · `Masthead.tsx` 28 · `types.ts` · `index.ts`. **Five
  components.** There is no `front.tsx`, `storyItem.tsx` or `editionBar.tsx` —
  those names came from a bad summary and cost a session; this list is the truth.
- `apps/web`: `src/App.tsx` imports `newspa-paper/styles/paper.css` (keep that
  import), `vite.config.ts` has `tailwindcss()`, `vitest.design.config.ts`
  launches real Edge with `include: ['test/design/**/*.test.{ts,tsx}']`, and
  **`apps/web/test/design/` does not exist** → `pnpm test:design` exits 1.
- `packages/paper/test/design-contract.test.tsx` is a text contract over the CSS
  **and** the components (no justify, no absolute leading, one typeface, no
  radius, no shadow outside the ring and the scroll edge, no gradient inside a
  component). It passes at HEAD. Its file list names the four sheets, so **it
  must be updated as they die** — drop the deleted names, keep every rule.
- Not yours: core's `classifyFetch` `304` defect and its `errorKindOf` TLS
  collapse (roadmap WP12), and everything in `docs/roadmap.md`. Do not touch
  `packages/core`, `packages/db`, `packages/fetch`.

## 4. Markup contract: BEM name → `data-part`

Add `data-part` to every element; the hook is what tests, print rules and the
flash query. Keep `data-key`, `data-read`, `data-slot`, `data-state`,
`data-flash` (the app sets `data-flash`).

| component | old                                                                                    | new hook                                                                                          |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Paper     | `.paper`                                                                               | `sheet`                                                                                           |
|           | `.paper__front` `.front__lead`                                                         | `front` `lead`                                                                                    |
|           | `.front__rail--left/right` `.rail__list` `.rail__head`                                 | `rail` (`data-side`) `rail-list` `block-head`                                                     |
|           | `.paper__sections` `.paper__lead` `.paper__ornament`                                   | `sections` `lead-block` `ornament`                                                                |
|           | `.edited` `.edited__head/_row/_headline/_source/_meta/_rule`                           | `edited` `block-head` `edited-row` `headline` `source` `meta` `rule`                              |
|           | `.onboarding` `__title/__lead/__steps/__command`                                       | `onboarding` `onboarding-title` `onboarding-lead` `onboarding-steps` `onboarding-command`         |
| Masthead  | `.masthead` `__top/__dateline/__switch/__name/__tagline/__bottom/__summary`            | `masthead` `dateline-strip` `dateline` `theme-switch` `title` `tagline` `summary-strip` `summary` |
| Section   | `.section` `.section__head` `.section__rule` `.section__blurb` `.section__columns`     | `section` `block-head` `rule` `blurb` `columns`                                                   |
| Story     | `.story` `.story--lead/leader/brief`                                                   | `story` + `data-slot="lead\|leader\|story\|brief"`                                                |
|           | `__figure/__image/__caption/__kicker/__mark/__source/__headline/__link/__deck/__meta`  | `figure` `image` `caption` `kicker` `mark` `source` `headline` `link` `deck` `meta`               |
| Health    | `.health` `.health--well` `__head/__rule/__list/__row/__label/__state/__detail/__line` | `health` (`data-well="true"`) `block-head` `rule` `list` `row` `label` `state` `detail` `line`    |
| EditDiff  | `.diff` `.diff__count`                                                                 | `diff` `count`                                                                                    |

## 5. The style table and the sketch layer

**`docs/handoff-style-table.md`** is the rule-by-rule translation: every
selector in the four sheets, as utilities, with the reason for the three that
look decorative (`bg-paper` on the sticky head, `shadow-scroll`, the image cap).
Read it before touching a component; a rule that is not in it was never in a
sheet, and a rule in it that you drop must be named in the commit message.

The sketch layer is already in `marks.css`, with its geometry **copied** from
tailwindcss.com's live stylesheet (CSSOM, 2026-11-09) rather than eyeballed:

| mark               | their definition                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| diagonal crossings | `repeating-linear-gradient(315deg, var(--pattern-fg) 0, var(--pattern-fg) 1px, transparent 0, transparent 50%)` + `background-size: 10px 10px` |
| dot grid           | `radial-gradient(var(--pattern-fg) 1px, transparent 0)` + `background-size: 10px 10px`                                                         |
| panel outline      | `after:inset-ring` → `box-shadow: inset 0 0 0 1px …`                                                                                           |
| panel padding      | `p-4 sm:p-8` → 1 rem, 2 rem from 40 rem                                                                                                        |
| pattern ink        | `oklab(1 0 0 / .1)` — the foreground at 10%                                                                                                    |

Placement, in newsprint (no blue, no radius, no fill, no shadow): **body** = the
crossings, fixed, and **none in print** (ink); the **sheet** sits on it as a
solid paper panel with a hairline ring and crop marks; **rails, edited, health,
onboarding** = `panel` (ring + dot grid + padding); the **lead's figure** and
the sheet carry `cropmarks`; a **non-`ok` health row** carries
`pattern-crossings`, because a crossing is the mark a newspaper prints where a
photograph is missing — it marks an absence, so it is never decoration. Keep the
docstring in `marks.css` that cites the measurements.

**Boxes are padded** (the reader's second ask): `--spacing-box` /
`--spacing-box-wide` in `@theme`, `panel` on the four blocks, `px-3 py-1.5` on
the theme switch, `p-box` on the onboarding command. Nothing with a border may
have zero padding.

## 6. The lead-order defect, fix it in the rewrite

At 1440×900 the lead's **image prints above its headline**, so the headline
starts below the fold; at 390×844 the photo fills the first screen. `stories.css`
states the intent the component violates ("a lead photo taller than the screen
pushes the headline off the page"). In `Story.tsx`, for the **lead** slot render
`kicker → headline → deck → figure → meta` (the figure moves after the deck) and
cap the lead image at `h-[min(15rem,30vh)]` (was 46 vh). Section leaders keep
`figure → kicker → headline`: a leader is a card in a column, the lead is the
page. Verify with `pnpm shots` that the lead headline is on the first screen at
all three widths, and report the `lead headline` size line it prints.

## 7. Tests

- 77 selector dependencies exist in 8 files: `packages/paper/test/
  {editdiff,front,health,masthead,paper,section,story}.test.tsx` (5–24 each) and
  `apps/web/test/unit/app.test.tsx` (16). Replace `.foo__bar` with
  `[data-part='bar']`; keep every assertion's **strength** (rule 14): same
  counts, same order, same text, same aria. Never convert a real assertion into
  `expect(true)`, never delete a case, never add `skip`.
- `packages/paper/test/design-contract.test.tsx` **shrinks** as the sheets die
  (drop the deleted files from its list) and keeps every ban.
- Add real computed assertions in `apps/web/test/design/design-contract.test.tsx`
  (real Edge, wired by `apps/web/vitest.design.config.ts`): never `justify` on
  any element at 1440/1024/390; the front is 3 columns at 1440 (lead column
  wider than a rail) and 1 column at 900; `block-head` computes `position:
  sticky` with an opaque background; a panel computes padding ≥ 16 px and an
  inset `box-shadow`; `body` computes a `repeating-linear-gradient` and a panel
  a `radial-gradient`; the lead headline's `bottom` is above the fold at 1440.
  That makes `pnpm test:design` green for the first time — the whole point.
- `apps/web/vitest.design.config.ts` sets `viewport: {width:1280,height:900}`;
  the suite must drive widths itself (`viewport: null`, and if you shim
  `matchMedia` for media queries, say so in the docstring: a shim is a shim).
- Coverage: keep the semantics of `packages/paper/vitest.coverage.ts` (a CSS
  assertion raises no line, so the contract file stays excluded) and keep the 95%
  gate green — components are markup, so the structural tests carry it.

## 8. Verify, and paste real output

```
pnpm format && pnpm lint          # expect: 0 errors (10 warnings is the ceiling)
pnpm lines                        # expect: all <= 300 lines
pnpm typecheck                    # expect: clean
pnpm test:fast                    # expect: 818 pass (counts may rise; none may vanish)
pnpm test                         # expect: 1055 pass (was 1055 at HEAD)
pnpm test:design                  # expect: green (was red at HEAD)
pnpm coverage                     # per package, >= 95 on every metric
pnpm --filter newspa-web run build
pnpm --filter newspa-web run seed
node scripts/screenshot-paper.mjs # NEWSPA_SHOT_URL if 5173 is taken
git grep -nE '[a-z]+__[a-z]+|[a-z]+--[a-z]+'   # expect: no hits
```

`NO_COLOR=1` when you capture a vitest run: the ANSI frames make the failure
unreadable in a log file, which costs a full round trip.

## 9. Environment traps (each cost a session already)

- Dev loop: `pnpm --filter newspa-web run seed` then dev. **Port 5173 is often
  held by a stale dev server** that answers `index.html` for API paths, and
  `netstat` may not show a listener. Run `vite --port 5199` and set
  `NEWSPA_SHOT_URL=http://localhost:5199/` for the shots.
- `pnpm coverage` must run per package; a root `vitest run --coverage` prints a
  confident 0% and gates nothing.
- The in-app browser is ~620 px wide: it always shows the phone stack. Use
  `pnpm shots` for desktop truth.
- The portable shell scanner rejects commands containing `{` / regex braces;
  multi-statement git blocks swallow output — one command per call, and never a
  backtick inside a double-quoted PowerShell commit message.
- `scripts/*.mjs` and any `.mjs`: **no type annotations** (Node strips types
  from `.ts` only). A `as string` in a `.mjs` is a syntax error at run time.
- happy-dom replaces the global `URL`: file scans need `fileURLToPath(new NodeUrl(…))`.
- The `read` tool prefixes lines with `N: ` — an edit `oldString` copied from it
  is one space too wide. Use single-line `oldString`s on CRLF files, and
  re-count parentheses after an edit: a stray `)` in a `.tsx` is a parse error
  that vitest reports as a suite failure with 0 failing tests.
- `pnpm install` needs no network for these deps; the age gate is
  `minimumReleaseAge: 2880` minutes (2 days) and exact pins are the rule.

## 10. Fences — read this, it is why a session was destroyed

A worker in this repo ran `git clean -fd` + `git checkout` while its briefing
said "run no git commands", and a human commits in the same working copy.
Untracked work was deleted and tracked files reverted under it; only committed
work survived.

- **Run no git write commands at all.** No `git add`, `commit`, `stash`,
  `checkout`, `restore`, `clean`, `rm`. Read-only `git status` / `git log` /
  `git grep` / `git show` are fine.
- Do not delete files. Deleting the four stylesheets is the **owner's** job —
  ask, and the owner runs `git rm`.
- Stay inside your file list. If a file outside it blocks you, **stop and
  report**; do not "fix" it.
- Report at the end: files touched with line counts, the verification output
  verbatim, what you did not do and why, and one line confirming you ran no git
  write commands.

## 11. Suggested commit sequence (the owner commits, Conventional Commits)

1. `refactor(paper): the story block is utilities, and the lead's headline leads`
   (`Story.tsx`, `EditDiff`, the image cap; `stories.css` deleted by the owner).
2. `refactor(paper): sections, rails, masthead, health and onboarding become utilities`
   (the last three sheets deleted by the owner).
3. `test(paper): the structural hooks are data-part, and the design contract is computed in Edge`
   (the 8 selector rewrites, `apps/web/test/design/**`, `pnpm test:design` green).
4. `docs: the styling policy is Tailwind v4 end to end` (fix any BEM name left in
   `docs/design.md`, delete both handoff files).

Then take the next package from `docs/roadmap.md`.
