# Decisions — tooling

Tooling, dependency, testing, i18n and paper-shape: the dependency list,
`playwright-core`, `node:sqlite`, Biome and TypeScript, the test layers and the
coverage gate, git hooks, i18next, and the reader-facing knobs of the paper.

Pipeline, data, identity and behaviour decisions live in `decisions.md`.

## D-003 — `playwright-core` + `channel: 'msedge'`, never `playwright`

Moved to **docs/tooling.md** (with D-004 and D-016): all three are dependency
decisions, and this file has a 300-line cap. Short form: `playwright` downloads a
~300 MB browser at install; `playwright-core` drives the Edge that is already
here.

## D-004 — `node:sqlite` (built-in), not `better-sqlite3`

Moved to **docs/tooling.md**. Short form: Node 26 ships SQLite 3.54.0 with FTS5,
WAL and ASCII-insensitive `LIKE`; `better-sqlite3` is a native addon, which on
Windows means node-gyp, Build Tools and Python.

## D-015 — Two test layers, and coverage 95 as a gate

Moved to **docs/testing.md**, which is where the layers are documented. Short
form: `happy-dom` for fast component/hook/lib tests inside the v8 coverage run
(thresholds 95, `all: true`); Vitest browser mode via `playwright-core` +
`channel: 'msedge'` asserts the visual contract on real computed CSS, and is
excluded from coverage because it asserts CSS, not code paths.

## D-016 — New dependencies (the complete list, with reasons)

Moved to **docs/tooling.md**, next to the catalog. Short form: `zod`, `cheerio`,
`fast-xml-parser`, `playwright-core` (+ `playwright` as a browser peer, with no
browser downloaded), `react`/`react-dom`/`react-router`,
`@tanstack/react-query`, `vite` + `@vitejs/plugin-react`, the `vitest` family,
`i18next`/`react-i18next`, `husky` (git hooks, the pre-commit gate, D-022).
Removed before the first commit: `tailwindcss` (the
design contract is one plain CSS file) and the ESLint stack (Biome, D-018).

## D-017 — The paper is an index, not a mirror

A story in the paper is a **teaser**: headline, one paragraph, hero image when
the source has one, and a link that opens the publisher's page in a new tab
(`target="_blank" rel="noopener noreferrer"`).

Enforced structurally, not by discipline: `ItemView` in `core/src/api.ts` has no
`body` field, so the browser cannot render full text even if a component is
written carelessly. `packages/core/test/api.test.ts` asserts that absence,
because a guarantee with no test is a comment. Scraped `body` text is capped at
`BODY_MAX_CHARS` (1 200) in the database and used only for stealth-edit
detection and scoring; the edit diff the paper shows is computed over the
teaser fields, so the diff cannot leak the article.

Why: the publisher keeps the reader, the traffic and the ads; a local full-text
mirror is a copying problem and a worse reading experience than the publisher's
own page; and diffing/storing 40 full articles per cycle is synchronous work on
the event loop that also drives the scheduler, plus a database that grows
without bound.

**Reverse if:** the intended use becomes offline deep reading of a source that
permits it (a personal newsletter, an RSS feed that ships full text). Then
full-text rendering is a per-source opt-in (`showFullText`), with the feed's own
terms as the gate.

## D-018 - Biome for lint + format; exact versions; TypeScript 7

Moved to **docs/tooling.md** - this file crossed the 300-line cap, and the decision is a tooling decision, so that is where it belongs. Short form: Biome 2.6.6 for lint and format (no ESLint, no Prettier) with `suspicious/noExplicitAny: error`; TypeScript 7.0.2 pinned as the **checker only** (Node 26 strips types at runtime); exact versions, no carets; `complexity/useLiteralKeys` off because tsc's `noPropertyAccessFromIndexSignature` requires the bracket form that rule forbids.

## D-019 — i18next from the start; `Intl` does every format

