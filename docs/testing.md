# Testing policy

`pnpm check` fails when coverage is below **95%** on lines, functions, branches
or statements. The policy is one document — **`vitest.coverage.json`** at the
repo root, thresholds plus `all: true` — read by every package's
`vitest.coverage.ts`. There is no per-branch escape hatch: no `it.skip`, no
`describe.skip`, no `/* istanbul ignore */`, no `v8 ignore` comments.

**Coverage is configured at root configs, never in project configs.** Vitest
allows `coverage` only in a root config (a project config's `test` type omits
it, so tsc rejects it), and a root-level coverage run resolves `include` per
project root: it matched nothing, printed a confident `0%` and passed — a gate
that gated nothing. So `pnpm coverage` starts one Vitest per package
(`vitest run --config vitest.coverage.ts --coverage`), where the policy's
package-relative `src/**` resolves. `scripts/check-coverage-policy.mjs` (in
`pnpm check`) fails the build if a package stops reading the policy, resolves it
from a cwd-relative path, weakens a threshold, or leaves a `coverage:` key in a
project config.

## Layout

Vitest 5 `projects` (the `workspace` key is deprecated): one Vitest process runs
`packages/*` and `apps/*`, each with its own `vitest.config.ts` written with
`defineProject`. Those configs say only which tests to run and in which
environment; coverage is the separate per-package root config described above.

| Project  | Env       | Notes                                                                                                               |
| -------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `core`   | node      | pure logic: normalize, diff, score, health, sections. Densest coverage: this is the code that decides what is news. |
| `config` | node      | zod schemas + file loading; every invalid source file must produce an issue, not a crash.                           |
| `db`     | node      | `node:sqlite` in `:memory:`; schema, migrations, the single-instance claim, repositories. No file DB, no FTS5 yet.  |
| `fetch`  | node      | parsers against fixtures (never the live web), fetch policy against a local `node:http` stub.                       |
| `server` | node      | scheduler, pipeline, routes over an ephemeral port, SSE stream, toast command building.                             |
| `web`    | happy-dom | components + hooks + `lib/` helpers; React plugin enabled.                                                          |

Measured for the next slice (`db`): **FTS5 is compiled into Node 26's SQLite** —
`create virtual table … using fts5(…, contentless_delete=1)`, `match`,
`snippet()` and `bm25()` all work on SQLite 3.54.0. So search needs no
dependency; note that `snippet()` returns `null` on a contentless table, which
is the reason the search table will be an external-content index over `items`,
not a contentless one.

## Rules

1. **Tests live in the package that owns the code**, named `*.test.ts(x)` under
   `test/` (node packages) or next to the module (`web`).
2. **No test touches the network.** Parsers read fixtures from
   `packages/fetch/test/fixtures/`; the HTTP layer is tested against a local
   `node:http` server. Live probes belong in `pnpm verify:web` (a manual script),
   never in the suite.
3. **Parsers need fixtures.** A selector/parse change adds or updates a fixture
   in the same change.
4. Determinism: inject `now`/clock into scoring and the day-boundary functions; no
   `Date.now()` inside `core` functions that take a clock parameter.
5. No test asserts on wall-clock timing, and no `sleep()`; use injected clocks
   and `await`ed promises.
6. A test that cannot be written is a signal: it usually means I/O has leaked
   into logic. Extract the pure part and test that.

## Excluded from coverage (the full list, with reasons)

| Path                                                 | Why                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/cli.ts` (server)                                | argv parsing + signal wiring; hand-verified by running `start/pick/login/status`. Everything it calls is covered.                                                  |
| `src/render/launch.ts`, `src/pick/launch.ts` (fetch) | `chromium.launch({ channel: 'msedge' })` needs a real browser. Selector generation, overlay script, pool accounting and timeout handling are tested against fakes. |
| `src/main.tsx` (web)                                 | `createRoot` + providers; no branching.                                                                                                                            |
| `**/*.d.ts`, `**/vitest*.ts`, `**/vite.config.ts`    | configuration, no runtime logic.                                                                                                                                   |

Deliberately **not** excluded: `db`, `scheduler`, `pipeline`, `routes`, `sse`,
`paper` (the components), every parser, `core` in full, and `web/src/lib`
(including the `Intl` adapters, whose whole job is a correct format).

## Arms that cannot be reached (documented, not excluded)

A path is excluded only when nothing in it can run. A single arm that cannot be
reached stays in the numerator, and is listed here with the measurement.

| Arm                                                                                                                   | Why, and what covers the rest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/src/opml.ts:83` — `?? 'invalid feed'`                                                                         | A failed `safeParse` always reports at least one issue (no empty-`issues` case exists in zod 4.6.7), so the fallback label is unreachable. The issue text it sits next to is covered.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `config/src/load.ts:31,65` and `config/src/watchlist.ts:54` — the non-`Error` arms (`'unparseable'`, `'cannot read'`) | Unreachable through real I/O: measured on Node 26, `fs.promises.readFile` rejects with an `Error` (`code: 'EISDIR'` for a directory, `code: 'ENOENT'` for a missing file) and `JSON.parse` throws a `SyntaxError`, so the directory trick in `load.test.ts` covers the `Error` arm and never this one. Covered by `config/test/loadFailures.test.ts`, which mocks `node:fs/promises` for one sentinel filename, plus a `JSON.parse` spy: the only two places in the suite that fabricate a failure. They are kept because the contract they pin is "a rejection of any shape becomes an issue, never a silent zero" — the mock is contained to that one file so `load.test.ts` keeps the real filesystem. |
| `db/src/snapshots.ts` (the CHECK re-checks on the way out), `db/src/value.ts:189`, `db/src/nodeDriver.ts:39`          | Unreachable by construction: the DDL CHECK constraints reject those values before a row can exist, and the JSON columns are constrained to an object/array by json_type. Kept on purpose - a row written by a future build must fail as a named fault (rule 5), not as `undefined` reaching a score. The 12 uncovered branches in `db` are the honest price of that, not missing behaviour.                                                                                                                                                                                                                                                                                                               |

## Commands

```
pnpm test              vitest run                     (all projects, no coverage)
pnpm test:watch        vitest
pnpm coverage          one vitest --coverage run per package   (the gate)
pnpm check:coverage-policy   asserts every package reads the policy
pnpm test --project core
pnpm test --project '!web'
pnpm --filter newspa-core exec vitest run --coverage  (one package, from the root)
```

## D-015 — Two test layers, and coverage 95 as a gate

Moved here from **docs/decisions.md**, which has a 300-line cap and whose
content this is; the short-form stub is now in **docs/decisions-tooling.md**.

`happy-dom` for fast component/hook/lib tests, inside the v8 coverage run
(thresholds 95 on lines/functions/branches/statements, `all: true`).
Vitest browser mode through `playwright-core` + `channel: 'msedge'` asserts the
visual contract on real computed CSS: the measure, the column count, the
`#f4ecd8` stock, hairline rules, grayscale images, dark mode, and the teaser
linking out with `target="_blank"`. It is excluded from coverage because it
asserts CSS, not code paths, and the components it mounts are already covered.
