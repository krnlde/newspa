# Decisions — detection, selectors, cost

The decisions about **how the paper notices that something changed**: what a
selector is allowed to match, the rungs of the HTML ladder, identity for pages,
what `gone` means, what the link base is, which selector languages each tier
speaks, and the measured cost of the alternatives.

Scope split: pipeline/data/behaviour in `decisions.md`, tooling and dependencies
in `decisions-tooling.md`, detection in this file. Numbering is shared, so
D-025 (reading list local) lives in `decisions.md` and is referenced here.

**Status rule.** D-026 … D-033 are **agreed**; D-027 (the selection rung),
D-028 (page-mode identity) and D-026's **parser half** (the `multi-match` fault)
are **implemented**, the rest are not built — each entry says what.
`docs/fetching.md` and `docs/state.md` describe what the code does
_today_, and are amended by the commit that lands each rung, not by
this document. Every number below is measured in this session (Node 26.2.0,
cheerio 1.9.2, playwright-core 1.60.1 + Edge 142, real pages, local).

## D-026 — An HTML selector matches exactly one node: the newest entry  _(parser half implemented 2026-11-11)_

The reader's rule, stated as policy: **"I will never put a selector that selects
more than 1 DOM node."** One HTML source is one subscription to "the newest thing
on this page", not a crawler. The consequence is accepted on purpose: a page with
ten new items yields one item, and the reader finds the other nine on the site.

|                                       |                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why**                               | The purpose of a poll is to learn **that** something changed. Coverage is the site's job; the paper's job is the nudge plus the link (D-017).                                                                                                                                       |
| **Cost of the alternative, measured** | A ten-node HTML source polled in a browser, 24 sources at 20 min: **1 440 launches/day ≈ 10 min of process churn + 41 min/day of `goto` + 1.7 GB/day of traffic**, and 57–114 browser-hours over a 7-hour night.                                                                    |
| **Enforcement**                       | `list` matching more than one node is a **`multi-match` fault** (rule 5), not a silent first node. _(parser half implemented 2026-11-11, mapped to `errorKind: 'parse'`.)_ **The `pick` half is not built:** `src/pick.ts` does not exist, so `matchCount` is hand-authored.        |
| **Why the DevTools selector failed**  | `section.mb-4:has(a[id^="release-list-title-"])` matched 10 nodes; narrowed to a node whose only child is `<h2>`, so the title extractor had nothing to take → `no-usable-items` / `item 1: no title`.                                                                              |
| **Why the two XPaths failed**         | cheerio rejected them as CSS (`invalid-selector`); run in real Chromium with `document.evaluate` they returned **0 nodes** — `document.body` has 4 element children and the path dies at step 5 of 14. `copy selector` in DevTools yields the _element's_ path, not a list pattern. |
| **What works on the same page**       | CSS `section[data-release-anchor]` → 10 nodes in the saved payload, in logged-out Chromium and in Edge. A data attribute, not layout.                                                                                                                                               |
| **Reverse if**                        | A reader genuinely wants a page's full list mirrored. Then a `multi` mode with an item ceiling (feeds have `maxItems`, HTML has none) — and the browser cost above is paid, not waved away.                                                                                         |

## D-027 — The HTML ladder: `304` → body hash → **selection hash** → parse  _(implemented 2026-11-11)_

`D-020`'s order, specialized for HTML. Three rungs, not four.

| Rung               | Cost                                                      | What it buys                                                                    |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `304`              | 0 bytes                                                   | "nothing happened", and it is the common answer on the sources that support it. |
| Body hash          | the fetch you already paid for                            | one comparison.                                                                 |
| **Selection hash** | parse + serialize the **matched node** (not the document) | "the headline changed" vs "a footer changed".                                   |
| Parse + diff       | parse, measured 2.2–52 ms                                 | the facts.                                                                      |

