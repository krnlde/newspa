import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Masthead } from '../src/Masthead.tsx';
import { SourcesModal, type SourcesModalLabels, type SourcesModalProps } from '../src/SourcesModal.tsx';
import { one, PART, THE_MASTHEAD_PROPS } from './support.ts';

/**
 * The sources modal (WP14): the box the editor opens in.
 *
 * The claims worth pinning are the ones the browser is trusted with, and the one
 * the design law is not:
 *
 *  - the `<dialog>` is the thing that opens and closes (the top layer, Esc, the
 *    focus trap and the return of focus are its, not a `z-index` and an effect);
 *  - closing by **either** route — the close control, Esc's native `close` event —
 *    reports to `onClose`, and the app owns the state; the scrim reports nothing,
 *    because a mouse-only target on a non-interactive element is an affordance a
 *    keyboard reader cannot see;
 *  - the head is the dialog's accessible name, so there is one name for the box;
 *  - the box casts **no shadow**: `docs/design.md` allows one shadow on this page,
 *    the scroll edge, so the scrim in `base.css` is a flat wash and the box has a
 *    hairline, not an elevation. A modal that floats on a shadow is a card.
 */

const LABELS: SourcesModalLabels = { headline: 'SOURCES', close: 'CLOSE' };

const show = (over: { readonly open?: boolean } = {}) => {
  const onClose = vi.fn();
  const props: SourcesModalProps = {
    open: over.open ?? true,
    labels: LABELS,
    onClose,
    children: <section data-part="sources">the panel</section>,
  };
  const view = render(<SourcesModal {...props} />);
  return { view, onClose, node: one<HTMLDialogElement>(PART.sourcesModal, view.container) };
};

afterEach(cleanup);

describe('the dialog', () => {
  it('is a real `<dialog>` that opens when it is told to, with the panel inside it', () => {
    const { node } = show();
    expect(node.tagName).toBe('DIALOG');
    expect(node.open).toBe(true);
    expect(one(PART.sources, node).textContent).toBe('the panel');
  });

  it('is not open when the app says it is closed', () => {
    expect(show({ open: false }).node.open).toBe(false);
  });

  it('names itself by its head, and carries no second label', () => {
    const { node } = show();
    const id = node.getAttribute('aria-labelledby');
    expect(id).not.toBeNull();
    const head = one<HTMLElement>(`#${id ?? ''}`, node.ownerDocument);
    expect(head.textContent).toBe(LABELS.headline);
    expect(node.getAttribute('aria-label')).toBeNull();
  });

  it('reports the close control and Esc’s native close, and the scrim asks for nothing', () => {
    const closed = show();
    fireEvent.click(one<HTMLButtonElement>(PART.sourcesClose, closed.node));
    expect(closed.onClose).toHaveBeenCalledTimes(1);

    const esc = show();
    // Esc is the browser's act; what the app sees is the dialog's `close` event.
    // It does not bubble, which is why React 19 attaches `onClose` to the element.
    esc.node.dispatchEvent(new Event('close'));
    expect(esc.onClose).toHaveBeenCalledTimes(1);

    // There is no third way out, and the scrim is not a mouse-only target: a click
    // on the box asks the app for nothing (Biome's a11y gate is the reason).
    const scrim = show();
    fireEvent.click(scrim.node);
    expect(scrim.onClose).not.toHaveBeenCalled();
  });

  it('follows the prop in both directions, so the app cannot get a dialog it did not ask for', () => {
    // The app unmounts the modal on close; the contract pinned here is the
    // component's own: the prop is the fact, and the dialog follows it — an
    // `open: false` re-render closes a node that a previous `showModal` opened.
    const view = render(
      <SourcesModal open labels={LABELS} onClose={vi.fn()}>
        <span data-part="sources">the panel</span>
      </SourcesModal>,
    );
    const node = one<HTMLDialogElement>(PART.sourcesModal, view.container);
    expect(node.open).toBe(true);
    view.rerender(
      <SourcesModal open={false} labels={LABELS} onClose={vi.fn()}>
        <span data-part="sources">the panel</span>
      </SourcesModal>,
    );
    expect(node.open).toBe(false);
  });

  it('is a bordered box, not an elevated one', () => {
    const { node, onClose } = show();
    fireEvent.click(one(PART.sources, node));
    expect(onClose).not.toHaveBeenCalled();
    expect(node.className).not.toMatch(/shadow-|rounded/u);
    expect(node.className).toContain('p-0');
  });
});

/**
 * The entry is in the masthead's control row (`apps/web` passes it as `editor`),
 * and the contract worth pinning is the one the app depends on for return focus:
 * the press hands over **the control itself**, not a guess at what was focused.
 */
describe('the trigger in the dateline strip', () => {
  it('prints beside the theme switch, and hands the pressed control to the app', () => {
    const onOpen = vi.fn();
    render(<Masthead {...THE_MASTHEAD_PROPS} sources={{ label: 'SOURCES', onOpen }} />);
    const button = one<HTMLButtonElement>(PART.sourcesOpen);
    expect(button.textContent).toBe('SOURCES');
    expect(one<HTMLElement>("[data-part='dateline-strip']").contains(one(PART.themeSwitch))).toBe(true);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toBe(button);
  });

  it('prints no control when the app has no editor to open', () => {
    render(<Masthead {...THE_MASTHEAD_PROPS} />);
    expect(document.querySelectorAll(PART.sourcesOpen)).toHaveLength(0);
  });
});
