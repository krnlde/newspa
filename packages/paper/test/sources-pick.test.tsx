import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourcesProps } from '../src/index.ts';
import { one, PART, partsOf } from './support.ts';
import { aFile, aPickedFile, LABELS, panelOf, pickOf, rowAt, settled, show, writeOf } from './support-sources.tsx';

/**
 * The picker's control in the sources editor (WP6, D-036), as the **paper** renders
 * it. The window opens on the machine that runs the server and the report arrives
 * from the app's poll; what is under test here is only what the panel can see:
 *
 *  - the control exists where a pick is possible: an `html` source whose file
 *    declares a `list` (D-028 — a page source has no list, `rss`/`json` need no
 *    selector) with an id the route can name, and only when the app passes `onPick`;
 *  - the job is **keyed by source id**: `pick: { id, state }` is one row's label and
 *    one row's disable, because a second window is a 409 on the server and the page
 *    must not offer the press. The panel can have two editors open at once, and a
 *    label on both would speak for a pick that row never started;
 *  - **the report fills, and never saves** (D-036): `pickFill.text` lands in that
 *    row's box when its stamp changes, so the reader presses SAVE themselves. The
 *    stamp is what lets the same text land twice, and what stops a re-render wiping
 *    the reader.
 *
 * The words are `LABELS`' literal finished strings (D-019): the panel composes none.
 */

const PICK = "[data-part='source-pick']";
const PICKED = '{"id":"page","kind":"html","list":"ul.cards > li","matchCount":12}';

const openEditor = (root: HTMLElement, file = 'page.json'): HTMLElement => {
  fireEvent.click(one("[data-part='source-edit']", rowAt(file, root)));
  return rowAt(file, root);
};

const boxOf = (root: ParentNode): HTMLTextAreaElement => one<HTMLTextAreaElement>(PART.sourceText, root);

/** The three controls of the open box, in the order they print. */
const controlsOf = (row: HTMLElement): string[] => {
  const head = one<HTMLButtonElement>("[data-part='source-save']", row).parentElement;
  if (head === null) throw new Error('the save control prints on no controls line');
  return partsOf(head);
};

afterEach(cleanup);

describe('the pick control', () => {
  it('is the third control of the open box, beside Save and Cancel', () => {
    const root = panelOf().root;
    const row = openEditor(root);
    expect(controlsOf(row)).toEqual(['source-save', 'source-pick', 'source-cancel']);
    expect(one<HTMLButtonElement>(PICK, row).textContent).toBe(LABELS.pick);
    expect(one<HTMLButtonElement>(PICK, row).disabled).toBe(false);
  });

  it('is not there at all when the app passes no `onPick`', () => {
    const root = show({ sources: [aPickedFile()] });
    const row = openEditor(root);
    expect(row.querySelector(PICK)).toBeNull();
    expect(row.querySelectorAll("[data-part='source-save'], [data-part='source-cancel']")).toHaveLength(2);
  });

  it('reads `picking` and is disabled while the job is running, so no second window is asked for', () => {
    const root = panelOf({ pick: { id: 'page', state: 'running' } }).root;
    const pick = one<HTMLButtonElement>(PICK, openEditor(root));
    expect(pick.textContent).toBe(LABELS.picking);
    expect(pick.disabled).toBe(true);
  });

  it('is pressable again in every other state the report has', () => {
    for (const state of ['idle', 'picked', 'failed'] as const) {
      const root = panelOf({ pick: { id: 'page', state } }).root;
      const pick = one<HTMLButtonElement>(PICK, openEditor(root));
      expect(pick.disabled, state).toBe(false);
      expect(pick.textContent, state).toBe(LABELS.pick);
    }
  });

  it('asks the app for the pick with the id of the file the box is editing', async () => {
    const onPick = pickOf();
    const root = panelOf({ onPick }).root;
    fireEvent.click(one(PICK, openEditor(root)));
    await settled();
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick.mock.calls[0]?.[0]).toBe('page');
  });

  it('states a pick the server refused, beside the box the reader is looking at', async () => {
    const onPick = vi.fn(async (_id: string): Promise<void> => {
      throw new Error('a pick window is already open for “tech”');
    });
    const root = panelOf({ onPick }).root;
    const row = openEditor(root);
    fireEvent.click(one(PICK, row));
    await settled();
    expect(one("[data-part='source-error']", row).textContent).toBe('a pick window is already open for “tech”');
  });

  it('prints no control for a source that is not html, even when its text declares a list', () => {
    for (const kind of ['rss', 'json'] as const) {
      const file = aPickedFile({
        file: `${kind}.json`,
        id: kind,
        kind,
        text: `{"id":"${kind}","kind":"${kind}","list":"ul.cards > li"}`,
      });
      const root = panelOf({ sources: [file] }).root;
      expect(openEditor(root, `${kind}.json`).querySelector(PICK), kind).toBeNull();
    }
  });

  it('prints no control for a page source, which has a body and no list to pick (D-028)', () => {
    const file = aPickedFile({ text: '{"id":"page","kind":"html","list":null}' });
    expect(openEditor(panelOf({ sources: [file] }).root).querySelector(PICK)).toBeNull();
  });

  it('prints no control for a file whose text does not parse, or parses to no list', () => {
    // The paper's own contract: a row is handed a `SourceFileView`, and a presentational
    // component may not crash on one whose text is not JSON. The loader's issue lines
    // are already on the row (rule 5), so the honest markup is: no control.
    for (const text of ['{ not json', 'null', '"a string"', '[]', '{"id":"page","kind":"html"}']) {
      const file = aPickedFile({ text, issues: ['[json] the file is not valid JSON'] });
      const root = panelOf({ sources: [file] }).root;
      expect(openEditor(root).querySelector(PICK), text).toBeNull();
    }
  });

  it('prints no control for a file with no id, which `POST /api/pick` cannot name', () => {
    const file = aPickedFile({ id: null });
    expect(openEditor(panelOf({ sources: [file] }).root).querySelector(PICK)).toBeNull();
  });

  it('prints no control when the app passes a broken file among the good ones', () => {
    const root = panelOf({
      sources: [aPickedFile(), aFile({ file: 'feed.json', id: 'feed', kind: 'rss', text: '{"id":"feed"}' })],
    }).root;
    expect(openEditor(root).querySelectorAll(PICK)).toHaveLength(1);
    expect(openEditor(root, 'feed.json').querySelector(PICK)).toBeNull();
  });
});

