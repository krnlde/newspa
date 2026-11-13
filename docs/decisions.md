# Decisions

Each entry states what was chosen, why, the evidence, and what would make us
reverse it. `AGENTS.md` requires a note here for every new dependency.

Pipeline, data, identity and behaviour: the pipeline shape, item identity,
the diff, render at pick time, JSON sources, scoring, notifications, source
files in git, exports, and change detection.

The surface - the page as the product (D-002), the reading list (D-025), the
address as the wall (D-034) and the one overlay (D-035) - is in
`decisions-surface.md`. The device - the server's place (D-037), the two display
axes (D-038), TLS and the install (D-039), and where a test certificate comes from
(D-040) - is in `decisions-display.md`; its D-047, the paper's dates, is in
`decisions-display-dates.md` (split at the cap). Tooling, dependency, testing and paper-shape decisions
live in `decisions-tooling.md`; the paper's CSS law, its vocabulary, and how the
styling is measured, in `decisions-styling.md` (D-024, split at the 300-line cap).
Detection, selector language, `gone`, identity
for pages and the measured cost of the browser live in `decisions-detection.md`
(shared numbering; D-026 … D-033 there revise parts of D-005, D-006, D-007
and D-020).

## D-001 — One hard-coded pipeline, not an agent graph

Huginn's power is a configurable graph of agents; its cost is Rails + MySQL +
Redis + Sidekiq + Compose and a mental model of scenarios. We fix the graph in
code: `fetch → parse → normalize → diff → score → publish`, six stages, one typed
record between them. Huginn vocabulary is kept where it is cheap: WebsiteAgent →
`html` source, RSSAgent → `rss`, DataOutputAgent → the paper,
EventFormatter → the record schema, Scenario export → `sources/*.json`.
**Reverse if:** a source needs a transformation that cannot be expressed by the
three parsers plus `fields`/`strip`/`itemsPath`. Then add a stage, not a graph.

## D-005 — Item identity: canonical link, else title+day (revised 2026-11-09)

`itemId = sourceId + hash(host + path + sortedQuery)`, fragment stripped, `www.`
and default port removed, tracking params removed. Conservative list
(`utm_*`, `fbclid`, `gclid`, `msclkid`, `mc_cid`, `igshid`, `spm`, …): `ref`,
`src` and `feature` are **not** stripped, because breaking a link costs an
article and a query param costs nothing. Last resort is `(title, day)`, for a
link that is not a story URL (`mailto:`, app schemes). Never positional
identity: one new item at the top shifts every index and prints 30 false "new"
stories.

**A declared `guid` / Atom `id` is not part of the key.** The guid machinery was
built (`isPermaLink`, an `idStrategy` knob, verbatim hashing for non-URL ids) and
removed the same day: the configuration surface it needs is permanent, and the
failure it prevents is bounded. The accepted cost, stated plainly — an item whose
only identity is its headline prints **twice** when the publisher retitles it,
and a re-tagged GitHub release prints twice when its URL moves. That is
information the paper would print anyway, and every software feed publishes a
link per release.

**Page identity** (the same decision, in the shape a software source needs): an
HTML source with **no `list`** is one item at a **stable address**,
`pageKey(sourceId)` → `<id>:page`. **Revised 2026-11-11 (D-028):** it used to be
`contentKey(sourceId, pageText)` — the hash of its whitespace-normalized text,
taken before the body cap — and that made one slot a **new story on every edit**,
with a fresh read marker each time (measured: three keys for one page slot).
"The text differs from the cache" is still the whole change model; it is now
reported as an **edit** of the page's one item, which is what the reader acts on,
and the compared text gets a wider window (`capPageBody`, 6 000) than an
article's evidence, so a change below the display fold is visible to the diff.
Re-indenting the markup is not a change, because `normalizeText` folds it; a new
version line is. `strip` runs **before** the text is compared, because a ticking
"last updated" would otherwise report an edit on every poll.

## D-006 — Diff the normalized item set, never raw HTML

Measured evidence, all from this machine:

- BBC `GET /news` → **370,436 bytes** with `vary: X-BBC-Edge-Scheme,bbc-mvt-1…10`
  — the HTML is an A/B variant, so any raw-HTML hash churns forever.
- BBC sent `etag: "5l49hlg0od7xhg"`; replaying it as `If-None-Match` returned
  **200 + the full 370 KB**, not 304. Conditional GET is a bandwidth
  optimization, not a source of truth.
- `content-length: 61508` vs 370,436 decoded: gzip. Size caps and change
  detection must use decoded bytes.
- `old.reddit.com/r/worldnews/.rss` returned **200 `text/html`, 341 KB**: a
  configured RSS URL can silently become HTML. We refuse to parse a source as a
  kind it is not and report it, rather than emitting a quiet zero.
  So: `baseline_hash = hash(sorted item keys + normalized fields)`; ETag and
  Last-Modified are stored and sent opportunistically.

