import { cleanup, render } from '@testing-library/react';
import type { HealthState, SourceHealthView } from 'newspa-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { HealthProps } from '../src/index.ts';
import { HealthStrip } from '../src/index.ts';
import { aSource, one, THE_FORMAT, THE_HEALTH_LABELS, textsOf } from './support.ts';

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

const detailOf = (source: SourceHealthView): string | null =>
  showHealth([source]).querySelector('.health__detail')?.textContent ?? null;

describe('an empty strip', () => {
  it('renders nothing at all, so a paper with no sources cannot look like a paper with no news', () => {
    const container = showHealth([]);
    expect(container.querySelector('.health')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});

describe('when every source is reporting', () => {
  it('prints the all-well line with the count, and no row', () => {
    const container = showHealth([aSource({ id: 'world' }), aSource({ id: 'tech', label: 'Example Tech' })]);
    expect(one('.health', container).className).toBe('health health--well');
    expect(one('.health__head', container).textContent).toBe(THE_HEALTH_LABELS.headline);
    expect(one('.health__line', container).textContent).toBe('2 sources, all reporting');
    expect(container.querySelectorAll('.health__row')).toHaveLength(0);
  });

  it('names one source as one count, in words the app composed', () => {
    expect(one('.health__line', showHealth([aSource()])).textContent).toBe('1 sources, all reporting');
  });
});

describe('a source that is not reporting', () => {
  it('prints one row per unhealthy source, and no row for the healthy ones', () => {
    const container = showHealth([
      aSource({ id: 'tech', state: 'ok', label: 'Example Tech' }),
      broken({ id: 'world' }),
      broken({ id: 'gov', label: 'Example Gov', state: 'blocked' }),
    ]);
    expect(container.querySelectorAll('.health__row')).toHaveLength(2);
    expect(textsOf('.health__label', container)).toEqual(['Example World', 'Example Gov']);
  });

  it('prints the label, the state word for the state, and the note the parser wrote', () => {
    const row = one('.health__row', showHealth([broken({ state: 'restructured' })]));
    expect(row.getAttribute('data-state')).toBe('restructured');
    expect(one('.health__label', row).textContent).toBe('Example World');
    expect(one('.health__state', row).textContent).toBe(THE_HEALTH_LABELS.state.restructured);
    expect(row.textContent).toContain('the selector matched 0 of 14 elements');
  });

  it('names every state the wire can carry, so no state is rendered as a blank', () => {
    const states: readonly HealthState[] = ['unknown', 'blocked', 'no-matches', 'restructured', 'error', 'stale'];
    for (const state of states) {
      const row = one('.health__row', showHealth([broken({ state, note: null })]));
      expect(row.getAttribute('data-state'), state).toBe(state);
      expect(one('.health__state', row).textContent, state).toBe(THE_HEALTH_LABELS.state[state]);
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