- **The declared-timestamp skip is removed — for every kind, not only HTML.** It
  fired at `signals.declaredStamp <= validators.declared_stamp &&
  !changedByLength` — i.e. **after** the body was in hand — so it saved no
  traffic and about 50 ms of a 1 171 ms poll, and it suppressed items when the
  site edited a page without moving `Last-Modified`. A feed is exposed to the
  same failure (a publisher restamps on publish, and edits afterwards), so the
  rung is gone for feeds and JSON as well; `declared_modified_at` is still
  written, because the freshness note reads it. `declared-unchanged` stays a
  legal `outcome` value: the rows it wrote are history.
- **Cheap signals never suppress** (D-020): the rung's name is
  `selection-unchanged`, it _skips_ the item pass, and it cannot mark an item
  read. Its own `null` contract is what keeps it honest — page mode, a feed,
  JSON, a selector that matched nothing and CSS the engine rejects all answer
  "no opinion", and a `null` never matches.
- **Counters** on `source_validators` are the pair that already existed,
  `fast_path_hits` / `fast_path_misses`, where a **hit is any poll that skipped
  the item pass** — so the selection rung counts as a hit and a `changed` poll
  is the miss. That is one pair, not per-rung counters: `hits: 0` with 400
  misses already reads as "the cheap signals are inert here", which is the
  visibility the rule asks for, and it is the number a health note can print.
- **The comparison unit stays the item**: `textOf` = title + body, with
  `minEditRatio` as the noise floor. A **document** text-diff is the number that
  reads the template: on CNN's lite page, one added article = **1 131 changed
  words, 36 added** — the 36 are the story, the 1 131 is the template moving.
- `strip` stays first-class: **page mode has no selection**, so `strip` is the
  only knob the whole-page rung has.

## D-028 — The page's identity is an address: `<id>:page`  _(implemented 2026-11-11)_

The measured defect: a page-mode source (HTML with **no `list`**) was keyed by
`contentKey(sourceId, pageText)` — a hash of the page's own text — so the key
moved every time the page moved. On the real row: `nodejs:hfc60fe36` →
`nodejs:h0c339c75` → `nodejs:hd3d6989d` — twelve `new` events for one slot, and
twelve read markers asked of the reader.

|                              |                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The fix**                  | `pageKey(sourceId)` → `<id>:page`. The key is an **address**, so the slot is **one item that gets edited**: `pollItems` finds the previous row by key and compares its text (`textOf` + `minEditRatio`), so the paper says _edited_ with a word diff.                                                                                                              |
| **The consequence, settled** | Page-mode change detection now reads the **stored** text, which `capBody` cut at 1 200 chars — a window on the page, not a page. So page mode stores `capPageBody` (6 000). Rule 7 survives: the text is evidence, never content (`ItemView` has no `body`, so nothing reaches the browser), and it is one row per page source, edited in place, not one per poll. |
| **Item mode needs nothing**  | An HTML source **with** a `list` keys on the item's canonical link (D-005) and was already stable — `node-releases:tag:…releases/tag/v0.2.13`. Under D-026 (one node) that item's link is the newest entry's, so a new entry is a **new item**, which is correct, and the vacated slot is D-029's `moved`/`removed`.                                               |
| **No `sel<hash>`**           | The first draft of this decision proposed keying a selector slot as `<id>:sel<sha1(list)>`. Not needed: item mode already has a stable per-item key, and page mode has one address. Inventing a third key shape would be identity churn with better branding.                                                                                                      |
| **What `strip` is now**      | The noise knob, not the identity knob. Ticking text in the compared text reports an edit every poll — the same failure as the reprinting hash, in a quieter shape.                                                                                                                                                                                                 |
| **Existing rows**            | A page source's old `:h…` row stops being updated the first poll after this lands; it stays in the paper as history. No migration: the DB is derived (D-011), and deleting `data/` is allowed.                                                                                                                                                                     |
| **Reverse if**               | The reader wants a page's edits to arrive as separate stories (a changelog read as a feed). Then it wants a `list`, not a page source — item mode is that shape.                                                                                                                                                                                                   |

