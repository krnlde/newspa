import type { Edition, EditionSection, EditionStats, ItemView } from './api.ts';
import { sectionFor, sectionOf, sectionTitleFor } from './sections.ts';

/** The paper before the first story: every count zero, never `undefined`. */
export const emptyStats = (): EditionStats => ({
  items: 0,
  newItems: 0,
  editedItems: 0,
  sourcesFetched: 0,
  sourcesUnhealthy: 0,
  cycles: 0,
});

/**
 * The section a story prints in. **The source's own words win**; the keyword
 * ladder is the fallback, because the author of a source knows what it is, and
 * the ladder is what makes the 40 sources nobody labelled readable.
 */
const headingOf = (
  item: ItemView,
  declared: ReadonlyMap<string, string>,
): { readonly id: string; readonly title: string } => {
  const label = declared.get(item.sourceId);
  if (label !== undefined) return sectionOf(label);
  const id = sectionFor(`${item.title} ${item.teaser} ${item.sourceLabel}`);
  return { id, title: sectionTitleFor(id) };
};

/**
 * The freshness law of the title page (D-048): the knobs that decide what is
 * **new**, how fast news decays, and how long a section is allowed to be.
 */
export interface EditionFreshness {
  /** The title page (lead and rails) prints only items at most this many hours old. */
  readonly maxAgeHours: number;
  /** Ranking decays the score by this half-life: age **multiplies**, it does not add. */
  readonly halfLifeHours: number;
  /** A section prints at most this many items: an index of the day, not an archive. */
  readonly sectionMaxItems: number;
}

export const defaultFreshness = (): EditionFreshness => ({
  maxAgeHours: 36,
  halfLifeHours: 24,
  sectionMaxItems: 12,
});

/** Age beyond two weeks is invisible, the same clamp as the score's recency term. */
const MAX_AGE_HOURS = 336;

/** The instant the age is measured from: the publisher's date, else the sighting (D-047). */
export const datedFrom = (item: ItemView): string | null => item.publishedAt ?? item.firstSeenAt;

export const ageOf = (item: ItemView, generatedAt: string): number => {
  const at = Date.parse(datedFrom(item) ?? '');
  if (Number.isNaN(at)) return MAX_AGE_HOURS;
  return Math.max(0, Math.min(MAX_AGE_HOURS, (Date.parse(generatedAt) - at) / 3_600_000));
};

/**
 * The rank a story is placed by: its score **multiplied** by an age factor.
 *
 * The score's own recency term (max 4, additive) lost to a source `weight` worth 6
 * or 10, and the front page printed 16-day-old stories on top (measured on the
 * live paper, 2026-11-14). A weight buys standing in the queue; age spends it: at
 * half-life 24 h a 5-day-old story keeps ~3% of its score and a month-old
 * page-sighting keeps none. The row's `scoreRealtime` stays undecayed — this is
 * the page's law, not the stored number, and the tier is the stored number's.
 */
export const rankOf = (item: ItemView, generatedAt: string, halfLifeHours: number): number =>
  item.score * 0.5 ** (ageOf(item, generatedAt) / Math.max(1, halfLifeHours));

/**
 * Assemble the day's paper from the wire's items.
 *
 * The order is the rank's (D-048), not the score's: age spends a weight. The lead
 * is the strongest story **that is news**; when nothing is fresh the paper prints
 * the freshest thing it has, because an empty front page is a silent zero (rule 5)
 * and the card says its own age in plain words (D-047).
 */
export const buildEdition = (
  id: string,
  generatedAt: string,
  dateline: string,
  items: readonly ItemView[],
  stats: EditionStats,
  declared: ReadonlyMap<string, string> = new Map(),
  fresh: EditionFreshness = defaultFreshness(),
): Edition => {
  // Ties break to the newer story, because "newest on top" is the reader's own
  // words for this law.
  const ranked = items
    .map((item) => ({
      item,
      rank: rankOf(item, generatedAt, fresh.halfLifeHours),
      age: ageOf(item, generatedAt),
    }))
    .sort((a, b) => b.rank - a.rank || compareIso(datedFrom(b.item), datedFrom(a.item)));

  const lead = (ranked.find((entry) => entry.age <= fresh.maxAgeHours) ?? ranked[0])?.item ?? null;

  const buckets = new Map<string, { readonly id: string; readonly title: string; readonly items: typeof ranked }>();
  for (const entry of ranked) {
    const heading = headingOf(entry.item, declared);
    const bucket = buckets.get(heading.id);
    if (bucket === undefined) buckets.set(heading.id, { ...heading, items: [entry] });
    else bucket.items.push(entry);
  }
  const sections: EditionSection[] = [...buckets.values()]
    .map((bucket) => ({
      id: bucket.id,
      title: bucket.title,
      blurb: bucket.items[0]?.item.teaser ?? null,
      // A bucket is built by pushing, so it is never empty: its first entry is the
      // section's strongest story, and that rank is what orders the sections.
      top: bucket.items[0]?.rank ?? 0,
      // The section prints the cap's worth, newest-ranked first; the rail is the
      // section's **news only** — the title page never prints an old item.
      items: bucket.items.slice(0, fresh.sectionMaxItems).map((entry) => entry.item),
      rail: bucket.items.filter((entry) => entry.age <= fresh.maxAgeHours).map((entry) => entry.item),
    }))
    .sort((a, b) => b.top - a.top)
    .map(({ top: _top, ...section }) => section);

  return {
    id,
    generatedAt,
    dateline,
    lead,
    sections,
    edited: ranked.filter((entry) => entry.item.editCount > 0).map((entry) => entry.item),
    stats,
  };
};

/** ISO strings sort lexically, which keeps this cheap and stable. */
export const compareIso = (a: string | null, b: string | null): number => {
  const x = a ?? '';
  const y = b ?? '';
  if (x === y) return 0;
  return x < y ? -1 : 1;
};
