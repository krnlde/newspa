import { describe, expect, it } from 'vitest';
import { cssOf, first, px, showPaperIn } from './support.tsx';

/**
 * The contrast axis (D-038), computed in real Edge — the only place this can be
 * measured. The complaint it answers is physical: on an e-ink panel the yellowed
 * stock `#f4ecd8` dithers into a grey fog and the hairline rule `#d8cdb4` vanishes
 * into the film, so the page has to be able to say **pure stock, pure ink, rules in
 * ink**.
 *
 * Four combinations, because the axis composes with the theme: light-high and
 * dark-high are both wanted, and the CSS rebinds the same token names under
 * `[data-contrast='more']`. Each claim is the cascade's answer at a growing distance
 * from the token:
 *
 *  - the **tokens** on `:root` (`--paper`, `--ink`, `--rule`, `--hair`);
 *  - the **utilities** that emit `var(--paper)` / `var(--ink)` — the sheet, the
 *    masthead's name, the muted dateline. No component knows the mode exists, which
 *    is what `@theme inline` is for;
 *  - the **rule** itself: the dateline strip's hairline, whose colour *and* width
 *    change — the exact thing a 16-level panel cannot see at `0.5px` on beige.
 *
 * And what must **not** change: the marks, the stock's crossings, the crop marks.
 * The ruling is that high contrast is a palette, not a penalty for asking — a page
 * that hid its own ornaments because the reader asked to be legible would be
 * punishing the ask.
 */

interface Combination {
  readonly theme: 'light' | 'dark';
  readonly contrast: 'normal' | 'more';
  readonly paper: string;
  readonly ink: string;
  readonly ink2: string;
  readonly rule: string;
  readonly ruleStrong: string;
  readonly muted: string;
  readonly hair: string;
}

const COMBINATIONS: readonly Combination[] = [
  {
    theme: 'light',
    contrast: 'normal',
    paper: '#f4ecd8',
    ink: '#1f1b16',
    ink2: '#453d31',
    rule: '#d8cdb4',
    ruleStrong: '#b9ac90',
    muted: '#7a705c',
    hair: '0.5px',
  },
  // High contrast is the palette `tokens.css` names, in one place: the stock is
  // white, the ink is black, every rule is ink at 1px, and the muted grey is
  // #333333 — a value a 16-level panel can draw, where `#7a705c` is a dither.
  {
    theme: 'light',
    contrast: 'more',
    paper: '#ffffff',
    ink: '#000000',
    ink2: '#1a1a1a',
    rule: '#000000',
    ruleStrong: '#000000',
    muted: '#333333',
    hair: '1px',
  },
  {
    theme: 'dark',
    contrast: 'normal',
    paper: '#16150f',
    ink: '#e9e4d6',
    ink2: '#c3bcab',
    rule: '#34322a',
    ruleStrong: '#4a463a',
    muted: '#8d8778',
    hair: '0.5px',
  },
  {
    theme: 'dark',
    contrast: 'more',
    paper: '#000000',
    ink: '#ffffff',
    ink2: '#ededed',
    rule: '#ffffff',
    ruleStrong: '#ffffff',
    muted: '#cccccc',
    hair: '1px',
  },
];

const asRgb = (hex: string): string => {
  const digits = hex.replace('#', '');
  const at = (i: number): string => Number.parseInt(digits.slice(i, i + 2), 16).toString();
  return `rgb(${at(0)}, ${at(2)}, ${at(4)})`;
};

const token = (name: string): string =>
  globalThis.getComputedStyle(document.documentElement).getPropertyValue(name).trim();

describe('the four combinations, as the cascade computes them', () => {
  for (const at of COMBINATIONS) {
    const label = `${at.theme} + contrast ${at.contrast}`;

    it(`${label}: the stock, the ink, the rules and the hairline are the tokens`, () => {
      showPaperIn(at.theme, at.contrast);
      expect(token('--paper'), label).toBe(at.paper);
      expect(token('--ink'), label).toBe(at.ink);
      expect(token('--rule'), label).toBe(at.rule);
      expect(token('--rule-strong'), label).toBe(at.ruleStrong);
      expect(token('--hair'), label).toBe(at.hair);
    });

    it(`${label}: the utilities follow the tokens, with no variant in the markup`, () => {
      showPaperIn(at.theme, at.contrast);
      expect(cssOf("[data-part='sheet']").backgroundColor, label).toBe(asRgb(at.paper));
      expect(cssOf("[data-part='title']").color, label).toBe(asRgb(at.ink));
      expect(cssOf("[data-part='dateline']").color, label).toBe(asRgb(at.muted));
      expect(cssOf("[data-part='tagline']").color, label).toBe(asRgb(at.ink2));
    });

    it(`${label}: the dateline strip’s rule has the colour the tokens name, at the hairline the device draws`, () => {
      showPaperIn(at.theme, at.contrast);
      const strip = cssOf("[data-part='dateline-strip']");
      expect(strip.borderBottomColor, label).toBe(asRgb(at.rule));
      // Chromium floors a border width to one device pixel, so the token's `0.5px`
      // measures as 1px at a device-pixel-ratio of 1 (measured, 2026-11-11). The
      // token does move — `--hair` is 0.5px, and 1px in high contrast, asserted
      // above — and on a 2x panel the rule really is twice as thick.
      expect(px(strip.borderBottomWidth), label).toBe(Math.max(px(at.hair), 1));
    });
  }

  it('leaves the marks alone: the crossings on the stock and the crop marks on the sheet', () => {
    for (const at of COMBINATIONS) {
      showPaperIn(at.theme, at.contrast);
      const label = `${at.theme} ${at.contrast}`;
      expect(globalThis.getComputedStyle(document.body).backgroundImage, `${label} lost the stock`).toContain(
        'repeating-linear-gradient',
      );
      expect(cssOf("[data-part='sheet']", '::before').content, `${label} lost the crop marks`).not.toBe('none');
    }
  });

  it('prints both controls in the strip, in one vocabulary, each naming the state the press gives', () => {
    showPaperIn('light', 'more');
    const theme = first("[data-part='theme-switch']");
    const contrast = first("[data-part='contrast-switch']");
    expect(theme.textContent).toBe('Dark');
    expect(contrast.textContent).toBe('Plain');
    expect(theme.getAttribute('aria-pressed')).toBe('false');
    expect(contrast.getAttribute('aria-pressed')).toBe('true');
    // One look, and one row: the same `CONTROL` class, and both inside the dateline
    // strip, which is the page's one control row (rule 11).
    expect(contrast.className).toBe(theme.className);
    expect(contrast.parentElement?.parentElement?.getAttribute('data-part')).toBe('dateline-strip');
  });

  it('does not thicken any rule beyond the hairline: the axis is a palette, not a new weight', () => {
    for (const at of COMBINATIONS) {
      showPaperIn(at.theme, at.contrast);
      const label = `${at.theme} ${at.contrast}`;
      // The masthead's rules are print rules — 2px above, the 4px/1px pair — and the
      // axis changes their colour, never their weight. `--hair` is the hairline only.
      expect(px(cssOf("[data-part='masthead']").borderTopWidth), label).toBe(2);
      expect(px(cssOf("[data-part='summary-strip']").borderTopWidth), label).toBe(4);
    }
  });
});
