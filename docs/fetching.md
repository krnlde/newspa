# Fetching: how a poll decides there is nothing to do

The poller's job is to notice change. Most polls of most sources produce none,
so the work is arranged as **layers, cheapest first**, and each layer may skip
the layers below it. The record of _why_ a poll did the cheap thing is part of
the design: an optimization that silently never fires is invisible, and
"silent zeros are bugs" (AGENTS.md rule 5) applies to a fast path that never
hits exactly as much as to a source that returns nothing.

The code is `packages/core/src/{httpDate,validators,signals}.ts` (pure,
browser-safe, fully tested) and, when it lands, `packages/fetch` (transport)
and `packages/server` (the state machine that uses them).

## The layers

| #   | Check                                    | Cost                      | What it proves                            | Outcome recorded     |
| --- | ---------------------------------------- | ------------------------- | ----------------------------------------- | -------------------- |
| 0   | Conditional GET → `304`                  | one round trip, no body   | nothing changed (strong)                  | `not-modified`       |
| 1   | Body hash equals the last stored body    | one round trip + one hash | nothing changed (strong, for our purpose) | `same-body`          |
| 2   | Declared timestamp equals the stored one | parse of a few tags       | the page claims it has not moved (weak)   | `declared-unchanged` |
| 3   | Parse → diff → score                     | the expensive path        | what actually changed                     | `changed`            |

Layer 1 is the biggest win and needs no cooperation from the publisher: the
same bytes contain the same items, so parsing is redundant. It is also the
layer that fails most often in practice, because a page that embeds a build
nonce, a `Date:` comment or a CSRF token never produces the same bytes twice.
That is not a defect of the check, it is a property of the source, and the
**per-source counters make it visible** (see below).

Layer 2 is a hint. A publisher that stamps the footer with the build time
declares a change on every poll — the cost of that is a full parse, which is
the correct price for a page that tells us nothing.

## The trust rule

**A cheap signal may skip work. It may never suppress an item.**

Concretely: a `304` and a matching body hash skip parse, diff and score,
because no new bytes exist. The declared-timestamp rung sits **before** the
parse, as the ladder's order says (`304 → body hash → declared timestamp → full
parse`): when the payload's own newest timestamp is unchanged, the parse does not
run. Nothing is extracted, so nothing is dropped — the items the last parse
produced stay published, with their counts, and the ladder's counters record the
hit.

The cost is stated where it can be seen: a publisher that edits a story
_without_ restamping its declared timestamp (`<lastBuildDate>`,
`article:modified_time`, JSON's `dateModified`) is not seen until it restamps
or the declared signal disappears. That is the deal D-020 makes — the payload's
own declaration is the cheapest signal available, and it is trusted. The
boundary is pinned by a test (`poll-edits.test.ts`: "layer 2 is the boundary"),
and a source that stamps once a day shows up as `fastPathHits` climbing.
Where the declaration is absent (most HTML pages, most JSON endpoints), layer 2
never fires and the body hash is the only fast path below the `304`.

## HTTP inputs

| Header                      | Used for               | Rule, and why                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ETag`                      | `If-None-Match`        | Sent back verbatim, strong (`"x"`) or weak (`W/"x"`). The weak indicator is case-sensitive; a lowercase `w/` is sent back as-is because an opaque validator asks for that.                                                                                                                                                         |
| `Last-Modified`             | `If-Modified-Since`    | Sent as **one second before** the stored value: the resolution is 1 s and servers compare inclusively, so an exact echo risks `412`. Dropped if it is more than 5 min ahead of the response's own `Date` — a skewed CDN `Last-Modified` is measured, and asking for content the server has not sent is a 304 we cannot trust.      |
| `Date`                      | skew reference         | Compares `Last-Modified` against the server's clock, not ours.                                                                                                                                                                                                                                                                     |
| `Cache-Control`, `s-maxage` | the cadence floor hint | `freshnessSeconds = min(max-age, s-maxage)`, `0` for `no-store`/`no-cache`. A CDN holding a page for 300 s means a 60 s cadence cannot see news sooner; that is surfaced as a health note, never applied to the user's cadence silently.                                                                                           |
| `Retry-After`               | backoff                | Delta-seconds or an HTTP date, clamped non-negative. It replaces the exponential backoff for that one poll, capped by `backoffMaxMs` — the server's number is better information than ours.                                                                                                                                        |
| `Vary`                      | diagnosis              | Stored per source. A `Vary: Accept-Language, Cookie` we do not send consistently can make a `304` serve a variant, which shows up as a mysterious `restructured` state; the field makes that diagnosable instead of mysterious. Cookies and `Accept-Language` are pinned per source, which is what makes reusing a validator safe. |
| `Content-Type`              | sniffing               | Already decided in D-006: `old.reddit.com/r/worldnews/.rss` answers `text/html`, so the payload, not the header, picks the parser.                                                                                                                                                                                                 |

## Document inputs

Read out of the payload by `pageSignals(text, kind)` — regex, deliberately:
this runs on raw bytes server-side, there is no DOM, and the surface is six
tag names.