The paper is almost entirely third-party text — headlines and teasers come from
publishers, in the publisher's language — so translating it looks pointless.
It is not, and the argument is the chrome: navigation, the health strip
("blocked", "no matches since Tuesday"), the source editor, onboarding, search
labels, "3 min ago", the dateline, the masthead. That is ~40 strings, it is the
part the tool speaks in its own voice, and translating it after the fact means
touching every component that was written to assume English. i18next
(`i18next` + `react-i18next`, pinned in the catalog) is in from the first
component.

The rule that makes it real, and the part that is easy to get wrong:

- **No locale-locked formatting anywhere below the UI.** `packages/core` returns
  _parts_ — `relativeParts()` gives `{ unit, delta, at }`, `editionDate()` gives
  a `Date` — and the web app renders them with native `Intl.RelativeTimeFormat`,
  `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.PluralRules`. Core has no
  `toLocaleDateString` and no English phrase templates; `packages/core/test/index.test.ts`
  bans the removed formatters by name, so the boundary cannot quietly erode.
- **The adapters listen to i18next's `language`.** One hook
  (`useLocale()`) builds memoised formatters for the active language and rebuilds
  them on `languageChanged`; every date, time, relative label and count in the
  app comes from it. A formatter built once at module load is the bug this rule
  exists to prevent: it silently freezes the language at first render.
- **Detection is five lines, not a dependency.** `localStorage` →
  `navigator.language` → `en`; no `i18next-browser-languagedetector`. The
  switcher writes `localStorage` and `<html lang>`/`dir`, so the browser's own
  hyphenation and font shaping follow the paper.
- **Locale files are UI chrome only.** No story text, ever: the story text stays
  in the publisher's language, because translating a headline is editing it.

**Reverse if:** the tool is only ever used in one language and the chrome strings
stay under ten - then the init, one namespace and the switcher are ~120 lines
that earn nothing, and deleting them is the honest move. The `Intl` half of this
decision is not reversible: it is how dates are formatted on the modern web.

## D-021 - Sections and importance are the reader's two knobs

A source file answers two questions the paper cannot infer: **where this prints**
(`section: "Iran"`) and **how loud it is** (`weight: 0..5`). A declared section
wins over the keyword ladder, which stays for the 40 unlabelled sources, and the
label prints verbatim — what the reader typed is data, not chrome (D-019). `weight`
is +2 a point against tiers at 12 / 8 / 4.5: 5 takes the title page, 0 never
reaches the front page, and the lead is the edition's top score.

**Cost accepted:** a `weight: 5` source takes the lead from genuine breaking news,
every day, by design — the fix is a weight change, not a code change. **Reverse
if:** the front page is the same source every day; then the lead needs a
per-edition diversity rule.

## D-022 - Git hooks via husky; activation is a command, not a lifecycle script

The gate before a commit is `.husky/pre-commit`, a file in git, reviewed like code, driven by
`husky` 9.1.7, pinned in the `pnpm-workspace.yaml` catalog. Its newest release is 9.1.7, published
2024-11-18 — the project is dormant (~2 years, no v10, no beta). Accepted on the shape of the
dependency: husky v9 is a ~30-line shim with **zero dependencies and zero install scripts**, so a
dormant husky cannot become a supply-chain problem. Verified at install: `pnpm install` added
exactly 1 package and reported no build-script violation under `strictDepBuilds: true` / `allowBuilds: {}`.

What the gate runs, measured 2026-11-09 on this tree: `pnpm exec biome check --staged` 1.1 s ·
`node scripts/check-file-length.mjs` 0.1 s · `node scripts/generate-schemas.mjs check` 0.2 s ·
`pnpm typecheck` 1.9 s (TypeScript 7 native, D-018) · `pnpm test` 6.0 s (78 files) = **9.3 s total**.

- **`set -e` is load-bearing.** husky runs the hook with `sh`; without it every command runs and only
  the **last** exit code decides, so a Biome failure followed by a passing file-length scan commits anyway.
