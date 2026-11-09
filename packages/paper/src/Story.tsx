import type { DiffOpView, EditReportView, ItemView } from 'newspa-core';
import type { FormatProps, StoryLabels, StoryProps } from './types.ts';

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
 */
export const Story = ({ item, slot, labels, format, showImage }: StoryProps) => {
  const kicker = item.lastEventKind === 'edited' ? labels.editedKicker : labels.newKicker;
  const meta = metaOf(item, labels, format);
  return (
    <article className={`story story--${slot}`} data-key={item.key} data-read={item.read ? 'true' : 'false'}>
      {showImage && item.image !== null ? (
        <figure className="story__figure">
          <img className="story__image" src={item.image} alt="" loading="lazy" />
          <figcaption className="story__caption">{item.sourceLabel}</figcaption>
        </figure>
      ) : null}
      <p className="story__kicker">
        {item.read ? null : <span className="story__mark" aria-hidden="true" />}
        {kicker}
        <span className="story__source">{item.sourceLabel}</span>
      </p>
      <h3 className="story__headline">
        <a
          className="story__link"
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={labels.opensInNewTab(item.sourceLabel)}
        >
          {item.title}
        </a>
      </h3>
      {item.teaser.length > 0 ? <p className="story__deck">{item.teaser}</p> : null}
      {meta.length > 0 ? <p className="story__meta">{meta}</p> : null}
    </article>
  );
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
  <p className="diff">
    {/* The count is real text, not an `aria-label`: a `<p>` has no accessible
        name to label, and a reader of the page should see it too. */}
    <span className="diff__count">{summary(report.added, report.removed)}</span>
    {keyedOps(report.ops).map(({ op, at }) =>
      op.type === 'equal' ? (
        <span key={at}>{op.text}</span>
      ) : op.type === 'insert' ? (
        <ins key={at}>{op.text}</ins>
      ) : (
        <del key={at}>{op.text}</del>
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
