import type { HealthState, SourceHealthView } from 'newspa-core';
import type { FormatProps } from './types.ts';

/**
 * Source health, printed in the paper.
 *
 * This block is rule 5 made visible: a source that matches nothing, is blocked,
 * or changed shape **must** reach the page, because a silent zero is
 * indistinguishable from a quiet news day. An empty strip therefore says
 * "everything reported", and any other state names the source, the state and
 * the parser's own note.
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

export const HealthStrip = ({ sources, labels, format }: HealthProps) => {
  const unhealthy = sources.filter((source) => source.state !== 'ok');
  if (sources.length === 0) return null;
  if (unhealthy.length === 0) {
    return (
      <footer className="health health--well">
        <h2 className="health__head">{labels.headline}</h2>
        <p className="health__line">{labels.allWell(sources.length)}</p>
      </footer>
    );
  }
  return (
    <footer className="health">
      <h2 className="health__head">
        {labels.headline}
        <span className="health__rule" aria-hidden="true" />
      </h2>
      <ul className="health__list">
        {unhealthy.map((source) => (
          <li key={source.id} className="health__row" data-state={source.state}>
            <span className="health__label">{source.label}</span>
            <span className="health__state">{labels.state[source.state]}</span>
            <span className="health__detail">{detailOf(source, labels, format)}</span>
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
