# AGENTS.md — project rules for future sessions

Read this before editing. These are hard rules, not preferences. Run `pnpm check`
before declaring work done.

## What this project is

A personal newspaper. It fetches RSS feeds, HTML pages and JSON endpoints on a
cadence, diffs each result against the cached baseline in SQLite, scores items
deterministically, and renders the changes as an ever-changing page that looks
like a newspaper at `http://127.0.0.1:8787` — the bind is config, and `0.0.0.0` puts
the page on the LAN, where the address is the only wall (D-034). Single process,
started by hand. Huginn's agent graph is
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
   Change detection is a ladder — `304` → body hash → the selection hash of
   the watched node → full parse — and **a cheap signal may skip work, never
   suppress an item**; every poll's `outcome` and the per-source fast-path
   counters are recorded, because an optimization that never fires is invisible
   (docs/fetching.md). A declared timestamp is recorded, never obeyed. A
   disappearance is a **streak over settled polls** (D-029): a parse that was not cut
   at `maxItems`, **or a rung that proved the set unchanged**, advances a key's count
   — the polls after a story leaves are byte-identical, so a ladder that read only
   parses would never speak — while a failure, a parse fault and a cut list advance
   nothing and **reset nothing**.
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
11. **Paper visuals follow docs/design.md + docs/design-page.md** (one law, two
    files: type, measure, rules, the one overlay, marks, colour here; the front
    page's grid, behaviour and print there): one typeface, columns by measure,
    hairline rules, grayscale, `--paper: #f4ecd8` in light mode. The display has
    **two axes, not a ladder of themes** (D-038): `data-theme` answers which stock,
    `data-contrast` answers how hard, and the pair composes. High contrast is the
    **palette only** — the marks, the images and the page's one shadow stay, because a
    page that hides its own content because the reader asked to be legible is punishing
    the ask. The values live in `tokens.css` (unlayered, so they beat `@layer base` for
    the same names: one owner per value); the system's `prefers-contrast: more` block is
    gated on `:root:not([data-contrast])`, so the page's choice beats the OS; and no
    component writes a `dark:`-style variant. The page has
    **exactly one overlay** (D-035): the sources editor, a native `<dialog>`
    opened with `showModal()`, a **scrim and no shadow** (the scroll edge is the
    page's only shadow), two ways out — Esc and the close control — no radius, and
    it opens **above** the sheet, never inside it, and **unmounts** when closed.
    Styling is
    **Tailwind v4** (D-024): the vocabulary is `@theme` in
    `packages/paper/styles/tokens.css`, utilities are written on the elements in
    `packages/paper/src`, and only the residue a utility cannot express lives in
    `base.css`, under `@layer base`. The sketch marks — diagonal crossings, dot
    grid, guideline ring, crop marks — are **one recipe** in `marks.css`, with
    geometry copied from a measured source, never eyeballed, and recoloured to
    newsprint: no component may write its own gradient. Structural hooks are
    `data-part` attributes, never BEM class names — the design suite, the print
    rules and the SSE flash query those. **Every box with a rule is padded**
    (`--spacing-box` / `--spacing-box-wide`), and **the sheet has a waste area**
    (`body`'s gutter padding): a mark drawn outside the box — the stock's
    crossings, the printer's corner ticks — needs air to land in, and a
    full-bleed sheet covers the pattern with its own background. No CDN assets,
    no cards, no shadow beyond the documented scroll edge, no rounded rectangles,
    no saturated colour, and **never `text-align: justify`**.
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
    `.husky/pre-commit` runs `biome check --staged` (only when a commit stages
    content: it exits 1 on an empty index, which is what a message-only amend
    presents), the 300-line scan, the secret
    scan, `schemas:check`, `pnpm typecheck` and `pnpm test:fast` — the four fast
    projects, core/db/web/fetch, no browser project (whole hook: 10.8 s) —
    under `set -e` — without it husky runs every command and only the **last**
    exit code decides, so a lint failure commits anyway. It never runs
    `pnpm check`: minutes (per-package coverage, the Edge browser projects, the
    audit), and it ends in `pnpm test:design`, which **launches real Edge** —
    green here, and a hook that needs Edge installed cannot pass on every
    machine, which is the same reason the browser projects stay out of the
    floor. Warnings are allowed (the tree carries 9); promoting them to errors
    teaches `--no-verify`. Husky activates from a `prepare` script, and
    `ignoreScripts: true` (rule 8) suppresses that — measured — so **a fresh
    clone has no hook** until `pnpm hooks:install`. `pnpm check` fails while the
    hook is inactive (`scripts/check-hooks.mjs`): an unguarded checkout must not
    look set up.
17. **No credential in git, ever.** The reader authenticates with **your own
    browser**: `pnpm login -- <url>` (designed, **not built**: WP8 — the command
    answers by name today, D-034) writes a persistent Edge profile under
    `profiles/`, and the state store is a `node:sqlite` file under `data/` that
    needs no authentication at all. Both are gitignored, and nothing in the repo
    can authenticate anything to anyone. Hence: `sources/*.json` has no `cookies`
    field by design, `scripts/check-secrets.mjs` fails the build when a tracked
    file holds a token shape, and `**/fixtures/**` is exempt for the same reason
    rule 1 exempts it — a captured payload edited to satisfy a scanner stops
    proving the parser handles the real site. A value that reaches a public
    commit is public **forever, including after a squash** — rotate it.
18. **Your reading list is not a public artifact.** The repository is public, and
    a source definition is a statement about what a reader cares about: the URL
    set, `watchwords`/`blockwords`, `section`, `notes`, the `profile: true` fact.
    So `sources/` is **gitignored** — local files, deliberately **not
    version-controlled** — and `sources.example/` is what ships (D-025). The
    loader takes a directory, so D-011's one-way rule is unchanged; only which
    tree is public changed. The backup is `pnpm export --bundle`, which carries
    `sources/`. `scripts/check-secrets.mjs` fails the build when a source
    definition is _tracked_. Capture fixtures **logged out**: a payload from a
    signed-in page carries the reader's data into a public file. The same rule
    covers **`config.json`**: `scoring.watchwords`/`blockwords` say what a reader
    cares about, and `server.host` says who can read it — so that file is
    gitignored and `config.example.json` is what ships, validated by
    `packages/config/test/examples.test.ts`.
19. **Delegation: exactly one agent at a time — the supervisor included.** Never
    two subagents, and never a subagent while the supervisor edits: they race on
    the same files, lockfile, and gates. Launch one, then work on files it is not
    touching **or stop and wait**. The supervisor keeps anything that needs design
    history — identity/diff/scoring semantics (D-005, D-028, D-029),
    `config/src/schema.ts` and `core/src/api.ts` shape, dependency choices, the
    first pass at a new layer. A worker gets separable work with a mechanical
    definition of done: tests for a package, fixture re-pinning, mechanical
    renames, wiring a decided shape. **For delegated work the rule-14 answer is:
    a worker may fix `src` when it is confident** — which is exactly why the
    report must carry the diff and the proof (commands, counts, coverage), and
    why the supervisor reads that diff and re-runs the gates before landing it.
    **The supervisor commits, a worker never does, and nothing pushes.** Commit at
    least per work package, earlier at a clean checkpoint.
20. **The address is the access control** (D-034). The server authenticates nothing
    (rule 17), so the bind is the wall: `server.host` defaults to loopback, and LAN is
    the reader's line in `config.json`. `server.tls: { cert, key }` is **two paths**
    (D-039: a key in `config.json` rides into every `export --bundle`), and a pair that
    cannot be read **stops the boot** — no silent fallback to plain HTTP, because on the
    LAN address that is a page that cannot install (WP16) and a reader who re-runs
    `mkcert -install` for nothing. Any route that **writes** (a source file, a
    settings file) is refused from a non-loopback peer by the guard in
    `packages/server/src/net.ts`, which runs **before** routing — no route may add a
    mutation without it, and no credential, token, cookie or "shared secret" may be
    introduced to make a LAN write safe (rule 17). `/api/sources` answers the source
    files' **verbatim text**, so **every verb of it** is loopback-only
    (`readingListAllowed`): the phone gets the paper, not the watchwords. `/api/pick`
    is loopback-only **on both verbs** for two reasons at once: launching a browser on
    the machine that runs the server is a write, and a pick reads a source file — so a
    LAN `POST` dies at the mutation guard **before routing** and a LAN `GET` dies at the
    reading-list wall, and each refusal names the route it refused. `/api/state`
    **is** the reading list (rule 18), so binding past loopback is announced at boot: the
    typeable URLs, the fact that the household can read the source list, and the firewall
    command.

## Layout

```
apps/web          Vite + React SPA (the paper). Only build step here. `public/` is the
                  install identity (WP16, D-039): the manifest, the icons, `sw.js`.
packages/core     Types, record schema, API contract, normalize, diff, score, health, teaser. No I/O.
packages/paper    React newspaper components + the paper CSS (browser-safe, used by the app)
packages/config   zod source/app schemas + file loading + watchlist/OPML (sources/*.json is truth)
packages/db       node:sqlite, schema, migrations, repositories, FTS5 search
packages/fetch    http, rss, html, json, fixtures. `pick` is built (WP6, D-036):
                  launch (msedge) + the injected inspector + the derivation, proved
                  against the raw bytes. The polling `render` tier (WP6b) is not:
                  the transport refuses a `render: true` source by name.
packages/server   Entry point (`cli.ts` → `boot` in `start.ts`), scheduler, pipeline,
                  routes (`/api/state`, `/api/events`, `/api/sources` GET/POST/DELETE and
                  `/api/pick` POST/GET — all loopback-only, rules 18 and 20), the built
                  page, the SSE hub, the address policy (D-034), the TLS pair
                  (`tls.ts`: paths, parsed at boot, no silent HTTP fallback, D-039),
                  the db open (`bootDb.ts`, D-041), the pick job
                  (`pickApi`/`pickHttp`/`pickCli`/`pickTransport`), `export --bundle`
                  (rule 18's backup). `sourcesApi.ts` is the **only** writer of
                  `sources/*.json` (pinned in `boundary.test.ts`) — a pick fills, never
                  writes. Cut commands answer by name (`commands.ts`); toasts (WP10)
                  and `import` are not built.
sources.example/  Example source definitions (public). `sources/` is your reading
                  list: local, gitignored, not version-controlled; the backup is
                  `pnpm export --bundle` (built — take a copy off this machine, since
                  the file is the only copy). data/ and profiles/ are gitignored too.
config.example.json The shipped app config, validated by `config/test/examples.test.ts`.
                  `config.json` is yours and is gitignored (rule 18: its
                  `scoring.watchwords` are the reading list too) — and it is the file
                  that turns the LAN on (`server.host`, D-034) and TLS
                  (`server.tls`: two **paths**, never PEM bytes, D-039 — and the
                  example ships no `tls` block: a first clone whose config names files
                  it does not have is a first run that cannot boot).
schemas/          JSON Schema generated from zod; `$schema` in exports points here
docs/             architecture.md, state.md + state-server.md (the surface, the run
                  verbs, the dev loop) + state-device.md (the claim, the argv, TLS,
                  the install), roadmap.md (what is not built) +
                  roadmap-closed.md (the pipeline's records) +
                  roadmap-closed-surface.md (the picker, the styling, the panel) +
                  roadmap-closed-device.md (TLS, the install, the offline edition),
                  decisions.md + decisions-surface.md (the page, the address, the
                  reading list, the one overlay, the picker) + decisions-display.md
                  (the device: the server's place, the two display axes, install and
                  TLS), decisions-tooling.md + decisions-styling.md (the CSS law,
                  split at the cap),
                  decisions-detection.md (selectors, the ladder, `gone`, measured
                  cost), fetching.md, design.md + design-page.md (the design law,
                  split at the 300-line cap), testing.md, tooling.md
```

## Commands

```
pnpm install            pnpm dev            pnpm build
pnpm start              # the paper: poll + routes + page. Bind is config (D-034). No argv:
                        # a flag it ignored used to be a setting believed changed (D-042)
pnpm server             # the process alone: poll + API, page only if `dist` exists (no build)
pnpm ui                 # Vite (5173, loopback) proxying /api to 8787: hot reload on live news
pnpm dev                # Vite on the seed from fixtures (`pnpm seed`): the paper offline
pnpm pick -- <url>      # a real Edge window on this machine: click the item, prints the keys
pnpm pick -- --id <s> --write   # the same for a source file; --write merges it (no --write: prints)
pnpm login -- <url>     # naming where the answer lives (commands.ts, roadmap WP8)
pnpm sources:init       # once per clone: copies sources.example/ into sources/ (D-025)
pnpm check              pnpm typecheck      pnpm lint    pnpm format
pnpm test               pnpm coverage       pnpm test:design
pnpm shots              # the paper in real Edge: 1440x900, 1024x768, 390x844
pnpm export --bundle      # the reading list's only backup (rule 18); `import` is not built
pnpm export --watchlist pnpm import -- …    # not built (WP11)
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
