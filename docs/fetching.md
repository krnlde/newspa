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

| #   | Check                                    | Cost                               | What it proves                            | Outcome recorded      |
| --- | ---------------------------------------- | ---------------------------------- | ----------------------------------------- | --------------------- |
| 0   | Conditional GET → `304`                  | one round trip, no body            | nothing changed (strong)                  | `not-modified`        |
| 1   | Body hash equals the last stored body    | one round trip + one hash          | nothing changed (strong, for our purpose) | `same-body`           |
| 2   | **Selection hash** equals the stored one | one load + the matched node's text | the news moved, the watched node did not  | `selection-unchanged` |
| 3   | Parse → diff → score                     | the expensive path                 | what actually changed                     | `changed`             |

Layer 1 is the biggest win and needs no cooperation from the publisher: the
same bytes contain the same items, so parsing is redundant. It is also the
layer that fails most often in practice, because a page that embeds a build
nonce, a `Date:` comment or a CSRF token never produces the same bytes twice.
That is not a defect of the check, it is a property of the source, and the
**per-source counters make it visible** (see below).

Layer 2 is the rung for that property, and it is only about the **node the
source watches** (D-026: one HTML selector, one node). A footer stamp, a
rotating sponsor, a re-navigated breadcrumb move every byte and no headline:
the poll says `selection-unchanged`, writes no item, and the note tells the
reader why the paper is quiet. `strip` and `NOISE_SELECTOR` are applied to the
node before it is hashed, exactly as the item extraction applies them, so the
hash is of the text the parser would have produced. The rung answers `null` —
_no opinion_ — for a page-mode source, a feed, JSON, and a selector that
matched nothing; a `null` never matches, so a broken selector can never read as
"nothing changed".

The rung that used to sit here — **the declared timestamp** — is gone, for every
kind, not only HTML (D-027). It compared the payload's own newest stamp with the
stored one, after the body was already in hand: it saved no traffic and ~50 ms
of a measured 1 171 ms poll, and it suppressed items whenever a publisher edited
a story without restamping it. The stamp is still **recorded**
(`declared_modified_at`: the freshness note reads it) — it is simply no longer
allowed to skip the news.

## The trust rule

**A cheap signal may skip work. It may never suppress an item.**

Concretely: a `304` and a matching body hash skip parse, diff and score, because
no new bytes exist. The selection hash skips the **item pass** after the parse,
because the bytes say the page moved and the node says the story did not. Every
one of them names itself in `snapshots.outcome`, and none of them can mark a
story read, retire one, or answer for a source the poll could not read.

The boundary of layer 2 is stated where it can be seen: it hashes the watched
node's **text**, so a poll that skips the item pass cannot see a change inside
that node which moves no word — an `href` retargeted, an image swapped, a class
that hides it. That is the deal D-027 makes: the paper is an index of what the
node _says_ (D-017), and the link the reader clicks is the node's own link, which
is read again the moment any word moves. A source that churns its template shows
up as `selection-unchanged` polls with `fastPathHits` climbing; a source whose
node text churns shows up as the opposite (`changed` every poll, `fastPathHits:
0`) — both are readable from the DB, and an inert rung is visible, which is the
point of the counters. Where there is no selection (page mode, a feed, JSON) the
rung answers `null`, never matches, and the body hash is the only fast path below
the `304`.

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
`etag`, `lastModified`, `responseDate`, `bodyHash`, `selectionHash`,
`declaredModifiedAt`, `generator`, `vary`, `freshnessSeconds`, `ttlMinutes`,
`noCacheMeta`, and two counters: `fastPathHits` (polls a rung resolved) and
`fastPathMisses`. Each `snapshots` row carries the `outcome` and the byte count.

The counters are not decoration. `fastPathHits: 0, fastPathMisses: 400` says
this source's cheap signals never fire — a page that stamps its footer, a feed
that re-serializes; `freshnessSeconds: 300` against a 60 s cadence says the poll
is wasted. Both are health notes on the paper, per rule 5.

A **hit** is any rung that skipped the item pass — the `304`, the body hash, the
selection hash — and a **miss** is a poll that published, including every
failing poll. The first poll of a source counts its own miss (the state row is
written before the counter moves, so a source's very first poll is countable).
A failure writes **no** state at all: `bodyHash` is "the hash of the body the
item set was built from", so a refused body must not become the baseline, or the
next identical poll answers `same-body`, skips the parse that has to happen, and
the source sits at zero items behind a healthy-looking ladder.

The `304` follows RFC 9110 §15.4.5 and §4.2.1: it updates the stored
**validators** (`etag`, `lastModified`, `responseDate`) and the **freshness
lifetime**, and nothing about the body — a `304` sent no body, so `bodyHash`,
`selectionHash`, `declaredModifiedAt`, `generator`, `ttlMinutes` and the
cache-hint set stay exactly as the parse left them. A CDN that answers a `304`
with no validators must not cost the source its fast path, so an absent
validator field keeps the stored one rather than clearing it
(`poll-ladder.test.ts` pins both cases).

Who owns the seams: the **poll** injects the socket (a required dep, never a
global it reaches for) and the clock, read once per poll so the snapshot, the
items, the events and the score all carry one instant; the **transport** owns
the retry policy, and its waits are recorded, not slept through, in tests.

## Reverse if

A layer earns nothing on the sources you actually watch — the counters say so —
then delete that layer. The order is the contract; the layers are not.
