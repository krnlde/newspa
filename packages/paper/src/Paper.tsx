import type { Edition, EditionStats, MastheadView, SourceHealthView } from 'newspa-core';
import { EditedStrip } from './EditedStrip.tsx';
import { FrontPage } from './FrontPage.tsx';
import { type HealthLabels, HealthStrip } from './HealthStrip.tsx';
import { Masthead } from './Masthead.tsx';
import { Section } from './Section.tsx';
import { Spine } from './Spine.tsx';
import type { Contrast, FormatProps, InstallControl, SourcesControl, SpineProps, StoryLabels } from './types.ts';

/**
 * The page: masthead, front page, sections, the edited strip, source health.
 * This file owns **the order the page prints in** and nothing else; the front
 * page's grid is `FrontPage.tsx`, the diff panel is `EditedStrip.tsx`, a
 * section is `Section.tsx`, a story is `Story.tsx`, and the block label's
 * vocabulary is `blockHead.ts`.
 *
 * There is **no edition** to pick (D-002): the page is the product, and it
 * shows what the last polls changed. Nothing here fetches, translates, formats
 * a date, or reads a clock — the app owns all four, and this file owns the
 * order things appear in and the utility classes that style every block. An
 * empty paper is a state, not a blank page: onboarding, with the commands that
 * add a source.
 */
export interface OnboardingCopy {
  readonly title: string;
  readonly lead: string;
  readonly steps: readonly string[];
  readonly command: string;
}

/**
 * The sheet's own class string, exported: a solid panel of paper on the
 * patterned stock, framed by the guidelines and the printer's crop marks.
 * `px-gutter` is the clamp that keeps a phone's edge air and a wide desk's edge
 * measure. It is public because the app's loading and failure states are shells
 * of the same page, and a class string copied into `App.tsx` is a second sheet
 * definition that drifts on the first edit.
 */
export const sheetClass =
  'mx-auto max-w-[104rem] px-gutter pt-box pb-16 min-[40rem]:pt-box-wide bg-paper guide-frame cropmarks relative';

export interface PaperLabels extends StoryLabels {
  readonly health: HealthLabels;
  readonly editedHeadline: string;
  readonly onboarding: OnboardingCopy;
  /** `"38 stories · 6 new · 2 edited"` — the dateline strip's line. `cachedAt`
   * adds the worker's stamp, and only when it is there (WP16, D-039): a caller
   * with no worker has nothing to say, and an optional argument says so. */
  readonly stats: (stats: EditionStats, cachedAt?: string | null) => string;
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
  /**
   * The contrast axis (D-038): a second, orthogonal knob. Omitted, and the strip
   * prints one control, as it did. The pair is deliberate — the e-ink wall wants
   * *black on white* and *white on black*, which is two axes, not four modes, and
   * the CSS rebinds the same token names under `[data-contrast]`.
   */
  readonly contrast?: Contrast | undefined;
  readonly onToggleContrast?: (() => void) | undefined;
  readonly contrastLabel?: string | undefined;
  /**
   * The worker's stamp (WP16, D-039): the ISO time the edition on this page was
   * written into a cache, or `null` when the answer came off the wire. `Paper`
   * renders no words of its own, so it hands the value to `labels.stats` and the
   * app decides the sentence — an installed page that shows a stale edition
   * without saying so is rule 5's silent zero, and this is the line that stops it.
   */
  readonly cachedAt?: string | null;
  /**
   * The install entry (WP16, D-039): the third control in the strip, omitted when
   * the app has nothing to offer. Named for what it is, not for the browser's
   * event: the paper prints an act, and the app decides whether this browser has
   * one, a recipe, or neither.
   */
  readonly install?: InstallControl;
  /**
   * The editor's entry, printed in the dateline strip (WP14). Omitted, and the
   * page is the paper alone. Named `editor`, not `sources`: `sources` is the
   * health strip's array, and one prop that is a list and a control is a lie.
   *
   * The editor itself is **not** a child of the sheet. The sheet is the one panel
   * of paper on the page (`docs/design.md`: its own `bg-paper`, guideline ring
   * and crop marks), and a form inside it would print on the newsprint — three
   * lines per source, a textarea, and the absolute path of the watchlist
   * directory. So the sheet prints news and the editor opens **above** it, in a
   * modal (`SourcesModal.tsx`).
   */
  readonly editor?: SourcesControl;
  /**
   * The spine (D-043): the rail of section ticks over the scrollbar, and the
   * panel of titles. Omitted when there is nothing to navigate — an empty paper
   * has no sections, and a rail with no ticks is a mark drawn for nothing.
   */
  readonly spine?: SpineProps;
}

