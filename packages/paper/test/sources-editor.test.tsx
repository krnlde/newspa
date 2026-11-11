import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { one, PART } from './support.ts';
import { aFile, gateOf, LABELS, removeOf, rowAt, settled, show, TEMPLATES, writeOf } from './support-sources.tsx';

/**
 * What the sources panel **does** (WP14): three affordances, each of which ends
 * in a callback carrying the bytes the reader chose. The panel never fetches,
 * never validates, and never decides what a refusal means — the app owns the
 * fetch, the server owns the verdict (`parseSourceJson`, D-014), and a panel
 * that guessed would be a second, weaker validator.
 *
 * `onSave` carries the **file it is editing** (so the server can check the id is
 * the filename, D-011) and, for a skeleton, **no filename at all** (the server
 * names the file from the posted id). A delete carries the **id**, never the
 * path: `DELETE /api/sources?id=…` is the route, and `sourceIdSchema` is what
 * stops `..%2f` naming a file.
 */

afterEach(cleanup);

const editOf = (file: string, root: HTMLElement): void => {
  fireEvent.click(one("[data-part='source-edit']", rowAt(file, root)));
};

const boxOf = (scope: ParentNode): HTMLTextAreaElement => one<HTMLTextAreaElement>(PART.sourceText, scope);

