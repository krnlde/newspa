# Open work packages

What is **not** built, in the order that unblocks the most. Each package states
the measured gap, the acceptance test, and the rules it is answerable to.
`docs/state.md` (and `docs/state-server.md`, for the surface and the verbs, with
`docs/state-device.md` for the claim, the address, TLS and the install) is the
inventory of what exists; `AGENTS.md` is the law.

The spine `WP2 → WP3 → WP4 → WP5` is closed (see `docs/roadmap-closed.md`): the poll,
the scheduler, the routes the app calls, the SSE stream, the page, and the entry point
that runs them — so `pnpm start` is a paper that fills itself, on a port, on the LAN if
the config says so (D-034), with `pnpm server` and `pnpm ui` as the development pair.
`export --bundle` is built too (WP11, half), which closes the one gap that was data
loss, and the reading list has an editor on the page (WP14: the three verbs, the modal,
and the reading-list rule that came out of it). **WP6 is closed as well** (D-036): a
click in a real Edge window on the server's machine, a selector proved against the
bytes the poller fetches, and a PICK control that **fills** the editor so SAVE stays
the reader's act. The display axes are built too (D-038: `data-contrast` composes with
`data-theme`, set by URL for a wall device).

What is left is quality of life, not architecture, and the queue is the reader's own
next sentence: _put it on a screen that is not a laptop._ **WP16 (the installable
paper) is built**, and so is **WP17 (TLS)**, the address it needed: the paper installs,
the worker keeps the last edition, and the dateline strip says when the page is served
from a cache. The page has a way to navigate a long edition now: **WP18 (the spine)** is
built, the rail of squares over the scrollbar, and it brought **D-044** with it — no
mark behind words. So the next package is **WP15 (the board)**, the recipe that ties them to
D-037's topology. After it:
search (WP7), toasts (WP10), the watchlist knobs (WP9), export/import (WP11), the
README (WP13). Closed packages are in `docs/roadmap-closed.md` (the pipeline) and
`docs/roadmap-closed-surface.md` (the picker, the styling, the panel, TLS, the install,
the spine)
with what each
measured - WP1, WP2, WP3, WP6, WP12, WP14, WP16, WP17, WP18; read WP12 before reopening those files.
(WP4 and WP5 are built and recorded below, where their open halves are named.)

## WP4 - The HTTP surface  _(built for the MVP 2026-11-11; the rest named)_

