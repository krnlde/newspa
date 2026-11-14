import type { EditionSection, ItemView } from 'newspa-core';
import { BLOCK_HEAD, HEAD_RULE } from './blockHead.ts';
import type { PaperLabels } from './Paper.tsx';
import { Story } from './Story.tsx';
import type { FormatProps } from './types.ts';

/**
 * Above the fold: the lead in the centre, the two strongest sections as narrow
 * rails at its sides, then the ornament. Which sections are "strongest" is not
 * decided here — core orders sections by the score they carry, so `sections[0]`
 * and `sections[1]` **are** the two strongest. The paper chooses what is big;
 * the server decides what matters, and this is the first half of that sentence.
 *
 * The DOM prints the lead **first** and the grid places it in the centre column
 * (`col-start-2`), so reading, screen-reader and print order all begin with the
 * story that matters: `order` would move the lead visually and leave it second
 * to a screen reader. At 900px the grid is one column and every placement
 * resets to the first column in DOM order — three screens of rails is not a
 * paper.
 */

/** A rail is a pointer into the section below the fold, not a full index. */
const RAIL_ITEMS = 4;

/*
 * Written out in full per side, because **Tailwind reads class names out of the
 * source text**: a name assembled by concatenation (`col-${side}`) is never
 * generated, and the page loses a column in production with no error anywhere.
 */
const RAIL_PLACEMENT: Record<'left' | 'right', string> = {
  left: 'col-start-1 row-start-1 panel pt-[0.35rem] max-[901px]:col-start-1 max-[901px]:row-start-auto',
  right: 'col-start-3 row-start-1 panel pt-[0.35rem] max-[901px]:col-start-1 max-[901px]:row-start-auto',
};

/*
 * One rule between rail items, on the `<li>` the list owns. The deleted sheet
 * scoped the rule to the list and matched a story's own first child; every rail
 * story is the only child of its `<li>`, so it reset `border-top` on all of
 * them, and the rails printed no hairline at all. Measured: `0px,1px,1px,1px`.
 */
const RAIL_ITEM =
  'py-[0.6rem] border-t border-t-[length:var(--hair)] border-t-rule first:border-t-0 first:pt-[0.15rem]';

export const FrontPage = ({
  lead,
  sections,
  labels,
  format,
}: {
  readonly lead: ItemView | null;
  readonly sections: readonly EditionSection[];
  readonly labels: PaperLabels;
  readonly format: FormatProps;
}) =>
  lead === null ? null : (
    <>
      <section
        data-part="front"
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1fr)] items-start gap-x-measure pt-3 max-[901px]:grid-cols-1 max-[901px]:gap-y-6"
      >
        <div
          data-part="lead"
          className="col-start-2 row-start-1 pt-6 pb-2 max-w-[46rem] mx-auto border-x border-x-[length:var(--hair)] border-x-rule px-measure max-[901px]:col-start-1 max-[901px]:row-start-auto max-[901px]:border-x-0 max-[901px]:border-y max-[901px]:px-0"
        >
          <Story item={lead} slot="lead" labels={labels} format={format} showImage />
        </div>
        <Rail side="left" section={sections[0]} skipKey={lead.key} labels={labels} format={format} />
        <Rail side="right" section={sections[1]} skipKey={lead.key} labels={labels} format={format} />
      </section>
      <p data-part="ornament" className="mt-[1.25rem] mb-2 text-center text-[1.1rem] text-muted" aria-hidden="true">
        ❦
      </p>
    </>
  );

/**
 * One rail: a section's items at `brief` volume, in the narrow column beside the
 * lead. Two rules make it honest:
 *
 *  - the centre story is **never** repeated here (`skipKey`): the same headline
 *    twice on one screen is not an index;
 *  - four items, no more: a rail is a pointer into the section below, and the
 *    full section is printed right under the fold.
 *
 * A rail with nothing left to show renders nothing, so the grid never grows an
 * empty column.
 */
const Rail = ({
  side,
  section,
  skipKey,
  labels,
  format,
}: {
  readonly side: 'left' | 'right';
  readonly section: EditionSection | undefined;
  readonly skipKey: string;
  readonly labels: PaperLabels;
  readonly format: FormatProps;
}) => {
  if (section === undefined) return null;
  // The items arrive as the section's **news** (D-048): core gates them by age, so
  // the title page cannot print an old story — the page has no clock, and a filter
  // here would be a second copy of the law.
  const items = section.rail.filter((item) => item.key !== skipKey).slice(0, RAIL_ITEMS);
  if (items.length === 0) return null;
  return (
    <section data-part="rail" data-side={side} aria-label={section.title} className={RAIL_PLACEMENT[side]}>
      <h2 data-part="block-head" className={BLOCK_HEAD}>
        {section.title}
        <span data-part="rule" className={HEAD_RULE} aria-hidden="true" />
      </h2>
      <ul data-part="rail-list" className="m-0 p-0 list-none">
        {items.map((item) => (
          <li key={item.key} className={RAIL_ITEM}>
            <Story item={item} slot="brief" labels={labels} format={format} showImage={false} />
          </li>
        ))}
      </ul>
    </section>
  );
};
