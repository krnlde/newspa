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
 * `index.html`), so this component only reflects it.
 */
export const Masthead = ({ name, tagline, dateline, summary, theme, onToggleTheme, themeLabel }: MastheadProps) => (
  <header className="masthead">
    <div className="masthead__top">
      <p className="masthead__dateline">{dateline}</p>
      <button type="button" className="masthead__switch" onClick={onToggleTheme} aria-pressed={theme === 'dark'}>
        {themeLabel}
      </button>
    </div>
    <h1 className="masthead__name">{name}</h1>
    <p className="masthead__tagline">{tagline}</p>
    <div className="masthead__bottom">
      <p className="masthead__summary">{summary}</p>
    </div>
  </header>
);
