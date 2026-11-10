import { describe, expect, it } from 'vitest';
import { cssOf, isOpaque, px, showPaper } from './support.tsx';

/**
 * The boxes the paper is made of — rails, the edited strip, the health strip,
 * the sticky section label — computed in real Edge. See `support.tsx`.
 * `design-contract.test.tsx` is the type and the front page.
 */

describe('the boxes', () => {
  it('pads every panel and boxes it with an inset ring, never a card', () => {
    showPaper();
    for (const selector of ["[data-part='rail']", "[data-part='edited']", "[data-part='health']"]) {
      const box = cssOf(selector);
      expect(px(box.paddingLeft), `${selector} is flush to its rule`).toBeGreaterThanOrEqual(16);
      expect(px(box.paddingBottom), `${selector} is flush to its rule`).toBeGreaterThanOrEqual(16);
      expect(box.boxShadow, `${selector} has no ring`).toContain('inset');
      expect(box.borderRadius, `${selector} is a card`).toBe('0px');
    }
  });

  it('draws the crossings on the stock and the dot grid on a panel, from one recipe', () => {
    showPaper();
    expect(globalThis.getComputedStyle(document.body).backgroundImage).toContain('repeating-linear-gradient');
    expect(cssOf("[data-part='edited']").backgroundImage).toContain('radial-gradient');
  });

  /*
   * The **waste area**: the air outside the sheet's box, and the only place a
   * mark that lives outside the box can be seen. Two failures, both measured
   * before `base.css` gave `body` its padding, and both invisible in the markup:
   *
   *  - the visible stock was **0 px² at 390, 620, 1024 and 1440**. The sheet is
   *    `max-w-[104rem]` = 1 664 px, so below that it is full-bleed and its own
   *    `bg-paper` covers the crossings completely. They appeared only past
   *    1 664 CSS px — which is why they show at 75% zoom on a 2 560 px screen and
   *    nowhere at 100%;
   *  - the crop marks, drawn `--mark-offset` (7px) **outside** the box, hung 6px
   *    past the viewport's right edge, so every width had a horizontal
   *    scrollbar: `scrollWidth - innerWidth = 6` at 390, 620, 1024 and 1440, and
   *    removing the `cropmarks` utility alone took it back to 0.
   *
   * What is computable **here** is the mark itself. The body's air is not:
   * `@vitest/browser` injects an unlayered `body { padding: 0 }` into the tester
   * iframe (`dist/index.js:3460`), and unlayered CSS beats every layer — so the
   * app's `@layer base` rule loses to the harness in this frame and wins on the
   * real page. The air, the sideways-scroll verdict and the visible stock are
   * therefore printed by `pnpm shots`, which drives the real app in real Edge.
   */
  it('draws the crop marks outside the sheet, at the size and offset the tokens name', () => {
    showPaper();
    const root = globalThis.getComputedStyle(document.documentElement);
    const need = px(root.getPropertyValue('--mark-offset'));
    expect(need, '--mark-offset is not a length').toBeGreaterThan(0);
    // Pseudo-elements are not nodes, so the mark is read as the cascade computes
    // it: `--mark-size` on a side, sitting `--mark-offset` outside the box. A
    // sheet that stops printing its ticks reads as `content: none` here.
    const tick = cssOf("[data-part='sheet']", '::before');
    expect(px(tick.width), 'the sheet prints no crop mark on screen').toBe(px(root.getPropertyValue('--mark-size')));
    expect(px(tick.insetInlineStart), 'the crop mark is not drawn outside the box').toBe(-need);
    const tail = cssOf("[data-part='sheet']", '::after');
    expect(px(tail.insetInlineEnd), 'the bottom-right mark is not drawn outside the box').toBe(-need);
  });

  it('makes a sticky label opaque, so the copy scrolling under it does not show through', () => {
    showPaper();
    const head = cssOf("[data-part='section'] [data-part='block-head']");
    expect(head.position).toBe('sticky');
    expect(isOpaque(head.backgroundColor), `bg-paper computes ${head.backgroundColor}`).toBe(true);
    expect(head.boxShadow).not.toBe('none');
  });

  it('prints the hooks the print rules target, and the sheet on top of the stock', () => {
    showPaper();
    // `@media print` is not reachable from a screen viewport, so the print rules
    // are pinned where they are honest: base.css targets these hooks, and they
    // exist on a real page. The claim is the selector, not the viewport.
    expect(document.querySelectorAll("[data-part='columns']").length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-part='headline'] a").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-part='theme-switch']")).not.toBeNull();
    expect(isOpaque(cssOf("[data-part='sheet']").backgroundColor), 'the sheet is a solid panel').toBe(true);
  });
});
