import type { EditReportView, ItemView } from 'newspa-core';
import { HEAD_RULE, PANEL_HEAD } from './blockHead.ts';
import type { PaperLabels } from './Paper.tsx';
import { EditDiff } from './Story.tsx';
import type { FormatProps } from './types.ts';

/* `Array.filter` cannot narrow, so the proof is written down: a row of the
   edited strip **always** has a report, which is why the render below has no
   `null` arm — and no branch that no test can reach. */
const hasReport = (item: ItemView): item is ItemView & { readonly lastReport: EditReportView } =>
  item.lastReport !== null;

/**
 * The edited strip: stories whose text changed, with the word diff of the
 * teaser. A publisher rewriting a headline is news in a tool that shows what
 * changed, and the diff is the evidence.
 */
export const EditedStrip = ({
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
    <section data-part="edited" className="mt-10 panel">
      <h2 data-part="block-head" className={PANEL_HEAD}>
        {labels.editedHeadline}
        <span data-part="rule" className={HEAD_RULE} aria-hidden="true" />
      </h2>
      {withReport.map((item) => (
        <article
          data-part="edited-row"
          key={item.key}
          className="py-3 border-b border-b-[length:var(--hair)] border-b-rule break-inside-avoid"
        >
          <h3
            data-part="headline"
            className="flex flex-wrap items-baseline gap-2 m-0 text-section font-bold leading-display break-after-avoid"
          >
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={labels.opensInNewTab(item.sourceLabel)}
              className="underline decoration-[length:var(--hair)] underline-offset-[0.15em]"
            >
              {item.title}
            </a>
            <span data-part="source" className="m-0 text-kicker font-bold tracking-kicker uppercase text-muted">
              {item.sourceLabel}
            </span>
          </h3>
          <EditDiff report={item.lastReport} summary={labels.editSummary} />
          <p data-part="meta" className="m-0 text-kicker font-normal tracking-kicker uppercase text-muted">
            {format.published(item.lastChangedAt ?? item.publishedAt)}
          </p>
        </article>
      ))}
    </section>
  );
};
