/**
 * The class strings and the two small helpers the sources panel's three parts
 * share (`SourcesPanel.tsx`, `SourceRow.tsx`, `SourceEditor.tsx`).
 *
 * One list, because the panel is one block: a word in `WORD` is the volume the
 * panel's meta prints at, and a second copy is a drift waiting to happen
 * (`docs/design.md`: hierarchy comes from size, weight, measure, letterspacing
 * and rules). Utilities on the element, vocabulary in one module — the paper's
 * Tailwind idiom (D-024), with no new CSS and no new token.
 *
 * No rounded corner, no shadow, no second face: `TEXT_BOX` is the onboarding
 * command block's idiom (`font-paper`, a small step, the whitespace kept),
 * because `docs/design.md` sets one family for everything and has no code face.
 */

export const PART_LINE = 'flex flex-wrap items-baseline gap-2';
export const WORD = 'text-kicker font-bold tracking-kicker uppercase text-ink-2';
export const QUIET = 'text-muted';
export const HAIR = 'py-[0.3rem] border-b border-b-[length:var(--hair)] border-b-rule';
export const TEXT_BOX =
  'w-full m-0 p-box bg-paper-2 border border-[length:var(--hair)] border-rule-strong font-paper text-[0.8rem] whitespace-pre';

/** A control needs a name, and the file it belongs to is the only honest one. */
export const textIdOf = (file: string): string => `source-text-${file}`;

/** A rejection is stated in the reader's words, whatever the server threw. */
export const reasonOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
