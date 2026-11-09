# Decisions

Each entry states what was chosen, why, the evidence, and what would make us
reverse it. `AGENTS.md` requires a note here for every new dependency.

Pipeline, data, identity and behaviour: the pipeline shape, item identity,
the diff, render at pick time, JSON sources, scoring, notifications, source
files in git, exports, and change detection.

Tooling, dependency, testing and paper-shape decisions live in
`decisions-tooling.md`.

## D-001 — One hard-coded pipeline, not an agent graph

Huginn's power is a configurable graph of agents; its cost is Rails + MySQL +
Redis + Sidekiq + Compose and a mental model of scenarios. We fix the graph in
code: `fetch → parse → normalize → diff → score → publish`, six stages, one typed
record between them. Huginn vocabulary is kept where it is cheap: WebsiteAgent →
`html` source, RSSAgent → `rss`, DataOutputAgent → the paper, PostingsAgent →
toasts, EventFormatter → the record schema, Scenario export → `sources/*.json`.
**Reverse if:** a source needs a transformation that cannot be expressed by the
three parsers plus `fields`/`strip`/`itemsPath`. Then add a stage, not a graph.

## D-002 — The page is the product; no static edition, no SSR (**reversed from the first cut**)

The paper is one ever-changing page at `http://127.0.0.1:8787`: SSE pushes what
changed, the DOM re-renders, read markers and search work on the same state. There
is **no edition file, no `editions/` directory, no `react-dom/server`, no cycle-time
artifact, no static route**. The DB is the record; the page is the paper.

The first cut of this decision said the opposite: at the end of every cycle, render
`editions/<id>/index.html` with `renderToStaticMarkup` (inlined CSS, zero JS). It
was reversed on the evidence of the product's own shape — **there is no single
cycle and no single edition.** The page changes continuously, so a file named after
a day does not describe it, and the "print the edition" story was a print-era habit
imported into a tool that prints nothing. Cost of the reversal: no mailable single
file, and the record is a database query rather than a document.

What survives from the reasoning, because it was never about the file:

- **No request-time SSR.** At `127.0.0.1` the render cost is identical and merely
  relocated into the process that runs the poller and the Edge pool; measured
  latency to real sites is 121–648 ms, localhost 1–5 ms, so first paint was never
  the bottleneck. SSR would add hydration mismatch, CSS ordering, a dual-environment
  data layer and a crash surface to the one process that must survive 3am.
- **A record must exist**, because stealth-edit detection is meaningless without
  what the page said at the time. It does: `items`, `item_events` with the word
  diff, and `snapshots` (one row per poll, 304s included). `pnpm search` reaches it.
- **`@media print` stays** in the paper CSS (3 columns, masthead preserved, hairlines
  kept): browser Print → Save as PDF on the live page is 80% of the print value for
  free, and it is honest about which state it prints — the one you are looking at.

**Reverse if:** a dated document becomes the point (a weekly digest by email, a
printout for a fridge). Then it is an _export_ on demand — `pnpm export --paper
2026-11-08` writing one self-contained file from the same `packages/paper`
components — not a cycle-time side effect with a retention policy.

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
HTML source with **no `list`** is one item, keyed by
`contentKey(sourceId, pageText)` — the hash of its whitespace-normalized text,
taken before the body cap. "The text differs from the cache" is the whole change
model, which is the change model: a version page, a status page, a changelog.
Re-indenting the markup is not a change; a new version line is. `strip` runs
**before** hashing, because a ticking "last updated" would otherwise reprint the
page on every poll.

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

## D-010 — Notifications: local Windows toast

One `node:child_process` call to PowerShell's toast API; no third party, no
account, no keys. Remote push (ntfy) is the obvious next notifier and is
deliberately deferred rather than half-built.

## D-011 — Sources in git, state in SQLite, one-way

`sources/*.json` is the only source of truth; the web UI writes files, never
rows. Selector history is `git log`; fixtures replay past editions. Two-way sync
between UI and git is how corpora get lost.

## D-014 — Exports are file formats, validated on the way in

The watchlist, the feeds, the config and the event history all export, because a
personal tool you keep for years must be portable and backup-able.

| Command                                            | Format                     | Notes                                                                                                                                  |
| -------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm export --watchlist`                          | `newspa.watchlist.v1` JSON | Merges global `scoring.watchwords/blockwords` with per-source `watchwords`/`weight`. `$schema` tag; import refuses an unknown version. |
| `pnpm import --watchlist <file>`                   | same                       | `--merge` (union, dedupe) or `--replace`; validates with zod, writes atomically, prints the diff it made.                              |
| `pnpm export --opml`                               | OPML 2.0                   | Exit ramp into any RSS reader. Loses weights and watchwords (no standard field), so it is not the archive.                             |
| `pnpm import --opml <file>`                        | OPML 2.0                   | Creates `kind: 'rss'` source files at `weight: 1`, which you re-rate.                                                                  |
| `pnpm export --bundle`                             | directory                  | `sources/`, `newspa.config.json`, watchlist, fixtures. The backup: the DB is rebuildable from it, fixtures replay history.             |
| `pnpm export --events --since <date> --format csv` | CSV                        | `new`/`edited` events with scores, timestamps, source, link.                                                                           |

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
