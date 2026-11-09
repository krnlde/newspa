# `packages/fetch` fixtures

Payload-shaped truth for the parsers. A fixture is a byte-for-byte payload with
the provenance comment **inside** it, so it cannot be separated from its
evidence, and every file names the behaviour it pins. Fixtures are excluded from
coverage; they are the input side of the tests in `packages/fetch/test/`.

Conventions:

- One fetch per URL. No hammering (AGENTS.md: respect the publisher).
- No cookies, no authorization, no `profiles/` state, no secrets, no PII.
- `<meta name="generator">` and build stamps are kept; they are the publisher's
  own bytes and the reason a fixture is pinned to a date.
- Hand-written fixtures are labelled as such inside the file, and are used only
  where a shape cannot be captured (a feed served as `text/html`, a truncated
  stream, a bot interstitial) — the label says so.
- The JSON fixture is re-serialised (2-space indent) with one added key,
  `_comment`, holding the provenance: JSON has no comments. Parsers ignore keys
  they do not read; the shape is unchanged.
- Names in this file are the ones the code uses: the reasons in
  `src/results.ts` (`no-matches`, `challenge`, `kind-mismatch`, …) and the fields
  of `ParseFailure` (`cause`, `matchCount`, `itemCount`, `notes`).

## Captured 2026-11-09 with `curl` (no cookies)

| File | URL | What it pins |
| --- | --- | --- |
| `feed-bbc-world.xml` | `https://feeds.bbci.co.uk/news/world/rss.xml` | Real RSS 2.0 (33 items): `guid isPermaLink="true"`, `media:thumbnail`/`media:content`, `atom:link`, tracking params in `link` (stripped by core's `canonicalizeUrl`, not by the parser), `pubDate` as RFC 1123 |
| `feed-guardian-world.xml` | `https://www.theguardian.com/world/rss` | RSS 2.0 with `dc:creator` (the byline), `dc:date`, a `category` array, `media:credit`, three `media:content` sizes, escaped `<p>` blocks and a "Continue reading…" trailer in `description` (the teaser boundary) |
| `feed-github-releases.atom.xml` | `https://github.com/nodejs/node/releases.atom` | Real Atom (10 entries, the page GitHub serves): `atom:link rel=self`, entry `link href`, an `id` that is `tag:…` and **not** a URL, `updated`, HTML `content` |
| `feed-ubuntu-blog.xml` | `https://ubuntu.com/blog/feed` | RSS 2.0 (12 items) with `content:encoded` holding escaped HTML (the `capBody` boundary), no `image`/`enclosure` in any item, served `application/rss+xml` |

## Hand-written (labelled in-file)

Feeds:

| File | Pin |
| --- | --- |
| `rss-guid-permalink.xml` | The `guid` grammar: `isPermaLink="true"` is the identity, `isPermaLink="false"` and Atom's non-URL `id` fall back to the link (and, in core today, to title+day) — D-005; CDATA, unescaped entities, a relative `link`, an audio vs an image `enclosure`, `dc:creator` |
| `rss-no-items.xml` | A channel with children and no `item`: `no-items` naming `rss > channel` and listing its children, `matchCount: 0` |
| `rss-truncated.xml` | A stream cut mid-element: `truncated`, with the validator's message quoted, nothing invented |
| `rss-sloppy-unclosed-element.xml` | Raw HTML in `<description>`: `InvalidTag` from the validator, read **anyway** with a tolerance note; the two measured consequences (an unclosed `<em>` swallows the rest of the document; an element child's text is read before the character data before it) |
| `rss-rdf-1.0.xml` | RSS 1.0 is parsed: no `channel`, the link is `rdf:about`, `dc:date` is the date, `dc:creator` the author |
| `atom-links.xml` | The Atom link ladder: `rel=alternate` + `type=text/html` wins over `rel=self` and over an `application/atom+xml` alternate, a missing `published` falls back to `updated`, an entry with no link is skipped and counted, `media:content` is the image, `xhtml:div` content flattens to one line |

HTML:

| File | Pin |
| --- | --- |
| `html-card-list.html` | CNN's lite card list (100 `li.card--lite`): the anchor **is** the item, so the link comes from the item's own `href` (`linkAttr`), while a `link` selector describes its children |
| `html-selector-rot.html` | A renamed class: `no-matches` naming the selector with `matchCount: 0` — a visible zero, not an empty day |
| `html-self-title.html` | The item root carries the title as text and no heading: the field ladder reads the root, which cheerio's `find` alone cannot do |
| `html-noise-strip.html` | Share widgets, a "Read more" link, a `<script>` and a `<style>` contribute nothing to title, deck, body, byline (`<address>`) or image; the strip runs on a clone, so the live document keeps its deck |

JSON:

| File | Pin |
| --- | --- |
| `json-hn-front-page.json` | Real JSON API (`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=12`): `itemsPath` → `hits`, `url` present and `objectID` absent, so identity comes from the link; `created_at` is the date; no deck, no thumbnail |
| `json-path-array.json` | The path ladder: `a.b.c` through a key, `a[1]` indexing an array, a missing segment (with the keys that are there), an index out of range, a path into a string, `[]` over a wrapper array |
| `json-no-items.json` | A path that resolves to nothing: `no-items-path` naming the path; a path at a single object with no usable link: `no-usable-items`, with one note per object |
| `json-malformed.json` | Malformed JSON: the `JSON.parse` message is reported as `malformed`, not swallowed |
| `json-island-nextdata.html` | A Next.js island (`__NEXT_DATA__`) parsed as JSON inside HTML: the island is the payload and markup beside it is ignored; inside `<script>` entities are **not** decoded; `islandRoot` (default `props.pageProps`) is applied only when `island` is set; a `ticker` array and an empty `script#EMPTY` pin the two root failures |

Walls and unsupported payloads:

| File | Pin |
| --- | --- |
| `challenge-cloudflare.html` | A challenge interstitial is `challenge` with the marker named — never zero items |
| `challenge-noscript.html` | A JavaScript-only page is `challenge`, naming what it requires (`enable javascript`) and pointing at `render: true` |
| `login-wall.html` | A registration wall (form, no content) is `challenge`; the marker is early, which is what makes it trustworthy |
| `plain-text.txt` | A payload that is none of the supported kinds is `kind-mismatch` for every source kind, naming what was sniffed and the leading marker |

The D-006 case a fixture cannot capture — a feed served as `text/html`, which
`reddit.com/.rss` does — is pinned by a test that builds the payload inline,
because the live endpoints answer `302` (old.reddit) and `403` (www.reddit) to
a fetch from this network.

## Why some measured facts live in a fixture comment

`rss-sloppy-unclosed-element.xml` and `json-island-nextdata.html` pin behaviour
of the libraries (fast-xml-parser 5.12.0, cheerio 1.2.0), not of this package:
the comment inside the file states the measurement, and the test asserts it.
A version bump that changes one of those behaviours turns a test red, which is
the point.
