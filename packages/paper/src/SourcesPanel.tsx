import type { HealthState, PickJobState, SourcesResponse } from 'newspa-core';
import { SourceRow } from './SourceRow.tsx';
import { NewSource } from './SourcesNew.tsx';
import { QUIET } from './sourceStyle.ts';

/**
 * The sources panel (WP14): the reading list, as files — the content of the modal
 * (`SourcesModal.tsx`) that opens above the paper.
 *
 * It has **no headline**: the modal's head names the block and carries the close
 * control, and a second label inside the same box is the duplicate the design law
 * exists to stop. It has no `panel` class either: the modal is the box, and a
 * ringed, dotted panel inside a bordered dialog is two boxes.
 *
 * Presentational only — no fetch, no i18next, no clock, no `node:*` (rule 4, and
 * `packages/paper/test/locale-boundary.test.tsx` reads this file as text to prove
 * it). Every word arrives in `labels`; the app composes them from i18next's
 * current `language` (`apps/web/src/labels.ts`, D-019).
 *
 * What the panel is for is the two things the rest of the paper cannot do:
 *
 *  - **a broken source is stated where the reader reads the paper** (rule 5). The
 *    loader's `issues` print in the row, with the crossings, and an empty
 *    directory prints the stated-empty line, never a blank box;
 *  - **the file is the truth** (D-011, D-025), so the editor edits the file's own
 *    text and the server validates it. The panel posts bytes and prints the
 *    answer's `messages` — a write that wrote nothing says so, in the loader's
 *    words, in `data-part='sources-status'`.
 *
 * When `writable` is false the panel has **no affordances at all**: the server
 * refuses a write from a non-loopback peer before routing (D-034), and the reading
 * list is refused for **every verb** (rule 18), so a Save button on a phone is a
 * guaranteed failure and the honest page says the sentence instead. The picker is
 * refused for the same two reasons at once (rule 20: opening a browser on a machine
 * is a write), so `onPick` arrives with `onSave`, and no pick control exists for a
 * peer the server will not let write.
 *
 * The panel is also the half that **owns which row is open**, so the pick's report
 * flows through it — keyed by source id, because two rows can be open at once: `pick`
 * drives one row's label, and `pickFill` lands in that row's editor as text to edit —
 * **never as a write** (D-036). The skeleton menu is `SourcesNew.tsx`, a module of
 * its own by the 300-line cap and by responsibility.
 */

/** The three kinds a source file can declare, as the skeleton menu knows them. */
export type SourceKindName = 'rss' | 'json' | 'html';

/** The words on the skeleton menu: one per kind. */
export interface SourcesTemplateLabels {
  readonly rss: string;
  readonly json: string;
  readonly html: string;
}

/**
 * The pick job, as the app reports it (D-036). Keyed by **source id**, because the
 * panel can have more than one row's editor open at once: a job belongs to one row,
 * and a label — or a fill — that lands in every open editor overwrites bytes the
 * reader never picked on. The row compares the id with its own and shows nothing for
 * the others.
 */
export interface PickJob {
  readonly id: string;
  readonly state: PickJobState;
}

/**
 * The text a landed pick fills the open editor with (D-036). `at` is a **stamp**,
 * supplied by the app: two picks can report the same text, and the editor fills on a
 * change of the stamp, so the second pick is not silently a no-op.
 */
export interface PickFill {
  readonly id: string;
  readonly text: string;
  readonly at: string;
}

/** Finished words for the panel. The app owns the language; this owns the layout. */
export interface SourcesLabels {
  /** The stated-empty line: an empty directory is a state, not a blank box. */
  readonly empty: string;
  /** `"files in /home/reader/newspa/sources"` — the directory the list came from. */
  readonly directory: (dir: string) => string;
  readonly kind: Record<SourceKindName, string>;
  /** The health word for a state the last poll reported. */
  readonly state: Record<HealthState, string>;
  /** The word for a source that has never been polled, so it has no state to name. */
  readonly noState: string;
  readonly disabled: string;
  /** `"2 problems in this file"` — the count above the loader's own lines. */
  readonly issues: (count: number) => string;
  /** The line for a file whose id the loader could not read: nothing can delete it. */
  readonly noId: string;
  /** The `<label>` of a file's textarea: `"Source file text, bbc-world.json"`. */
  readonly textOf: (file: string) => string;
  readonly edit: string;
  readonly save: string;
  readonly saving: string;
  /** The pick control's word (D-036): the paper's own verb for the inspector click. */
  readonly pick: string;
  /** The same control while the window is open on the server's machine. */
  readonly picking: string;
  readonly delete: string;
  readonly deleting: string;
  readonly cancel: string;
  /** The skeleton menu's own label. */
  readonly newSource: string;
  /** The sentence that stands in for every affordance when the peer may not write. */
  readonly readOnly: string;
  readonly templates: SourcesTemplateLabels;
  /** The sentence a delete asks with, naming the file it is about to remove. */
  readonly confirmDelete: (label: string) => string;
  /** The sentence beside the `html` skeleton: selectors come from the picker (WP6). */
  readonly htmlNote: string;
  /** The answer line, from the server's own `messages`. */
  readonly messages: (lines: readonly string[]) => string;
}

export interface SourcesProps {
  readonly sources: SourcesResponse['files'];
  readonly dir: string;
  readonly writable: boolean;
  readonly labels: SourcesLabels;
  /** The three skeletons, keyed by kind: the app owns the JSON, the panel inserts it. */
  readonly templates: Record<SourceKindName, string>;
  /** The last write's answer lines. The region prints empty when there is none. */
  readonly messages?: readonly string[] | undefined;
  readonly onSave?: ((text: string, filename?: string) => Promise<void>) | undefined;
  readonly onDelete?: ((id: string) => Promise<void>) | undefined;
  /** The picker (D-036): open a window on the **server's** machine for this id. */
  readonly onPick?: ((id: string) => Promise<void>) | undefined;
  /** The running job, with the id it belongs to: `running` is that row's label. */
  readonly pick?: PickJob | undefined;
  /** The text a landed pick fills with, and the row it fills. The panel never saves it. */
  readonly pickFill?: PickFill | undefined;
}

export const SourcesPanel = ({
  sources,
  dir,
  writable,
  labels,
  templates,
  messages,
  onSave,
  onDelete,
  onPick,
  pick,
  pickFill,
}: SourcesProps) => {
  const lines = messages ?? [];

  return (
    <section data-part="sources" className="text-small">
      <p data-part="sources-dir" className={`m-0 ${QUIET}`}>
        {labels.directory(dir)}
      </p>
      {!writable ? (
        <p data-part="sources-readonly" className="m-0 text-ink-2">
          {labels.readOnly}
        </p>
      ) : null}

      {sources.length === 0 ? (
        <p data-part="sources-empty" className="m-0 mt-2 text-ink-2">
          {labels.empty}
        </p>
      ) : (
        <ul data-part="sources-list" className="m-0 p-0 list-none">
          {sources.map((file) => (
            <SourceRow
              key={file.file}
              file={file}
              labels={labels}
              writable={writable}
              onSave={onSave}
              onDelete={onDelete}
              onPick={onPick}
              pick={pick}
              pickFill={pickFill}
            />
          ))}
        </ul>
      )}

      {writable && onSave !== undefined ? <NewSource labels={labels} templates={templates} onSave={onSave} /> : null}

      {/* The answer region always prints, so a write's line cannot shift the layout it
          lands in; an empty line is the slot keeping its own height. */}
      <p data-part="sources-status" className="m-0 mt-3 text-ink-2" aria-live="polite">
        {labels.messages(lines)}
      </p>
    </section>
  );
};
