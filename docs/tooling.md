# Tooling rules

Verified on: Windows 11 `win32`, Node `v26.12.1`, pnpm `12.18.0`, npm `11.20.0`.

## npm → pnpm translation

pnpm 12 reads **only auth, registry, TLS, proxy and `local-address`** from `.npmrc`.
Every other rule must live in `pnpm-workspace.yaml`, in camelCase, or it is
**silently ignored**. The three rules in the project's npm `.npmrc` therefore
translate to:

| npm `.npmrc`              | pnpm 12 (`pnpm-workspace.yaml`)                                     | Gotcha                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save-exact=true`         | `saveExact: true`                                                   | pnpm's older spelling is `savePrefix: ''`; `saveExact` is the current one.                                                                        |
| `min-release-age=2`       | `minimumReleaseAge: 2880`                                           | **Unit change.** npm counts **days**, pnpm counts **minutes**. `minimumReleaseAge: 2` = two minutes = the rule does nothing.                      |
| `ignore-scripts=true`     | `ignoreScripts: true` + `strictDepBuilds: true` + `allowBuilds: {}` | pnpm's default already denies unreviewed builds and fails the install; `ignoreScripts` additionally blocks dependency lifecycle scripts outright. |
| `engine-strict=true`      | `engineStrict: true`                                                | `.npmrc` spelling is dropped by pnpm 12.                                                                                                          |
| `min-release-age-exclude` | `minimumReleaseAgeExclude: []`                                      | Kept in file, empty: no private scope to exempt.                                                                                                  |
| `audit` / `fund`          | `pnpm audit` / `pnpm fund` are commands                             | Not config; run `pnpm audit --audit-level=high`.                                                                                                  |

Companion hardening that costs nothing here:

| Setting                                             | Why                                                                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minimumReleaseAgeStrict: true`                     | Explicit config makes strict the default; stated so the intent survives copy-paste. A range with nothing old enough fails resolution loudly instead of installing a day-old release. |
| `blockExoticSubdeps: true`                          | Transitive dependencies may not come from git URLs or direct tarballs.                                                                                                               |
| `verifyDepsBeforeRun: install`                      | `pnpm start` self-heals a stale `node_modules` after a `git pull` — this is what makes "start it yourself" survivable.                                                               |
| `enablePrePostScripts: false`                       | `pnpm build` is one command, no `prebuild`/`postbuild` surprises.                                                                                                                    |
| `sharedWorkspaceLockfile: true`                     | One lockfile, one resolution across `core/db/fetch/server/web`.                                                                                                                      |
| `linkWorkspacePackages` + `preferWorkspacePackages` | Workspace packages always resolve to local source, never to a registry copy.                                                                                                         |

## Why `ignore-scripts` is free for this project

Measured on this machine, the whole runtime dependency set:

```
cheerio + playwright-core + fast-xml-parser
node_modules: 21.28 MB, 1454 files
native .node files: 0
postinstall scripts: 0
```

Zero scripts means the policy costs nothing today, and `strictDepBuilds: true`
means a future dependency that _adds_ a build script fails the install with
`ERR_PNPM_IGNORED_BUILDS` rather than running it. Approving one is a deliberate
edit to `allowBuilds`, which shows up in `git diff`.

