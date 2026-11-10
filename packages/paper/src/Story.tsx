import type { DiffOpView, EditReportView, ItemView } from 'newspa-core';
import type { FormatProps, StoryLabels, StoryProps, StorySlot } from './types.ts';

/**
 * One story: kicker, headline (the link), one paragraph, meta line.
 *
 * The headline **is** the link — `target="_blank"`, and the whole block is
 * clickable — because the paper is an index, not a mirror (D-017): there is
 * nothing more to read here, so there is no "Read more" button, and the
 * publisher keeps the reader. Middle-click and copy-link work, because it is a
 * real `<a href>`.
 *
 * No image, no box: an empty `<div>` is not a photograph.
 *
 * **The lead's figure prints after the deck, not before the kicker.** A lead
 * photo taller than the screen pushes the headline off the page — docs/design.md
 * says the lead's headline leads, and the component did the opposite: at
 * 1440×900 the lead headline started below the fold, and at 390×844 the photo
 * filled the first screen. The cap is `min(15rem, 30vh)` (was `min(24rem,
 * 46vh)`) so the crop is a newspaper's, not a blog's. A section **leader** keeps
 * `figure → kicker → headline`: it is a card in a column, the lead is the page.
 */
export const Story = ({ item, slot, labels, format, showImage }: StoryProps) => {
  const kicker = item.lastEventKind === 'edited' ? labels.editedKicker : labels.newKicker;
  const meta = metaOf(item, labels, format);
  const figure =
    showImage && item.image !== null ? (
      <figure data-part="figure" className="mb-[0.6rem] cropmarks">
        <img data-part="image" className={IMAGE_OF[slot]} src={item.image} alt="" loading="lazy" />
        <figcaption data-part="caption" className="pt-[0.2rem] text-kicker italic text-muted">
          {item.sourceLabel}
        </figcaption>
      </figure>
    ) : null;
  return (
    <article
      data-part="story"
      data-slot={slot}
      data-key={item.key}
      data-read={item.read ? 'true' : 'false'}
      className={SLOT_OF[slot]}
    >
      {slot === 'lead' ? null : figure}
      <p
        data-part="kicker"
        className="flex items-baseline gap-[0.45rem] mb-[0.2rem] text-kicker font-bold tracking-kicker uppercase text-ink-2"
      >
        {item.read ? null : (
          <span
            data-part="mark"
            className="before:content-['●'] before:text-[0.6em] before:tracking-normal"
            aria-hidden="true"
          />
        )}
        {kicker}
        <span data-part="source" className="ms-auto text-muted font-normal">
          {item.sourceLabel}
        </span>
      </p>
      <h3
        data-part="headline"
        className={`mb-1 font-extrabold leading-display tracking-display text-balance break-after-avoid ${HEAD_OF[slot]}`}
      >
        <a
          data-part="link"
          className="after:content-[''] after:absolute after:inset-0"
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={labels.opensInNewTab(item.sourceLabel)}
        >
          {item.title}
        </a>
      </h3>
      {item.teaser.length > 0 ? (
        <p data-part="deck" className={DECK_OF[slot]}>
          {item.teaser}
        </p>
      ) : null}
      {slot === 'lead' ? figure : null}
      {meta.length > 0 ? (
        <p data-part="meta" className="m-0 text-kicker font-bold tracking-kicker leading-meta uppercase text-muted">
          {meta}
        </p>
      ) : null}
    </article>
  );
};

const STORY_BOX =
  'relative break-inside-avoid pb-5 mb-5 border-b border-b-[length:var(--hair)] border-b-rule last:border-b-0 last:mb-0';
const DECK_BOX = 'mb-[0.3rem] leading-read text-ink-2 text-pretty [orphans:2] [widows:2]';
const IMAGE_BOX =
  'block w-full grayscale contrast-[1.06] brightness-[1.02] border-b border-b-[length:var(--hair)] border-b-rule-strong';

/**
 * The story block: a hairline and air, and the anchor's overlay needs the box.
 *
 * A `brief` is a rail item, and a rail is a `<ul>` of `<li>`: the rule between
 * rail items belongs to the list (see `Paper.tsx`), so a brief carries no rule
 * and no margin of its own. The old sheet asked for exactly that
 * (`.rail__list .story`) and could not say it — a utility cannot see its parent.
 */
