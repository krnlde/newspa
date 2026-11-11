import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The paper's visual contract, as a gate — the checks that are cheap as text and
 * expensive to rediscover six months later in a sensible-looking commit.
 *
 * Tailwind v4 moved the styling into the components, so a contract that reads
 * only stylesheets is now **half** the contract: `text-justify` (the utility for
 * `text-align: justify`) and `leading-[1.6rem]` are class strings in
 * `packages/paper/src/*.tsx`. Every scan here therefore runs over the CSS **and**
 * the components, which is the stronger version of the same rule. The four
 * hand-written BEM sheets the entry file used to import are gone, so the
 * components are the whole styling surface and the scan has no blind spot left.
 *
 * Geometry — columns, measure, the sticky head, print, what a box's padding
 * computes to — needs a layout engine and is asserted in real Edge by
 * `apps/web/vitest.design.config.ts` (the paper's `vitest.config.ts` excludes
 * that file from this project, and the coverage config excludes it from the
 * gate: a CSS assertion raises no line).
 *
 * Paths come from **node:url**'s own `URL`: happy-dom replaces the global one,
 * and `node:fs` rejects a foreign URL object (measured in `locale-boundary`).
 */

const STYLE_DIR = fileURLToPath(new NodeUrl('../styles/', import.meta.url));
const SRC_DIR = fileURLToPath(new NodeUrl('../src/', import.meta.url));

const CSS = ['tokens.css', 'marks.css', 'base.css'];

const cssOf = (file: string): string => readFileSync(`${STYLE_DIR}${file}`, 'utf8');

/** Every component source, so a utility written in JSX is inside the scan. */
interface SourceFile {
  readonly name: string;
  readonly text: string;
}

const components = (): SourceFile[] =>
  readdirSync(SRC_DIR)
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(`${SRC_DIR}${name}`, 'utf8') }));

const scan = (needle: string): string[] => [
  ...CSS.filter((file) => cssOf(file).includes(needle)),
  ...components()
    .filter((source) => source.text.includes(needle))
    .map((source) => source.name),
];

const patternScan = (pattern: RegExp): string[] => [
  ...CSS.filter((file) => pattern.test(cssOf(file))),
  ...components()
    .filter((source) => pattern.test(source.text))
    .map((source) => source.name),
];