Re-measured with `pino` in the tree (D-046): the workspace store holds **836
packages**, and **0** of them declare `install` / `preinstall` / `postinstall`. The
6 packages that ship a native `.node` file are all of the **build** chain —
`@rolldown/binding`, `@tailwindcss/oxide`, `lightningcss` — none of them in the set
`pnpm start` loads. (`prepare` is not counted: it runs for git dependencies and the
root project, never for a registry install, so counting it would report 97 inert
scripts and hide the policy's real cost, which is zero.)

Two dependencies we deliberately do **not** take, both because of install scripts:

- `playwright` (downloads a ~300 MB browser in a postinstall) → we use
  `playwright-core` + `channel: 'msedge'`, launching the Edge that is already on
  the machine. Measured launch: 410 ms.
- `better-sqlite3` (native addon, needs node-gyp + Visual Studio Build Tools) →
  we use Node's built-in `node:sqlite`, which ships SQLite 3.54.0 **with FTS5
  enabled**, WAL, and ASCII case-insensitive `LIKE`.

One dependency the policy does bite on, and it is worth the scar: `husky` (D-022)
activates itself from a `prepare` lifecycle script, and `ignoreScripts: true`
blocks lifecycle scripts **outright** — measured, `pnpm install` created no
`.husky/_` and left `core.hooksPath` unset. So a fresh clone carries a hook file
that never runs. The policy is not loosened for it: activation is the explicit
`pnpm hooks:install`, and `scripts/check-hooks.mjs` fails `pnpm check` while
`core.hooksPath` is not `.husky/_`. Approving husky silently would have bought a
guard that guards nothing. Install cost, measured: **+1 package, 0 scripts**
(husky v9 has no dependencies at all).

## The catalog

Versions live once, in `pnpm-workspace.yaml`, and packages reference them with
the `catalog:` protocol. Caret ranges are intentional: the lockfile pins exact,
and the 2-day age gate is the actual protection, so security patches can still
flow through `pnpm update`. `saveExact: true` means anything added later lands
pinned.

## Commands

```powershell
pnpm install --frozen-lockfile   # replay the lockfile, no resolution
pnpm check                       # typecheck + lint + test, all packages
pnpm build                       # vite build -> apps/web/dist
pnpm start                       # node runs TS directly, serves apps/web/dist
pnpm audit --audit-level=high
pnpm why zod                     # who depends on it
```

Note: `npm run` on this machine needs `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
because npm's PowerShell shim (`npm.ps1`) is blocked by the execution policy.
`npm.cmd` and `pnpm.cmd` work regardless.

## D-018 — Biome for lint + format; exact versions; TypeScript 7

One tool, one config file, no plugin ecosystem: `@biomejs/biome` (Rust, single
binary, no install script) does linting, formatting and import ordering.
`biome.json` sets `suspicious/noExplicitAny: "error"`, which is what makes the
no-`any` rule mechanical. `pnpm lint` is `biome check .`, inside `pnpm check`.

Reasons it replaced ESLint here: speed (a full check of the workspace in
hundreds of ms), zero config dependency graph (an ESLint flat config with
`typescript-eslint` pulls in ~90 packages and a TypeScript version peer range),
and the formatter is free with it, so `pnpm format` and `pnpm lint` cannot
disagree.

Consequences, stated:

- **Type-aware rules are off.** ESLint's `typed-linting` (rules needing a
  `Program`) does not exist in Biome; `tsc --noEmit` is the type gate, and it is
  the stricter one for the things people want type-aware linting for.
- **TypeScript 7.0.2** (the native compiler) is pinned. `typescript-eslint`'s
  peer range (`>=4.8.4 <6.1.0`) was the only thing holding the repo on TS 6;
  with Biome, nothing is. tsc is only the checker — Node 26 strips types at
  runtime.
- **Exact versions, no carets** (`saveExact: true`, catalog of exact pins). An
  exact pin is a snapshot of "aged 2 days, clean audit, works here", so
  advancing is an explicit `pnpm update`, never an accident of `install`.
- **One Biome rule is off:** `complexity/useLiteralKeys`. `tsconfig.base.json`
  turns on `noPropertyAccessFromIndexSignature`, which _requires_ `record["k"]`;
  the rule demands `record.k`. tsc is the type gate, so the bracket form wins
  and the rule cannot be obeyed. (Commented in `biome.json`? No - Biome parses
  its config as strict JSON, so the reason lives here.)

## D-003 — `playwright-core` + `channel: 'msedge'`, never `playwright`

`playwright`'s postinstall downloads a ~300 MB browser; that is the single
biggest threat to `pnpm install && pnpm start`. Measured on this machine:
`playwright-core` launching the installed Edge 156 headless takes **410 ms**, and
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` exists.
The same browser serves scraping (`render: true`), the picker (`pnpm pick`) and
Vitest browser mode — one browser story, no downloads.
**Cost accepted:** Microsoft auto-updates Edge, so the renderer changes under us;
a layout-shifting update can break selectors. `matchCount` + health states make
that visible rather than silent.
**Reverse if:** a site serves different content to Edge than to Chromium. Then
that source declares `browser: 'chromium'` and pays the download.

## D-004 — `node:sqlite` (built-in), not `better-sqlite3`

Measured: Node 26.12.1 ships SQLite **3.54.0** with **FTS5 enabled**
(`pragma_compile_options` lists `ENABLE_FTS5`), WAL, and ASCII case-insensitive
`LIKE`. `better-sqlite3` is a native addon: node-gyp, Visual Studio Build Tools,
Python — the classic Windows `npm install` killer. A search table, were one ever built,
is FTS5 over `(title, summary, body)` with external-content triggers; none is built, and
the reader retired the feature (D-045: the page is an index, not a search engine).

## D-016 — New dependencies (the complete list, with reasons)

| Dep                                                                        | Why                                                                                                                                                                                                                                      | Why not the alternative                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zod`                                                                      | Source/config schemas; a bad source file must produce an issue, not a crash. Inferred types = 100% typed config.                                                                                                                         | Hand-written validators duplicate the type; `ajv` has no inference.                                                                                                                                                                                                                                                                                 |
| `cheerio`                                                                  | HTML parse on raw bytes (80% of sources), pure JS, 0 scripts, 0 native.                                                                                                                                                                  | `jsdom` is heavy and not needed for list/field extraction.                                                                                                                                                                                                                                                                                          |
| `fast-xml-parser`                                                          | RSS/Atom, pure JS.                                                                                                                                                                                                                       | `rss-parser` pulls in more for less control over namespaces.                                                                                                                                                                                                                                                                                        |
| `playwright-core`                                                          | `render: true`, picker, Vitest browser mode.                                                                                                                                                                                             | `playwright` downloads 300 MB (D-003).                                                                                                                                                                                                                                                                                                              |
| `playwright` (dev)                                                         | Peer dependency of `@vitest/browser-playwright`. **No browser is downloaded**: `ignoreScripts: true` blocks its install script and every launch uses `channel: 'msedge'`.                                                                | Leaving the peer auto-installed unnamed hides a script-bearing package; it is declared and denied in `allowBuilds`.                                                                                                                                                                                                                                 |
| `react`, `react-dom`, `react-router`                                       | SPA paper; router is a dependency of the app shell.                                                                                                                                                                                      | Lit/vanilla would mean hand-written DOM for the picker preview.                                                                                                                                                                                                                                                                                     |
| `@tanstack/react-query`                                                    | Cache + invalidation on SSE events; the paper is a cache view of `/api`.                                                                                                                                                                 | Hand-rolled fetch state in a tool you keep for years.                                                                                                                                                                                                                                                                                               |
| `vite` + `@vitejs/plugin-react`                                            | The only build step, for `apps/web`.                                                                                                                                                                                                     | esbuild alone loses HMR/dev proxy.                                                                                                                                                                                                                                                                                                                  |
| `vitest`, `@vitest/coverage-v8`, `@vitest/browser-playwright`, `happy-dom` | The 95% gate and the two test layers (D-012).                                                                                                                                                                                            | `node:test` has no coverage gate and no browser mode.                                                                                                                                                                                                                                                                                               |
| `i18next`, `react-i18next`                                                 | UI-chrome translation from the first commit, with the language change wired to `Intl` (D-019).                                                                                                                                           | A hand-rolled string map is i18next with less: no namespaces, no interpolation, no `language` event to listen to.                                                                                                                                                                                                                                   |
| `pino` (server only)                                                       | The log (D-046): a clock on every line, the loudness from `config.json` (`server.logLevel`), JSON lines when stdout is a pipe, and **one line per poll** in the `snapshots.outcome` words. 11 pure-JS deps, 0 install scripts, 0 native. | A `console.log` prefix buys the clock and nothing else: no levels, no JSON, no silence. `winston` is ~10 packages of transports for one stdout; `debug` is namespaces, not levels, and has no structured line; `pino-pretty` (10 deps, worker threads) is refused — the TTY line is ten lines of ours, the same reasoning that hand-writes `sw.js`. |

**Removed before the first commit:** `tailwindcss` + `@tailwindcss/vite` — the
paper's design contract lives in one plain CSS file in `packages/paper/styles`,
imported by the app and inlinable by any future exporter; a compiled utility
bundle cannot be inlined, and two styling systems for one design contract is how
a design drifts. `eslint`, `@eslint/js`, `typescript-eslint` — replaced by Biome
(D-018).
