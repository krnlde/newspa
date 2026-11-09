# AGENTS.md — project rules for future sessions

Read this before editing. These are hard rules, not preferences. Run `pnpm check`
before declaring work done.

## What this project is

A personal newspaper. It fetches RSS feeds, HTML pages and JSON endpoints on a
cadence, diffs each result against the cached baseline in SQLite, scores items
deterministically, and renders the changes as an ever-changing page that looks
like a newspaper at `http://127.0.0.1:8787`. Single process, started by hand. Huginn's agent graph is
deliberately **not** reimplemented: the pipeline is hard-coded
(`fetch → parse → normalize → diff → score → publish`).

## Hard rules

1. **No file over 300 lines — any file, including markdown, JSON, YAML, CSS and
   scripts.** Enforced by `pnpm check` → `scripts/check-file-length.mjs`, which
   counts every file. Exemptions are only generated/fetched payloads
   (`pnpm-lock.yaml`, `**/fixtures/**`, binaries) and are listed in that script.
   If a file approaches the cap, split it by responsibility; if a doc does, split
   the doc.
2. **100% typed. No `any`, no `as any`, no `@ts-ignore`, `@ts-expect-error`,
   `@ts-nocheck`.** Biome's `suspicious/noExplicitAny` is `error` (`biome.json`).
   Use `unknown` at boundaries and narrow; a cast to a named type from `unknown`
   is allowed at I/O edges. `tsconfig.base.json` is maximal: `strict`,
   `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noUnusedLocals`,
   `noUnusedParameters`, `noImplicitReturns`, `erasableSyntaxOnly`.
3. **No build step for the backend.** Node 26 runs `.ts` directly
   (`node packages/server/src/cli.ts`). Consequences: ESM only, relative imports
   **must include the `.ts` extension**, no `enum`/`namespace`/parameter
   properties (erasable syntax only), and no `require()`.
4. **`packages/core` and `packages/paper` are browser-safe.** Never import `node:*`
   from them: the web app imports the same types, scoring, diff and components.
   Put I/O in `db`, `fetch`, `server`.
5. **Silent zeros are bugs.** A source that matches nothing, is blocked, or
   changed shape must produce a `HealthState` that reaches the paper. Never
   `catch { return [] }`, never swallow a fetch failure into "no news".
6. **Policies, not guesses** (see docs/tooling.md): exact link identity,
   fragment-stripped canonical URLs, conditional GET as an optimization only
   (BBC returns 200 + full body for a valid `If-None-Match`), diff the normalized
   item set — never raw HTML (A/B variants), `render: true` is a pick-time decision.
   Change detection is a ladder — `304` → body hash → declared timestamp → full
   parse — and **a cheap signal may skip work, never suppress an item**; every
   poll's `outcome` and the per-source fast-path counters are recorded, because
   an optimization that never fires is invisible (docs/fetching.md).
7. **The paper is an index, not a mirror.** Show a teaser (headline + one
   paragraph) and link out (`target="_blank"`). `ItemView` has no `body` field —
   full text is never sent to the browser. Scraped body is capped and used only
   for edit detection and scoring.
8. **Dependencies**: `pnpm-workspace.yaml` catalog only, **exact versions — no
   carets, no `latest`** (`saveExact: true`). No native modules (no node-gyp), no
   install scripts, `playwright-core` + `channel: 'msedge'` (never `playwright`
   for launching), `node:sqlite` (never `better-sqlite3`). Advance versions with
   an explicit `pnpm update`; the 2-day `minimumReleaseAge` gate is the point,
   not an obstacle.
9. **pnpm config lives in `pnpm-workspace.yaml`**, not `.npmrc` (pnpm 12 reads
   only auth/registry/TLS/proxy from `.npmrc`).
10. **Lint and format are Biome** (`biome.json`, `pnpm lint`, `pnpm format`).
    No ESLint, no Prettier. Formatting is not a debate: run `pnpm format`.
11. **Paper visuals follow docs/design.md**: one typeface, columns by measure,
    hairline rules, grayscale, `--paper: #f4ecd8` in light mode. Plain CSS in
    `packages/paper/styles` (no Tailwind, no CDN assets), no cards, no shadows,
    no rounded rectangles, no saturated colour.
12. **Every behaviour gets a test** in the package that owns it (Vitest, 95%
    coverage gate). Parser changes need a fixture under
    `packages/fetch/test/fixtures/`.
13. **i18n is a boundary, not a feature** (D-019). Locales cover UI chrome only
    — story text is the publisher's language, never translated. `packages/core`
    ships **locale-free parts** (`relativeParts`, `editionDate`); finished
    strings and `toLocale*` calls live in `apps/web` and go through native
    `Intl`. Every formatter is built from, and rebuilt on, i18next's `language`
    (`useLocale()`); a formatter created at module load is a frozen language and
    a bug. The core barrel bans the removed locale-locked formatters by name.