describe('the paper contract, in CSS and in the components', () => {
  it('imports every stylesheet the entry file owns, so the scan cannot be vacuous', () => {
    const entry = cssOf('paper.css');
    for (const file of CSS) expect(entry, `paper.css must import ${file}`).toContain(`./${file}`);
    expect(entry).toContain('tailwindcss');
  });

  /*
   * Justification is the rule this paper has been argued about the most: at a
   * 20rem measure (~40 characters) it rivers, and an italic deck makes it worse.
   * Banned as a CSS declaration, as the v4 utility, and as its tuning knobs.
   * `justify-between` is flexbox and is not this rule, hence the word boundary.
   */
  it('never justifies text, in any file, at any width', () => {
    const banned = [
      { needle: 'text-align: justify', why: 'a ~40-character column rivers (docs/design.md)' },
      { needle: 'text-align:justify', why: 'the same rule, minified spelling' },
      { needle: 'text-justify', why: 'justification is banned, so its tuning knob is dead code' },
      { needle: 'hyphens: auto', why: 'an italic deck becomes a hyphen storm' },
    ];
    for (const { needle, why } of banned) {
      expect(scan(needle), `${needle} — ${why}`).toEqual([]);
    }
    expect(patternScan(/\btext-justify\b/u), 'the text-justify utility aligns a block justified').toEqual([]);
  });

  /*
   * Leading is relative, always: a token, a bare multiplier, `normal`, or `loose`
   * /`tight`. A `px`/`rem` leading is a size committed twice — it stops tracking
   * the type when the size changes, which is how a page drifts back into
   * unreadable. Three values exist (`--leading-display|read|meta`) and a
   * component may only reach for one of them, or a Tailwind default.
   */
  it('never sets an absolute line-height, in CSS or as a utility', () => {
    for (const file of CSS) {
      for (const match of cssOf(file).matchAll(/line-height:\s*([^;]+);/g)) {
        const value = (match[1] ?? '').trim();
        const relative = value.startsWith('var(--leading-') || /^\d*\.?\d+$/.test(value) || value === 'normal';
        expect(relative, `${file}: line-height: ${value}`).toBe(true);
      }
    }
    const absolute = patternScan(/leading-\[[^\]]*(px|rem|em)\]/u);
    expect(absolute, 'leading-[…px|rem|em] hardcodes a leading; use leading-display|read|meta').toEqual([]);
    const invented = patternScan(/leading-\[[0-9.]+\]/u);
    expect(invented, 'a bare multiplier in JSX is a fourth leading value: use the scale').toEqual([]);
  });

  it('declares the leading scale exactly once, in tokens.css only', () => {
    expect([...cssOf('tokens.css').matchAll(/--leading-[a-z]+:/g)]).toHaveLength(3);
    for (const file of CSS.filter((name) => name !== 'tokens.css')) {
      expect(cssOf(file), `${file} must not define a leading token`).not.toMatch(/--leading-[a-z]+:/);
    }
  });

  it('uses one typeface, with no download and no CDN asset', () => {
    for (const file of CSS) {
      for (const match of cssOf(file).matchAll(/font-family:\s*([^;]+);/g)) {
        expect((match[1] ?? '').trim(), `${file}: the paper has one family`).toBe('var(--font-paper)');
      }
      expect(cssOf(file), `${file}: no @font-face, the paper never downloads a face`).not.toMatch(/@font-face/u);
      expect(cssOf(file), `${file}: no CDN asset (rule 11)`).not.toMatch(/https?:\/\//u);
    }
    for (const { name, text } of components()) {
      expect(text, `${name}: no font utility outside the scale`).not.toMatch(/font-\[/u);
    }
  });

  /*
   * A box vocabulary with no radius, and one shadow: the guideline ring (an
   * inset ring, in `marks.css`) and the scroll edge under a sticky label
   * (`--shadow-scroll`, docs/design.md). A component may cast the scroll edge
   * and nothing else, because the utility is now where the shadow is written.
   */
  it('keeps the box vocabulary honest: no radius, and the shadow is the scroll edge', () => {
    // Prose in a docstring may say "no rounded corners", so the radius rule is
    // read off declarations and utilities, never off the word.
    expect(patternScan(/border-radius\s*:/u), 'the paper has no rounded corners (rule 11)').toEqual([]);
    expect(patternScan(/rounded-/u), 'the paper has no rounded corners (rule 11)').toEqual([]);
    expect([...cssOf('tokens.css').matchAll(/--radius-[a-z0-9-]+/g)].map((m) => m[0])).toEqual(['--radius-none']);
    const shadows = patternScan(/box-shadow\s*:/u);
    for (const file of shadows) {
      expect(['marks.css', 'tokens.css'], `${file} may not cast a shadow`).toContain(file);
    }
    for (const { name, text } of components()) {
      for (const cast of text.matchAll(/\bshadow-[a-z0-9-]+/g)) {
        expect(cast[0], `${name}: the paper casts one shadow, the scroll edge`).toBe('shadow-scroll');
      }
    }
  });

  it('draws the sketch marks from one recipe, not from a copy in a component', () => {
    // The pattern geometry is measured from tailwindcss.com and lives in
    // marks.css; a component that writes its own gradient is a fork of it.
    for (const { name, text } of components()) {
      expect(text, `${name}: use pattern-crossings / pattern-dots / panel / cropmarks`).not.toMatch(
        /repeating-linear-gradient|radial-gradient/u,
      );
    }
    expect(cssOf('marks.css')).toContain('315deg');
    expect(cssOf('marks.css')).toContain('background-size: var(--pattern-tile)');
    /*
     * And the layer is the layer a **screen** gets. `html` asks for
     * `print-color-adjust: exact`, so a texture would spend the reader's ink, and
     * a printed page's waste area is the `@page` margin — so `base.css` removes
     * the crossings, the dots **and** the corner ticks for print. The claim is
     * the selector: `@media print` is not reachable from a screen viewport, which
     * is why the computed suite (apps/web/test/design) never sees it.
     */
    const print = /@media print\s*\{([\s\S]*?)\n {2}\}/u.exec(cssOf('base.css'))?.[1] ?? '';
    expect(print, 'base.css: no print block to scan').toContain('background-image: none');
    expect(print, 'base.css: the sheet prints its crop marks').toContain("[data-part='sheet']::before");
    expect(print, 'base.css: the lead figure prints its crop marks').toContain("[data-part='figure']::after");
    /*
     * What a printed page does **not** carry: the theme switch (a printed page has
     * no clicks), the health strip (the machine's report, not the edition) and the
     * sources panel (WP14) — a form, with a textarea, buttons and the absolute path
     * of the watchlist directory, which is the reading list (rule 18) and so has no
     * business on a page that leaves the machine.
     */
    const printRules = print.replace(/\/\*[\s\S]*?\*\//gu, '');
    const hiddenInPrint = [...printRules.matchAll(/([^{}]+)\{\s*display:\s*none\s*;?\s*\}/gu)].flatMap(
      (rule) => (rule[1] ?? '').match(/\[data-part='[a-z-]+'\]/gu) ?? [],
    );
    for (const part of [
      'theme-switch',
      'contrast-switch',
      'health',
      'sources',
      'sources-open',
      'sources-close',
      'sources-modal',
    ]) {
      expect(hiddenInPrint, `base.css print: [data-part='${part}'] prints`).toContain(`[data-part='${part}']`);
    }
  });

  /*
   * The waste area: the air outside the sheet's box, which the sketch layer's
   * marks need. Measured before `body` had padding, with the sheet at
   * `max-w-[104rem]` = 1 664 px (full-bleed below that):
   *
   *  - the visible stock was **0 px² at 390, 620, 1024 and 1440** — the sheet's
   *    own `bg-paper` covered `body`'s crossings completely. They appeared only
   *    past 1 664 CSS px, which is why they show at 75% zoom on a 2 560 px screen
   *    and nowhere at 100%;
   *  - the crop marks, drawn `--mark-offset` outside the box, hung **6px** past
   *    the viewport's right edge: a horizontal scrollbar on every screen, and
   *    removing the `cropmarks` utility alone took it to 0.
   *
   * Pinned as text, not measured: `@vitest/browser` injects an unlayered
   * `body { padding: 0 }` into the design iframe (`dist/index.js:3460`), and
   * unlayered CSS beats every layer, so the app's `@layer base` rule loses to the
   * harness in that frame. `pnpm shots` measures the air, the sideways-scroll
   * verdict and the stock on the real page, in real Edge, at four widths.
   */
  it('gives the sheet a waste area, so the marks outside the box have somewhere to land', () => {
    const body = /(?:^|\n) {2}body \{([^}]*)\}/u.exec(cssOf('base.css'))?.[1] ?? '';
    expect(body, 'base.css: no `body` rule to scan').toContain('var(--crossing-image)');
    expect(body, 'base.css: body carries no inline air for the stock and the marks').toContain(
      'padding-inline: var(--spacing-gutter)',
    );
    expect(body, 'base.css: no block air for the corner ticks').toContain('padding-block: var(--mark-offset)');
  });

  /*
   * The contrast axis (D-038), as the law the CSS must keep. Two triggers, one law —
   * the system's `prefers-contrast: more` and the page's own `data-contrast` — and
   * **the page's choice beats the system's**, which is the whole point of the second
   * trigger: a wall device set to `normal` has expressed an opinion, and an OS signal
   * may not overrule a reader's. The computed half (what the four combinations
   * resolve to) is `apps/web/test/design/contrast.test.tsx`, in real Edge; what is
   * pinned here is the shape, because a media query is not reachable from a viewport.
   */
  it('makes the contrast axis one law with two triggers, the page’s beating the system’s', () => {
    const tokens = cssOf('tokens.css');
    // Palette in the tokens, and the pair selector last: `[data-a][data-b]` outranks
    // each single attribute, so dark + high needs its own block.
    expect(tokens).toContain("[data-contrast='more'] {");
    expect(tokens).toContain("[data-theme='dark'][data-contrast='more'] {");
    expect(tokens.indexOf("[data-theme='dark'][data-contrast='more']")).toBeGreaterThan(
      tokens.indexOf("[data-contrast='more'] {"),
    );

    for (const file of ['base.css', 'marks.css']) {
      const block = /@media \(prefers-contrast: more\) \{([\s\S]*?)\n {2}\}/u.exec(cssOf(file))?.[1] ?? '';
      expect(block, `${file}: the system signal must be gated so the page can win`).toContain(
        ':root:not([data-contrast])',
      );
    }
    // One owner per value (measured, 2026-11-11): `tokens.css` is unlayered, so its
    // attribute blocks beat `@layer base` for the same names — the palette is
    // therefore the tokens' and `base.css` keeps only the system trigger. `marks.css`
    // carries the attribute block too, because the tokens say nothing about a mark.
    expect(cssOf('marks.css'), 'marks.css: the marks must darken on the attribute as well').toContain(
      "[data-contrast='more'] {",
    );
    expect(cssOf('base.css'), 'base.css: a repeating palette block is dead CSS').not.toContain(
      "[data-contrast='more'] {",
    );

    // The axis is CSS, not a component concern: nothing beyond passing the prop
    // through knows it exists, and no `dark:`-style variant is born.
    for (const { name, text } of components()) {
      if (name === 'Masthead.tsx' || name === 'Paper.tsx' || name === 'types.ts') continue;
      expect(text, `${name}: the contrast axis is tokens and attributes, not a class`).not.toMatch(
        /data-contrast|contrast='more'/u,
      );
    }
  });

  /*
   * The structural contract: style may be rewritten, the hooks may not. Every
   * BEM name (`foo__bar`, `foo--baz`) is a class the design suite, the print
   * rules and the flash query cannot follow, so none survives in a component.
   */
  it('hooks structure to data-part, never to a BEM class name', () => {
    for (const { name, text } of components()) {
      expect(
        [...text.matchAll(/['"`][a-z][a-z0-9]*(?:__|--)[a-z0-9-]+/g)].map((m) => m[0]),
        `${name}: BEM name`,
      ).toEqual([]);
    }
    for (const file of CSS) {
      expect(
        [...cssOf(file).matchAll(/^\s*\.[a-z][a-z0-9]*(?:__|--)/gmu)].map((m) => m[0]),
        `${file}: BEM selector`,
      ).toEqual([]);
    }
  });
});
