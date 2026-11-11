/**
 * The publish step: picked items → item rows + events, with the score and the
 * section applied on the way (D-001's last two stages, D-017's cap).
 *
 * Two decisions live here, and each is a rule, not a style:
 *
 * **Edit detection is a diff of the story's text, against the stored row.**
 * `textOf` is the title plus the body, falling back to the summary: a publisher
 * who rewrites only the headline has edited the story, and a body-only diff
 * would miss it. The ratio is the source's own `minEditRatio` (core's
 * `editReport.meaningful`), so "a punctuation change is not news" is a knob, not
 * an argument. The scrape is capped at 1 200 chars (`capBody`, rule 7), so an
 * edit past that cap is invisible — the honest boundary of a diff over a teaser
 * source.
 *
 * **The upsert's arithmetic is the repository's.** `edit_count` is **added**, so
 * an unchanged item writes `0` and an edit writes `1`. `last_changed_at` is
 * `coalesce(items.last_changed_at, excluded.last_changed_at)`, i.e. the **first**
 * change wins, so an unchanged row must be handed its existing value: passing
 * `takenAt` there would claim a change that never happened. `first_seen_at` and
 * `read_at` are not in the update set, so they survive on their own.
 *
 * **`gone` is decided next door.** The third rule of this step is the
 * disappearance ladder (D-029), and it is `pollGone.ts`: core counts the streak,
 * that module owns which polls are evidence, and this file supplies the key set
 * this poll published, after its own rows are written — so a story cannot be
 * retired by the poll that published it.
 */
import type { SourceSpec } from 'newspa-config';
import {
  defaultScoreRules,
  type EditReport,
  type EventKind,
  editReport,
  type ItemRecord,
  type PickedItem,
  type ScoreRules,
  scoreItem,
  sectionFor,
  sectionOf,
} from 'newspa-core';
import { type ItemEventsRepository, type ItemsRepository, itemWriteOf, type NewItemEvent } from 'newspa-db';
import { disappear } from './pollGone.ts';
import { type ItemPass, NO_PASS } from './pollTypes.ts';

/** The repositories the item pass writes through. */
export interface ItemRepos {
  readonly items: ItemsRepository;
  readonly itemEvents: ItemEventsRepository;
}

/** The reader's knobs, in the shape core scores with: `weight` is the importance slider. */
export const rulesOf = (spec: SourceSpec): ScoreRules =>
  defaultScoreRules({ watchwords: spec.watchwords, blockwords: spec.blockwords, sourceWeight: spec.weight });

/** The text a story **is**, for identity of content: the headline and the prose. */
const textOf = (item: PickedItem): string =>
  `${item.title}\n${item.body.length > 0 ? item.body : (item.summary ?? '')}`;

/**
 * The item's section id. A declared section (the reader's knob) wins; otherwise
 * core's keyword ladder routes it, so the paper has a front page and not an
 * inbox. The id is stored, not the title: `sectionTitleFor` is typography's job.
 */
const sectionOfItem = (spec: SourceSpec, item: PickedItem): string =>
  spec.section === undefined ? sectionFor(`${item.title} ${item.summary ?? ''}`) : sectionOf(spec.section).id;

/** The realtime score. `scoreDigest` is the digest pass's column, and no digest has run. */
const scoreOf = (spec: SourceSpec, item: PickedItem, rules: ScoreRules, now: Date): number =>
  scoreItem(
    { title: item.title, summary: item.summary, publishedAt: item.publishedAt, sourceLabel: spec.label },
    rules,
    now,
  ).total;

/**
 * One picked item, one row.
 *
 * `changedAt` is `takenAt` for a meaningful edit, `null` for anything else;
 * `null` means "leave the stored value alone", which for a new item is `null`
 * (never changed) and for an unchanged item is its existing instant.
 */
const recordOf = (
  spec: SourceSpec,
  item: PickedItem,
  before: ItemRecord | undefined,
  changedAt: string | null,
  score: number,
  takenAt: string,
): ItemRecord => ({
  key: item.key,
  sourceId: spec.id,
  kind: spec.kind,
  title: item.title,
  link: item.link,
  publishedAt: item.publishedAt,
  summary: item.summary,
  image: item.image,
  author: item.author,
  body: item.body,
  firstSeenAt: before?.firstSeenAt ?? takenAt,
  lastSeenAt: takenAt,
  lastChangedAt: changedAt ?? before?.lastChangedAt ?? null,
  editCount: changedAt === null ? 0 : 1,
  readAt: before?.readAt ?? null,
  scoreRealtime: score,
  scoreDigest: 0,
});

const eventOf = (
  spec: SourceSpec,
  item: PickedItem,
  kind: EventKind,
  at: string,
  score: number,
  report: EditReport | null,
): NewItemEvent => ({
  sourceId: spec.id,
  itemKey: item.key,
  kind,
  at,
  title: item.title,
  link: item.link,
  score,
  report,
});

/**
 * Write every picked item, and the events the diff produced, in the caller's
 * transaction. One read per item (`itemOf`) is the budget the pipeline is
 * allowed: the read side's "never per item" rule protects a page render, not a
 * producer that has to look at each row it is about to write. The disappearance
 * ladder is the one **whole-set** read (`storedKeys`), and it exists because a
 * page of keys cannot answer a question about absence.
 *
 * `closed` is the ladder's precondition on this path: `true` when the parse saw
 * the source's whole set, i.e. `!ParseSuccess.capped`. A feed cut at `maxItems`
 * lists the front of the feed, so the poll that cut it has no opinion — the
 * streaks do not move, and they do not reset (`pollGone.ts`).
 */
export const publishItems = (
  repos: ItemRepos,
  spec: SourceSpec,
  picked: readonly PickedItem[],
  takenAt: string,
  now: Date,
  rules: ScoreRules,
  closed: boolean,
): ItemPass => {
  const newKeys: string[] = [];
  const editedKeys: string[] = [];
  const events: NewItemEvent[] = [];
  for (const item of picked) {
    const before = repos.items.itemOf(spec.id, item.key);
    const score = scoreOf(spec, item, rules, now);
    const report = before === undefined ? null : editReport(textOf(before), textOf(item), spec.minEditRatio);
    const changed = report?.meaningful === true ? takenAt : null;
    repos.items.upsert(itemWriteOf(recordOf(spec, item, before, changed, score, takenAt), sectionOfItem(spec, item)));
    if (before === undefined) {
      newKeys.push(item.key);
      events.push(eventOf(spec, item, 'new', takenAt, score, null));
    } else if (changed !== null) {
      editedKeys.push(item.key);
      events.push(eventOf(spec, item, 'edited', takenAt, score, report));
    }
  }
  // The ladder runs after the items are written, so its whole-set read sees this
  // poll's own rows: an item the poll published is present, and cannot be counted
  // as absent by its own poll.
  const gone = disappear(repos, spec, closed ? new Set(picked.map((item) => item.key)) : null, takenAt);
  if (gone.writes.length > 0) repos.items.markStreaks(spec.id, gone.writes);
  events.push(...gone.events);
  if (events.length === 0) return { ...NO_PASS, items: picked.length };
  repos.itemEvents.insertMany(events);
  return {
    items: picked.length,
    newItems: newKeys.length,
    editedItems: editedKeys.length,
    newKeys,
    editedKeys,
    goneItems: gone.keys.length,
    goneKeys: gone.keys,
  };
};
