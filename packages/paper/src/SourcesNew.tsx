import { useState } from 'react';
import { CONTROL } from './blockHead.ts';
import type { SourceKindName, SourcesLabels } from './SourcesPanel.tsx';
import { QUIET, reasonOf, TEXT_BOX, WORD } from './sourceStyle.ts';

/**
 * The "new source" affordance of the sources panel (WP14), as a module of its own:
 * `SourcesPanel.tsx` is the list, and this is the skeleton menu — one block each, so
 * the panel keeps room for what the picker adds to it (rule 1's cap is the reason,
 * the responsibility split is the excuse).
 *
 * Choose a kind, and its skeleton lands in a textarea as **text to edit**, because
 * no form can validate an `html` source's selectors better than the config schema
 * does — and the reader is the author (D-011: the file is the truth, and the file is
 * what this posts).
 *
 * The write carries **no filename**: the server names the file `<id>.json` from the
 * posted text, and a filename that disagrees with the id is a refusal, not a rename.
 *
 * Presentational like the rest of the package: every word arrives in `labels`, and a
 * refused write is stated **beside the box the reader has to fix** (rule 5).
 */

const MENU_ID = 'sources-template-menu';
const NEW_ID = 'sources-new-text';
/** The id the skeletons declare, so the label names the file the write will make. */
const NEW_FILE = 'new-source.json';
const KINDS: readonly SourceKindName[] = ['rss', 'json', 'html'];

/** Narrowed, not cast: a `<select>` hands back a string, and only three of them mean anything. */
const kindOf = (name: string): SourceKindName | null =>
  name === 'rss' || name === 'json' || name === 'html' ? name : null;

interface NewSourceProps {
  readonly labels: SourcesLabels;
  readonly templates: Record<SourceKindName, string>;
  readonly onSave: (text: string, filename?: string) => Promise<void>;
}

export const NewSource = ({ labels, templates, onSave }: NewSourceProps) => {
  const [chosen, setChosen] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const choose = (name: string): void => {
    const kind = kindOf(name);
    setChosen(kind ?? '');
    setDraft(kind === null ? '' : templates[kind]);
    setFailed('');
  };

  const write = async (): Promise<void> => {
    setBusy(true);
    setFailed('');
    try {
      await onSave(draft);
    } catch (cause) {
      setFailed(reasonOf(cause));
      return;
    } finally {
      setBusy(false);
    }
    // A skeleton that wrote is closed; the list refetches and shows the file.
    setChosen('');
    setDraft('');
  };

  return (
    <div data-part="sources-new" className="mt-3 flex flex-col gap-2">
      <label htmlFor={MENU_ID} className={`block ${WORD}`}>
        {labels.newSource}
      </label>
      <select
        id={MENU_ID}
        data-part="template-menu"
        className={CONTROL}
        value={chosen}
        onChange={(event) => {
          choose(event.target.value);
        }}
      >
        <option value="" />
        {KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {labels.templates[kind]}
          </option>
        ))}
      </select>
      {chosen === '' ? null : (
        <>
          <label htmlFor={NEW_ID} className={`block ${WORD}`}>
            {labels.textOf(NEW_FILE)}
          </label>
          <textarea
            id={NEW_ID}
            data-part="source-text"
            rows={10}
            spellCheck={false}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            className={TEXT_BOX}
          />
          {chosen === 'html' ? (
            <p data-part="template-note" className={`m-0 ${QUIET}`}>
              {labels.htmlNote}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-part="new-save"
              className={CONTROL}
              disabled={busy}
              onClick={() => {
                void write();
              }}
            >
              {busy ? labels.saving : labels.save}
            </button>
            <button
              type="button"
              data-part="new-cancel"
              className={CONTROL}
              onClick={() => {
                setChosen('');
                setDraft('');
                setFailed('');
              }}
            >
              {labels.cancel}
            </button>
          </div>
          {failed === '' ? null : (
            <p data-part="new-error" className={`m-0 ${QUIET}`}>
              {failed}
            </p>
          )}
        </>
      )}
    </div>
  );
};
