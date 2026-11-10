import { BLOCK_HEAD, HEAD_RULE } from './blockHead.ts';
import { Story } from './Story.tsx';
import type { SectionProps } from './types.ts';

/**
 * A section: an uppercase label with a rule running to the column edge, then
 * the stories in CSS multi-columns (the measure is the design's, not the
 * component's).
 *
 * The first story of a section is its **leader**: bigger headline, its image if
 * the source has one. Everything after it is a plain story, separated by a
 * hairline and air.
 *
 * The label's own vocabulary is `blockHead.ts`, shared with the rails: it is
 * `sticky`, its background must be opaque because the copy scrolls under it, and
 * it carries the paper's one shadow (docs/design.md). Written once, because the
 * rails and the sections must be the same label, and two copies drift the first
 * time one of them is edited.
 */
export const Section = ({ id, title, blurb, items, labels, format }: SectionProps) => (
  <section data-part="section" id={`section-${id}`}>
    <h2 data-part="block-head" className={BLOCK_HEAD}>
      {title}
      <span data-part="rule" className={HEAD_RULE} aria-hidden="true" />
    </h2>
    {blurb === null || items.length === 0 ? null : (
      <p data-part="blurb" className="mb-3 text-deck leading-read italic text-ink-2">
        {blurb}
      </p>
    )}
    {/* Columns enforce the measure (45–75 characters) and the rule between them
        is a hairline. 21rem from 1440px up: the gutter is paid for there. */}
    <div
      data-part="columns"
      className="gap-x-measure [column-rule:1px_solid_var(--rule)] columns-[20rem] max-[640px]:columns-1 max-[640px]:max-w-[34rem] min-[1440px]:columns-[21rem]"
    >
      {items.map((item, index) => (
        <Story
          key={item.key}
          item={item}
          slot={index === 0 ? 'leader' : 'story'}
          labels={labels}
          format={format}
          showImage={index === 0}
        />
      ))}
    </div>
  </section>
);
