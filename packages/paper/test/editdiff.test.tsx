import { cleanup, render } from '@testing-library/react';
import type { EditReportView } from 'newspa-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditDiff } from '../src/index.ts';
import { aReport, one, THE_LABELS } from './support.ts';

/**
 * The word diff of a story's **teaser** fields, marked the way print
 * copy-editing marks it: `ins` for inserted text, `del` for deleted text, plain
 * for text that did not move. That is a semantic claim, not a styling one, so
 * it is testable in happy-dom: the elements exist or they do not.
 *
 * The summary is asserted as **visible text**, because the component's comment
 * says it is deliberately not an `aria-label` — a `<p>` has no accessible name
 * to label, and the reader of the page should see the count too.
 */

afterEach(cleanup);

const showDiff = (report: Partial<EditReportView> = {}): HTMLElement =>
  render(<EditDiff report={aReport(report)} summary={THE_LABELS.editSummary} />).container;

describe('the marked text', () => {
  it('marks an inserted run with an `ins` element', () => {
    const ins = [...one('.diff', showDiff()).querySelectorAll('ins')];
    expect(ins).toHaveLength(1);
    expect(ins[0]?.textContent).toBe('unchanged');
  });

  it('marks a deleted run with a `del` element', () => {
    const del = [...one('.diff', showDiff()).querySelectorAll('del')];
    expect(del).toHaveLength(1);
    expect(del[0]?.textContent).toBe('steady');
  });

  it('leaves unchanged text unmarked', () => {
    const container = showDiff();
    expect(container.querySelectorAll('ins, del')).toHaveLength(2);
    expect(one('.diff', container).textContent).toContain('The bank kept rates ');
    const equal = [...one('.diff', container).querySelectorAll(':scope > span:not(.diff__count)')];
    expect(equal.map((node) => node.textContent)).toEqual(['The bank kept rates ']);
  });

  it('keeps the runs in the order the diff reported them', () => {
    expect(one('.diff', showDiff()).textContent).toBe('9 added, 5 removedThe bank kept rates unchangedsteady');
  });
});

describe('the summary', () => {
  it('prints the added and removed counts as text a reader can see', () => {
    expect(one('.diff__count', showDiff({ added: 3, removed: 1 })).textContent).toBe('3 added, 1 removed');
  });

  it('is not hidden behind an accessible name', () => {
    const paragraph = one('.diff', showDiff({ added: 3, removed: 1 }));
    expect(paragraph.hasAttribute('aria-label')).toBe(false);
    expect(paragraph.textContent).toContain('3 added, 1 removed');
  });

  it('is the label function the app handed in, called with this report’s counts', () => {
    const summary = vi.fn((added: number, removed: number) => `${String(added)}/${String(removed)}`);
    render(<EditDiff report={aReport({ added: 12, removed: 0 })} summary={summary} />);
    expect(summary).toHaveBeenCalledWith(12, 0);
    expect(one('.diff__count').textContent).toBe('12/0');
  });
});

describe('ops that repeat', () => {
  it('renders every run when two carry identical text, because the index is the identity', () => {
    const warned = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const container = showDiff({
      ops: [
        { type: 'insert', text: 'now' },
        { type: 'equal', text: ': ' },
        { type: 'insert', text: 'now' },
      ],
    });
    const ins = [...container.querySelectorAll('ins')];
    expect(ins).toHaveLength(2);
    expect(ins.map((node) => node.textContent)).toEqual(['now', 'now']);
    expect(warned).not.toHaveBeenCalled();
  });

  it('prints the summary alone for an empty diff', () => {
    const container = showDiff({ ops: [], added: 0, removed: 0 });
    expect(container.querySelectorAll('ins, del')).toHaveLength(0);
    expect(one('.diff', container).textContent).toBe('0 added, 0 removed');
  });
});
