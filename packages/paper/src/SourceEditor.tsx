import type { SourceFileView } from 'newspa-core';
import { useState } from 'react';
import { CONTROL } from './blockHead.ts';
import type { SourcesLabels } from './SourcesPanel.tsx';
import { QUIET, reasonOf, TEXT_BOX, textIdOf, WORD } from './sourceStyle.ts';

/**
 * The row's editor: the file's own bytes in a box, and a Save that posts them.
 *
 * The editor edits **text**, not fields, because the file is the truth (D-011,
 * D-025) and the server validates what is posted with the loader's own parser
 * (D-014). A form that "fixed" the JSON for the reader would be a second,
 * weaker validator, and the second validator is the one that drifts.
 *
 * No monospace face: `docs/design.md` sets one family for everything, and the
 * onboarding command block (`font-paper`, a small step, whitespace kept) is the
 * paper's existing precedent for code-shaped text.
 *
 * **A rejected write keeps the box open with the reader's text in it** and names
 * the reason. The answer's words are the app's to print in the panel's status
 * line; this is the copy of the fact that stays where the reader can fix it
 * (rule 5), and handling the rejection here is what stops it floating out of the
 * click handler as an unhandled promise.
 */
export interface SourceEditorProps {
  readonly file: SourceFileView;
  readonly labels: SourcesLabels;
  readonly onSave: (text: string, filename?: string) => Promise<void>;
  /** Close the box: the row owns whether it is open, so it owns closing it. */
  readonly onDone: () => void;
}

export const SourceEditor = ({ file, labels, onSave, onDone }: SourceEditorProps) => {
  const [text, setText] = useState(file.text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const id = textIdOf(file.file);

  /** `busy` is what stops one press posting the file twice. */
  const save = async (): Promise<void> => {
    setBusy(true);
    setFailed('');
    try {
      await onSave(text, file.file);
    } catch (cause) {
      setFailed(reasonOf(cause));
      return;
    } finally {
      setBusy(false);
    }
    // Only a write that landed closes the box: the app refetches the list, and
    // the row that arrives carries the file's new bytes.
    onDone();
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={`block ${WORD}`}>
        {labels.textOf(file.file)}
      </label>
      <textarea
        id={id}
        data-part="source-text"
        rows={8}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className={TEXT_BOX}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-part="source-save"
          className={CONTROL}
          disabled={busy}
          onClick={() => {
            void save();
          }}
        >
          {busy ? labels.saving : labels.save}
        </button>
        <button
          type="button"
          data-part="source-cancel"
          className={CONTROL}
          onClick={() => {
            setFailed('');
            setText(file.text);
            onDone();
          }}
        >
          {labels.cancel}
        </button>
      </div>
      {failed === '' ? null : (
        <p data-part="source-error" className={`m-0 ${QUIET}`}>
          {failed}
        </p>
      )}
    </div>
  );
};
