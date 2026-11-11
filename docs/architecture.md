# Architecture

## One process

`node packages/server/src/cli.ts start` is the whole product. No cron, no queue,
no Redis, no separate web server, no Vite at runtime.

```
newspa (one node process)
├── scheduler      one tick loop (60 s): the sources due by `next_run_at`, in a bounded
│                  batch (24), one poll at a time. Per-source plan: pause → ×4 backoff →
│                  cron (at zero failures) → cadence, render floor + quiet hours on top.
│                  Boot is the catch-up: a `null next_run_at` leads every batch
├── pipeline       fetch → parse → normalize → diff → score → publish
├── db             node:sqlite, WAL, FTS5  (synchronous: bounded queries only)
├── http           node:http; host and port from config.json (default 127.0.0.1:8787;
│                  `0.0.0.0` opens it to the LAN, and the boot says what that means, D-034)
│                  built:  GET /api/state · GET /api/events (SSE) · /api/sources (GET the
│                  files, POST writes sources/<id>.json from raw text, DELETE disables
│                  the row and removes the file — D-011) · / (apps/web/dist)
│                  named as not built, in the body of a 404: /api/items, /api/search
│                  writes from a non-loopback peer: refused 403, on the address, before
│                  routing (D-034) — no route authenticates, and rule 20 forbids adding
│                  a token to make a LAN write safe
│                  /api/sources, every verb: loopback-only (rule 18) — its answer is the
│                  source files themselves, so the editor is a machine-local tool and a
│                  LAN peer gets the 403 sentence, which the page prints
└── pool           playwright-core + channel 'msedge', bounded, for render:true sources

child processes: Edge (scrape/pick), PowerShell (toast). Nothing else.
```

`pnpm dev` is two processes (Vite dev server + `node --watch`), dev only.
`pnpm start` serves the prebuilt `apps/web/dist` from node; `pnpm build` is a
separate, explicit step, never part of the start path.

## Why one process, and what it costs

Chosen deliberately over a split poller/web-server. **Cost:** shared fate — a
crash takes polling and the UI together. Non-negotiable mitigations:

- a `try/catch` per poll **and** per batch inside the scheduler, so no tick rejects
  to top level (measured: the per-poll catch keeps a fault's failure count and plan,
  the per-batch catch keeps the loop alive);
- a `process.on('unhandledRejection')` / `uncaughtException` last resort that
  writes to `system_log` and **survives** (Node 26 terminates the process by
  default, which is exactly the 3am silent gap this tool must not have);
- a single-instance claim on the database: the `db_lock` row, taken by a token at
  open (a second process gets `DatabaseLockedError`), extended every batch, stale
  after 10 minutes. So a double start cannot interleave writes. A claim on the
  **port** is not built and is not needed: the database claim means two processes
  can never both poll, whatever they bind (D-034);
- `SIGINT`/`SIGTERM` close the Edge pool, checkpoint WAL, then exit;
- `PRAGMA busy_timeout`, one connection for writes.

## Event-loop budget

`node:sqlite` is synchronous and global `fetch` is not, so the loop mixes two
kinds of work:

| Work                        | Where it runs      | Guard                                                                             |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------- |
| HTTP fetch of a source      | off-loop (undici)  | `AbortSignal.timeout`, `maxBytes` on decoded bytes, `maxConcurrentFetches`        |
| cheerio parse of ~370 KB    | on-loop, ~ms       | one source at a time, concurrency-capped                                          |
| SQLite read/write           | **on-loop (sync)** | indexed, `limit<=200`, no `SELECT *`, retention pruned in small batches off-cycle |
| word diff of an edited item | on-loop, bounded   | LCS cell cap (`MAX_LCS_CELLS`) with a coarse fallback                             |
| scoring a page of items     | on-loop            | `setImmediate` yield every 500 items                                              |
| Edge page scrape            | out-of-process     | pool cap `maxConcurrentRenderers` (default 1), per-page timeout                   |
| page assembly for `/api`    | on-loop            | bounded by the query `limit<=200`; the paper is a view of the DB, not a file      |

Measured context: a real fetch is 121–648 ms; a localhost request is 1–5 ms.
60 plain sources at 20 min cadence is ~3 fetches/minute — trivial. 20 `render: true`
sources is not, which is why the JS tier is deliberately capped in the config.

## Data flow of one poll

1. `scheduler` picks due, enabled sources (jittered, backed off after failures).
2. `fetch` layer chooses the transport: plain `fetch` (default) or Edge (`render: true`),
   sends pinned headers/cookies and `If-None-Match`/`If-Modified-Since`
   (`conditionalHeaders`, one second before the stored `Last-Modified`).
