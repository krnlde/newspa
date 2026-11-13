import { render } from '@testing-library/react';
import type { ItemView } from 'newspa-core';
import { vi } from 'vitest';
import type { PaperProps } from '../src/index.ts';
import { Paper } from '../src/index.ts';
import { anEdition, anItem, aReport, aSource, at, THE_FORMAT, THE_LABELS, THE_MASTHEAD } from './support.ts';

/**
 * The page, mounted, and the fixtures its test files share. `Paper.tsx` composes
 * every block, so a block's behaviour is proved **through the page**: the order of
 * the sheet (`paper.test.tsx`, `front.test.tsx`) and the edited strip
 * (`edited-strip.test.tsx`). One copy of the mount, because the split exists to
 * satisfy rule 1's 300-line cap, and a fixture copied into a second file is a
 * fixture that drifts on the first edit.
 */

export const okSource = aSource({ id: 'tech', state: 'ok' });
export const brokenSource = aSource({
  id: 'world',
  state: 'no-matches',
  note: 'the selector matched 0 of 14 elements',
});

export const editedItem = (key: string, over: Partial<ItemView> = {}): ItemView =>
  anItem({ key, lastEventKind: 'edited', lastReport: aReport(), lastChangedAt: at('09:30'), ...over });

export const showPaper = (over: Partial<PaperProps> = {}) => {
  const props: PaperProps = {
    masthead: THE_MASTHEAD,
    edition: anEdition(),
    sources: [okSource],
    labels: THE_LABELS,
    format: THE_FORMAT,
    theme: 'light',
    onToggleTheme: vi.fn(),
    themeLabel: 'Switch to dark',
    ...over,
  };
  const container = render(<Paper {...props} />).container;
  return { container, props, onToggleTheme: props.onToggleTheme };
};

/** Every block of the edited strip's row, in the order the row prints. */
export const rowParts = (root: Element): string[] =>
  [...root.children].map((node) => node.getAttribute('data-part') ?? '');