## D-007 — `render: true` is a pick-time decision

A selector authored against a hydrated DOM matches nothing in a raw fetch, and
the failure is a silent zero-item poll. The picker records the render mode into
the source file; changing it requires re-picking.

## D-008 — JSON sources ship in v1

The BBC probe found a 91 KB `__NEXT_DATA__` island inside a 370 KB page,
containing navigation/`experiments`, with 30 `/news/articles/<id>` links in the
raw HTML and `pageProps.state` exposing `worldNewsFullScheduleUrl`. Article data
lives in HTML, islands, and separate JSON endpoints; a JSON path is the one
source shape that survives a redesign. `kind: 'json'` takes `itemsPath` +
relative field paths.

## D-009 — Deterministic scoring, no LLM

Recency decay + watchwords + source weight + headline substance. No randomness,
no network, no key: the same input must print the same front page at 3am and on
a train. **Reverse if:** 400 items/day makes keyword scoring insufficient — then
an optional local (Ollama/OpenAI-compatible) scorer, off by default.

## D-010 — Notifications: local Windows toast _(retired 2026-11-13 by D-045)_

One `node:child_process` call to PowerShell's toast API; no third party, no
account, no keys. Remote push (ntfy) is the obvious next notifier and is
deliberately deferred rather than half-built.

**Retired by the reader, with roadmap WP10 and the `notify` config block that carried
its five knobs** (D-045). The page answers "what arrived" in its own body — the SSE
flash, the health strip, the spine — and a paper that taps the reader for every publish
is a second product. Nothing emitted a toast in any release, so the retirement deletes
a schema, a config example, a published-schema file and a comment; no behaviour is
removed.

## D-011 — Sources in files, state in SQLite, one-way

A source definition file is the only source of truth; the web UI writes files,
never rows. The picker writes them, the scheduler reads them, and the DB holds
what the paper _learns_ — items, events, snapshots, validators, health — which
is rebuildable from `sources/` + a first poll. Two-way sync between UI and the
definition files is how corpora get lost. **Which directory is public is D-025's
question; this decision is about files being truth and the DB being derived.**

## D-014 — Exports are file formats, validated on the way in

The watchlist, the feeds, the config and the event history all export, because a
personal tool you keep for years must be portable and backup-able.

