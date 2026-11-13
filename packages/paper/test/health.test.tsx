import { cleanup, render } from '@testing-library/react';
import type { HealthState, SourceHealthView } from 'newspa-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthProps } from '../src/index.ts';
import { HealthStrip } from '../src/index.ts';
import { aSource, at, one, PART, THE_FORMAT, THE_HEALTH_LABELS, textsOf } from './support.ts';

/**
 * Rule 5 made visible. A source that matches nothing, is blocked, is stale, or
 * has never been fetched **must** reach the paper with its own state word and
 * the parser's note, because a silent zero is indistinguishable from a quiet
 * news day. So the tests here are about what a reader can see: the count when
 * all is well, one row per unhealthy source, and the evidence line — note, rot,
 * age, items, cadence — joined without dangling separators.
 *
 * Every word comes from `THE_HEALTH_LABELS` and every instant from
 * `THE_FORMAT.ago`, so a component that formatted a count or a date itself
 * would print something no test expected.
 */

afterEach(cleanup);

const showHealth = (sources: readonly SourceHealthView[]): HTMLElement => {
  const props: HealthProps = { sources, labels: THE_HEALTH_LABELS, format: THE_FORMAT };
  return render(<HealthStrip {...props} />).container;
};

const broken = (over: Partial<SourceHealthView> = {}): SourceHealthView =>
  aSource({ state: 'no-matches', label: 'Example World', note: 'the selector matched 0 of 14 elements', ...over });

const rowSelector = `${PART.health} ${PART.healthRow}`;
const detailOf = (source: SourceHealthView): string | null =>
  showHealth([source]).querySelector(PART.detail)?.textContent ?? null;

describe('an empty strip', () => {
  it('renders nothing at all, so a paper with no sources cannot look like a paper with no news', () => {
    const container = showHealth([]);
    expect(container.querySelector(PART.health)).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

describe('when every source is reporting', () => {
  it('prints the all-well line with the count, and no row', () => {
    const container = showHealth([aSource({ id: 'world' }), aSource({ id: 'tech', label: 'Example Tech' })]);
    expect(one<HTMLElement>(PART.health, container).dataset['well']).toBe('true');
    expect(one(`${PART.health} ${PART.blockHead}`, container).textContent).toBe(THE_HEALTH_LABELS.headline);
    expect(one(PART.line, container).textContent).toBe('2 sources, all reporting');
    expect(container.querySelectorAll(rowSelector)).toHaveLength(0);
  });

  it('names one source as one count, in words the app composed', () => {
    expect(one(PART.line, showHealth([aSource()])).textContent).toBe('1 sources, all reporting');
  });
});

describe('a source that is not reporting', () => {
  it('prints one row per unhealthy source, and no row for the healthy ones', () => {
    const container = showHealth([
      aSource({ id: 'tech', state: 'ok', label: 'Example Tech' }),
      broken({ id: 'world' }),
      broken({ id: 'gov', label: 'Example Gov', state: 'blocked' }),
    ]);
    expect(container.querySelectorAll(rowSelector)).toHaveLength(2);
    expect(textsOf(PART.label, container)).toEqual(['Example World', 'Example Gov']);
  });

  it('carries the poll the row reports on as an absolute date, in the row', () => {
    // The row's age is measured from the reader's clock, so the exact instant is the
    // part a reader cannot derive from what they see: when the poll ran, zone named.
    const container = showHealth([broken({ id: 'world', lastFetchAt: at('09:30') })]);
    expect(one(rowSelector, container).getAttribute('title')).toBe(`absolute(${at('09:30')})`);
  });

  it('carries no tooltip for a source that has never been fetched', () => {
    const container = showHealth([broken({ id: 'world', lastFetchAt: null })]);
    expect(one(rowSelector, container).hasAttribute('title')).toBe(false);
  });

  it('marks the strip as not-well, so a stylesheet can name the state', () => {
    const container = showHealth([broken({ id: 'world' })]);
    expect(one<HTMLElement>(PART.health, container).dataset['well']).toBeUndefined();
  });

  it('prints the label, the state word for the state, and the note the parser wrote', () => {
    const row = one(rowSelector, showHealth([broken({ state: 'restructured' })]));
    expect(row.getAttribute('data-state')).toBe('restructured');
    expect(one(PART.label, row).textContent).toBe('Example World');
    expect(one(PART.state, row).textContent).toBe(THE_HEALTH_LABELS.state.restructured);
    expect(row.textContent).toContain('the selector matched 0 of 14 elements');
  });

  it('names every state the wire can carry, so no state is rendered as a blank', () => {
    const states: readonly HealthState[] = ['unknown', 'blocked', 'no-matches', 'restructured', 'error', 'stale'];
    for (const state of states) {
      const row = one(rowSelector, showHealth([broken({ state, note: null })]));
      expect(row.getAttribute('data-state'), state).toBe(state);
      expect(one(PART.state, row).textContent, state).toBe(THE_HEALTH_LABELS.state[state]);
    }
  });
});

describe('the evidence line', () => {
  it('joins the note, the last poll, the item count and the cadence with a separator', () => {
    expect(detailOf(broken({ itemCount: 0, cadenceMinutes: 20 }))).toBe(
      `the selector matched 0 of 14 elements · last poll ago(${aSource().lastFetchAt ?? ''}) · 0 stories · every 20 min`,
    );
  });

  it('says never fetched for a source that has never been polled, instead of an age', () => {
    const detail = detailOf(broken({ note: null, lastFetchAt: null }));
    expect(detail).toBe(`never fetched · 12 stories · every 20 min`);
  });

  it('reports the rot when the selector matched fewer elements than it expected', () => {
    expect(detailOf(broken({ note: null, matchCount: 0, expectedMatchCount: 14 }))).toContain(
      'matched 0 of 14 elements',
    );
  });

  it('says nothing about matches when the counts are equal: nothing has rotted', () => {
    const detail = detailOf(broken({ note: null, matchCount: 14, expectedMatchCount: 14 }));
    expect(detail).not.toContain('matched');
  });

  it('says nothing about matches when the source has no expected count to compare against', () => {
    const detail = detailOf(broken({ note: null, matchCount: 40, expectedMatchCount: null }));
    expect(detail).not.toContain('matched');
    expect(detailOf(broken({ note: null, matchCount: null, expectedMatchCount: 14 }))).not.toContain('matched');
  });

  it('does not report a match count that is above the expected one as rot', () => {
    expect(detailOf(broken({ note: null, matchCount: 20, expectedMatchCount: 14 }))).not.toContain('matched');
  });
});

describe('the shape of the strip', () => {
  it('prints the list, the rows and the head in that order, and the all-well line instead of a list', () => {
    const brokenStrip = showHealth([broken({ id: 'world' })]);
    expect([...one(PART.health, brokenStrip).children].map((node) => node.getAttribute('data-part'))).toEqual([
      'block-head',
      'list',
    ]);
    const wellStrip = showHealth([aSource({ id: 'world' })]);
    expect([...one(PART.health, wellStrip).children].map((node) => node.getAttribute('data-part'))).toEqual([
      'block-head',
      'line',
    ]);
  });
});