export const Paper = ({
  masthead,
  edition,
  sources,
  labels,
  format,
  theme,
  onToggleTheme,
  themeLabel,
  contrast,
  onToggleContrast,
  contrastLabel,
  cachedAt = null,
  install,
  editor,
  spine,
}: PaperProps) => (
  <div data-part="sheet" className={sheetClass}>
    <Masthead
      name={masthead.name}
      tagline={masthead.tagline}
      dateline={edition.dateline}
      summary={labels.stats(edition.stats, cachedAt)}
      format={format}
      generatedAt={edition.generatedAt}
      cachedAt={cachedAt}
      {...(install === undefined ? {} : { install })}
      theme={theme}
      onToggleTheme={onToggleTheme}
      themeLabel={themeLabel}
      contrast={contrast}
      onToggleContrast={onToggleContrast}
      contrastLabel={contrastLabel}
      {...(editor === undefined ? {} : { sources: editor })}
    />
    {sources.length === 0 ? (
      <Onboarding copy={labels.onboarding} />
    ) : (
      <>
        <FrontPage lead={edition.lead} sections={edition.sections} labels={labels} format={format} />
        <div
          data-part="sections"
          className="grid gap-8 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] pt-4 max-[640px]:grid-cols-1"
        >
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
        <EditedStrip items={edition.edited} labels={labels} format={format} />
        <HealthStrip sources={sources} labels={labels.health} format={format} />
        {/* The rail is last in the sheet's order, so tabbing reaches it after the
            news. It prints whenever the edition has a place to go (the app decides
            from the section count): the rail's box must exist **before** the ticks
            are measured, because a tick's place is a fraction of the rail's height,
            and a rail mounted by its own ticks measures zero and piles every mark
            at the top. Measured, 2026-11-13. */}
        {spine === undefined ? null : <Spine {...spine} />}
      </>
    )}
  </div>
);

/**
 * The empty paper: what to run, in the order it works. Exported because the
 * app's failure state is the same panel with the publisher's words in it —
 * "the server answered 500" and "there are no sources" both end in the same
 * reader question, *what do I run now* — and a panel built twice is two panels.
 * The steps are optional: a failure has no recipe, and an empty `<ol>` is a
 * strip of list-marker air above the command.
 */
export const Onboarding = ({ copy }: { readonly copy: OnboardingCopy }) => (
  <section data-part="onboarding" className="mt-8 max-w-[34rem] panel">
    <h2 data-part="onboarding-title" className="mb-2 text-title leading-display font-bold">
      {copy.title}
    </h2>
    <p data-part="onboarding-lead" className="mb-4 text-deck italic text-ink-2">
      {copy.lead}
    </p>
    {copy.steps.length > 0 ? (
      <ol data-part="onboarding-steps" className="mb-4 ps-5 text-note">
        {copy.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    ) : null}
    <pre
      data-part="onboarding-command"
      className="m-0 p-box border border-[length:var(--hair)] border-rule-strong bg-paper-2 font-paper text-[0.8rem] whitespace-pre-wrap"
    >
      {copy.command}
    </pre>
  </section>
);