| Command                                            | Format                     | Notes                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm export --watchlist`                          | `newspa.watchlist.v1` JSON | Merges global `scoring.watchwords/blockwords` with per-source `watchwords`/`weight`. `$schema` tag; import refuses an unknown version.                                                                                                                                                                                  |
| `pnpm import --watchlist <file>`                   | same                       | `--merge` (union, dedupe) or `--replace`; validates with zod, writes atomically, prints the diff it made.                                                                                                                                                                                                               |
| `pnpm export --opml`                               | OPML 2.0                   | Exit ramp into any RSS reader. Loses weights and watchwords (no standard field), so it is not the archive.                                                                                                                                                                                                              |
| `pnpm import --opml <file>`                        | OPML 2.0                   | Creates `kind: 'rss'` source files at `weight: 1`, which you re-rate.                                                                                                                                                                                                                                                   |
| `pnpm export --bundle`                             | one JSON file              | **Built 2026-11-11** (`newspa.bundle.v1`): every `sources/*.json` plus the app config. Rule 18's only backup of the reading list, so it is **complete or refuses** — any source file that did not parse fails the command and writes nothing. Fixtures are not in it (they are the test corpus, not the reader's list). |
| `pnpm export --events --since <date> --format csv` | CSV                        | `new`/`edited` events with scores, timestamps, source, link.                                                                                                                                                                                                                                                            |

Rules: exports are stdout-friendly (`>` works), imports never guess (a
schema-version mismatch is an error, not a migration), and the web `/watchlist`
page calls the same handlers as the CLI, so there is one implementation.

The OPML **reader** is a scanner, not an XML parser (no dependency for six
attribute names), and that only holds if the scanner is quote-aware and never
silent. Measured on the first cut, on this project's own code: a single-quoted
`<outline text='x' xmlUrl='…'/>` was skipped with `issues: []`, `text="A > B"`
truncated the tag and dropped that feed, and `data-xmlUrl` matched as `xmlUrl`.
All three are the silent zero rule 5 forbids — and importing a reader's
subscription list is exactly where single quotes and `>` in titles appear. So
`parseOpml` accepts both quote styles, scans tags as quoted runs, anchors
attribute names at a word boundary, and **counts what it saw**: a zero-feed
result says "no outlines" or "N outline element(s), none with a usable xmlUrl",
never an empty issues list. If a real export needs more XML than that, the
honest fix is a parser dependency noted here, not a wider regex.

## D-020 — Change detection is layered, cheapest first, and never lies

Most polls of most sources produce no change, so a poll is a ladder:
conditional GET (`304`) → body-hash equality → the payload's own declared
timestamp → the full parse/diff/score path, each rung able to skip the ones
below it. **The rule that makes it safe: a cheap signal may skip work, it may
never suppress an item** - a `304` and a matching body hash prove no new bytes
exist; a matching declared stamp only skips scoring, after items were extracted.

**Revised 2026-11-11** (D-027, `decisions-detection.md`): the ladder is `304` →
body hash → **selection hash** → parse, and the declared-timestamp skip is **not
a rung at all** - it fired after the body was already in hand, saved ~50 ms of a
1 171 ms poll, and suppressed items on stealth edits (a page edited without its
stamp moved). That was true of feeds as much as of HTML, so the rung is gone for
every kind; the declared stamp is still **recorded** (`declared_modified_at`,
which the freshness note reads). A feed has no selection, so below the `304` its
only fast path is the body hash.

Two consequences are load-bearing, and they are why this is a decision and not
just a speed-up: a fast path that never fires must be **visible** (pages that
embed a build nonce never produce identical bytes, so per-source
`fastPathHits`/`fastPathMisses` counters and an `outcome` on every snapshot row
turn "the optimization is inert here" into a health note, per rule 5), and
header timestamps need their **own parser** (measured: `Date.parse` reads
asctime and zone-less ISO in the machine's zone, so a zone-less publisher
timestamp is UTC here, always - a story's age must not depend on which machine
opens the paper).

The full contract - the layer table, every header rule (`Retry-After` replaces
the backoff, `min(max-age, s-maxage)` becomes a cadence note, `Vary` is stored
for diagnosis), the document-tag list, and the DB state it requires - is
**docs/fetching.md**. The parsing is
`packages/core/src/{httpDate,validators,signals}.ts`.

**Reverse if:** the counters show a rung earns nothing on the sources you watch,
then delete that rung. The order is the contract, the rungs are not.

## D-046 — The log is pino: a clock, levels from config, one line per poll

The reader's question was "is there debug output showing when it fetches what?", and the
honest answer was no: the scheduler printed one line per source naming the rule that
**planned** the next run, a successful fetch printed nothing, and `cli.ts`'s `log` was
`console.log(line)` with no clock. Rule 6 already demands the record — "every poll's
`outcome` … is recorded, because an optimization that never fires is invisible" — and the
record lived only in the `snapshots` rows, which no command reads (`pnpm status` is a cut
command, WP5).

**The library.** `pino` (10.4.0; 11 pure-JS deps, **0 install scripts**, 0 native; the
whole store re-measured at 836 packages with 0 install scripts). Chosen for the three
things a prefix cannot buy: levels the reader dials, a JSON line for a pipe and for the
board (WP15), and a clock that both `jq` and a human read. Refused: `winston` (~10
packages of transports for one stdout), `debug` (namespaced toggling, no levels, no
structured line), and **`pino-pretty`** (10 deps of its own, worker threads) — the TTY
line is ten lines of ours, the same reasoning that hand-writes `sw.js` and refuses
Workbox.

**The shape.** `14:33:08 info strata-releases 200 changed · 10 items, +2 new · 60.3 KB ·
412 ms`, and `14:33:08 info bbc-world 304 not-modified · 38 ms` for a rung that counted
nothing (D-006: `itemCount: null` is an absence, so it prints no item clause, while
`0 items` is a claim and prints one). The words are `snapshots.outcome`'s, so the terminal
and the row cannot tell two stories. The plan line moves to `debug`, so the level a reader
sees is **fetches**, not schedules, and `server.logLevel` dials it (`silent` included) — a
setting in `config.json`, honoured at boot, which is D-042's rule.

**Measured on pino 10.4.0, and it changed the code.**

- `options.stream` is **accepted and ignored**: the record goes to stdout anyway, so a
  formatter attached to it never runs. `pino(options, destination)` honours the stream,
  synchronously. The first cut used the option, and the tests went red on an empty bag —
  rule 5's silent zero in a library's clothes, caught by a test and not by reading docs.
- `base: undefined` is the documented way to drop `pid`/`hostname`, and
  `exactOptionalPropertyTypes` rejects it; `base: {}` drops them (measured).
- `formatters.level` is what makes the JSON line say `info` and not `30`: a board's log
  file should not require knowing pino's table.

**Reverse if:** the terminal needs more shape than one line per poll. The seam is
`logger.ts`: the scheduler, the routes and the boot only ever hold `(line: string) => void`
and its `debug` twin, so the engine behind them is replaceable by a print.
