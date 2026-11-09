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
 */
export const Section = ({ id, title, blurb, items, labels, format }: SectionProps) => (
  <section className="section" id={`section-${id}`}>
    <h2 className="section__head">
      {title}
      <span className="section__rule" aria-hidden="true" />
    </h2>
    {blurb === null || items.length === 0 ? null : <p className="section__blurb">{blurb}</p>}
    <div className="section__columns">
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