- **HTML:** `meta[http-equiv=last-modified]`, `meta[name=last-modified]`,
  `meta[property=article:modified_time]`, `meta[property=og:updated_time]`,
  `meta[name=dcterms.modified]`, `link[rel=lastmod]` (RFC 822 in `href`).
  Not `article:published_time`: a page whose newest story is old has not
  changed, and a publish date is not a modify date.
- **RSS:** `lastBuildDate`, the newest `pubDate`, `lastmod`. **Atom:** the
  feed- and entry-level `updated`. **JSON:** a top-level `modified` /
  `updated` / `lastModified`.
- **Generator** (`meta[name=generator]`, `<generator>`): stored per source. A
  change here is the best early warning of a restructure, so a `no-matches`
  health note can say "WordPress went 5.9 → 6.7" instead of "selector matches
  nothing".
- **`<ttl>`** (RSS): the source's own poll-cadence hint, in minutes. Surfaced
  in the sources UI; never applied without the user seeing it.
- **No-cache meta** (`http-equiv=cache-control|pragma|expires`): means do not
  expect a `304` fast path from this page. A meta `Expires` counts on its own:
  the idiom is a 1997 date, browsers ignore it, and reading it needs no clock,
  which keeps `pageSignals` a pure function.

The newest declared stamp wins (`maxIso`). Scanning stops at `</head>` (HTML).

## Software sources, and page-mode HTML

The paper covers software updates as readily as news, and the two shapes are:

- **A release feed** — `https://github.com/<owner>/<repo>/releases.atom`,
  `/tags.atom`, a project's changelog Atom. An ordinary RSS/Atom source: each
  release has its own link, so identity is that link, and the body cap is enough
  to notice a rewritten release note.
- **A page with no list** — `https://nodejs.org/en/download`, a status page, a
  version table. Configure it as HTML with **no `list`**: the document is one
  item at a stable address (`<id>:page`, D-005/D-028), the paper shows its
  `<title>` and description, and the link is the page itself.

For the second shape `strip` is not cosmetic. A page that prints "last updated 3
minutes ago", a build timestamp, or a rotating sponsor changes its own **text**
every poll, and the paper reports an edit of that one item every poll — the
loudest failure this design can produce. Name those selectors in `strip` (the
picker's "never show this" list); they are removed before the text is compared.
Page mode has no selection, so `strip` is the only knob it has.

## Timestamp parsing is not `Date.parse`

Measured: `Date.parse('Sun Nov  9 10:00:00 2025')` and
`Date.parse('2025-11-09 10:00:00')` return the **machine's** zone, and
`Date.parse('09/11/2025')` happily reads US month/day. So `parseHttpDate` is
written by hand: RFC 1123, RFC 850 (two-digit years the POSIX way: `69` →
2069, `70` → 1970), asctime, and strict ISO — and **a zone-less timestamp is
UTC, always**, because a story's age must not depend on which machine opens
the paper. An impossible date (`31 Feb`) is `null`, not a normalised instant:
a `null` validator means "no fast path", which is always safe.

## State this requires

Per source, in the DB (owned by `packages/db`, written by the pipeline):
`etag`, `lastModified`, `responseDate`, `bodyHash`, `declaredModifiedAt`,
`generator`, `vary`, `freshnessSeconds`, `ttlMinutes`, `noCacheMeta`, and two
counters: `fastPathHits` (polls resolved by layer 0/1) and `fastPathMisses`.
Each `snapshots` row carries the `outcome` and the byte count.

The counters are not decoration. `fastPathHits: 0, fastPathMisses: 400` says
this source stamps its HTML; `freshnessSeconds: 300` against a 60 s cadence
says the poll is wasted. Both are health notes on the paper, per rule 5.

A **hit** is any rung that skipped the parse — the `304`, the body hash, the
declared timestamp — and a **miss** is a poll that parsed, including every
failing poll. The first poll of a source counts its own miss (the state row is
written before the counter moves, so a source's very first poll is countable).
A failure writes **no** state at all: `bodyHash` is "the hash of the body the
item set was built from", so a refused body must not become the baseline, or the
next identical poll answers `same-body`, skips the parse that has to happen, and
the source sits at zero items behind a healthy-looking ladder.

The `304` follows RFC 9110 §15.4.5 and §4.2.1: it updates the stored
**validators** (`etag`, `lastModified`, `responseDate`) and the **freshness
lifetime**, and nothing about the body — a `304` sent no body, so `bodyHash`,
`declaredModifiedAt`, `generator`, `ttlMinutes` and the cache-hint set stay
exactly as the parse left them. A CDN that answers a `304` with no validators
must not cost the source its fast path, so an absent validator field keeps the
stored one rather than clearing it (`poll-ladder.test.ts` pins both cases).

Who owns the seams: the **poll** injects the socket (a required dep, never a
global it reaches for) and the clock, read once per poll so the snapshot, the
items, the events and the score all carry one instant; the **transport** owns
the retry policy, and its waits are recorded, not slept through, in tests.

## Reverse if

A layer earns nothing on the sources you actually watch — the counters say so —
then delete that layer. The order is the contract; the layers are not.