**Built.** `GET /api/state` (the composed read side, `no-store`), `GET
/api/events` (`text/event-stream`: `cycle:start`/`cycle:done` from the scheduler,
`retry:`, a keep-alive comment, a client that cannot be written dropped **and
logged**), and the app from `apps/web/dist` with the pair of cache rules that make a
reload cheap (`index.html` never cached, a hashed asset immutable for a year). A
missing `dist` answers with `pnpm build` and the path it looked at, plus the fact
that the API is up (rule 5: a blank page and a 404 in a log is the silent zero in a
server's clothes). `net.ts` is the address policy (D-034): the LAN reads, writes are
loopback-only, refused on the address **before** routing.

**Named as not built, in the body of the 404:** `/api/items`, `/api/editions`,
`/api/search` (FTS5 exists in `packages/db`; the box is WP7) and
`POST /api/sources` (the file writer, D-025). Every 4xx is a line with the reason;
no answer is a stack.

**Accept - met.** Contract tests parse what the routes answer with **core's own
schemas** (`stateResponseSchema` on `/api/state`, `serverEventSchema` on the frames),
so a response that fails its shape is a failing test, not a broken page. The SSE
tests prove a publish arrives, a disconnect removes the client, `close()` ends every
stream, a late subscribe is a 503 with a reason, and the headers a proxy obeys are
present. 33 tests across `net`, `sse`, `http-app` and `static-files`, over a real
socket on port 0. The dev plugin (`apps/web/dev/apiPlugin.ts`) is untouched, stays
for offline dev, and is never in the bundle.

## WP5 - the entry point  _(built 2026-11-11, including `export --bundle`)_

**Built.** `packages/server/src/cli.ts` is the process edge the root scripts name —
argv, `console`, signals, exit codes — coverage-excluded as `main.tsx` is. Its
commands are **data** in `commands.ts`: three built (`start`, `export --bundle`,
`pick`), the rest refused **by
name**, each line naming where the answer lives (the health strip is the paper, the
file is the truth, the credential is WP8). `test/commands.test.ts`
reads the root `package.json` and fails if any script naming `cli.ts` has no answer,
so the scripts and the commands cannot drift: `pnpm status` prints a sentence, exit 1;
an unknown name prints the list, exit 2.

`start.ts`'s `boot(deps)` is the whole boot as a function of a deps bag: report the
config, `ensureSourcesDir` (D-025), open and migrate (the open takes the `db_lock`
claim, so a second `pnpm start` is refused by name before it can interleave a write),
upsert the watchlist and print every issue, start the scheduler publishing to the
hub, serve. `test/start.test.ts` boots a **temp tree** and asserts the acceptance the
old WP5 asked for — a paper from a real poll of `sources/` — over a socket, offline,
with a captured feed as the transport's answer: the source is `ok`, the items print,
the plan is in the row, and the tally's count equals the wire's.

**Built, and it was the gap that was data loss:** `export --bundle` — rule 18 makes
`sources/` gitignored, so the bundle is the only backup of the reading list. Its rules
(complete-or-refuse, byte-stable, gitignored itself) are WP11's, below. `import` is
still open, and refuses by name, pointing at the schema to restore by hand.

## WP7 — Search

**Gap.** `AGENTS.md` claims FTS5 in `packages/db`; `grep -i fts5 packages/db/src`
is empty. `ItemsQuery` exists in the contract and has no server.

**Build.** A migration adding an FTS5 content table over the item
title/teaser/source, kept in sync by triggers, a `search` method on
`itemsRepository` with BM25 ordering, `GET /api/items` (WP4), and the search
field in the app — chrome strings through i18n, results rendered as story rows
(the styling migration is finished, so a new row type is utilities on the
element, per rule 11).

**Accept.** A fixture db of ~200 items returns the expected order for a
two-word query, respects the section filter and the limit, and a prefix query
matches. The migration is tested forward **and** the FTS table is verified to
survive a reopen.

## WP8 — `login`: the browser profile is the credential

**Gap.** `pnpm login -- <url>` names a command that does not exist (rule 17
says it is the only credential mechanism).

**Build.** Launch a headed Edge with a persistent profile under `profiles/`
(gitignored), let the reader sign in, close it, and have `fetch`/`render` use
that profile for sources that need it. Nothing in git can authenticate anything:
no cookie jar in `sources/*.json`, no token in any tracked file
(`scripts/check-secrets.mjs` enforces it).

**Accept.** A source marked `profile: <name>` renders through the stored profile
(the test uses a local page that echoes its own cookie header), and a source
without one never touches the profile dir. `pnpm check:secrets` stays green.

## WP9 — The reader's two knobs, and the watchlist

**Gap.** D-021 says `section` and `weight` are the reader's file knobs;
`packages/config` has `watchlist.ts` and `opml.ts`, and `pnpm export --watchlist`
/ `pnpm import --watchlist file.json` point at the missing CLI (WP5).

**Build.** Apply `section` and `weight` in the scoring/placement path so a
source's declared section and weight change where its stories land, and wire the
watchlist round trip: export the reader's list as a validated file, import
it back.

**Accept.** Two sources differing only in `weight` land in the expected
slots in `editionOf`; the export → import round trip is byte-stable for the
same input; an imported file that violates the schema fails with the zod issue
and writes nothing (D-014).

## WP10 — Notifications

**Gap.** D-010 promises a local Windows toast on a publish; nothing emits one.

**Build.** `packages/server/src/toasts.ts`: on a publish, raise a Windows toast
(a PowerShell call, no new dependency), suppressed when the paper is being read
(the SSE stream has a client) and by a flag.

**Accept.** A publish with no connected client calls the notifier once with the
edition summary; with a connected client it does not; a notifier failure is a
log line, never a failed poll.

## WP11 - Export and import formats  _(half built 2026-11-11: `export --bundle`)_

**Built, and it is the half rule 18 asks for.** `packages/config/src/bundle.ts` is
the shape (`bundleSchema`, `$schemaVersion: newspa.bundle.v1`, `$schema` at the
generated `schemas/bundle.schema.json` — the fifth published schema, so
`schemas:check` gates it like the other four); `packages/server/src/bundleExport.ts`
is the command. A bundle is the app config **plus every source in `sources/`**, which
is that tree's only backup, since the tree is gitignored on purpose.

**The one hard rule: complete, or refuse, and write nothing.** `loadSources` _drops_
a source file that does not parse — right for a poll, where the paper must run without
it — so a backup built on the loader's output would silently be a shorter list, and
the loss is discovered at restore time, when the original was the only copy. So any
issue turns into `BundleRefusedError`, with every issue line, and no file. A config
that fell back to defaults is **said, not fatal**: a fresh clone has no
`config.json`, and refusing to back up a reading list over a default masthead is not
the reader's friend. Sources are sorted by id, so two exports of an unchanged tree are
**byte-identical** — a backup you can diff is a backup you can trust. The file
(`newspa-bundle.json`) is gitignored, because it _is_ the reading list (rule 18).

**Open.** `import` (it pairs, and refuses by name, pointing at the schema),
`export --watchlist` and `export --opml` (`watchlist.ts`/`opml.ts` exist and are
tested; the CLI flags do not), and the edition JSON export.

**Accept, for the half built.** `bundle.test.ts` (9) pins the defaults, the
`$schemaVersion` gate, a source that is not a source named by path, the sort, the
byte-stability, the tie arm of the comparator (a writer that loses a source is a
lying backup), and a root-path issue printed as `(root):` rather than an empty string.
`bundle-export.test.ts` (5) writes to a temp tree, reads it back through
`bundleSchema`, and proves the refusal writes **no file** — including for a tree with
no sources at all, which is a backup of nothing.

## WP13 — README

**Gap.** No `README.md`. A first-time reader has `AGENTS.md` (rules for an
agent) and `docs/*` (why), and nothing that says "run these three commands".

**Build.** A page a human reads: what the paper is, `pnpm install`,
`pnpm hooks:install`, `pnpm seed` + `pnpm dev` (the seeded paper, offline),
`pnpm start` (the real one, once WP5 lands), `pnpm shots`, and a pointer to
`docs/state.md` and `docs/roadmap.md`.

**Accept.** Every command in it is run and quoted with its real output, and it
stays under 300 lines (rule 1).

## WP15 — The board: a screen that shows the paper and asks for nothing

**Gap.** The reader's goal is _an always-up-to-date news board_, and the topology is
decided (D-037: the server is a desk machine, the wall is a display). The page is
already the board's front end — `/api/state`, `/api/events`, and D-038's two display
axes **set by URL** (`?theme=dark&contrast=more`, read by the pre-paint script). What
is missing is the rest of the sentence: the launch, and the board's story when the
desk is asleep.

**Build.** The kiosk recipe, stated and checked:
`msedge --app=http://<server>:8787/?theme=dark&contrast=more` (no tabs, no address
bar, no first-run UI), plus the Pi's boot (a systemd user unit, documented, not
shipped). No new server role, no companion daemon on the wall (D-037's cut). The one
page behaviour worth building is the **freshness line**: the paper already says
`last poll …`, and the claim to pin is that a board left for a day says so in words a
reader can act on.

**Accept.** `pnpm shots` at 1 024 × 768 (the Pi's usual panel) and 800 × 480, with the
URL axes applied at first paint — no flash of the yellowed stock, both switches in the
state the URL names. A server that stops answering leaves the last edition on the
screen with its stated age, not a blank page and not a spinner (rule 5).
