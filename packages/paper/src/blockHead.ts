/**
 * The class strings a block label needs, shared by every block that has one:
 * the rails, the sections, the edited strip, the health strip.
 *
 * Two of these are load-bearing, and both are recorded in docs/design.md:
 *
 *  - **`bg-paper` is not decoration.** The label is `sticky`, so its own column
 *    scrolls under it; a transparent label sits on top of the words and is
 *    illegible, not elegant.
 *  - **`shadow-scroll` is the paper's only shadow**, and it is a scroll edge,
 *    not a card: without it the top of a headline row slides up to the label's
 *    baseline and the two collide into a grey smear.
 *
 * The sticky label is measured in real Edge (`apps/web/test/design`): a utility
 * that silently loses to another utility by source order is invisible in the
 * markup, which is how the lead photo came to break the fold twice.
 */
export const BLOCK_HEAD =
  'sticky top-0 z-[2] flex items-center gap-[0.6rem] mb-2 text-section font-bold leading-meta tracking-kicker uppercase bg-paper pt-[0.35rem] pb-[0.4rem] border-b border-b-[length:var(--hair)] border-b-rule shadow-scroll';

/** The rule that runs from the label's text to the edge of its column. */
export const HEAD_RULE = 'flex-1 h-px bg-ink';

/** A panel that opens with a label: the ring, the dots, and the padding. */
export const PANEL_HEAD = 'flex items-center gap-[0.6rem] mb-3 text-section font-bold tracking-kicker uppercase';
