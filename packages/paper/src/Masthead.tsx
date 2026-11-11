import { CONTROL } from './blockHead.ts';
import type { MastheadProps } from './types.ts';

/**
 * The masthead, the dateline strip and the switcher.
 *
 * The rules are print rules: a `2px` rule above, and the classic thick/thin
 * pair below (`4px` with a `1px` partner). The name is the biggest thing on the
 * page, set in the one family the paper uses for everything.
 *
 * The theme switcher is a `<button>`, not a checkbox pretending to be one, and
 * the app applies the theme **before first paint** (an inline script in
 * `index.html`), so this component only reflects it. It names no family:
 * Preflight already sets `font: inherit` on a form control
 * (`tailwindcss@4.3.5/preflight.css`), and the design contract fails a component
 * that reaches outside the scale.
 *
 * The dateline strip is the page's one **control row**, so the editor's entry
 * (`sources`, WP14) prints beside the switcher, in the same `CONTROL` vocabulary:
 * two controls, one look. The masthead owns no data for it — the list is fetched
 * when the modal opens, and this only asks for the opening.
 */
export const Masthead = ({
  name,
  tagline,
  dateline,
  summary,
  theme,
  onToggleTheme,
  themeLabel,
  sources,
}: MastheadProps) => (
  <header data-part="masthead" className="pt-3 pb-2 border-t-2 border-t-ink text-center">
    <div
      data-part="dateline-strip"
      className="flex items-baseline justify-between gap-4 pb-[0.4rem] border-b border-b-[length:var(--hair)] border-b-rule"
    >
      <p data-part="dateline" className="m-0 text-kicker font-bold tracking-kicker uppercase text-muted">
        {dateline}
      </p>
      <div className="flex items-baseline gap-2">
        {sources === undefined ? null : (
          <button
            type="button"
            data-part="sources-open"
            className={CONTROL}
            onClick={(event) => {
              sources.onOpen(event.currentTarget);
            }}
          >
            {sources.label}
          </button>
        )}
        <button
          type="button"
          data-part="theme-switch"
          className={CONTROL}
          onClick={onToggleTheme}
          aria-pressed={theme === 'dark'}
        >
          {themeLabel}
        </button>
      </div>
    </div>
    {/* `leading-display`, not the sheet's 1.03: three leading values exist
        (`--leading-display|read|meta`) and a fourth in a class string is the
        drift the design contract exists to stop. */}
    <h1
      data-part="title"
      className="mt-[0.35rem] mb-[0.15rem] text-masthead font-bold leading-display tracking-display text-balance"
    >
      {name}
    </h1>
    <p data-part="tagline" className="m-0 text-small italic text-ink-2">
      {tagline}
    </p>
    <div data-part="summary-strip" className="mt-[0.6rem] pt-[0.35rem] border-t-4 border-t-ink border-b border-b-ink">
      <p data-part="summary" className="m-0 py-[0.15rem] text-kicker font-bold tracking-kicker uppercase text-muted">
        {summary}
      </p>
    </div>
  </header>
);