- **Warnings are not promoted to errors.** The tree carries 10 pre-existing warnings:
  `noExcessiveCognitiveComplexity` in core's `cadenceCron.ts`, `diff.ts`, `health.ts`, `signals.ts`;
  `noImportantStyles` in `sheet.css`; one `noDescendingSpecificity`. A `--error-on-warnings` hook blocks
  any commit touching those files and teaches people to type `--no-verify`.
- **`pnpm check` is deliberately excluded.** That chain ends in `pnpm test:design`, and the real-Edge
  design suite under `apps/web/test/design` is not written yet, so `pnpm check` exits 1 at HEAD
  (measured: 16.6 s, exit 1). An always-red hook is a bypassed hook; `check` stays the gate before
  declaring work done.

The finding that matters, and the reason this entry exists: husky activates from a `prepare`
lifecycle script, and this workspace sets `ignoreScripts: true` (rule 8), which suppresses it.
Measured: `pnpm install` created no `.husky/_` and left `core.hooksPath` empty, while
`pnpm exec husky` set it to `.husky/_`. A fresh clone therefore has a hook file in git that
**never runs** — a silent zero, which rule 5 bans. The fix is not to weaken the supply-chain rule:
activation is the explicit command `pnpm hooks:install`, and `scripts/check-hooks.mjs` fails
`pnpm check` while `core.hooksPath` is not `.husky/_`.

Verified, not assumed: a staged file needing formatting produced `husky - pre-commit script failed
(code 1)`, exit 1, and no commit created. Note the diagnostic shape — a formatting failure exits
`biome check` with **no lint rule name in the output**, which is why the hook runs `check`, not `lint`.

## D-023 - The credential is your browser; nothing in git authenticates anything

The repository is public, so the posture is written down as rule 17: **no credential in git, ever.**
Two properties make that livable rather than ascetic:

- **The fetcher uses your browser.** `pnpm login -- <url>` opens a persistent Edge profile at
  `profiles/<id>` (D-003), and a `render: true` source polls through that profile. The publisher
  sees the session you already have; the paper stores no password. A profile directory is plaintext
  cookies on disk — your filesystem's concern, never the repository's.
- **The state store needs no authentication.** `node:sqlite` (D-004), a file under `data/`. No user,
  no password, no listening port, so there is nothing to steal and nothing to rotate.

Both directories are gitignored, and the source schema ships with **no `cookies` field** by design:
a config file in git is the worst possible place for a session cookie.

What stayed open was `headers: z.record(z.string(), z.string())` on a committed source spec. A
Bearer token in an `Authorization` entry parses cleanly and validates against the published JSON
Schema, so a live credential commits **silently**. The field is kept — the fetch contract needs
non-secret pinned headers for A/B variants, `Accept` and `User-Agent` (D-006, D-020) — and policed
instead: `scripts/check-secrets.mjs` (measured 0.13 s over 237 tracked files) fails the build on
token shapes: AWS, GitHub, GitLab, Slack, Google, OpenAI, `sk_live_`/`rk_live_`, private-key blocks,
basic-auth URLs, `Authorization`/`Cookie` headers, Bearer tokens.

- **Public-by-design values warn, they do not fail.** A Stripe `pk_live_` key is served to every
  visitor's browser; failing on it is a false alarm, and a gate that cries wolf gets bypassed. The
  secret half, `sk_live_`, is what fails.
- **`**/fixtures/**` is exempt**, for the reason rule 1 exempts it: a captured payload is
  byte-for-byte evidence of what a site actually sent, and editing one to satisfy a scanner destroys
  the only proof the parser handles it. Scanning the whole pushed history (40 commits, 264 paths)
  found exactly that shape: CNN's own publishable key and the jwt.io example header inside
  `html-cnn-lite.html`. No user credential is in the history.
- **A public commit is public forever, including after a squash.** The raw CDN keeps serving cached
  bodies, and anyone who cloned already has the object. Rotate; do not rewrite away.
