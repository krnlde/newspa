import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The paper's visual contract, as a gate.
 *
 * `docs/design.md` states what the paper is allowed to look like, and a rule
 * stated only in prose is a rule that returns six months later in a sensible
 * looking commit. These are the checks that are cheap to make by text and
 * expensive to rediscover: no justified type, and no absolute leading.
 *
 * The layout claims — columns, measure, the sticky header, print — need a
 * layout engine, so they are asserted in real Edge by
 * `apps/web/vitest.design.config.ts`. happy-dom has no layout, which is exactly
 * why this file reads declarations and never geometry.
 *
 * Paths come from **node:url**'s own `URL`: happy-dom replaces the global one,
 * and `node:fs` rejects a foreign URL object (measured in `locale-boundary`).
 */

const STYLE_DIR = fileURLToPath(new NodeUrl('../styles/', import.meta.url));

const FILES = ['sheet.css', 'blocks.css', 'front.css', 'stories.css'] as const;

const BANNED: readonly { readonly needle: string; readonly why: string }[] = [
  { needle: 'text-align: justify', why: 'a ~40-character column rivers; text is aligned start (docs/design.md)' },
  { needle: 'text-align: justify-all', why: 'the same river, spelled again' },
  { needle: 'text-justify', why: 'justification is banned, so its tuning knob is dead code' },
  { needle: 'hyphens: auto', why: 'an italic deck becomes a hyphen storm' },
];

const cssOf = (file: string): string => readFileSync(`${STYLE_DIR}${file}`, 'utf8');

const lineHeightsOf = (css: string): string[] =>
  [...css.matchAll(/line-height:\s*([^;]+);/g)].map((match) => (match[1] ?? '').trim());

describe('the paper CSS contract', () => {
  it('reads every stylesheet the entry file imports, so the scan cannot be vacuous', () => {
    const entry = cssOf('paper.css');
    for (const file of FILES) expect(entry, `paper.css must import ${file}`).toContain(`./${file}`);
  });

  it('never justifies text, in any file, at any width', () => {
    for (const file of FILES) {
      const css = cssOf(file);
      for (const { needle, why } of BANNED) expect(css, `${file}: ${needle} — ${why}`).not.toContain(needle);
    }
  });

  /*
   * Leading is relative, always: `var(--lh-*)` for the scale, a bare multiplier
   * for the optical fixes (a drop cap, the masthead), `normal` for nothing. A
   * `px` leading is a size committed twice — it stops tracking the type when the
   * size changes, which is how a page drifts back into unreadable.
   */
  it('never sets an absolute line-height', () => {
    for (const file of FILES) {
      for (const value of lineHeightsOf(cssOf(file))) {
        const relative = value.startsWith('var(--lh-') || /^\d*\.?\d+$/.test(value) || value === 'normal';
        expect(relative, `${file}: line-height: ${value} must be a token, a multiplier, or normal`).toBe(true);
      }
    }
  });

  it('declares the leading scale exactly once, in sheet.css only', () => {
    expect([...cssOf('sheet.css').matchAll(/--lh-[a-z]+:/g)]).toHaveLength(3);
    for (const file of FILES.filter((name) => name !== 'sheet.css')) {
      expect(cssOf(file), `${file} must not define a leading token`).not.toMatch(/--lh-[a-z]+:/);
    }
  });
});
