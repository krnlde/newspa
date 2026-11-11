import type { PickJobState, SourceFileView } from 'newspa-core';
import { useEffect, useState } from 'react';
import { CONTROL } from './blockHead.ts';
import type { PickFill, SourcesLabels } from './SourcesPanel.tsx';
import { QUIET, reasonOf, TEXT_BOX, textIdOf, WORD } from './sourceStyle.ts';

/**
 * The row's editor: the file's own bytes in a box, and a Save that posts them.
 *
 * The editor edits **text**, not fields, because the file is the truth (D-011,
 * D-025) and the server validates what is posted with the loader's own parser
 * (D-014). A form that "fixed" the JSON for the reader would be a second, weaker
 * validator, and the second validator is the one that drifts.
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
 *
 * The picker's half (D-036) is the third control, `data-part="source-pick"`, and it
 * **fills** — the report's text lands in the box as bytes to read, and SAVE stays the
 * reader's act: a click that rewrote a file would make D-011's truth a mouse's side
 * effect. The control is rendered only when the row hands down `onPick`, so the
 * "which source can be picked" rule lives in `SourceRow.tsx` (D-028), not here, and
 * the running label is the app's `pickState` (a pick window is one at a time: a
 * second start is a 409).
 */
export interface SourceEditorProps {
  readonly file: SourceFileView;
  readonly labels: SourcesLabels;
  readonly onSave: (text: string, filename?: string) => Promise<void>;
  /** Close the box: the row owns whether it is open, so it owns closing it. */
  readonly onDone: () => void;
  /** The pick, asked of the server's machine. Absent for a source that has no list. */
  readonly onPick?: ((id: string) => Promise<void>) | undefined;
  /** The job's state, from the app's poll: `running` is the label, and the disable. */
  readonly pickState?: PickJobState | undefined;
  /** The text a landed pick fills the box with. Filling is not saving (D-036). */
  readonly pickFill?: PickFill | undefined;
}

export const SourceEditor = ({ file, labels, onSave, onDone, onPick, pickState, pickFill }: SourceEditorProps) => {
  const [text, setText] = useState(file.text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const id = textIdOf(file.file);

  /**
   * The fill (D-036), keyed on the **stamp**: two picks can report the same text, and
   * the stamp is what makes the second one land. Keyed on the stamp and not on the
   * object, because a re-render that hands down the same fill must not wipe what the
   * reader typed after it — the paper reads no clock, so the app stamps (D-019).
   */
  const fillAt = pickFill?.at;
  const fillText = pickFill?.text;
  useEffect(() => {
    if (fillAt === undefined || fillText === undefined) return;
    setText(fillText);
  }, [fillAt, fillText]);

  /**
   * The control, with the id the route names the source by (`POST /api/pick` is an
   * id, never a url, D-036). One condition for both the render and the id, so the
   * handler cannot be reached with nothing to send.
   */
  const pickId = onPick === undefined ? null : file.id;
  const startPicking =
    pickId === null || onPick === undefined
      ? null
      : async (): Promise<void> => {
          setFailed('');
          try {
            await onPick(pickId);
          } catch (cause) {
            // The app states the refusal in the panel's status lines too; this is the
            // copy beside the bytes, where the reader is looking.
            setFailed(reasonOf(cause));
          }
        };

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
        {startPicking === null ? null : (
          <button
            type="button"
            data-part="source-pick"
            className={CONTROL}
            disabled={pickState === 'running'}
            onClick={() => {
              void startPicking();
            }}
          >
            {pickState === 'running' ? labels.picking : labels.pick}
          </button>
        )}
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