## D-029 — `gone` is a fact about the world, and a failed poll is never evidence

`gone` exists in the schema, is emitted by `diffItems`, is rendered as a strikethrough, and
**is emitted by no poll today** — the server's `diffForSource` passes
`previous: null`, and the 304 and unchanged-hash rungs return early, so a source
that quietly stops listing an entry says nothing. HN's shape is the proof: a
deleted story is a **link that 404s with `{"code":"Deleted"}`**, and a dead
comment id 422s — the world tells us things, we do not listen.

**Level 1 — item-level** (`rss`/`json`, a closed set): an item present last poll,
absent for **K consecutive successful, non-truncated** polls → `gone`. Truncated
polls (the source's own ceiling) and burst-suppressed polls are not evidence.

**Level 2 — source-level** (`html`, one slot). `gone` needs an event, not a
silence:

| Event      | Trigger                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| `archived` | `404` / `410` / `451`, a soft-404 shape (status 200, title says 404), **selector 0 matches for K polls** |
| `moved`    | the item's link changed, the final URL changed, a redirect chain that does not end at the recorded URL   |
| `closed`   | source disabled / definition file deleted                                                                |

- **A failed poll is never evidence of absence** — timeout, `403`, `429`, `5xx`,
  paywall, bot wall. Those are D-020's "never lie" cases.
- **Feeds stay interlocked** by `burst.newRatioThreshold`: the 77-of-77 example
  in `decisions.md` D-020 is the same failure as "everything is gone"; the `gone`
  ladder is interlocked with the same burst window.
- **A `gone` slot is a door left open**, not a row marked dead: the UI shows
  _archived_, and the paper keeps polling the source.
- **No tombstone by default.** HN's `dead` story returns `title: "[dead]"` with
  the real title, so a tombstone is free and honest _only_ for APIs that answer
  this way; 0-matches HTML has no title to store.

## D-030 — The link base is the URL that answered

Today link resolution uses `spec.url` (`absoluteLink(href, spec.url)`), and
`fetch` already records the final URL (`FetchResponse.url`, `redirected`), while
`poll.ts` throws that information away. Measured: a payload served from
`cdn.example.com` resolved against the recorded `old.example.com` yielded
`https://old.example.com/world/2026-11-10/thing-1` — the item's text is from the
payload, its link is from the _old_ place. `resolveUrl` is correct; the base is
the bug.

- **Rung 1, now:** resolve against the response's `url`. It is correct today, and
  it makes a permanent redirect self-healing: every subsequent poll follows it,
  costs one hop, and is silent.
- **Rung 2, cheap:** count redirects on the source row; a source that answers 301
  on most polls gets a health note.
- **Rung 3, the only state:** a **migration proposal**. On `redirected`, the poll
  offers `final_url`; nothing is written. `pnpm sources:migrate` (or the web UI)
  applies it through `writeSource` — an authored change, per D-011 — and the
  source carries a `url_migrate` counter so the cost of not applying it stays
  visible.
- **Why not "store the chain"**: a chain is state, and the state is the redirect.
  Following it is the right behaviour; making it permanent is a decision the
  reader makes.

## D-031 — Selector languages by tier

| Tier          | Engine                               | Languages                                      | Evidence                                                                                                                                                                                                                      |
| ------------- | ------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feeds         | tag ladders (`pickFirst`/`pickText`) | element names, not selectors                   | `rssFields.ts`; `media:content[...][url]` is already attribute-picking, so the ladder is the same idea, made general (a general version needs `node.children()` + `nodes()`, which the current helpers do not expose).        |
| JSON          | paths                                | `itemsPath`, `fields`                          | `jsonFields.ts`; dot/bracket paths are the right shape.                                                                                                                                                                       |
| Bytes HTML    | cheerio                              | CSS **plus** `parent`/`preceding-sibling` axes | cheerio's `xpath` package **is installed** (it ships cheerio's transform), but `fieldNode` only uses `find`/`filter`, which cannot reach the DevTools copy-paste shape. The axes are already in cheerio, free, no dependency. |
| Rendered HTML | playwright                           | CSS **and** `xpath=`                           | `locator(selector)`: `data-*` prefixes are CSS, `//` is xpath, natively.                                                                                                                                                      |

