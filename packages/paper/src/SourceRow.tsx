import type { SourceFileView } from 'newspa-core';
import { useState } from 'react';
import { CONTROL } from './blockHead.ts';
import { SourceEditor } from './SourceEditor.tsx';
import type { PickFill, PickJob, SourceKindName, SourcesLabels } from './SourcesPanel.tsx';
import { HAIR, PART_LINE, QUIET, reasonOf, WORD } from './sourceStyle.ts';

/**
 * One source **file** in the sources panel (WP14): the facts the loader read, and
 * the affordances a writable peer has — edit the text, remove the file, and (inside
 * the editor) pick the list (D-036).
 *
 * **A file with issues prints the crossings**, the mark `HealthStrip` puts on a
 * source that is not reporting: a file that does not parse is a source that
 * cannot report (rule 5), and the editor is where it gets fixed. A row with
 * nothing wrong with it prints no mark.
 *
 * The affordances are sub-blocks that **require** their callback, so no callback
 * is guarded against a state the panel cannot render: the panel renders no
 * affordance at all for a peer the server refuses to write for (D-034), and a
 * guard no test can reach is an arm that reports nothing. The pick is the same
 * rule twice over — `pickableOf` is the row's one condition, and the editor
 * renders the control when it is handed `onPick`.
 */
export interface SourceRowProps {
  readonly file: SourceFileView;
  readonly labels: SourcesLabels;
  /** `false` for a peer the server refuses to write for (D-034): no affordances at all. */
  readonly writable: boolean;
  readonly onSave?: ((text: string, filename?: string) => Promise<void>) | undefined;
  readonly onDelete?: ((id: string) => Promise<void>) | undefined;
  /** The picker (D-036), handed to the row's editor — and only where a pick is possible. */
  readonly onPick?: ((id: string) => Promise<void>) | undefined;
  /** The job, and the fill: both carry the source id, and this row shows them only for its own. */
  readonly pick?: PickJob | undefined;
  readonly pickFill?: PickFill | undefined;
}

/**
 * Does this file declare a list to pick? Only an `html` source in **item mode**
 * has one (`list: '<css path>'`, D-028): a page source has a body, not a list, and
 * `rss`/`json` need no selector at all.
 *
 * The `list` is read from the file's **own text**, because the file is the truth
 * (D-011) and the view's `kind` is the loader's reading of it. Text that does not
 * parse declares nothing: a broken file shows no pick control, and the loader's
 * issue lines already say why (rule 5 is met by the lines that are on the row).
 */
const declaresList = (text: string): boolean => {
  try {
    const file = JSON.parse(text) as unknown;
    if (typeof file !== 'object' || file === null) return false;
    const list = (file as Record<string, unknown>)['list'];
    return typeof list === 'string' && list.length > 0;
  } catch {
    return false;
  }
};

const kindWordOf = (kind: string | null, labels: SourcesLabels): { name: SourceKindName | null; word: string } => {
  if (kind === 'rss' || kind === 'json' || kind === 'html') return { name: kind, word: labels.kind[kind] };
  return { name: null, word: kind ?? '' };
};

/**
 * Is a pick possible for this file? Where the route can name the source (an id,
 * D-036) and the kind has a list to pick (`declaresList`, D-028). `writable` is not
 * in the condition: the editor this feeds is rendered only for a peer the server
 * will write for (D-034). The row decides, and the editor renders the control **only
 * when it is handed `onPick`** — one condition, so no arm is unreachable.
 */
const pickableOf = (file: SourceFileView, onPick: ((id: string) => Promise<void>) | undefined): boolean =>
  onPick !== undefined && file.kind === 'html' && file.id !== null && declaresList(file.text);

/**
 * The job, or the fill, **if it is this row's**. Both are keyed by source id, and
 * the panel can have two editors open at once: a running label on both, or a fill in
 * both, would speak for a pick the reader never started and overwrite bytes in a box
 * nobody picked on.
 */
const mine = <T extends { readonly id: string }>(job: T | undefined, id: string | null): T | undefined =>
  job !== undefined && job.id === id ? job : undefined;

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

export const SourceRow = ({ file, labels, writable, onSave, onDelete, onPick, pick, pickFill }: SourceRowProps) => {
  const [editing, setEditing] = useState(false);
  const kind = kindWordOf(file.kind, labels);
  const named = file.label ?? file.id ?? file.file;
  const id = file.id;
  const pickable = pickableOf(file, onPick);
  /**
   * The pick's props, handed down **only where a pick is possible** — one spread, not
   * three ternaries in the controls line, which is the count the complexity gate
   * reads. The job and the fill are this row's, by id, and the editor renders the
   * control when it is handed `onPick` (D-036).
   */
  const pickProps = pickable ? { onPick, pickState: mine(pick, id)?.state, pickFill: mine(pickFill, id) } : {};

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
              {...pickProps}
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
