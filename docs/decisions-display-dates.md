# Decisions — the paper’s dates

One decision, D-047: what a date on the page answers, whose clock it is written on,
where the tooltip rides, and what a document’s stamp is worth. Split out of
`docs/decisions-display.md` at rule 1’s 300-line cap; the numbering is one tree, and
`docs/design.md` / `docs/design-page.md` are the law this decision is written into.

## D-047 — Every date is an age; the tooltip is the instant, zone named  _(decided and built 2026-11-13)_

The reader asked twice, and the second ask replaced the first: _"For all dates displayed,
I want a `title=""` attribute showing the exact date with timezone"_, then _"Maybe we
should use relative dates for all news with the `title=""` attribute showing the absolute
date"_. The second is the better page, and it is the one built: **the visible date is the
age, the hover is the exact instant.**

**Why the age wins the visible slot.** A front page is scanned top-down as a stack of
_recency_, and `"2 hours ago"` answers "what is new here?" without making the reader
subtract a clock. `"14:03"` answers a question the reader did not ask, and it is
ambiguous about yesterday. The page already had the machinery: `ago` (core's
locale-free `relativeParts` + `Intl.RelativeTimeFormat`) was printing the health row's
"last poll" and the edit stamp, and it keeps its month rule — past 30 days an item stops
being an age and prints a date, because "3 months ago" is a shrug.

**Why the zone is the point of the tooltip.** An age is a distance measured from the
_reader's_ clock. The exact answer therefore has to say which clock it is written on:
the paper's server is on the desk, the wall display is a Raspi, the reader may be on a
phone in another zone, and a publisher's `publishedAt` is a zone-aware instant.
`"13 November 2026, 15:03"` is a number the reader cannot check;
`"November 13, 2026 at 2:30 PM +01:00"` is one they can.

**One absolute rendering, used everywhere the page shows an exact instant.** `ago` and
`absolute`, in the app, per language (D-019) — the old `published` ("today as a wall
clock, older as a date") is **deleted**, not kept alongside, and the month-old fallback
of `ago` prints `absolute` too, so the page never has two ways to write a date and a
card's visible line and its tooltip cannot tell two stories. The clock in the stats line
carries its offset as well (`13:58 +01:00`), because "13:58" is a time somewhere.
`LocaleApi` is four functions — `relative`, `time`, `absolute`, `count` — and the
`Formatters` object is **not** exposed to components: a component handed `Intl` objects
will call them directly, and the page's language stops being a user setting.

**Two candidates for the absolute form, both refused, with the reason written down.**
`Date#toISOString()` (`2026-11-13T14:30:00.000Z`) is unambiguous and identical on every
machine — it is the shape the server's own log lines and `/api/state` JSON use — and it
is machine text: it does not follow the page's language, and a paper in German printing
an Anglophone machine-format date is the page arguing with itself. Threading the
**paper's** zone into the formatter (the desk's `paper.timezone`, so a tooltip and the
dateline always name the same day) is refused too: the offset in the string already
makes a cross-zone reading legible, and a second formatter per zone is more machinery
than a page with one reader has any use for. So the form is the human one, in the
reader's clock: moment's `L`/`LLL` family, `Intl`'s components, with the offset kept.

**Measured, and it changed the code.**

- `dateStyle` and `timeStyle` **cannot** be combined with `timeZoneName`: ECMA-402
  forbids the pair and V8 throws `TypeError: Invalid option : option`. So the components
  are spelled out (`year`, `month`, `day`, `hour`, `minute`, `timeZoneName: 'longOffset'`).
  The shorthand is the way that cannot answer, so the long way is the one in the file.
- `Intl` spells that offset as `GMT+01:00`; the page wants `+01:00`, so `GMT` is
  stripped (`11/14/2026 … +01:00`). A language that spells the zone its own way is left
  alone — measured, `fr` prints `UTC+01:00`, and rewriting that is the page overruling
  the locale.
- Output at one instant: en-US `November 13, 2026 at 2:30 PM +01:00`, de
  `13. November 2026 um 14:30 +01:00`, ja `2026年11月13日 14:30 +01:00`.