- **`xpath=` prefix, render tier only.** No cheerio xpath: measured on
  `npm view` — 28 KB, 12-month mean ≈ 556, last publish 2023, i.e. not dead and
  not maintained.
- **XPath in the bytes tier is a documented limitation.** `pick` prints the
  selector and the count it got; when the input is an XPath and the count is 0,
  it prints the CSS that would work.

## D-032 — Noise is controlled by stability at pick time, and an edited-streak note

No new noise control is invented at runtime, because the data is already stored
(`textOf` + `minEditRatio`, `item_events`, `source_validators.varied`).

1. **Pick time, a two-fetch stability probe.** Fetch the page twice, run the
   candidate selector, and show the diff of the extracted text. The reader sees
   whether the node they chose is a headline or a rotating promo. A selector is
   picked, not guessed (D-007's posture).
2. **The pick output prints the word diff** of the extracted node, so a template
   node is obvious at the moment of choosing.
3. **At runtime, an edited-streak health note**: "this source reported an edit on
   12 of its last 12 polls" — computed from rows that already exist, no new
   storage.
4. **The image rule** is a _validation_ rule, not a filter: an image URL whose
   shape is a query-string blob (measured:
   `…/refs?tag_name=v0.2.13&experimental=1` chosen as a story image; GitHub's
   `media:thumbnail` 30×30 avatar chosen over the 256px `media:content`) yields
   `image: null`, and the paper prints no placeholder (rule 5: a null is a
   statement, not a 404 in an `<img>`).

## D-033 — A browser per poll is off the table; `render: true` stays pick-time

The measurement that ends the argument (Edge 142, local, `channel: 'msedge'`):

|                                          |                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Launch + first goto                      | **208–214 ms**                                                                  |
| Second `goto` of the same page           | **858 ms** warm, **1 595 ms** cold (first run includes Edge's first-run window) |
| Serialized DOM of GitHub's releases page | **606 787 B**                                                                   |
| cheerio poll, live (fetch + parse)       | **1 171 ms**, 304 = **0 bytes**                                                 |

At 24 sources / 20 min the browser is **57–114 browser-hours over a 7-hour
night**, 1 440 launches a day. So: parse bytes with cheerio, render only what
D-007 marked at pick time, and keep the pool bounded. **Reverse if** a source is
only readable rendered — then it is `render: true`, and the cadence and the
`maxRenderPerPoll` budget are set with these numbers in front of them.

## Open, not decided

- **`<picture>` as a source** — `NOISE_SELECTOR` strips `picture`/`source`
  _before_ `imageFrom`, so `<picture><source srcset><img src>` yields
  `image: null` (reproduced against the shipped code). Fix = look inside the
  element being cleaned. `imageAttr: 'data-src'` works today.
- **Feeds ship 10 entries.** GitHub's `releases.atom` carries 10 items with real
  decks — the _deck_ is the thing, not the count.
- **`sources:init` and the empty directory** — **decided** (D-025's "First run"
  row): boot creates the directory through `ensureSourcesDir`, the loader reports
  `missing-dir` / `no-sources`, and `pnpm sources:init` keeps exactly one job —
  copying the **example files**, which no `mkdir` can do. `writeSource` has
  created the directory for itself since the first commit, so every writer is
  already resilient.
- **The WP3 cost answer.** Per-source scheduler cost is now a _policy_ question
  with a measured price: 304 where the server supports it, body hash, selection
  hash, parse. The expensive rung is the browser, and D-026 is what keeps the
  browser off the hot path.
