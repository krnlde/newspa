import { act, render } from '@testing-library/react';
import type { SourceFileView, SourcesResponse } from 'newspa-core';
import { type Mock, vi } from 'vitest';
import type { SourceKindName, SourcesLabels, SourcesProps } from '../src/index.ts';
import { SourcesPanel } from '../src/index.ts';
import { one, PART } from './support.ts';

/**
 * The fixtures the two sources-panel suites share.
 *
 * The labels are **literal finished words** and the templates literal text
 * (D-019): a component that composed a string of its own, or formatted a count,
 * prints something no test asked for. Every selector is a `data-part` (rule 11).
 *
 * It is its own module because the suites are two files by responsibility — what
 * the panel *says* (the list, the issues, the answer) and what the panel *does*
 * (edit, skeleton, delete) — and 300 lines is the cap for each of them (rule 1).
 */

export const LABELS: SourcesLabels = {
  empty: 'No source files in the directory.',
  directory: (dir: string) => `files in ${dir}`,
  kind: { rss: 'RSS', json: 'JSON', html: 'HTML' },
  state: {
    ok: 'reporting',
    blocked: 'blocked',
    'no-matches': 'matching nothing',
    restructured: 'restructured',
    error: 'errored',
    stale: 'gone quiet',
    unknown: 'unknown',
  },
  noState: 'never polled',
  disabled: 'disabled',
  issues: (count: number) => `${String(count)} problems in this file`,
  noId: 'no id in this file',
  textOf: (file: string) => `Source file text, ${file}`,
  edit: 'Edit',
  save: 'Save',
  saving: 'Saving',
  pick: 'Pick',
  picking: 'Picking',
  delete: 'Remove',
  deleting: 'Removing',
  cancel: 'Cancel',
  newSource: 'New source',
  readOnly: 'Editing is from this machine only.',
  templates: { rss: 'An RSS feed', json: 'A JSON endpoint', html: 'An HTML page' },
  confirmDelete: (label: string) => `Remove ${label}? The file goes; the items stay.`,
  htmlNote: 'The picker writes the selectors; render is refused until WP6.',
  messages: (lines: readonly string[]) => lines.join(' + '),
};

export const TEMPLATES: Record<SourceKindName, string> = {
  rss: 'RSS-SKELETON',
  json: 'JSON-SKELETON',
  html: 'HTML-SKELETON',
};

export const aFile = (over: Partial<SourceFileView> = {}): SourceFileView => ({
  file: 'world.json',
  id: 'world',
  kind: 'rss',
  label: 'Example World',
  text: '{"id":"world","kind":"rss"}',
  issues: [],
  enabled: true,
  state: 'ok',
  ...over,
});

export const FILES: SourcesResponse['files'] = [
  aFile(),
  aFile({
    file: 'tech.json',
    id: 'tech',
    label: 'Example Tech',
    kind: 'json',
    state: 'no-matches',
    text: '{"id":"tech","kind":"json"}',
  }),
];

/** The mocks as `Mock`, so a suite can read the arguments the panel posted. */
export type SaveMock = Mock<(text: string, filename?: string) => Promise<void>>;
export type RemoveMock = Mock<(id: string) => Promise<void>>;
export type PickMock = Mock<(id: string) => Promise<void>>;

export const writeOf = (): SaveMock => vi.fn(async (_text: string, _filename?: string): Promise<void> => undefined);
export const removeOf = (): RemoveMock => vi.fn(async (_id: string): Promise<void> => undefined);
export const pickOf = (): PickMock => vi.fn(async (_id: string): Promise<void> => undefined);

/** The panel as the app mounts it on a peer that may write: both affordances wired. */
export const show = (props: Partial<SourcesProps> = {}): HTMLElement => {
  const all: SourcesProps = {
    sources: FILES,
    dir: '/home/reader/sources',
    writable: true,
    labels: LABELS,
    templates: TEMPLATES,
    onSave: writeOf(),
    onDelete: removeOf(),
    ...props,
  };
  return render(<SourcesPanel {...all} />).container;
};

export const rowAt = (file: string, root: ParentNode = globalThis.document): HTMLElement =>
  one<HTMLElement>(`${PART.sourceRow}[data-file='${file}']`, root);

/** A file the picker can be asked for: `html` in item mode, so it declares a `list` (D-028). */
export const aPickedFile = (over: Partial<SourceFileView> = {}): SourceFileView =>
  aFile({
    file: 'page.json',
    id: 'page',
    kind: 'html',
    label: 'Example Page',
    text: '{"id":"page","kind":"html","list":"ul.cards > li"}',
    ...over,
  });

/**
 * The panel with a **rerender**, because a pick's report lands while the panel is
 * open: the suite hands a new `pickFill` down to the same mounted tree, which is
 * exactly what the fill's stamp is for (D-036).
 */
export const panelOf = (
  props: Partial<SourcesProps> = {},
): { readonly root: HTMLElement; readonly rerender: (over: Partial<SourcesProps>) => void } => {
  const base: SourcesProps = {
    sources: [aPickedFile()],
    dir: '/home/reader/sources',
    writable: true,
    labels: LABELS,
    templates: TEMPLATES,
    onSave: writeOf(),
    onPick: pickOf(),
    ...props,
  };
  const view = render(<SourcesPanel {...base} />);
  return {
    root: view.container,
    rerender: (over: Partial<SourcesProps>): void => {
      view.rerender(<SourcesPanel {...base} {...over} />);
    },
  };
};

/** A write the test decides the moment of: `busy` is only observable in the air. */
export const gateOf = (): { readonly promise: Promise<void>; readonly open: () => void } => {
  let open: () => void = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
};

/** Let a rejected write reach its handler: one microtask, flushed inside `act`. */
export const settled = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};
