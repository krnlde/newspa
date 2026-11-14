# Decisions - what the title page prints

The surface file's numbering continues here: D-048 is the law of the **front page's
news**, which is a surface question (what a reader sees above the fold) and not a
display question (which stock, how hard).

## D-048 - Age multiplies the score; the title page prints only the last N hours

The reader's ruling, 2026-11-14: _"the title page is the most important part of the
page. There should never be old content there. It should have newest stuff on top."_
The screenshot that started it: the lead was the Ubuntu Blog's page-mode item, its
meta line reading `BY CANONICAL · LAST MONTH`.

**The measurement, on the live paper, same day.** The pool is `db.items.list()`
(newest `last_seen_at`, limit 200). The score is `weight × 2` + a recency term capped
at 4 + watchword hits, so a source `weight` of 5 buys 10 points and an age of five
days costs at most 4: the additive term **cannot** outrank a weight. The front page
printed 16-day-old stories on top, and one section printed **102 items** - 28 of 201
items on the wire were older than four days. A page-mode source with one item per page
has no publisher date, so its "age" is the sighting, which for a stable page is
months: exactly the card in the screenshot.

**The law, in one place (`packages/core/src/edition.ts`).**

```
rank = score × 0.5 ^ (age / halfLife)      age = now - (publishedAt ?? firstSeenAt)
```

- Age is clamped at 336 h (two weeks), the same ceiling the score's recency term uses,
  so an archive item's rank is ~0 and never negative.
- **The lead** is the strongest story with `age ≤ maxAgeHours` (default 36 h). Older
  than the gate it belongs in a section, not above the fold.
- **When nothing is fresh, the lead is the freshest item there is.** An empty front
  page is a silent zero (rule 5), and the card prints its own age in plain words
  (D-047), so the truth is on the page, not in an absence.
- **`EditionSection.rail`** is the section's fresh items - a **required** wire field,
  filled by core, and **capped at 5**: the page prints 4 (`RAIL_ITEMS`), and the live
  paper showed rails of 70, which is 70 item objects per section on the wire for a
  column of 4. The paper has no clock: a rail that filtered by age itself would be a
  second copy of the law, and the second copy is the one that drifts.
- **A section prints `sectionMaxItems` (default 12)**, newest-ranked first. The paper
  is an index of the day (rule 7), not an archive of the feed.
- **Sections are ordered by the rank of their strongest story**, not by a summed
  score. Summing is what made a pile of mid stories outrank one strong one.
- Ties break to the newer story - "newest on top" is the reader's own words.

**The tier is not decayed.** The first cut re-tiered by rank (`tierFor(rank)`), and the
server's tier tests - `scoreRealtime 12 → lead` - failed. They were right: the tier is
the **standing of the stored score**, and the paper prints volume by slot, not by tier
(`Story.tsx`: "the volume is the slot's, never the item's tier"). Only **placement**
decays. `scoreRealtime` on the row is untouched: this is the page's law, not the
stored number.

**The knobs** (`packages/config/src/appSchema.ts`, `paper` block):
`titlePageMaxAgeHours` (36, 1-168) and `sectionMaxItems` (12, 4-50). The decay
reuses **`scoring.recencyHalfLifeHours`** (24): one half-life, one meaning. A third
knob for the decay would be a knob whose effect nobody can predict from its name.

**The split.** `normalize.ts` carried the identity rules and the edition assembly and
reached 348 lines; rule 1 forced the question and the answer is by responsibility:
identity and text in `normalize.ts`, the paper's assembly - sections, order, age - in
`edition.ts`. The core barrel's names are unchanged, so `apps/web` and `packages/paper`
never noticed.

Rejected: **A** (a hard "newest first" sort by date alone, which prints a
low-weight wire above a strong story); **F** (age as a bigger additive term, which
measures as a tuning treadmill: any weight can be outbid by any other knob);
**G** (a per-source freshness promise, which is the reader's reading list, not a law);
filtering in `packages/paper` (the page has no clock, and the law needs testing at the
layer that owns it).

**Tests.** `packages/core/test/edition.test.ts` owns the law - the 12-point
five-day-old story against the 6-point story from an hour ago, the month-old
page-sighting that cannot lead and leaves the rail while staying in the section, the
never-empty fallback, the gate at the knob, the cap at the knob, the untouched tier.
`packages/server/test/edition.test.ts` proves the knob reaches the law through the real
rows (`rowsOf(db, { freshness })`). `packages/paper/test/front.test.tsx` proves the
page prints only the rail it is given. The two boot tests (`poll.test.ts`,
`start.test.ts`) now assert the cap against the poll's count, because "the read side
prints the stories the poll wrote" is no longer true past 12.

**Reverse if:** the reader wants the front page to be a **summary of the archive**
rather than the day's news - then the gate moves from the title page to the section
list, and the rail becomes the place where old stories are allowed.
