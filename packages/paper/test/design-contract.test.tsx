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
 * the components, which is the stronger version of the same rule.
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

const CSS = ['tokens.css', 'marks.css', 'base.css', 'sheet.css', 'blocks.css', 'front.css', 'stories.css'];

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
   * component may only reach for one of them.
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

  it('keeps the box vocabulary honest: no radius, and the shadow is the scroll edge', () => {
    // Prose in a docstring may say "no rounded corners", so the radius rule is
    // read off declarations and utilities, never off the word.
    expect(patternScan(/border-radius\s*:/u), 'the paper has no rounded corners (rule 11)').toEqual([]);
    expect(patternScan(/rounded-/u), 'the paper has no rounded corners (rule 11)').toEqual([]);
    expect([...cssOf('tokens.css').matchAll(/--radius-[a-z0-9-]+/g)].map((m) => m[0])).toEqual(['--radius-none']);
    const shadows = patternScan(/box-shadow\s*:/u);
    for (const file of shadows) {
      expect(['marks.css', 'blocks.css', 'tokens.css'], `${file} may not cast a shadow`).toContain(file);
    }
    for (const { name, text } of components()) {
      expect(text, `${name}: a component casts no shadow`).not.toMatch(/\bshadow-/u);
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
  });
});
