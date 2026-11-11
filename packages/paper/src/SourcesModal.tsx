import { type ReactNode, useEffect, useRef } from 'react';
import { CONTROL, PANEL_HEAD } from './blockHead.ts';

/**
 * The sources editor opens **above** the paper, in a native `<dialog>` (WP14).
 *
 * Why a modal, and why this one:
 *
 *  - the sheet is the page's one panel of newsprint (`docs/design.md`: its own
 *    `bg-paper`, its guideline ring, its crop marks). A form inside it — three
 *    lines per source, a textarea, the absolute path of the watchlist directory —
 *    is not news and prints as ink spent on affordances. Above the sheet, the
 *    paper stays the paper and the tool is a tool.
 *  - `<dialog>` + `showModal()` is the browser's own: the top layer (no `z-index`
 *    ladder to lose), Esc closes it, and the tab loop is trapped. A `div` with a
 *    state flag re-implements all three badly, which is why the design law's "no
 *    new dependency" is not in tension here: nothing is added. And no
 *    `typeof showModal === 'function'` guard: every browser this page runs in has
 *    it, the test environment has it, and an arm that never runs is a coverage
 *    hole with a claim inside it.
 *  - There are exactly **two ways out** — Esc and the close control — and both
 *    report through the native `close` event. A click on the scrim is not a third:
 *    Biome's a11y gate is right that a mouse-only target on a non-interactive
 *    element has no keyboard route, and a way out that only a mouse finds is a
 *     affordance a keyboard reader cannot see.
 *  - The app **unmounts** this component when it closes, so the page carries no
 *    hidden form and the paper's own part list stays the paper's. The browser's
 *    focus return needs a node to return to, so the app remembers the control that
 *    opened the modal and focuses it (see `SourcesControl.onOpen`).
 *  - It stays presentational like the rest of the package: no fetch, no i18next,
 *    no `node:*`. Every word arrives in `labels` (D-019), and the panel inside is
 *    `children` — so the app owns the wire, including fetching the list only while
 *    the modal is open.
 *
 * `base.css` styles the box and the `::backdrop`: the backdrop is a **scrim**, not
 * a shadow, because the paper casts one shadow (the scroll edge) and no more.
 */
export interface SourcesModalLabels {
  /** The modal's own head: `"Sources"`. It is also the dialog's accessible name. */
  readonly headline: string;
  /** The close control: `"Close"`. */
  readonly close: string;
}

export interface SourcesModalProps {
  /** The app owns this: the trigger opens it, `onClose` closes it. */
  readonly open: boolean;
  readonly labels: SourcesModalLabels;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

const HEAD_ID = 'newspa-sources-modal-head';

export const SourcesModal = ({ open, labels, onClose, children }: SourcesModalProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  /**
   * The `open` prop is the app's fact; `showModal` is the browser's act. Both
   * directions are driven from the prop so one state cannot drift from the other:
   * Esc fires the native `close` event, the app sets `open` false, and the effect
   * finds the dialog already closed and says nothing.
   */
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (open && !node.open) {
      node.showModal();
      return;
    }
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-part="sources-modal"
      aria-labelledby={HEAD_ID}
      onClose={onClose}
      className="m-auto max-w-[64rem] max-h-[88vh] w-full p-0 bg-paper text-ink border border-[length:var(--hair)] border-rule-strong"
    >
      <div className="p-box">
        <div data-part="block-head" className={PANEL_HEAD}>
          <h2 id={HEAD_ID} className="m-0 text-section font-bold tracking-kicker uppercase">
            {labels.headline}
          </h2>
          <span data-part="rule" className="flex-1 h-px bg-ink" aria-hidden="true" />
          <button type="button" data-part="sources-close" className={CONTROL} onClick={onClose}>
            {labels.close}
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
};
