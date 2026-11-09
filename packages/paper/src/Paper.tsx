import type {
  Edition,
  EditionSection,
  EditionStats,
  EditReportView,
  ItemView,
  MastheadView,
  SourceHealthView,
} from 'newspa-core';
import { type HealthLabels, HealthStrip } from './HealthStrip.tsx';
import { Masthead } from './Masthead.tsx';
import { Section } from './Section.tsx';
import { EditDiff, Story } from './Story.tsx';
import type { FormatProps, StoryLabels } from './types.ts';

/**
 * The page: masthead, lead, sections, the edited strip, source health.
 *
 * There is **no edition** to pick (D-002): the page is the product, and it
 * shows what the last polls changed. Nothing here fetches, translates, formats
 * a date, or reads a clock — the app owns all four, and this file owns the
 * order things appear in and the class names the design contract styles.
 *
 * An empty paper is a state, not a blank page: onboarding, with the commands
 * that add a source.
 */
export interface OnboardingCopy {
  readonly title: string;
  readonly lead: string;
  readonly steps: readonly string[];
  readonly command: string;
}

/** A rail is a pointer into the section below the fold, not a full index. */
const RAIL_ITEMS = 4;

export interface PaperLabels extends StoryLabels {
  readonly health: HealthLabels;
  readonly editedHeadline: string;
  readonly onboarding: OnboardingCopy;
  /** `"38 stories · 6 new · 2 edited"` — the dateline strip's line. */
  readonly stats: (stats: EditionStats) => string;
}

export interface PaperProps {
  readonly masthead: MastheadView;
  readonly edition: Edition;
  readonly sources: readonly SourceHealthView[];
  readonly labels: PaperLabels;
  readonly format: FormatProps;
  readonly theme: 'light' | 'dark';
  readonly onToggleTheme: () => void;
  readonly themeLabel: string;
}

export const Paper = ({ masthead, edition, sources, labels, format, theme, onToggleTheme, themeLabel }: PaperProps) => (
  <div className="paper">
    <Masthead
      name={masthead.name}
      tagline={masthead.tagline}
      dateline={edition.dateline}
      summary={labels.stats(edition.stats)}
      theme={theme}
      onToggleTheme={onToggleTheme}
      themeLabel={themeLabel}
    />
    {sources.length === 0 ? (
      <Onboarding labels={labels} />
    ) : (
      <>
        <FrontPage lead={edition.lead} sections={edition.sections} labels={labels} format={format} />
        <div className="paper__sections">
          {edition.sections.map((section) => (
            <Section
              key={section.id}
              id={section.id}
              title={section.title}
              blurb={section.blurb}
              items={section.items}
              labels={labels}
              format={format}
            />
          ))}
        </div>
        <Edited items={edition.edited} labels={labels} format={format} />
        <HealthStrip sources={sources} labels={labels.health} format={format} />
      </>
    )}
  </div>
);

/**
 * Above the fold: the lead in the centre, the two strongest sections as narrow
 * rails at its sides, then the ornament. Which sections are "strongest" is not
 * decided here — core orders sections by the score they carry, so `sections[0]`
 * and `sections[1]` **are** the two strongest. The paper chooses what is big;
 * the server decides what matters, and this is the first half of that sentence.
 */
const FrontPage = ({
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
      <section className="paper__front">
        <div className="paper__lead front__lead">
          <Story item={lead} slot="lead" labels={labels} format={format} showImage />
        </div>
        <Rail side="left" section={sections[0]} skipKey={lead.key} labels={labels} format={format} />
        <Rail side="right" section={sections[1]} skipKey={lead.key} labels={labels} format={format} />
      </section>
      <p className="paper__ornament" aria-hidden="true">
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
  const items = section.items.filter((item) => item.key !== skipKey).slice(0, RAIL_ITEMS);
  if (items.length === 0) return null;
  return (
    <section className={`front__rail front__rail--${side}`} aria-label={section.title}>
      <h2 className="section__head rail__head">
        {section.title}
        <span className="section__rule" aria-hidden="true" />
      </h2>
      <ul className="rail__list">
        {items.map((item) => (
          <li key={item.key}>
            <Story item={item} slot="brief" labels={labels} format={format} showImage={false} />
          </li>
        ))}
      </ul>
    </section>
  );
};

/**
 * `Array.filter` cannot narrow, so the proof is written down. A row of the
 * edited strip **always** has a report, which is why the render below has no
 * `null` arm — and no branch that no test can reach.
 */
const hasReport = (item: ItemView): item is ItemView & { readonly lastReport: EditReportView } =>
  item.lastReport !== null;

/**
 * The edited strip: stories whose text changed, with the word diff of the
 * teaser. A publisher rewriting a headline is news in a tool that shows what
 * changed, and the diff is the evidence.
 */
const Edited = ({
  items,
  labels,
  format,
}: {
  readonly items: readonly ItemView[];
  readonly labels: PaperLabels;
  readonly format: FormatProps;
}) => {
  const withReport = items.filter(hasReport);
  if (withReport.length === 0) return null;
  return (
    <section className="edited">
      <h2 className="edited__head">
        {labels.editedHeadline}
        <span className="edited__rule" aria-hidden="true" />
      </h2>
      {withReport.map((item) => (
        <article className="edited__row" key={item.key}>
          <h3 className="edited__headline">
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={labels.opensInNewTab(item.sourceLabel)}
            >
              {item.title}
            </a>
            <span className="edited__source">{item.sourceLabel}</span>
          </h3>
          <EditDiff report={item.lastReport} summary={labels.editSummary} />
          <p className="edited__meta">{format.published(item.lastChangedAt ?? item.publishedAt)}</p>
        </article>
      ))}
    </section>
  );
};

/** The empty paper: what to run, in the order it works. */
const Onboarding = ({ labels }: { readonly labels: PaperLabels }) => (
  <section className="onboarding">
    <h2 className="onboarding__title">{labels.onboarding.title}</h2>
    <p className="onboarding__lead">{labels.onboarding.lead}</p>
    <ol className="onboarding__steps">
      {labels.onboarding.steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
    <pre className="onboarding__command">{labels.onboarding.command}</pre>
  </section>
);
