import type { HealthState, SourceHealthView } from 'newspa-core';
import { HEAD_RULE } from './blockHead.ts';
import type { FormatProps } from './types.ts';

/**
 * Source health, printed in the paper.
 *
 * This block is rule 5 made visible: a source that matches nothing, is blocked,
 * or changed shape **must** reach the page, because a silent zero is
 * indistinguishable from a quiet news day. An empty strip therefore says
 * "everything reported", and any other state names the source, the state and
 * the parser's own note.
 *
 * Every row here is a source that is **not** reporting, so every row carries
 * `pattern-crossings`: a newspaper prints a cross-hatch where a photograph is
 * missing. The mark names an absence, which is why it is never decoration, and
 * why an `ok` source prints no row at all.
 */
export interface HealthLabels {
  readonly headline: string;
  /** `"12 sources, all reporting"` — the healthy line, with the count. */
  readonly allWell: (count: number) => string;
  readonly state: Record<HealthState, string>;
  /** `"every 20 min"` */
  readonly cadence: (minutes: number) => string;
  /** `"60 stories"` */
  readonly items: (count: number) => string;
  readonly neverFetched: string;
  /** `"last poll 3 hours ago"` */
  readonly lastPoll: (age: string) => string;
  /** The rot line: `"the selector matched 0 of 14 elements"`. */
  readonly matches: (seen: number, expected: number) => string;
}

export interface HealthProps {
  readonly sources: readonly SourceHealthView[];
  readonly labels: HealthLabels;
  readonly format: FormatProps;
}

/**
 * The strip's label, at `text-small`: a health strip is a footnote to the
 * paper, not a section, so it takes the panel label and lowers its type.
 */
const HEALTH_HEAD = 'flex items-center gap-[0.6rem] mb-2 text-small font-bold tracking-kicker uppercase';

export const HealthStrip = ({ sources, labels, format }: HealthProps) => {
  const unhealthy = sources.filter((source) => source.state !== 'ok');
  if (sources.length === 0) return null;
  if (unhealthy.length === 0) {
    return (
      <footer data-part="health" data-well="true" className="mt-10 panel text-small">
        <h2 data-part="block-head" className={HEALTH_HEAD}>
          {labels.headline}
        </h2>
        <p data-part="line" className="m-0 text-muted">
          {labels.allWell(sources.length)}
        </p>
      </footer>
    );
  }
  return (
    <footer data-part="health" className="mt-10 panel text-small">
      <h2 data-part="block-head" className={HEALTH_HEAD}>
        {labels.headline}
        <span data-part="rule" className={HEAD_RULE} aria-hidden="true" />
      </h2>
      <ul data-part="list" className="m-0 p-0 list-none">
        {unhealthy.map((source) => (
          <li
            key={source.id}
            data-part="row"
            data-state={source.state}
            className="flex flex-wrap gap-2 py-[0.3rem] border-b border-b-[length:var(--hair)] border-b-rule pattern-crossings"
          >
            <span data-part="label" className="font-bold text-ink">
              {source.label}
            </span>
            <span data-part="state" className="font-bold tracking-kicker uppercase text-kicker text-ink-2">
              {labels.state[source.state]}
            </span>
            <span data-part="detail" className="text-muted">
              {detailOf(source, labels, format)}
            </span>
          </li>
        ))}
      </ul>
    </footer>
  );
};

/** One line of evidence: the parser's note, the match count, the age, the cadence. */
const detailOf = (source: SourceHealthView, labels: HealthLabels, format: FormatProps): string => {
  const parts: string[] = [];
  if (source.note !== null) parts.push(source.note);
  if (source.matchCount !== null && source.expectedMatchCount !== null && source.matchCount < source.expectedMatchCount)
    parts.push(labels.matches(source.matchCount, source.expectedMatchCount));
  if (source.lastFetchAt === null) parts.push(labels.neverFetched);
  else parts.push(labels.lastPoll(format.ago(source.lastFetchAt)));
  parts.push(labels.items(source.itemCount));
  parts.push(labels.cadence(source.cadenceMinutes));
  return parts.filter((part) => part.length > 0).join(' · ');
};