describe('the fill (D-036)', () => {
  const withBox = (
    props: Partial<SourcesProps> = {},
  ): { readonly root: HTMLElement; readonly box: HTMLTextAreaElement } => {
    const panel = panelOf(props);
    openEditor(panel.root);
    return { root: panel.root, box: boxOf(panel.root) };
  };

  it('replaces the box’s bytes with the pick’s text when the stamp changes', () => {
    const panel = panelOf();
    const box = boxOf(openEditor(panel.root));
    expect(box.value).toBe('{"id":"page","kind":"html","list":"ul.cards > li"}');
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '1' } });
    expect(boxOf(panel.root).value).toBe(PICKED);
  });

  it('fills again when the same text lands under a new stamp', () => {
    const panel = panelOf();
    openEditor(panel.root);
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '1' } });
    fireEvent.change(boxOf(panel.root), { target: { value: 'the reader typed over it' } });
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '2' } });
    expect(boxOf(panel.root).value).toBe(PICKED);
  });

  it('leaves what the reader typed alone when the same fill is handed down again', () => {
    const panel = panelOf();
    openEditor(panel.root);
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '1' } });
    fireEvent.change(boxOf(panel.root), { target: { value: 'mine, edited' } });
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '1' } });
    expect(boxOf(panel.root).value).toBe('mine, edited');
  });

  it('writes nothing: a landed pick fills the box and posts no save', async () => {
    const onSave = writeOf();
    const panel = panelOf({
      onSave,
      pick: { id: 'page', state: 'picked' },
      messages: ['the list matched 12 elements'],
    });
    openEditor(panel.root);
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '1' } });
    await settled();
    expect(onSave).not.toHaveBeenCalled();
    expect(boxOf(panel.root).value).toBe(PICKED);
  });

  it('prints the report’s lines in the panel’s status region, in the server’s own words', () => {
    const { root } = withBox({ messages: ['the list matched 12 elements', 'render stays false'] });
    expect(one(PART.sourcesStatus, root).textContent).toBe('the list matched 12 elements + render stays false');
  });
});

describe('the job belongs to one row, and the panel can have two editors open', () => {
  const OTHER = '{"id":"other","kind":"html","list":"ul.grid > li"}';

  const twoBoxes = (): { readonly root: HTMLElement; readonly rerender: (over: Partial<SourcesProps>) => void } => {
    const panel = panelOf({
      sources: [aPickedFile(), aPickedFile({ file: 'other.json', id: 'other', label: 'Example Other', text: OTHER })],
    });
    openEditor(panel.root);
    openEditor(panel.root, 'other.json');
    return panel;
  };

  it('labels and disables only the row the running job is on', () => {
    const panel = twoBoxes();
    panel.rerender({ pick: { id: 'page', state: 'running' } });
    const mine = one<HTMLButtonElement>(PICK, rowAt('page.json', panel.root));
    expect(mine.disabled).toBe(true);
    expect(mine.textContent).toBe(LABELS.picking);
    // The other row is not picking, and a label there would be a sentence about a
    // window that reader never opened.
    const other = one<HTMLButtonElement>(PICK, rowAt('other.json', panel.root));
    expect(other.disabled).toBe(false);
    expect(other.textContent).toBe(LABELS.pick);
  });

  it('fills only the box of the source that was picked', () => {
    const panel = twoBoxes();
    panel.rerender({ pickFill: { id: 'page', text: PICKED, at: '1' } });
    expect(boxOf(rowAt('page.json', panel.root)).value).toBe(PICKED);
    expect(boxOf(rowAt('other.json', panel.root)).value).toBe(OTHER);
  });
});