describe('the editor', () => {
  it('puts the file’s own bytes in a textarea, named by the file they came from', () => {
    const root = show();
    editOf('tech.json', root);
    const box = boxOf(rowAt('tech.json', root));
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.value).toBe('{"id":"tech","kind":"json"}');
    expect(one<HTMLLabelElement>("label[for='source-text-tech.json']", root).textContent).toBe(
      LABELS.textOf('tech.json'),
    );
  });

  it('posts the edited text with the file it is editing, and closes when the write lands', async () => {
    const onSave = writeOf();
    const root = show({ onSave });
    editOf('world.json', root);
    fireEvent.change(boxOf(rowAt('world.json', root)), { target: { value: '{"id":"world","weight":5}' } });
    fireEvent.click(one("[data-part='source-save']", rowAt('world.json', root)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toBe('{"id":"world","weight":5}');
    expect(onSave.mock.calls[0]?.[1]).toBe('world.json');
    expect(root.querySelectorAll(PART.sourceText)).toHaveLength(0);
  });

  it('cancels: nothing is posted, and the box closes', () => {
    const onSave = writeOf();
    const root = show({ onSave });
    editOf('world.json', root);
    fireEvent.change(boxOf(rowAt('world.json', root)), { target: { value: 'not the file' } });
    fireEvent.click(one("[data-part='source-cancel']", rowAt('world.json', root)));
    expect(onSave).not.toHaveBeenCalled();
    expect(root.querySelectorAll(PART.sourceText)).toHaveLength(0);
  });

  it('keeps the box open, with the reader’s text, when the write is refused', async () => {
    const onSave = vi.fn(async (): Promise<void> => {
      throw new Error('the loader refused this file');
    });
    const root = show({ onSave });
    editOf('world.json', root);
    fireEvent.change(boxOf(rowAt('world.json', root)), { target: { value: '{ broken' } });
    fireEvent.click(one("[data-part='source-save']", rowAt('world.json', root)));
    await settled();
    expect(one<HTMLTextAreaElement>(PART.sourceText, rowAt('world.json', root)).value).toBe('{ broken');
    expect(one("[data-part='source-error']", rowAt('world.json', root)).textContent).toBe(
      'the loader refused this file',
    );
  });

  it('states a rejection that is not an Error, in the words the server threw', async () => {
    const onSave = vi.fn(async (): Promise<void> => {
      throw 'connection closed';
    });
    const root = show({ onSave });
    editOf('world.json', root);
    fireEvent.click(one("[data-part='source-save']", rowAt('world.json', root)));
    await settled();
    expect(one("[data-part='source-error']", rowAt('world.json', root)).textContent).toBe('connection closed');
  });

  it('says the write is in the air, and is disabled, so one press cannot post the file twice', async () => {
    const gate = gateOf();
    const onSave = vi.fn(async (): Promise<void> => gate.promise);
    const root = show({ onSave });
    editOf('world.json', root);
    fireEvent.click(one("[data-part='source-save']", rowAt('world.json', root)));
    const button = one<HTMLButtonElement>("[data-part='source-save']", root);
    expect(button.textContent).toBe(LABELS.saving);
    expect(button.disabled).toBe(true);
    await act(async () => {
      gate.open();
    });
    expect(root.querySelectorAll(PART.sourceText)).toHaveLength(0);
  });
});

describe('the skeleton for a new source', () => {
  const menuOf = (root: HTMLElement): HTMLSelectElement => one<HTMLSelectElement>("[data-part='template-menu']", root);

  it('inserts the skeleton of the kind chosen, in a textarea of its own', () => {
    const root = show();
    fireEvent.change(menuOf(root), { target: { value: 'rss' } });
    expect(boxOf(one("[data-part='sources-new']", root)).value).toBe(TEMPLATES.rss);
  });

  it('names every template the menu offers, in the words the app supplied', () => {
    fireEvent.change(menuOf(show()), { target: { value: 'json' } });
    const options = [...globalThis.document.querySelectorAll("[data-part='template-menu'] option")];
    expect(options.map((option) => `${option.getAttribute('value')}=${option.textContent ?? ''}`)).toEqual([
      '=',
      `rss=${LABELS.templates.rss}`,
      `json=${LABELS.templates.json}`,
      `html=${LABELS.templates.html}`,
    ]);
  });

  it('states the html note only beside the html skeleton', () => {
    const root = show();
    const menu = menuOf(root);
    fireEvent.change(menu, { target: { value: 'html' } });
    expect(one("[data-part='template-note']", root).textContent).toBe(LABELS.htmlNote);
    fireEvent.change(menu, { target: { value: 'json' } });
    expect(root.querySelector("[data-part='template-note']")).toBeNull();
  });

  it('closes the box when the menu is set back to nothing, and prints no skeleton', () => {
    const root = show();
    const menu = menuOf(root);
    fireEvent.change(menu, { target: { value: 'rss' } });
    expect(root.querySelectorAll("[data-part='sources-new'] [data-part='source-text']")).toHaveLength(1);
    fireEvent.change(menu, { target: { value: '' } });
    expect(root.querySelectorAll("[data-part='sources-new'] [data-part='source-text']")).toHaveLength(0);
  });

  it('cancels a skeleton: nothing is posted, and the box closes', () => {
    const onSave = writeOf();
    const root = show({ onSave });
    fireEvent.change(menuOf(root), { target: { value: 'rss' } });
    fireEvent.click(one("[data-part='new-cancel']", root));
    expect(onSave).not.toHaveBeenCalled();
    expect(root.querySelectorAll("[data-part='sources-new'] [data-part='source-text']")).toHaveLength(0);
  });

  it('posts the skeleton with no filename: the server names the file from the id', async () => {
    const onSave = writeOf();
    const root = show({ onSave });
    fireEvent.change(menuOf(root), { target: { value: 'json' } });
    fireEvent.change(boxOf(one("[data-part='sources-new']", root)), { target: { value: 'EDITED-SKELETON' } });
    fireEvent.click(one("[data-part='new-save']", root));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toBe('EDITED-SKELETON');
    expect(onSave.mock.calls[0]?.[1]).toBeUndefined();
    expect(root.querySelector("[data-part='sources-new'] [data-part='source-text']")).toBeNull();
  });

  it('states a skeleton that was refused, in front of the box the reader has to fix', async () => {
    const onSave = vi.fn(async (): Promise<void> => {
      throw new Error('id: the filename is the id');
    });
    const root = show({ onSave });
    fireEvent.change(menuOf(root), { target: { value: 'rss' } });
    fireEvent.click(one("[data-part='new-save']", root));
    await settled();
    expect(one("[data-part='new-error']", root).textContent).toBe('id: the filename is the id');
    expect(boxOf(one("[data-part='sources-new']", root)).value).toBe(TEMPLATES.rss);
  });
});

describe('the delete, asked once', () => {
  const askOf = (file: string, root: HTMLElement): void => {
    fireEvent.click(one("[data-part='source-delete']", rowAt(file, root)));
  };

  it('asks in the row, naming the file, and calls `onDelete` once with the id', async () => {
    const onDelete = removeOf();
    const root = show({ onDelete });
    askOf('tech.json', root);
    expect(onDelete).not.toHaveBeenCalled();
    expect(one(PART.confirm, rowAt('tech.json', root)).textContent).toBe(LABELS.confirmDelete('Example Tech'));
    fireEvent.click(one("[data-part='confirm-yes']", rowAt('tech.json', root)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onDelete.mock.calls[0]?.[0]).toBe('tech');
    expect(root.querySelector(PART.confirm)).toBeNull();
  });

  it('takes the asking back, and removes nothing', () => {
    const onDelete = removeOf();
    const root = show({ onDelete });
    askOf('world.json', root);
    fireEvent.click(one("[data-part='confirm-no']", rowAt('world.json', root)));
    expect(onDelete).not.toHaveBeenCalled();
    expect(root.querySelector(PART.confirm)).toBeNull();
  });

  it('says the removal is in the air, so one press cannot delete twice', async () => {
    const gate = gateOf();
    const onDelete = vi.fn(async (_id: string): Promise<void> => gate.promise);
    const root = show({ onDelete });
    askOf('world.json', root);
    fireEvent.click(one("[data-part='confirm-yes']", rowAt('world.json', root)));
    expect(one<HTMLButtonElement>("[data-part='confirm-yes']", root).textContent).toBe(LABELS.deleting);
    await act(async () => {
      gate.open();
    });
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('states a delete the server refused, in the row that asked for it', async () => {
    const onDelete = vi.fn(async (_id: string): Promise<void> => {
      throw new Error('no source file named world.json');
    });
    const root = show({ onDelete });
    askOf('world.json', root);
    fireEvent.click(one("[data-part='confirm-yes']", rowAt('world.json', root)));
    await settled();
    expect(one("[data-part='source-error']", rowAt('world.json', root)).textContent).toContain(
      'no source file named world.json',
    );
  });

  it('offers no delete for a file with no id, which the route cannot name', () => {
    const root = show({ sources: [aFile({ id: null, label: null, kind: null, state: null })], onDelete: removeOf() });
    expect(root.querySelectorAll("[data-part='source-delete']")).toHaveLength(0);
  });
});
