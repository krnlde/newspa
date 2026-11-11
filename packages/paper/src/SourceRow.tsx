import type { SourceFileView } from 'newspa-core';
import { useState } from 'react';
import { CONTROL } from './blockHead.ts';
import { SourceEditor } from './SourceEditor.tsx';
import type { SourceKindName, SourcesLabels } from './SourcesPanel.tsx';
import { HAIR, PART_LINE, QUIET, reasonOf, WORD } from './sourceStyle.ts';

/**
 * One source **file** in the sources panel (WP14): the facts the loader read, and
 * the two affordances a writable peer has — edit the text, remove the file.
 *
 * **A file with issues prints the crossings**, the mark `HealthStrip` puts on a
 * source that is not reporting: a file that does not parse is a source that
 * cannot report (rule 5), and the editor is where it gets fixed. A row with
 * nothing wrong with it prints no mark.
 *
 * The affordances are sub-blocks that **require** their callback, so no callback
 * is guarded against a state the panel cannot render: the panel renders no
 * affordance at all for a peer the server refuses to write for (D-034), and a
 * guard no test can reach is an arm that reports nothing.
 */
export interface SourceRowProps {
  readonly file: SourceFileView;
  readonly labels: SourcesLabels;
  /** `false` for a peer the server refuses to write for (D-034): no affordances at all. */
  readonly writable: boolean;
  readonly onSave?: ((text: string, filename?: string) => Promise<void>) | undefined;
  readonly onDelete?: ((id: string) => Promise<void>) | undefined;
}

const kindWordOf = (kind: string | null, labels: SourcesLabels): { name: SourceKindName | null; word: string } => {
  if (kind === 'rss' || kind === 'json' || kind === 'html') return { name: kind, word: labels.kind[kind] };
  return { name: null, word: kind ?? '' };
};

interface DeleteProps {
  readonly named: string;
  readonly id: string;
  readonly labels: SourcesLabels;
  readonly onDelete: (id: string) => Promise<void>;
}

/**
 * The delete, **asked once in the page**: the first press prints the sentence
 * naming what is about to happen, the second calls `onDelete`. A dialog is a
 * second layer above the page for one word of confirmation, and the sentence
 * belongs beside the file it removes — the server deletes the file and
 * **disables the row**, so the sentence says what happens to the history.
 */
const RowDelete = ({ named, id, labels, onDelete }: DeleteProps) => {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  const remove = async (): Promise<void> => {
    setBusy(true);
    setFailed('');
    try {
      await onDelete(id);
    } catch (cause) {
      setFailed(reasonOf(cause));
      return;
    } finally {
      setBusy(false);
    }
    // The list refetches on a removal that landed, so this row is on its way out.
    setConfirming(false);
  };

  return (
    <div className="contents">
      {confirming ? (
        <>
          <p data-part="confirm" className={`m-0 ${QUIET}`}>
            {labels.confirmDelete(named)}
          </p>
          <button
            type="button"
            data-part="confirm-yes"
            className={CONTROL}
            aria-label={`${labels.delete} ${named}`}
            disabled={busy}
            onClick={() => {
              void remove();
            }}
          >
            {busy ? labels.deleting : labels.delete}
          </button>
          <button
            type="button"
            data-part="confirm-no"
            className={CONTROL}
            aria-label={`${labels.cancel} ${named}`}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {labels.cancel}
          </button>
        </>
      ) : (
        <button
          type="button"
          data-part="source-delete"
          className={CONTROL}
          aria-label={`${labels.delete} ${named}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {labels.delete}
        </button>
      )}
      {failed === '' ? null : (
        <p data-part="source-error" className={`m-0 ${QUIET}`}>
          {failed}
        </p>
      )}
    </div>
  );
};

export const SourceRow = ({ file, labels, writable, onSave, onDelete }: SourceRowProps) => {
  const [editing, setEditing] = useState(false);
  const kind = kindWordOf(file.kind, labels);
  const named = file.label ?? file.id ?? file.file;
  const id = file.id;

  return (
    <li
      data-part="source-row"
      data-file={file.file}
      data-state={file.state ?? 'none'}
      data-enabled={String(file.enabled)}
      data-issues={String(file.issues.length)}
      className={HAIR}
    >
      <div className={PART_LINE}>
        <span data-part="source-label" className="font-bold text-ink">
          {named}
        </span>
        <span data-part="source-file" className={QUIET}>
          {file.file}
        </span>
        {kind.name === null ? null : (
          <span data-part="source-kind" className={WORD}>
            {kind.word}
          </span>
        )}
        <span data-part="source-state" className={WORD}>
          {file.state === null ? labels.noState : labels.state[file.state]}
        </span>
        {file.enabled ? null : (
          <span data-part="source-disabled" className={WORD}>
            {labels.disabled}
          </span>
        )}
        {id === null ? (
          <span data-part="source-noid" className={QUIET}>
            {labels.noId}
          </span>
        ) : null}
      </div>

      {file.issues.length === 0 ? null : (
        <ul data-part="issues" className="m-0 p-0 list-none pattern-crossings">
          <li data-part="issues-count" className={WORD}>
            {labels.issues(file.issues.length)}
          </li>
          {file.issues.map((issue, index) => (
            <li key={`${String(index)}:${issue}`} data-part="issue-line" className={QUIET}>
              {issue}
            </li>
          ))}
        </ul>
      )}

      {/* One controls line: the label's own line carries the facts, and this carries
          the acts. `contents` is the point — `RowDelete` is a component, and a wrapper
          div around it would put REMOVE on a third line under a full-width EDIT bar,
          which reads as a table of buttons. With the box dissolved, the two controls
          sit on one hairline row and wrap when a phone is narrow. The editor takes
          `basis-full`: a textarea is a block, not a chip. */}
      <div className="mt-[0.3rem] flex flex-wrap items-center gap-2">
        {!writable || onSave === undefined ? null : editing ? (
          <div className="basis-full">
            <SourceEditor
              file={file}
              labels={labels}
              onSave={onSave}
              onDone={() => {
                setEditing(false);
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            data-part="source-edit"
            className={CONTROL}
            aria-label={`${labels.edit} ${named}`}
            onClick={() => {
              setEditing(true);
            }}
          >
            {labels.edit}
          </button>
        )}
        {!writable || onDelete === undefined || id === null ? null : (
          <RowDelete named={named} id={id} labels={labels} onDelete={onDelete} />
        )}
      </div>
    </li>
  );
};