14. **A failing test is a report, not a verdict** — never "fix" it by making it
    pass. Tests here are largely LLM-generated, so a failure is equally likely
    to mean a wrong assertion, a wrong expectation about intended behaviour, or
    a real bug: read the code under test, decide which of the three it is, and
    **raise it with the user** unless you are confident the defect is in the
    test (then fix the test and say so in the commit); never edit `src` to
    satisfy an assertion you do not understand, and never weaken a test to
    green a build.
15. **Commits use Conventional Commits**: `feat:`, `fix:`, `docs:`, `test:`,
    `refactor:`, `chore:`, `build:`, `ci:` — scope is the package
    (`feat(fetch): …`). One commit per behaviour change; the log is the changelog.
16. **The pre-commit gate is a floor, and activating it is a command.**
    `.husky/pre-commit` runs `biome check --staged`, the 300-line scan, the secret
    scan, `schemas:check`, `pnpm typecheck` and `pnpm test:fast` — the four fast
    projects, core/db/web/fetch, no browser project (whole hook: 10.8 s) —
    under `set -e` — without it husky runs every command and only the **last**
    exit code decides, so a lint failure commits anyway. It never runs
    `pnpm check`: minutes (per-package coverage, the Edge browser projects, the
    audit), and it ends in `pnpm test:design`, which is red at HEAD —
    `apps/web/test/design/**` holds no tests yet — and an always-red hook is a hook
    that gets bypassed. The browser projects stay out of the floor for the same
    reason: a hook that needs Edge installed cannot pass on every machine.
    Warnings are allowed (the tree carries 10); promoting them to errors teaches
    `--no-verify`. Husky activates from a `prepare` script, and `ignoreScripts:
    true` (rule 8) suppresses that — measured — so **a fresh clone has no hook**
    until `pnpm hooks:install`. `pnpm check` fails while the hook is inactive
    (`scripts/check-hooks.mjs`): an unguarded checkout must not look set up.
17. **No credential in git, ever.** The reader authenticates with **your own
    browser**: `pnpm login -- <url>` writes a persistent Edge profile under
    `profiles/`, and the state store is a `node:sqlite` file under `data/` that
    needs no authentication at all. Both are gitignored, and nothing in the repo
    can authenticate anything to anyone. Hence: `sources/*.json` has no `cookies`
    field by design, `scripts/check-secrets.mjs` fails the build when a tracked
    file holds a token shape, and `**/fixtures/**` is exempt for the same reason
    rule 1 exempts it — a captured payload edited to satisfy a scanner stops
    proving the parser handles the real site. A value that reaches a public
    commit is public **forever, including after a squash** — rotate it.

## Layout

```
apps/web          Vite + React SPA (the paper). Only build step here.
packages/core     Types, record schema, API contract, normalize, diff, score, health, teaser. No I/O.
packages/paper    React newspaper components + the paper CSS (browser-safe, used by the app)
packages/config   zod source/app schemas + file loading + watchlist/OPML (sources/*.json is truth)
packages/db       node:sqlite, schema, migrations, repositories, FTS5 search
packages/fetch    http, rss, html, json, render (msedge), pick (headed picker), fixtures
packages/server   CLI (start/pick/login/status/search/export/import), scheduler, pipeline, SSE, static, toasts
sources/*.json    Source definitions in git. data/ and profiles/ are gitignored.
schemas/          JSON Schema generated from zod; `$schema` in exports points here
docs/             architecture.md, decisions.md, decisions-tooling.md, fetching.md, design.md, testing.md, tooling.md
```

## Commands

```
pnpm install            pnpm dev            pnpm build
pnpm start              pnpm pick -- <url>  pnpm login -- <url>
pnpm check              pnpm typecheck      pnpm lint    pnpm format
pnpm test               pnpm coverage       pnpm test:design
pnpm export --watchlist > watchlist.json    pnpm import --watchlist file.json
pnpm audit --audit-level=low
pnpm hooks:install        # once per clone: activates the pre-commit gate
pnpm check:repo           # the published-schema owner/repo must match `git remote`
pnpm check:secrets        # no credential shape in any tracked file (fixtures exempt)
```

## Style

- Named exports, `type` imports (`verbatimModuleSyntax`), arrow-function module API.
- Interfaces for records, unions for states, `readonly` on inputs of pure functions.
- Comments explain **why** and cite the measured evidence; they never restate the code.
- No new dependency without noting why in `docs/decisions.md`.
- Node builtins only where they suffice: `node:http`, `node:sqlite`, `node:test`,
  `node:fs/promises`, global `fetch`, `AbortSignal.timeout`, `node:child_process`.
