# Architecture

## One process

`node packages/server/src/cli.ts start` is the whole product. No cron, no queue,
no Redis, no separate web server, no Vite at runtime.

```
newspa (one node process)
├── scheduler      per-source setTimeout chain: cadence + deterministic jitter + exponential backoff
│                  catch-up pass at boot, so a 09:00 reboot fetches what the night missed
├── pipeline       fetch → parse → normalize → diff → score → publish
├── db             node:sqlite, WAL, FTS5  (synchronous: bounded queries only)
├── http           node:http on 127.0.0.1:8787
│                  /api/state  /api/items  /api/search  /api/health
│                  /api/sources (GET, POST=write a sources/*.json file — local dir, D-025)
│                  /api/events (SSE)  / (apps/web/dist)
└── pool           playwright-core + channel 'msedge', bounded, for render:true sources

child processes: Edge (scrape/pick), PowerShell (toast). Nothing else.
```

`pnpm dev` is two processes (Vite dev server + `node --watch`), dev only.
`pnpm start` serves the prebuilt `apps/web/dist` from node; `pnpm build` is a
separate, explicit step, never part of the start path.

## Why one process, and what it costs

Chosen deliberately over a split poller/web-server. **Cost:** shared fate — a
crash takes polling and the UI together. Non-negotiable mitigations:

- per-task `try/catch` inside the scheduler, so no tick rejects to top level;
- a `process.on('unhandledRejection')` / `uncaughtException` last resort that
  writes to `system_log` and **survives** (Node 26 terminates the process by
  default, which is exactly the 3am silent gap this tool must not have);
- a single-instance lock on the port and on the DB file (`O_EXCL` lockfile) so a
  double start cannot interleave writes;
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
5. Parser (rss / html / json) → `PickedItem[]`; identity from the canonical link.
6. `diff` against the stored baseline → `new | edited | gone`; `edited` requires
   `meaningful` from the word diff (typo filter).
7. Burst breaker: >40% new keys, or matches ≪ `matchCount` → `restructured`,
   suppress publishing, keep the baseline. The stored `generator` and `vary` make
   that diagnosis a sentence, not a guess. The opposite direction is a **parse
    fault**: an HTML `list` matching **more** nodes than the source recorded is
   `multi-match` (D-026: one node per source) → `errorKind: 'parse'` → `error`,
   with both counts in the note.
8. `score` deterministically (watchwords, source weight, recency, headline substance).
9. Write: `items` upsert, `item_events` insert, `snapshots` insert (one row per
   poll, including the 304s), `sources.health` + validator state, `system_log` for
   anomalies. A `Retry-After` on a 429 replaces the exponential backoff for that
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