3. **Cheap-signal ladder** (docs/fetching.md, D-020): `304` → body hash equals
   the last stored body → the payload's stored body, and the **selection hash**
   of the node the source watches equals the stored one
   (D-027) → only then the full path. A rung may skip work; it may never suppress
   an item, and the declared timestamp is recorded, not obeyed: the rung that
   skipped the parse on an unchanged stamp is gone. The `outcome` lands on the `snapshots` row and the
   per-source `fastPathHits`/`fastPathMisses` counters keep an inert fast path visible.
4. `sniff` decides what arrived by content, not by `content-type`
   (`<?xml`/`<rss`/`<feed`), because `old.reddit.com/….rss` measured as
   `200 text/html`. A source parsed as a kind it is not is a **health error**,
   never a zero-item success.
5. Parser (rss / html / json) → `PickedItem[]`; identity from the canonical
   link, resolved against the URL that **answered** (D-030: `withBase(spec,
    res.url)` — after a permanent redirect the text and the link are from one
   place, and following it does not rewrite the reader's file).
6. `diff` against the stored baseline, `new | edited`; **`gone` is a streak and not
   a diff (D-029)**: core's `goneVerdicts` counts the polls whose item set was
   **settled** — a parse not cut at `maxItems`, or a rung that proved the set
   unchanged — and at K = 3 the poll writes one `gone` event, built from the
   **stored** title and link; a key that comes back is reopened, not resurrected.
   `edited` requires `meaningful` from the word diff (typo filter).
7. Burst breaker: >40% new keys, or matches ≪ `matchCount` → `restructured`,
   suppress publishing, keep the baseline. The stored `generator` and `vary` make
   that diagnosis a sentence, not a guess. The opposite direction is a **parse
    fault**: an HTML `list` matching **more** nodes than the source recorded is
   `multi-match` (D-026: one node per source) → `errorKind: 'parse'` → `error`,
   with both counts in the note. **Unbuilt:** `detectBurst` is in core and no poll
   path calls it, so the disappearance ladder has no burst interlock (D-029).
8. `score` deterministically (watchwords, source weight, recency, headline substance).
9. Write: `items` upsert, `item_events` insert, `snapshots` insert (one row per
   poll, including the 304s), `sources.health` + validator state, `system_log` for
   anomalies. The ladder's two columns (`missing_streak`, `gone_at`) are written
   only by `items.markStreaks`, scoped to the source, from `items.storedKeys` — the
   whole key set, never `items.list`, because a page cannot answer a question about
   absence. The upsert does not name those columns, so re-seeing a key never resets
   its count. A `Retry-After` on a 429 replaces the exponential backoff for that
   poll, capped by `backoffMaxMs`.
10. Publish: SSE `item:new` / `item:edited` / `source:health` / `cycle:complete`;
    toast for high-score new items. **Nothing is written to disk as a report**: the
    page in the browser is the paper, re-rendered from the DB as events arrive
    (D-002 reversed).

## State

| Path                              | Contents                                                          | In git |
| --------------------------------- | ----------------------------------------------------------------- | ------ |
| `sources/*.json`                  | source definitions — the only source of truth                     | **no** |
| `sources.example/*.json`          | placeholder definitions, so a clone boots (D-025)                 | yes    |
| `packages/fetch/test/fixtures/`   | captured payloads for parser tests                                | yes    |
| `data/newspa.db` (+`-wal`,`-shm`) | items, events, snapshots, health, read markers                    | no     |
| `profiles/<sourceId>/`            | persistent Edge profiles (login cookies live here, not in the DB) | no     |
| `data/snapshots/`                 | raw responses, capped per source                                  | no     |

Secrets policy: the DB never stores credentials. Logged-in sources reference a
profile directory. A profile folder is plaintext cookies on disk — stated,
accepted for a personal tool on your own machine, and the place to harden if
that ever stops being true.

## Modules

| Package         | Responsibility                                                              | Must not                                 |
| --------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `newspa-core`   | record schema, wire contract, normalize, diff, score, health, the day clock | import `node:*` (the web app imports it) |
| `newspa-config` | zod schemas for sources + app config, file loading, watchlist, OPML         | touch the DB                             |
| `newspa-paper`  | the newspaper components and the paper CSS                                  | import `node:*`, do layout math in JS    |
| `newspa-db`     | schema, migrations, repositories, FTS5                                      | know about HTTP                          |
| `newspa-fetch`  | transport (fetch/Edge), sniffing, 3 parsers, picker                         | read config files (it receives specs)    |
| `newspa-server` | CLI, scheduler, pipeline, routes, SSE, toasts                               | implement parsing                        |
| `apps/web`      | the paper, sources UI, health strip, search, i18n, picker preview           | import node builtins                     |

## CLI (the API is the CLI)

```
pnpm start              node packages/server/src/cli.ts start
pnpm pick -- <url>      headed Edge, click-to-pick, prints + writes a source file, saves a fixture
pnpm login -- <url>     headed Edge with a persistent profile, log in by hand once
pnpm edition [id]       print today's/past edition to stdout, or open the static file
pnpm status             per-source health table
pnpm search -- <q>      FTS5 search over the corpus
```
