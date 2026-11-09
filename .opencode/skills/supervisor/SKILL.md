---

name: Supervisor
description: Rules for delegating work to subagents in this repo — the one-agent-at-a-time limit, what never gets delegated, what does, and how a briefing must be written.
---

# Delegating work

## The hard limit

**At most one subagent at a time — me or it, never two of them.**

Two subagents editing one repo race on the same files, the same lockfile, the
same `pnpm install`, and the same gates. A second one adds no throughput, only
merge conflicts I then have to resolve. So:

1. Launch one subagent.
2. Work on files it is **not** touching, or stop and wait.
3. Only after it reports, launch the next.

If I have three delegable tasks, they queue. Launching all three at once is a
mistake I will pay for in conflicts, and the user has said so explicitly.

## The size test

> If the briefing is larger than doing it myself, do it myself.

A briefing is "larger" when writing it means explaining the design decisions,
the measured facts, the history of why a rule exists, and the failure modes to
avoid — because at that point I have done the thinking and the subagent is only
typing. Concretely, delegate when the briefing is **a list of files and an
assertion style**, and do it myself when the briefing needs a **design history**.

Estimate before launching: if the prompt is over ~40 lines, or it needs to
teach the agent what D-005 means, write the code myself.

## Never delegated

Decisions whose blast radius is the repo, because a wrong call produces a bad
design, not a bad line:

- **Identity, diff and scoring semantics** — what counts as the same story.
- **Schema and wire-contract shape** — `packages/config/src/schema.ts`,
  `packages/core/src/api.ts`.
- **Rule 14 adjudication** — "is this failing test wrong, or the code?" Needs
  the code under test, the decision history, and the intent; the answer goes to
  the user.
- **Anything needing a `docs/decisions.md` entry**, and dependency choices.
- **The first pass at a new layer** — the frontend, the pipeline, the CLI. The
  second pass, the wiring of a decided shape, is delegable.

## Delegated well

Separable work with a mechanical definition of done:

- Writing tests for a package that has none (the coverage gate turns real).
- Test sweeps: re-pinning fixtures after a schema change, mechanical renames.
- Reading tasks: "find every caller of X and report" (use `explore`).
- Per-file jobs that touch disjoint paths from mine.

## The briefing

Every briefing names, in this order:

1. **`AGENTS.md` first, and the specific rules that bind this task** — 300-line
   cap, no `any`, Biome, `.ts` import extensions, per-package coverage.
2. **Exact file list** to create, and the explicit **do-not-touch list** (the
   files I am editing, `docs/**`, `src/**` when the task is tests).
3. **Files to imitate**, by path. Style drift is the usual failure.
4. **The verification commands**, per package: `pnpm --filter newspa-<pkg> exec
   vitest run`, then `--config vitest.coverage.ts --coverage`, then `typecheck`,
   then `pnpm exec biome check --write <pkg>`.
5. **Rule 14 in one line**: expose a source bug with a failing test and report
   it; never weaken a test, never edit `src` to satisfy an assertion.
6. **Do not run root-level `pnpm test` / `pnpm coverage`** while other work is
   in flight — it will show unrelated failures and invite a wrong fix.
7. **The final message shape**: files created, test count, coverage numbers,
   defects found, rules it could not satisfy.

## After it reports

Own the result. Run the gates myself (`pnpm lines`, `pnpm lint`, the package's
coverage), read the diff, and land it in one Conventional Commit. A subagent's
green suite is a claim, not a fact.