const SLOT_OF: Record<StorySlot, string> = {
  lead: STORY_BOX,
  leader: STORY_BOX,
  story: STORY_BOX,
  brief: 'relative break-inside-avoid pb-[0.15rem]',
};

/** The volume is the slot's, never the item's tier: the paper decides what is big. */
const HEAD_OF: Record<StorySlot, string> = {
  lead: 'text-lead',
  leader: 'text-leader',
  story: 'text-headline',
  brief: 'text-brief',
};

/**
 * Italic deck on the lead and the section leaders only, as in print, and a drop
 * cap on the lead. `first-letter:leading-none` (1), not the sheet's `0.85`:
 * three leading values exist and a fourth in a class string is a size committed
 * twice — the design contract fails it.
 */
const DECK_OF: Record<StorySlot, string> = {
  lead: `${DECK_BOX} text-deck-lead italic first-letter:float-left first-letter:text-[3.1em] first-letter:font-bold first-letter:leading-none first-letter:pr-[0.08em] first-letter:mt-[0.04em]`,
  leader: `${DECK_BOX} text-deck-lead italic`,
  story: `${DECK_BOX} text-deck`,
  brief: `${DECK_BOX} text-deck`,
};

/**
 * A newspaper **crops** a photograph; it does not paste the file. `cover` crops
 * and the cap holds the fold, so the width stays the column's and the headline
 * stays on the first screen. Only the lead and the leader are ever shown one.
 *
 * The cap replaces `h-auto` rather than joining it: Tailwind emits `h-auto`
 * after an arbitrary height (measured in the built sheet), so a box carrying
 * both is auto-sized — which is how a lead photo ends up taller than the screen
 * twice.
 */
const IMAGE_OF: Record<StorySlot, string> = {
  lead: `${IMAGE_BOX} h-[min(15rem,30vh)] object-cover object-[50%_25%]`,
  leader: `${IMAGE_BOX} h-44 object-cover object-[50%_30%]`,
  story: `${IMAGE_BOX} h-auto`,
  brief: `${IMAGE_BOX} h-auto`,
};

/** Byline and age in one muted uppercase line. Empty parts are absent, not blank. */
const metaOf = (item: ItemView, labels: StoryLabels, format: FormatProps): string => {
  const published = format.published(item.publishedAt);
  const changed = item.lastChangedAt === null ? '' : format.ago(item.lastChangedAt);
  const parts = [
    item.author === null ? '' : labels.byline(item.author),
    published,
    changed.length > 0 ? `${labels.changedLabel.toLowerCase()} ${changed}` : '',
  ];
  return parts.filter((part) => part.length > 0).join(' · ');
};

/**
 * The word diff of a story's **teaser** fields (D-017: the paper shows what
 * changed in the words it displays), marked the way print copy-editing marks
 * it: inserted text underlined, deleted text struck and muted. No colour, so it
 * survives a grayscale page, and `ins`/`del` carry the meaning to a reader.
 */
export const EditDiff = ({
  report,
  summary,
}: {
  readonly report: EditReportView;
  readonly summary: StoryLabels['editSummary'];
}) => (
  <p data-part="diff" className="mt-[0.2rem] text-note leading-read text-ink-2">
    {/* The count is real text, not an `aria-label`: a `<p>` has no accessible
        name to label, and a reader of the page should see it too. */}
    <span data-part="count" className="block mb-1 text-kicker font-bold tracking-kicker uppercase text-muted">
      {summary(report.added, report.removed)}
    </span>
    {keyedOps(report.ops).map(({ op, at }) =>
      op.type === 'equal' ? (
        <span key={at}>{op.text}</span>
      ) : op.type === 'insert' ? (
        <ins key={at} className="underline decoration-1 text-ink">
          {op.text}
        </ins>
      ) : (
        <del key={at} className="line-through text-muted">
          {op.text}
        </del>
      ),
    )}
  </p>
);

/**
 * A diff's ops are **positional**: two runs can carry identical text, so the
 * text is not an identity and the index is. Keyed outside the JSX because the
 * index is a real identity here, not a shortcut.
 */
const keyedOps = (ops: readonly DiffOpView[]): { readonly op: DiffOpView; readonly at: string }[] =>
  ops.map((op, index) => ({ op, at: `${index}-${op.type}` }));