**The tooltip rides on the age's own words** _(amended the same day: "I want the
`title=""` to be only set on the relative time… Not the whole card")_. The first cut hung
the story card's tooltip on the `article`, because the headline's anchor paints an overlay
across the card (`after:absolute after:inset-0`, the paper's one-click affordance) and a
`title` on the meta `<p>` is never under the pointer — hit-testing lands on the overlay.
That is a tooltip for the story, the source, the image and the date, which is a tooltip for
nothing, and it answers a hover that asked no question. The built rule: **the `title`
belongs to the words that show an age** — the meta row's age span, its `changed …` span,
the edited row's date, the health row's detail line. It reaches a pointer because the meta
row is `relative`, so it paints and hit-tests **above** the overlay. The cost is named in
`docs/design-page.md`: that row's own strip of pixels no longer navigates; the rest of the
card, including the deck, still does.

**Two cases print no tooltip, for one reason: a tooltip that repeats the words under it is
noise.** A month-old line prints the absolute instant as its **visible** text (the page has
one way to write a date), so `ageTitle` compares the two renderings and returns none when
they are the same string. And the masthead prints none at all: the dateline is the
edition's day and the stats line's `13:58 +01:00` is a clock — neither is an age, so
neither has a "when, exactly?" to answer. `ageTitle` is one exported function used by all
three sites, because it is one rule about the two renderings, not three rules.

**The proof is a hit test, not a markup scan.** `packages/paper/test/story.test.tsx` pins
the placement: the card bare, the byline bare, each age span titled, the month-old case
`hasAttribute('title') === false`. Markup that carries a tooltip nobody can summon is the
failure `apps/web/test/design/dates.test.tsx` exists for: in real Edge it calls
`document.elementFromPoint` at the titled span's own centre and demands the **span**, then
at the deck's centre and demands the link — the overlay lifted, the card still clickable.

**The undated story prints the sighting; the last fetch is refused.** The pushback on the
first cut was _"we could use the date of our last fetch? Where's the problem"_ — the right
instinct, the wrong instant. The paper's own `firstSeenAt` is on the wire, non-null and
**per item**, so an undated story is placeable by when the paper learned it: the line
prints `"seen 2 days ago"` and the tooltip on those words is the instant,
`"November 11, 2026 at 02:24 PM +01:00"` — the words say "seen", so the tooltip needs no
word of its own (live: the `nodejs-downloads` card is the paper's only undated story). The
word is the honesty — a bare age would read as the publication date the source never
gave, which is the page claiming what it does not know, the rule that already refuses to
print `New` for a door the source closed (D-029). The **source's** last fetch is the
tempting fallback and the bad one: it is one value shared by every item of that source,
so a 5-minute cadence prints a two-year-old story as five minutes old, forever, and every
card of the source the same age. That is recency manufactured from the poll clock, which
is worse than no date at all. Where there is genuinely no instant, the element carries no
`title`, and never `title=""`: an empty tooltip is a control that does nothing — the same
rule that refuses a silent absence elsewhere in the paper (rule 5, and the install
entry's "no control, no lie").

**The ladder for a date, measured on the reader's nine sources** _(asked 2026-11-13:
"dates can come from 3 sources (in priority order): in the HTML page / RSS feed itself;
in the HTTP Header Last-Modified; in our database, last fetched")_. The tree answers with
numbers, and the numbers decide it:

- `Last-Modified` is **NULL for all nine sources** — the header does not fire on this
  reading list, so that rung is machinery with no input.
- The payload's document stamp (`declared_modified_at`: RSS `lastBuildDate`, HTML
  `<meta name=last-modified>`, JSON `modified`) exists on 7/9, and on 4 of those it
  **equals the fetch instant** (yahoo-aapl `21:18:29`, identical to the response's `Date`;
  bbc-world 9 s behind it). As a story's date that is a machine for printing "3 minutes
  ago" on a three-year-old story — D-027's measurement, a publisher that stamps its feed
  once a day and edits it, in a new costume, and the same fault as the source's last fetch.
- The one undated card in the edition (`nodejs-downloads`, 1 item of 227) has **neither**
  stamp, so the rung would not have reached the case that motivated it.

A document's stamp is a **bound**, not a date: an item provably existed when its document
was last stamped, so a source declaring 9 November says "at least four days old" and a
source declaring "now" says nothing. Not built: the paper prints no bound, because the
sources able to fill it in are the ones whose stamp is their own clock. The ladder stands
as two rungs — the item's own declared date, then the paper's sighting, worded as one.

**The scoring bug the question exposed, fixed the same day.** `score.ts` read
`publishedAt === null` as 72 hours while the card printed the sighting: one story, two
clocks, and the reason a card read `seen just now` and ranked mid-list. `ScoreInput` is
now handed the sighting — `firstSeenAt`, per item, the same instant `recordOf` writes —
and scores `publishedAt ?? firstSeenAt`, so the ranked order and the printed age come from
one number. 72 stays for an instant that **cannot be read** (an unparsable date), which is
a fault, not an undated story. Pinned by an identity, at two polls 50 hours apart: an
undated row's stored `scoreRealtime` equals scoring its own printed instant.

**Not built, on purpose:** no custom tooltip, no `aria-describedby`, no hover panel.
`title` is the ask, it is the platform's, and a styled tooltip is a second overlay where
D-035 allows exactly one.

**Reverse if:** a reader on a touch device needs the exact date visible — a phone fires no
hover, so the zone is unreachable there. The seam is one prop: the paper prints what
`FormatProps` hands it, so a device that wants the stamp visible is a call site, not a
redesign.
