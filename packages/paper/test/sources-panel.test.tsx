import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { one, PART, textsOf } from './support.ts';
import { aFile, LABELS, rowAt, show } from './support-sources.tsx';

/**
 * What the sources panel **says** (WP14). The affordances are `sources-editor.test.tsx`.
 *
 * The panel is the reading list in the paper, so the contract under test is
 * speech, and it is the same law the rest of the page is under:
 *
 *  - **a broken source is stated where the reader reads the paper** (rule 5): the
 *    loader's lines print in the row, with a count, and an empty directory says
 *    so — an empty box is not an answer;
 *  - **a peer that may not write is told so** (D-034): the sentence, and not one
 *    Save button that is guaranteed to fail;
 *  - every word is the app's (`LABELS`): the panel composes no string of its own,
 *    which is what keeps it locale-free (D-019).
 */

afterEach(cleanup);

describe('the list', () => {
  it('prints the directory and one row per file, with no head and no box of its own', () => {
    const root = show();
    expect(one(PART.sources, root).tagName).toBe('SECTION');
    // The modal owns the head and the border. A `panel` class here would be a
    // ringed, dotted box **inside** the dialog's box: two boxes, one block.
    expect(one(PART.sources, root).className).not.toContain('panel');
    expect(root.querySelectorAll(PART.blockHead)).toHaveLength(0);
    expect(one("[data-part='sources-dir']", root).textContent).toBe('files in /home/reader/sources');
    expect(root.querySelectorAll(PART.sourceRow)).toHaveLength(2);
    expect(textsOf(PART.sourceLabel, root)).toEqual(['Example World', 'Example Tech']);
    expect(textsOf(PART.sourceKind, root)).toEqual(['RSS', 'JSON']);
    expect(textsOf(PART.sourceState, root)).toEqual(['reporting', 'matching nothing']);
  });

  it('names the file on disk beside the label the file declares', () => {
    expect(textsOf("[data-part='source-file']", show())).toEqual(['world.json', 'tech.json']);
  });

  it('names the state of a file that has never been polled', () => {
    const root = show({ sources: [aFile({ state: null })] });
    const row = rowAt('world.json', root);
    expect(one(PART.sourceState, row).textContent).toBe(LABELS.noState);
    expect(row.getAttribute('data-state')).toBe('none');
  });

  it('prints no kind word for a kind it has no word for', () => {
    const root = show({ sources: [aFile({ kind: 'sqlite' })] });
    expect(root.querySelector(PART.sourceKind)).toBeNull();
    expect(one(PART.sourceLabel, rowAt('world.json', root)).textContent).toBe('Example World');
  });

  it('marks a file that is not enabled, so a stylesheet and a test can both see it', () => {
    const root = show({ sources: [aFile({ enabled: false })] });
    const row = rowAt('world.json', root);
    expect(row.getAttribute('data-enabled')).toBe('false');
    expect(one("[data-part='source-disabled']", row).textContent).toBe(LABELS.disabled);
    expect(row.getAttribute('data-state')).toBe('ok');
  });

  it('says the empty line when the directory has no files, and prints no list', () => {
    const root = show({ sources: [] });
    expect(one("[data-part='sources-empty']", root).textContent).toBe(LABELS.empty);
    expect(root.querySelectorAll(PART.sourceRow)).toHaveLength(0);
    expect(root.querySelector(PART.sourcesList)).toBeNull();
  });

  it('names a file whose id the loader could not read, and offers no delete for it', () => {
    const root = show({ sources: [aFile({ id: null, label: null, kind: null, state: null, issues: ['not json'] })] });
    expect(one("[data-part='source-noid']", root).textContent).toBe(LABELS.noId);
    expect(root.querySelector("[data-part='source-delete']")).toBeNull();
    expect(one(PART.sourceLabel, root).textContent).toBe('world.json');
  });
});

describe('a file the loader refused', () => {
  it('prints the loader’s lines, with the count, on the row that carries them', () => {
    const root = show({ sources: [aFile({ issues: ['id must be lowercase kebab-case', 'the filename is the id'] })] });
    const row = rowAt('world.json', root);
    expect(row.getAttribute('data-issues')).toBe('2');
    expect(textsOf(`${PART.issues} li`, row)).toEqual([
      LABELS.issues(2),
      'id must be lowercase kebab-case',
      'the filename is the id',
    ]);
  });

  it('prints no issues block for a file that parses', () => {
    expect(show().querySelector(PART.issues)).toBeNull();
  });
});

describe('a peer that may not write', () => {
  it('prints the sentence, and no affordance the server would refuse', () => {
    const root = show({ writable: false, onSave: undefined, onDelete: undefined });
    expect(one("[data-part='sources-readonly']", root).textContent).toBe(LABELS.readOnly);
    expect(
      root.querySelectorAll(
        "[data-part='source-edit'], [data-part='source-save'], [data-part='source-delete'], [data-part='new-save']",
      ),
    ).toHaveLength(0);
    expect(root.querySelector("[data-part='template-menu']")).toBeNull();
    expect(root.querySelector("[data-part='sources-new']")).toBeNull();
  });

  it('keeps the list itself: a reader on a phone still reads the reading list', () => {
    const root = show({ writable: false, onSave: undefined, onDelete: undefined });
    expect(root.querySelectorAll(PART.sourceRow)).toHaveLength(2);
    expect(one(PART.sources, root).querySelector(PART.sourceRow)).not.toBeNull();
  });
});

describe('the answer line', () => {
  it('prints the lines the server answered with, in the region that is always there', () => {
    const root = show({ messages: ['wrote /home/reader/sources/world.json', 'the row is refreshed'] });
    expect(one(PART.sourcesStatus, root).textContent).toBe(
      'wrote /home/reader/sources/world.json + the row is refreshed',
    );
  });

  it('prints an empty line, not nothing, when there is no answer to show', () => {
    expect(one(PART.sourcesStatus, show()).textContent).toBe('');
  });
});
