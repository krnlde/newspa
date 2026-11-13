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
 * (`sources`, WP14) and the two display switches print beside each other, in the
 * same `CONTROL` vocabulary: several controls, one look. The masthead owns no data
 * for the editor — the list is fetched when the modal opens, and this only asks for
 * the opening. The switches only reflect what the app applies **before first paint**
 * (D-002 for the theme, D-038 for the contrast axis).
 */
export const Masthead = ({
  name,
  tagline,
  dateline,
  summary,
  format,
  generatedAt,
  cachedAt,
  theme,
  onToggleTheme,
  themeLabel,
  contrast,
  onToggleContrast,
  contrastLabel,
  sources,
  install,
}: MastheadProps) => {
  /* The strip prints two dates — the day the edition belongs to, and the line
     that says what it counted (and, offline, when the cache was written). The
     visible words are the app's; the tooltips are those same instants written
     out with the zone, because "Friday, 13 November" is a day for a reader who
     did not say where they are. */
  const datelineStamp = format.stamp(generatedAt);
  const summaryStamp = format.stamp(cachedAt);
  return (
    <header data-part="masthead" className="pt-3 pb-2 border-t-2 border-t-ink text-center">
      <div
        data-part="dateline-strip"
        className="flex items-baseline justify-between gap-4 pb-[0.4rem] border-b border-b-[length:var(--hair)] border-b-rule"
      >
        <p
          data-part="dateline"
          {...(datelineStamp === '' ? {} : { title: datelineStamp })}
          className="m-0 text-kicker font-bold tracking-kicker uppercase text-muted"
        >
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
          {/* The install entry (WP16, D-039), in the same row and the same
            vocabulary: the page has **one** control row, and a second overlay is
            refused by D-035. A browser with no prompt is not answered by an absent
            control — the line names the recipe that works there, because a feature
            the reader cannot find is a feature they do not have. */}
          {install === undefined || install.mode === 'none' ? null : install.mode === 'prompt' ? (
            <button type="button" data-part="install" className={CONTROL} onClick={install.onInstall}>
              {install.label}
            </button>
          ) : (
            <p data-part="install-recipe" className="m-0 text-kicker font-bold tracking-kicker uppercase text-muted">
              {install.recipe}
            </p>
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
          {/* The second axis (D-038), and no more of the strip than the theme switch
            is: the button names the state the press gives, and `aria-pressed` says
            whether it is on. Rendered only when the app has the control to offer. */}
          {contrast === undefined || onToggleContrast === undefined || contrastLabel === undefined ? null : (
            <button
              type="button"
              data-part="contrast-switch"
              className={CONTROL}
              onClick={onToggleContrast}
              aria-pressed={contrast === 'more'}
            >
              {contrastLabel}
            </button>
          )}
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
        {/* The stats line is where the offline stamp prints (WP16): "cached 13:58" is
          an age of the cache, so the tooltip is that write, written out. */}
        <p
          data-part="summary"
          {...(summaryStamp === '' ? {} : { title: summaryStamp })}
          className="m-0 py-[0.15rem] text-kicker font-bold tracking-kicker uppercase text-muted"
        >
          {summary}
        </p>
      </div>
    </header>
  );
};
